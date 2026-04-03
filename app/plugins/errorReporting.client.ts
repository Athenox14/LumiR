import { getClientInfo } from '~/composables/useBugReport'

const AUTO_REPORT_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes
const reportedErrorKeys = new Set<string>()
let lastAutoReportAt = 0

export default defineNuxtPlugin((nuxtApp) => {
  const trpc = useNuxtApp().$trpc

  async function autoReport(error: Error | string, context: string) {
    const now = Date.now()
    if (now - lastAutoReportAt < AUTO_REPORT_COOLDOWN_MS) return

    const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 150)

    // Deduplicate — same error message within the cooldown window
    if (reportedErrorKeys.has(errorMessage)) return
    reportedErrorKeys.add(errorMessage)
    setTimeout(() => reportedErrorKeys.delete(errorMessage), AUTO_REPORT_COOLDOWN_MS)

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
        clientInfo: getClientInfo(),
      })
    }
    catch {
      // Fail silently — must not create infinite error loops
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
