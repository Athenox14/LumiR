export type ServerLogEntry = {
  level: 'error' | 'warn' | 'log'
  message: string
  timestamp: string
}

const MAX_ENTRIES = 100

// Module-level singleton — persists for the lifetime of the Node.js process
export const serverLogs: ServerLogEntry[] = []

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`
      if (typeof a === 'object' && a !== null) {
        try { return JSON.stringify(a) }
        catch { return String(a) }
      }
      return String(a)
    })
    .join(' ')
}

function push(level: ServerLogEntry['level'], args: unknown[]) {
  serverLogs.push({ level, message: formatArgs(args), timestamp: new Date().toISOString() })
  if (serverLogs.length > MAX_ENTRIES) serverLogs.shift()
}

let interceptSetup = false

export function setupServerLogging() {
  if (interceptSetup) return
  interceptSetup = true

  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  const origLog = console.log.bind(console)

  console.error = (...args: unknown[]) => { push('error', args); origError(...args) }
  console.warn = (...args: unknown[]) => { push('warn', args); origWarn(...args) }
  console.log = (...args: unknown[]) => { push('log', args); origLog(...args) }
}
