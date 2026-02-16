const DEFAULT_APP_NAME = 'LumiR'

export function useAppName() {
  const appName = useState<string>('app-name', () => DEFAULT_APP_NAME)
  const fetched = useState<boolean>('app-name-fetched', () => false)

  // Fetch from public settings (no auth needed) on first call
  if (import.meta.client && !fetched.value) {
    fetched.value = true
    const trpc = useTrpc()
    trpc.settings.getPublic.query().then((data) => {
      if (data.appName && typeof data.appName === 'string') {
        appName.value = data.appName
      }
    }).catch(() => {})
  }

  return { appName, DEFAULT_APP_NAME }
}
