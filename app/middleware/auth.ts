export default defineNuxtRouteMiddleware(async (to, from) => {
  const { loggedIn } = useUserSession()

  // Redirect to login if not authenticated
  if (!loggedIn.value) {
    return navigateTo('/login')
  }
})
