import { readFileSync } from 'fs'
import { join } from 'path'
import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getActiveUserCount } from '../utils/activityTracker'
import { fetchLatestRelease, getReleaseZipAsset } from '../utils/releases'
import { installRelease } from '../utils/updateInstaller'

const CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

interface UpdateInfo {
  latestVersion: string
  downloadUrl: string | null
  hasUpdate: boolean
}

let pendingUpdate: UpdateInfo | null = null
let _checkTimer: ReturnType<typeof setInterval> | null = null

async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const [enabledSetting] = await db.select().from(settings).where(eq(settings.key, 'autoUpdateEnabled')).limit(1)
    const enabled = enabledSetting?.value === true || enabledSetting?.value === 'true'

    if (!enabled) {
      console.log('[AutoUpdate] Automatic updates disabled, skipping update check')
      return null
    }

    const release = await fetchLatestRelease()

    let currentVersion = 'dev'
    for (const base of [process.cwd(), join(process.cwd(), '.output')]) {
      try {
        currentVersion = readFileSync(join(base, 'BUILD_VERSION'), 'utf-8').trim()
        break
      } catch {}
    }

    const hasUpdate = currentVersion !== release.tag_name && currentVersion !== 'dev'
    const asset = getReleaseZipAsset(release)
    const downloadUrl = asset?.browser_download_url || null

    return { latestVersion: release.tag_name, downloadUrl, hasUpdate }
  } catch (e) {
    console.error('[AutoUpdate] Check failed:', (e as Error).message)
    return null
  }
}

async function installUpdate(downloadUrl: string, version: string): Promise<boolean> {
  try {
    await installRelease(downloadUrl, version)
    return true
  } catch (e) {
    console.error('[AutoUpdate] Install failed:', (e as Error).message)
    return false
  }
}

async function tryAutoInstall() {
  if (!pendingUpdate || !pendingUpdate.hasUpdate || !pendingUpdate.downloadUrl) return

  const activeUsers = getActiveUserCount({ consumeSkip: true })
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
  setTimeout(async () => {
    try {
      console.log('[AutoUpdate] Running startup update check...')
      await periodicCheck()
    } catch (e) {
      console.error('[AutoUpdate] Startup check error:', e)
    }
  }, 10000)

  _checkTimer = setInterval(async () => {
    try {
      await periodicCheck()
    } catch (e) {
      console.error('[AutoUpdate] Periodic check error:', e)
    }
  }, CHECK_INTERVAL_MS)
})
