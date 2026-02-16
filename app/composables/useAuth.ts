interface User {
  id: string
  email: string
  username?: string | null
  displayName: string
  role: 'super_admin' | 'admin' | 'user'
  permissions?: string[] | null
  avatarUrl?: string | null
  bio?: string | null
  isProfilePublic?: boolean
  showWatchedFilms?: boolean
  showLikedFilms?: boolean
  favoriteActorId?: number | null
  favoriteActorName?: string | null
  favoriteActorImage?: string | null
}

export function useAuth() {
  const { loggedIn, user: sessionUser, fetch: fetchSession, clear } = useUserSession()
  const trpc = useTrpc()
  const loading = useState<boolean>('auth-loading', () => false)

  // Computed user from session
  const user = computed<User | null>(() => {
    if (!sessionUser.value) return null
    return sessionUser.value as User
  })

  async function login(identifier: string, password: string) {
    loading.value = true
    try {
      const result = await trpc.auth.login.mutate({ identifier, password })
      await fetchSession() // Refresh session after login
      return result
    } finally {
      loading.value = false
    }
  }

  async function register(email: string, password: string, displayName: string) {
    loading.value = true
    try {
      const result = await trpc.auth.register.mutate({ email, password, displayName })
      await fetchSession() // Refresh session after register
      return result
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    await trpc.auth.logout.mutate()
    await clear() // Clear local session
    await navigateTo('/login')
  }

  async function updateProfile(data: {
    displayName?: string
    username?: string | null
    currentPassword?: string
    newPassword?: string
    bio?: string
    isProfilePublic?: boolean
    showWatchedFilms?: boolean
    showLikedFilms?: boolean
    favoriteActorId?: number | null
    favoriteActorName?: string | null
    favoriteActorImage?: string | null
  }) {
    await trpc.auth.updateProfile.mutate(data)
    await fetchSession() // Refresh session to get updated user data
  }

  const isAuthenticated = computed(() => loggedIn.value)
  const isAdmin = computed(() => user.value?.role === 'admin' || user.value?.role === 'super_admin')
  const isSuperAdmin = computed(() => user.value?.role === 'super_admin')

  return {
    user,
    loading,
    isAuthenticated,
    isAdmin,
    isSuperAdmin,
    fetchUser: fetchSession,
    login,
    register,
    logout,
    updateProfile,
  }
}
