export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, user } = useUserSession()

  // Redirect to login if not authenticated
  if (!loggedIn.value) {
    return navigateTo('/login')
  }

  // Redirect to home if not admin
  const role = (user.value as any)?.role
  if (role !== 'admin' && role !== 'super_admin') {
    return navigateTo('/')
  }
})
