<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const trpc = useTrpc()
const { user } = useAuth()
const { t } = useI18n()

useHead({ title: computed(() => t('nav.home')) })

// Fetch data
const { data: continueWatching, pending: continueLoading } = useAsyncData(
  'continue-watching',
  () => trpc.media.continueWatching.query({ limit: 10 })
)

const { data: recentlyAdded, pending: recentLoading } = useAsyncData(
  'recently-added',
  () => trpc.media.recentlyAdded.query({ limit: 12 })
)

const { data: youMightAlsoLike, pending: recommendationsLoading } = useAsyncData(
  'home-you-might-also-like',
  () => trpc.media.youMightAlsoLike.query({ limit: 12, mediaType: 'movie' })
)

const { data: watchlist, pending: watchlistLoading } = useAsyncData(
  'home-watchlist',
  () => trpc.media.getWatchlist.query({ limit: 12 })
)

const { data: stats } = useAsyncData(
  'stats',
  () => trpc.media.stats.query()
)

// Predictive launch (admin option, off by default): on the first home visit of a
// browser session, jump straight to the film the algorithm expects the user to watch.
const launching = ref(false)
onMounted(async () => {
  const userId = user.value?.id
  if (!userId) return
  const key = `lumir:launch:${userId}`
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch { return }
  launching.value = true
  try {
    const target = await trpc.algorithm.launchTarget.mutate()
    if (target?.mediaId) {
      await navigateTo(`/watch/${target.mediaId}`)
      return
    }
  } catch { /* fall back to the normal home page */ }
  launching.value = false
})
</script>

<template>
  <div class="p-6 space-y-8">
    <div v-if="launching" class="fixed inset-0 z-50 bg-background flex items-center justify-center">
      <div class="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>

    <!-- Welcome -->
    <div>
      <h1 class="text-2xl font-bold text-text-primary">
        {{ t('home.welcomeBack', { name: user?.displayName?.split(' ')[0] || 'User' }) }}
      </h1>
      <p class="text-text-secondary mt-1">
        {{ t('home.libraryStatus') }}
      </p>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-2xl font-bold text-text-primary">
          {{ stats?.totalMedia || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('home.totalMedia') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-2xl font-bold text-text-primary">
          {{ stats?.totalMovies || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('home.movies') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-2xl font-bold text-text-primary">
          {{ stats?.totalTv || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('home.tvShows') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-2xl font-bold text-text-primary">
          {{ stats?.totalWatched || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('home.watched') }}</p>
      </div>
    </div>

    <!-- Continue Watching -->
    <MediaContinueWatchingRow
      :items="continueWatching || []"
      :loading="continueLoading"
    />

    <!-- My Watchlist -->
    <div v-if="watchlist?.length">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-text-primary">{{ t('watchlist.title') }}</h2>
      </div>
      <MediaGrid
        :items="watchlist || []"
        :loading="watchlistLoading"
      />
    </div>

    <div v-if="youMightAlsoLike?.length">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-text-primary">{{ t('common.youMightAlsoLike') }}</h2>
        <NuxtLink
          to="/movies"
          class="text-sm text-primary hover:underline"
        >
          {{ t('common.viewAll') }}
        </NuxtLink>
      </div>
      <MediaGrid
        :items="youMightAlsoLike || []"
        :loading="recommendationsLoading"
      />
    </div>

    <!-- Recently Added -->
    <div>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-text-primary">{{ t('home.recentlyAdded') }}</h2>
        <NuxtLink
          to="/movies"
          class="text-sm text-primary hover:underline"
        >
          {{ t('common.viewAll') }}
        </NuxtLink>
      </div>
      <MediaGrid
        :items="recentlyAdded || []"
        :loading="recentLoading"
        :empty-message="t('home.emptyLibrary')"
      />
    </div>
  </div>
</template>
