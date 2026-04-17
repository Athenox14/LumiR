export default defineNuxtPlugin(() => {
  const { $trpc } = useNuxtApp()
  const route = useRoute()
  const sessionKey = 'pipouflix:analytics-session'

  function getDeviceType() {
    if (window.matchMedia('(min-width: 1280px)').matches) return 'desktop'
    if (window.matchMedia('(min-width: 768px)').matches) return 'tablet'
    return 'mobile'
  }

  function readSession() {
    const raw = sessionStorage.getItem(sessionKey)
    if (!raw) return null
    try {
      return JSON.parse(raw) as {
        startedAt: string
        lastPath: string | null
        lastSeenAt: string | null
      }
    } catch {
      return null
    }
  }

  function writeSession(data: { startedAt: string, lastPath: string | null, lastSeenAt: string | null }) {
    sessionStorage.setItem(sessionKey, JSON.stringify(data))
  }

  function buildPageMetadata(path: string) {
    const now = new Date()
    const previous = readSession()
    const sessionGapMs = previous?.lastSeenAt ? (now.getTime() - new Date(previous.lastSeenAt).getTime()) : null
    const sessionExpired = sessionGapMs == null || sessionGapMs > 30 * 60 * 1000
    const nextSession = sessionExpired
      ? { startedAt: now.toISOString(), lastPath: path, lastSeenAt: now.toISOString() }
      : { startedAt: previous!.startedAt, lastPath: path, lastSeenAt: now.toISOString() }

    writeSession(nextSession)

    return {
      path,
      from: previous?.lastPath || null,
      clientAt: now.toISOString(),
      hour: now.getHours(),
      weekday: now.getDay(),
      deviceType: getDeviceType(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenRatio: `${window.screen.width}x${window.screen.height}`,
      sessionStart: sessionExpired,
      lastSessionGapMs: sessionGapMs,
    }
  }

  function trackPageView(path: string) {
    $trpc.analytics.logEvent.mutate({
      type: 'PAGE_VIEW',
      metadata: buildPageMetadata(path),
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
