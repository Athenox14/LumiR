import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { triggerAutoScan } from '../trpc/routers/library'

let scanTimer: ReturnType<typeof setInterval> | null = null

async function getAutoScanSettings() {
  const [enabledSetting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'autoScanEnabled'))
    .limit(1)

  const [intervalSetting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'scanInterval'))
    .limit(1)

  const enabled = enabledSetting?.value === true || enabledSetting?.value === 'true'
  const intervalHours = Number(intervalSetting?.value) || 24

  return { enabled, intervalHours }
}

async function setupAutoScan() {
  // Clear previous timer
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }

  const { enabled, intervalHours } = await getAutoScanSettings()

  if (!enabled) {
    console.log('[AutoScan] Auto-scan is disabled')
    return
  }

  const intervalMs = intervalHours * 60 * 60 * 1000
  console.log(`[AutoScan] Scheduling auto-scan every ${intervalHours}h`)

  scanTimer = setInterval(async () => {
    try {
      // Re-check settings each time (user may have disabled it)
      const current = await getAutoScanSettings()
      if (!current.enabled) {
        console.log('[AutoScan] Auto-scan was disabled, stopping scheduler')
        if (scanTimer) {
          clearInterval(scanTimer)
          scanTimer = null
        }
        return
      }
      await triggerAutoScan()
    } catch (e) {
      console.error('[AutoScan] Scheduled scan error:', e)
    }
  }, intervalMs)
}

export default defineNitroPlugin(() => {
  // Wait a bit for DB to be fully ready, then setup auto-scan
  setTimeout(() => {
    setupAutoScan().catch(console.error)
  }, 5000)
})
