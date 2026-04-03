import { pushLog, getClientInfo, bugReportLogs } from '~/composables/useBugReport'

const AUTO_REPORT_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes
const reportedErrorKeys = new Set<string>()
let lastAutoReportAt = 0
let interceptSetup = false

function setupConsoleInterception() {
  if (interceptSetup) return
  interceptSetup = true

  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)

  console.error = (...args: unknown[]) => {
    pushLog('error', args)
    origError(...args)
  }

  console.warn = (...args: unknown[]) => {
    pushLog('warn', args)
    origWarn(...args)
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  setupConsoleInterception()

  const trpc = useNuxtApp().$trpc

  async function autoReport(error: Error | string, context: string) {
    const now = Date.now()
    if (now - lastAutoReportAt < AUTO_REPORT_COOLDOWN_MS) return

    const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 150)
    const errorKey = errorMessage

    if (reportedErrorKeys.has(errorKey)) return
    reportedErrorKeys.add(errorKey)
    setTimeout(() => reportedErrorKeys.delete(errorKey), AUTO_REPORT_COOLDOWN_MS)

    try {
      const { enabled } = await trpc.bugReport.isEnabled.query()
      if (!enabled) return

      lastAutoReportAt = now

      await trpc.bugReport.submit.mutate({
        title: errorMessage,
        description: context,
        page: window.location.href,
        errorStack: error instanceof Error && error.stack ? error.stack : undefined,
        automatic: true,
        logs: [...bugReportLogs],
        clientInfo: getClientInfo(),
      })
    }
    catch {
      // Fail silently — we must not create infinite error loops
    }
  }

  // Vue component errors
  nuxtApp.vueApp.config.errorHandler = (error, _instance, info) => {
    const err = error instanceof Error ? error : new Error(String(error))
    autoReport(err, `Vue error — lifecycle hook / handler: ${info}`)
  }

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason instanceof Error
      ? event.reason
      : new Error(String(event.reason ?? 'Unhandled rejection'))
    autoReport(err, 'Unhandled promise rejection')
  })

  // Global JS errors (outside Vue)
  window.addEventListener('error', (event) => {
    if (event.error instanceof Error) {
      autoReport(event.error, `Uncaught error at ${event.filename}:${event.lineno}:${event.colno}`)
    }
  })
})
