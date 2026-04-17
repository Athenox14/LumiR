export const useAnalytics = () => {
  const { $trpc } = useNuxtApp()
  
  /**
   * Log an event to the server.
   * type: 'HOVER', 'SEARCH', 'WATCH_PROGRESS', 'PAGE_VIEW', etc.
   */
  const track = (type: string, mediaId?: string | null, metadata?: Record<string, any>) => {
    $trpc.analytics.logEvent.mutate({
      type,
      mediaId,
      metadata,
    }).catch(console.error)
  }

  return { track }
}
