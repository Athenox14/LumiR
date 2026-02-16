<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const { t } = useI18n()
const route = useRoute()
const trpc = useTrpc()
const { user: currentUser } = useAuth()

const userId = computed(() => route.params.id as string)
const isOwnProfile = computed(() => currentUser.value?.id === userId.value)

const { data: profile, error: profileError, refresh: refreshProfile } = useAsyncData(
  `public-profile-${userId.value}`,
  () => trpc.users.getPublicProfile.query({ userId: userId.value })
)

const { data: stats } = useAsyncData(
  `user-stats-${userId.value}`,
  () => trpc.users.getUserStats.query({ userId: userId.value }),
  { lazy: true }
)

const { data: watchedFilms } = useAsyncData(
  `user-watched-${userId.value}`,
  async () => {
    if (!profile.value?.showWatchedFilms) return null
    const films = await trpc.users.getWatchedFilms.query({ userId: userId.value, limit: 30 })
    return films.length > 0 ? films : null
  },
  { lazy: true, watch: [profile] }
)

const { data: likedFilms } = useAsyncData(
  `user-liked-${userId.value}`,
  async () => {
    if (!profile.value?.showLikedFilms) return null
    const films = await trpc.users.getLikedFilms.query({ userId: userId.value, limit: 30 })
    return films.length > 0 ? films : null
  },
  { lazy: true, watch: [profile] }
)

// Force fresh data on client-side navigation (avoid stale cache after profile edits)
onMounted(() => {
  refreshProfile()
})
</script>

<template>
  <div class="min-h-screen">
    <!-- Error / Private -->
    <div v-if="profileError" class="p-6 text-center py-20">
      <div class="w-16 h-16 rounded-full bg-surface flex items-center justify-center mx-auto mb-4">
        <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p class="text-text-secondary">{{ t('user.privateProfile') }}</p>
      <NuxtLink to="/" class="text-primary hover:underline mt-4 inline-block">
        {{ t('user.backToHome') }}
      </NuxtLink>
    </div>

    <!-- Profile -->
    <div v-else-if="profile" class="max-w-4xl mx-auto p-6">
      <!-- Private profile notice -->
      <div v-if="isOwnProfile && !profile.isProfilePublic" class="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center gap-3">
        <svg class="w-5 h-5 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <p class="text-sm text-yellow-500">{{ t('user.privateNotice') }}</p>
      </div>

      <!-- Header -->
      <div class="flex items-start gap-6 mb-8">
        <div class="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden bg-surface flex-shrink-0 ring-4 ring-primary/20">
          <img
            v-if="profile.favoriteActorImage || profile.avatarUrl"
            :src="profile.favoriteActorImage || profile.avatarUrl"
            :alt="profile.displayName"
            class="w-full h-full object-cover"
          >
          <div v-else class="w-full h-full flex items-center justify-center bg-primary/10">
            <span class="text-3xl md:text-4xl font-bold text-primary">
              {{ profile.displayName?.charAt(0).toUpperCase() }}
            </span>
          </div>
        </div>

        <div class="flex-1 min-w-0">
          <h1 class="text-2xl md:text-3xl font-bold text-text-primary">{{ profile.displayName }}</h1>
          <p v-if="profile.favoriteActorName" class="text-sm text-text-muted mt-1">
            {{ t('profile.favoriteActor', { name: profile.favoriteActorName }) }}
          </p>
          <p v-if="profile.bio" class="text-text-secondary mt-3 max-w-lg">{{ profile.bio }}</p>

          <NuxtLink
            v-if="isOwnProfile"
            to="/profile"
            class="inline-flex items-center gap-1.5 mt-3 text-sm text-primary hover:underline"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            {{ t('user.editProfile') }}
          </NuxtLink>
        </div>
      </div>

      <!-- Stats -->
      <div v-if="stats && profile.isProfilePublic" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div class="p-4 bg-surface border border-border rounded-xl text-center">
          <p class="text-2xl font-bold text-text-primary">{{ stats.totalWatched }}</p>
          <p class="text-sm text-text-muted">{{ t('profile.totalWatched') }}</p>
        </div>
        <div class="p-4 bg-surface border border-border rounded-xl text-center">
          <p class="text-2xl font-bold text-text-primary">{{ stats.totalHours }}h</p>
          <p class="text-sm text-text-muted">{{ t('profile.totalHours') }}</p>
        </div>
        <div class="p-4 bg-surface border border-border rounded-xl text-center">
          <p class="text-2xl font-bold text-text-primary">{{ stats.completionRate }}%</p>
          <p class="text-sm text-text-muted">{{ t('profile.completionRate') }}</p>
        </div>
        <div class="p-4 bg-surface border border-border rounded-xl text-center">
          <p class="text-sm font-medium text-text-primary">{{ stats.topGenres?.slice(0, 3).join(', ') || '-' }}</p>
          <p class="text-sm text-text-muted mt-1">{{ t('profile.topGenres') }}</p>
        </div>
      </div>

      <!-- Liked films -->
      <div v-if="likedFilms?.length" class="mb-8">
        <h2 class="text-xl font-semibold text-text-primary mb-4">{{ t('user.likedFilms') }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <NuxtLink
            v-for="film in likedFilms"
            :key="film.id"
            :to="`/media/${film.id}`"
            class="group block"
          >
            <div class="aspect-[2/3] rounded-xl overflow-hidden bg-surface">
              <img
                v-if="film.posterPath"
                :src="film.posterPath"
                :alt="film.title"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              >
              <div v-else class="w-full h-full flex items-center justify-center">
                <span class="text-text-muted text-sm">{{ t('common.noPoster') }}</span>
              </div>
            </div>
            <div class="mt-2 px-1">
              <p class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">{{ film.title }}</p>
              <p v-if="film.year" class="text-xs text-text-muted">{{ film.year }}</p>
            </div>
          </NuxtLink>
        </div>
      </div>

      <!-- Watched films -->
      <div v-if="watchedFilms?.length">
        <h2 class="text-xl font-semibold text-text-primary mb-4">{{ t('user.watchedFilms') }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <NuxtLink
            v-for="film in watchedFilms"
            :key="film.id"
            :to="`/media/${film.id}`"
            class="group block"
          >
            <div class="aspect-[2/3] rounded-xl overflow-hidden bg-surface">
              <img
                v-if="film.posterPath"
                :src="film.posterPath"
                :alt="film.title"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              >
              <div v-else class="w-full h-full flex items-center justify-center">
                <span class="text-text-muted text-sm">{{ t('common.noPoster') }}</span>
              </div>
            </div>
            <div class="mt-2 px-1">
              <p class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">{{ film.title }}</p>
              <p v-if="film.year" class="text-xs text-text-muted">{{ film.year }}</p>
            </div>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
