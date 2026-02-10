export default defineNuxtRouteMiddleware(async (to, from) => {
  const { loggedIn } = useUserSession()

  // Redirect to home if already authenticated
  if (loggedIn.value) {
    return navigateTo('/')
  }
})
