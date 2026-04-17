export default defineNuxtPlugin(() => {
  const { $trpc } = useNuxtApp()
  const route = useRoute()

  function trackPageView(path: string) {
    $trpc.analytics.logEvent.mutate({
      type: 'PAGE_VIEW',
      metadata: { path },
    }).catch(() => {})
  }

  let lastTrackedPath = ''

  watch(
    () => route.fullPath,
    (path) => {
      if (!path || path === lastTrackedPath) return
      lastTrackedPath = path
      trackPageView(path)
    },
    { immediate: true }
  )
})
