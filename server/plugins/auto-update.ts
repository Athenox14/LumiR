import { readFileSync } from 'fs'
import { join } from 'path'
import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getActiveUserCount } from '../utils/activityTracker'
import { execSync } from 'child_process'
import { mkdirSync, createWriteStream, writeFileSync, existsSync, renameSync, rmSync } from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

interface UpdateInfo {
  latestVersion: string
  downloadUrl: string | null
  hasUpdate: boolean
}

let pendingUpdate: UpdateInfo | null = null
let checkTimer: ReturnType<typeof setInterval> | null = null

/**
 * Fetch the latest release info from GitHub (same logic as check-update.get.ts).
 */
async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const [repoSetting] = await db.select().from(settings).where(eq(settings.key, 'githubRepo')).limit(1)
    const [tokenSetting] = await db.select().from(settings).where(eq(settings.key, 'githubToken')).limit(1)

    const repo = repoSetting?.value as string
    const token = tokenSetting?.value as string

    if (!repo) {
      console.log('[AutoUpdate] GitHub repo not configured, skipping update check')
      return null
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LumiR-Updater',
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers })
    if (!response.ok) {
      console.error(`[AutoUpdate] GitHub API error: ${response.status}`)
      return null
    }

    const release = await response.json() as {
      tag_name: string
      assets: Array<{ name: string; url: string; browser_download_url: string; size: number }>
    }

    // Current version
    let currentVersion = 'dev'
    for (const base of [process.cwd(), join(process.cwd(), '.output')]) {
      try {
        currentVersion = readFileSync(join(base, 'BUILD_VERSION'), 'utf-8').trim()
        break
      } catch {}
    }

    const hasUpdate = currentVersion !== release.tag_name && currentVersion !== 'dev'
    const asset = release.assets.find(a => a.name.endsWith('.zip'))

    const downloadUrl = token && asset?.url
      ? asset.url
      : asset?.browser_download_url || null

    return { latestVersion: release.tag_name, downloadUrl, hasUpdate }
  } catch (e) {
    console.error('[AutoUpdate] Check failed:', (e as Error).message)
    return null
  }
}

/**
 * Install the update (same mechanism as update.post.ts).
 */
async function installUpdate(downloadUrl: string, version: string): Promise<boolean> {
  const [tokenSetting] = await db.select().from(settings).where(eq(settings.key, 'githubToken')).limit(1)
  const token = tokenSetting?.value as string

  const appDir = process.cwd()
  const tempDir = join(appDir, `.update-${Date.now()}`)
  const zipPath = join(appDir, '.update.zip')

  try {
    // 1. Download the zip
    const headers: Record<string, string> = {
      Accept: 'application/octet-stream',
      'User-Agent': 'LumiR-Updater',
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(downloadUrl, { headers })
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status}`)
    }

    const fileStream = createWriteStream(zipPath)
    await pipeline(Readable.fromWeb(response.body as any), fileStream)

    // 2. Unzip to temp directory
    mkdirSync(tempDir, { recursive: true })

    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`)
    } else {
      execSync(`unzip -o "${zipPath}" -d "${tempDir}"`)
    }

    // 3. Atomic swap: old -> .output.old, new -> .output
    const outputDir = join(appDir, '.output')
    const oldOutputDir = join(appDir, '.output.old')

    if (existsSync(oldOutputDir)) {
      rmSync(oldOutputDir, { recursive: true, force: true })
    }

    if (existsSync(outputDir)) {
      renameSync(outputDir, oldOutputDir)
    }

    const newOutputDir = join(tempDir, '.output')
    if (existsSync(newOutputDir)) {
      renameSync(newOutputDir, outputDir)
    } else {
      renameSync(tempDir, outputDir)
    }

    // 4. Write BUILD_VERSION
    if (version) {
      writeFileSync(join(appDir, 'BUILD_VERSION'), version + '\n', 'utf-8')
    }

    // 5. Cleanup
    if (existsSync(zipPath)) rmSync(zipPath, { force: true })
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    if (existsSync(oldOutputDir)) rmSync(oldOutputDir, { recursive: true, force: true })

    // 6. Restart
    try {
      execSync('pm2 restart all', { timeout: 5000 })
    } catch {
      try {
        execSync('systemctl restart lumir', { timeout: 5000 })
      } catch {
        setTimeout(() => process.exit(0), 1000)
      }
    }

    return true
  } catch (e) {
    console.error('[AutoUpdate] Install failed:', (e as Error).message)
    // Cleanup on failure
    if (existsSync(zipPath)) rmSync(zipPath, { force: true })
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    return false
  }
}

/**
 * Try to auto-install if there's a pending update and no active users.
 */
async function tryAutoInstall() {
  if (!pendingUpdate || !pendingUpdate.hasUpdate || !pendingUpdate.downloadUrl) return

  const activeUsers = getActiveUserCount()
  if (activeUsers > 0) {
    console.log(`[AutoUpdate] Update ${pendingUpdate.latestVersion} available but ${activeUsers} user(s) active, deferring`)
    return
  }

  console.log(`[AutoUpdate] No active users, installing update ${pendingUpdate.latestVersion}...`)
  const success = await installUpdate(pendingUpdate.downloadUrl, pendingUpdate.latestVersion)
  if (success) {
    console.log('[AutoUpdate] Update installed successfully, restarting...')
    pendingUpdate = null
  }
}

/**
 * Periodic check: look for updates and auto-install when the platform is empty.
 */
async function periodicCheck() {
  const updateInfo = await checkForUpdate()
  if (updateInfo?.hasUpdate) {
    pendingUpdate = updateInfo
    console.log(`[AutoUpdate] Update available: ${updateInfo.latestVersion}`)
    await tryAutoInstall()
  } else {
    pendingUpdate = null
  }
}

export default defineNitroPlugin(() => {
  // Initial check on server startup (wait for DB to be ready)
  setTimeout(async () => {
    try {
      console.log('[AutoUpdate] Running startup update check...')
      await periodicCheck()
    } catch (e) {
      console.error('[AutoUpdate] Startup check error:', e)
    }
  }, 10000) // 10s delay to let DB initialize

  // Periodic check every 5 minutes
  checkTimer = setInterval(async () => {
    try {
      await periodicCheck()
    } catch (e) {
      console.error('[AutoUpdate] Periodic check error:', e)
    }
  }, CHECK_INTERVAL_MS)
})
