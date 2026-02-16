import { db } from '../../db'
import { settings } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { execSync } from 'child_process'
import { mkdirSync, createWriteStream, existsSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const role = (session?.user as any)?.role
  if (role !== 'admin' && role !== 'super_admin') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody(event)
  const downloadUrl = body?.downloadUrl as string

  if (!downloadUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Missing downloadUrl' })
  }

  // Get GitHub token from DB
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

    // Use unzip on Linux, tar on Windows
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`)
    } else {
      execSync(`unzip -o "${zipPath}" -d "${tempDir}"`)
    }

    // 3. Atomic swap: old → .output.old, new → .output
    const outputDir = join(appDir, '.output')
    const oldOutputDir = join(appDir, '.output.old')

    // Clean up previous old backup
    if (existsSync(oldOutputDir)) {
      rmSync(oldOutputDir, { recursive: true, force: true })
    }

    // Move current output to old
    if (existsSync(outputDir)) {
      renameSync(outputDir, oldOutputDir)
    }

    // Move new output into place
    const newOutputDir = join(tempDir, '.output')
    if (existsSync(newOutputDir)) {
      renameSync(newOutputDir, outputDir)
    } else {
      // If the zip contents are flat (no .output wrapper), move the temp dir itself
      renameSync(tempDir, outputDir)
    }

    // 4. Cleanup
    if (existsSync(zipPath)) rmSync(zipPath, { force: true })
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    if (existsSync(oldOutputDir)) rmSync(oldOutputDir, { recursive: true, force: true })

    // 5. Restart - try pm2 first, then systemd, then just exit and let the process manager restart
    try {
      execSync('pm2 restart all', { timeout: 5000 })
    } catch {
      try {
        execSync('systemctl restart lumir', { timeout: 5000 })
      } catch {
        // Last resort: exit the process, assuming a process manager will restart it
        setTimeout(() => process.exit(0), 1000)
      }
    }

    return { success: true, message: 'Update applied, restarting...' }
  } catch (err) {
    // Cleanup on failure
    if (existsSync(zipPath)) rmSync(zipPath, { force: true })
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })

    throw createError({
      statusCode: 500,
      statusMessage: `Update failed: ${(err as Error).message}`,
    })
  }
})
