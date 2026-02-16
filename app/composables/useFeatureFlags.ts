export function useFeatureFlags() {
  const trpc = useTrpc()

  const catalogEnabled = useState<boolean>('flag-catalog', () => true)
  const downloadsEnabled = useState<boolean>('flag-downloads', () => true)
  const registrationEnabled = useState<boolean>('flag-registration', () => true)
  const loaded = useState<boolean>('flag-loaded', () => false)

  if (import.meta.client && !loaded.value) {
    trpc.settings.getPublic.query().then((data) => {
      catalogEnabled.value = data.catalogEnabled
      downloadsEnabled.value = data.downloadsEnabled
      registrationEnabled.value = data.registrationEnabled
      loaded.value = true
    }).catch(() => {})
  }

  return {
    catalogEnabled,
    downloadsEnabled,
    registrationEnabled,
    loaded,
  }
}
