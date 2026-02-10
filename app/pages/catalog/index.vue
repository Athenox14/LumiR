<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const { t } = useI18n()
const trpc = useTrpc()

const searchQuery = ref('')
const activeTab = ref<'movie' | 'tv'>('movie')
const isSearching = ref(false)

// Fetch trending
const { data: trendingMovies, pending: trendingMoviesLoading } = useAsyncData(
  'trending-movies',
  () => trpc.catalog.trending.query({ type: 'movie' })
)

const { data: trendingTv, pending: trendingTvLoading } = useAsyncData(
  'trending-tv',
  () => trpc.catalog.trending.query({ type: 'tv' })
)

// Search results
const searchResults = ref<any[]>([])
const searchLoading = ref(false)

let searchTimeout: NodeJS.Timeout | null = null

watch(searchQuery, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!val.trim()) {
    searchResults.value = []
    isSearching.value = false
    return
  }
  isSearching.value = true
  searchLoading.value = true
  searchTimeout = setTimeout(async () => {
    try {
      searchResults.value = await trpc.catalog.search.query({
        query: val.trim(),
        type: activeTab.value,
      })
    } catch (e) {
      console.error('Search error:', e)
      searchResults.value = []
    } finally {
      searchLoading.value = false
    }
  }, 400)
})

watch(activeTab, () => {
  if (searchQuery.value.trim()) {
    // Re-search with new tab
    searchLoading.value = true
    trpc.catalog.search.query({
      query: searchQuery.value.trim(),
      type: activeTab.value,
    }).then(results => {
      searchResults.value = results
    }).catch(() => {
      searchResults.value = []
    }).finally(() => {
      searchLoading.value = false
    })
  }
})

const displayItems = computed(() => {
  if (isSearching.value) return searchResults.value
  if (activeTab.value === 'movie') return trendingMovies.value || []
  return trendingTv.value || []
})

const loading = computed(() => {
  if (isSearching.value) return searchLoading.value
  if (activeTab.value === 'movie') return trendingMoviesLoading.value
  return trendingTvLoading.value
})

function getDetailUrl(item: any): string {
  const type = item.type === 'TV Series' || activeTab.value === 'tv' ? 'tv' : 'movie'
  return `/catalog/${type}/${item.id}`
}

const placeholderImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"%3E%3Crect fill="%231a1a1a" width="300" height="450"/%3E%3Ctext fill="%23404040" font-family="sans-serif" font-size="24" text-anchor="middle" x="150" y="225"%3ENo Poster%3C/text%3E%3C/svg%3E'
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-text-primary mb-1">{{ t('catalog.title') }}</h1>
      <p class="text-text-secondary">{{ t('catalog.subtitle') }}</p>
    </div>

    <!-- Search bar -->
    <div class="mb-6">
      <div class="relative max-w-xl">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('catalog.searchPlaceholder')"
          class="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
        />
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6">
      <button
        :class="[
          'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
          activeTab === 'movie'
            ? 'bg-primary text-white'
            : 'bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-secondary',
        ]"
        @click="activeTab = 'movie'"
      >
        {{ t('catalog.movies') }}
      </button>
      <button
        :class="[
          'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
          activeTab === 'tv'
            ? 'bg-primary text-white'
            : 'bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-secondary',
        ]"
        @click="activeTab = 'tv'"
      >
        {{ t('catalog.tvShows') }}
      </button>
    </div>

    <!-- Section title -->
    <h2 class="text-lg font-semibold text-text-primary mb-4">
      {{ isSearching ? t('catalog.searchResults') : t('catalog.trending') }}
    </h2>

    <!-- Loading -->
    <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      <div v-for="i in 12" :key="i" class="space-y-3">
        <UiSkeleton class="aspect-[2/3] rounded-xl" />
        <UiSkeleton height="1rem" width="80%" />
        <UiSkeleton height="0.75rem" width="40%" />
      </div>
    </div>

    <!-- Empty -->
    <div v-else-if="displayItems.length === 0" class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-16 h-16 rounded-full bg-surface flex items-center justify-center mb-4">
        <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <p class="text-text-secondary">
        {{ isSearching ? t('catalog.noResultsFound') : t('catalog.noTrending') }}
      </p>
    </div>

    <!-- Grid -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      <NuxtLink
        v-for="item in displayItems"
        :key="item.id"
        :to="getDetailUrl(item)"
        class="group block"
      >
        <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface card-hover">
          <img
            :src="item.image || placeholderImage"
            :alt="item.title"
            class="w-full h-full object-cover"
            loading="lazy"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div class="absolute bottom-0 left-0 right-0 p-4">
              <div class="flex justify-center mb-3">
                <div class="w-12 h-12 rounded-full bg-primary flex items-center justify-center transform scale-0 group-hover:scale-100 transition-transform duration-300">
                  <svg class="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
              <div v-if="item.rating" class="flex items-center justify-center gap-1 text-sm text-text-secondary">
                <svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {{ typeof item.rating === 'number' ? item.rating.toFixed(1) : item.rating }}
              </div>
            </div>
          </div>

          <!-- Online badge -->
          <div class="absolute top-2 right-2 bg-blue-500 text-white text-xs font-medium px-2 py-1 rounded-full">
            {{ t('catalog.online') }}
          </div>
        </div>

        <div class="mt-3 px-1">
          <h3 class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">
            {{ item.title }}
          </h3>
          <p v-if="item.releaseDate" class="text-xs text-text-muted mt-0.5">
            {{ item.releaseDate?.substring(0, 4) }}
          </p>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
