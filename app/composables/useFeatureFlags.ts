export function useFeatureFlags() {
  const trpc = useTrpc()

  const registrationEnabled = useState<boolean>('flag-registration', () => true)
  const loaded = useState<boolean>('flag-loaded', () => false)

  if (import.meta.client && !loaded.value) {
    trpc.settings.getPublic.query().then((data) => {
      registrationEnabled.value = data.registrationEnabled
      loaded.value = true
    }).catch(() => {})
  }

  return {
    registrationEnabled,
    loaded,
  }
}
