const DEFAULT_APP_NAME = 'LumiR'

export function useAppName() {
  const appName = useState<string>('app-name', () => DEFAULT_APP_NAME)

  // Fetch from settings on first call (client-side)
  if (import.meta.client && appName.value === DEFAULT_APP_NAME) {
    const trpc = useTrpc()
    trpc.settings.get.query('appName').then((val) => {
      if (val && typeof val === 'string') {
        appName.value = val
      }
    }).catch(() => {})
  }

  return { appName, DEFAULT_APP_NAME }
}
