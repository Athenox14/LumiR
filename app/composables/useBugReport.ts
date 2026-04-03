export type LogEntry = {
  level: 'error' | 'warn'
  message: string
  timestamp: string
}

export type ClientInfo = {
  userAgent: string
  viewport: string
  screen: string
  language: string
  onLine: boolean
}

const MAX_LOG_ENTRIES = 50

// Module-level singleton shared across all composable calls
export const bugReportLogs: LogEntry[] = []

function formatArg(a: unknown): string {
  if (a instanceof Error) {
    return a.stack ? a.stack : `${a.name}: ${a.message}`
  }
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a) }
    catch { return String(a) }
  }
  return String(a)
}

export function pushLog(level: 'error' | 'warn', args: unknown[]) {
  bugReportLogs.push({
    level,
    message: args.map(formatArg).join(' '),
    timestamp: new Date().toISOString(),
  })
  if (bugReportLogs.length > MAX_LOG_ENTRIES) bugReportLogs.shift()
}

export function getClientInfo(): ClientInfo | undefined {
  if (import.meta.server) return undefined
  return {
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    onLine: navigator.onLine,
  }
}

export function useBugReport() {
  const trpc = useTrpc()

  async function submitReport(data: {
    title: string
    description: string
    page?: string
    errorStack?: string
    automatic?: boolean
  }) {
    return trpc.bugReport.submit.mutate({
      ...data,
      logs: [...bugReportLogs],
      clientInfo: getClientInfo(),
    })
  }

  return { submitReport, logs: bugReportLogs }
}
