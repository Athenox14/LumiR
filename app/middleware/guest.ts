export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn } = useUserSession()

  // Redirect to home if already authenticated
  if (loggedIn.value) {
    return navigateTo('/')
  }
})
