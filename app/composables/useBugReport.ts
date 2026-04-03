export type ClientInfo = {
  userAgent: string
  viewport: string
  screen: string
  language: string
  onLine: boolean
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
      clientInfo: getClientInfo(),
    })
  }

  return { submitReport }
}
