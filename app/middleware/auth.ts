export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn } = useUserSession()

  // Redirect to login if not authenticated
  if (!loggedIn.value) {
    return navigateTo('/login')
  }
})
