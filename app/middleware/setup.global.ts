export default defineNuxtRouteMiddleware(async (to) => {
  const needsSetup = useState<boolean | null>('needs-setup', () => null)

  if (needsSetup.value === null) {
    try {
      const response = await $fetch<{ needsSetup: boolean }>('/api/setup-status')
      needsSetup.value = response.needsSetup
    } catch {
      // If the check fails, do not block routing.
      needsSetup.value = false
    }
  }

  if (needsSetup.value) {
    if (to.path !== '/setup') {
      return navigateTo('/setup')
    }
    return
  }

  if (to.path === '/setup') {
    return navigateTo('/login')
  }
})
