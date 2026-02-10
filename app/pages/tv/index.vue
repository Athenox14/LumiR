<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const trpc = useTrpc()
const { t } = useI18n()

// Filters
const sortBy = ref<'title' | 'year' | 'rating' | 'addedAt'>('addedAt')
const sortOrder = ref<'asc' | 'desc'>('desc')
const selectedGenre = ref('')

// Fetch genres for filters
const { data: genres } = useAsyncData('genres', () => trpc.media.genres.query())

// Fetch grouped shows
const { data: showsData, pending } = useAsyncData(
  'tv-shows',
  () => trpc.media.listShows.query({
    sortBy: sortBy.value,
    sortOrder: sortOrder.value,
    genre: selectedGenre.value || undefined,
    limit: 50,
  }),
  {
    watch: [sortBy, sortOrder, selectedGenre],
  }
)

const sortOptions = computed(() => [
  { value: 'addedAt', label: t('movies.recentlyAdded') },
  { value: 'title', label: t('movies.titleSort') },
  { value: 'year', label: t('movies.year') },
  { value: 'rating', label: t('movies.rating') },
])

const placeholderImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"%3E%3Crect fill="%231a1a1a" width="300" height="450"/%3E%3Ctext fill="%23404040" font-family="sans-serif" font-size="24" text-anchor="middle" x="150" y="225"%3ENo Poster%3C/text%3E%3C/svg%3E'
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold text-text-primary">{{ t('tv.title') }}</h1>
        <p class="text-text-secondary">
          {{ t('tv.inLibrary', { count: showsData?.total || 0 }) }}
        </p>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap gap-3">
        <UiSelect
          v-model="sortBy"
          :options="sortOptions"
          :placeholder="t('movies.sortBy')"
        />

        <select
          v-model="sortOrder"
          class="px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm"
        >
          <option value="desc">{{ t('movies.descending') }}</option>
          <option value="asc">{{ t('movies.ascending') }}</option>
        </select>

        <select
          v-model="selectedGenre"
          class="px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm"
        >
          <option value="">{{ t('movies.allGenres') }}</option>
          <option v-for="genre in genres" :key="genre" :value="genre">
            {{ genre }}
          </option>
        </select>
      </div>
    </div>

    <!-- Loading -->
    <div
      v-if="pending"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
    >
      <div v-for="i in 12" :key="i" class="space-y-3">
        <UiSkeleton class="aspect-[2/3] rounded-xl" />
        <UiSkeleton height="1rem" width="80%" />
        <UiSkeleton height="0.75rem" width="40%" />
      </div>
    </div>

    <!-- Empty -->
    <div
      v-else-if="!showsData?.items?.length"
      class="flex flex-col items-center justify-center py-16 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-surface flex items-center justify-center mb-4">
        <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        </svg>
      </div>
      <p class="text-text-secondary">{{ t('tv.noSeriesFound') }}</p>
    </div>

    <!-- Shows Grid -->
    <div
      v-else
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
    >
      <NuxtLink
        v-for="show in showsData.items"
        :key="show.tmdbId || show.title"
        :to="`/tv/${show.tmdbId}`"
        class="group block"
      >
        <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface card-hover">
          <!-- Poster -->
          <img
            :src="show.posterPath || placeholderImage"
            :alt="show.title"
            class="w-full h-full object-cover"
            loading="lazy"
          />

          <!-- Overlay on hover -->
          <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div class="absolute bottom-0 left-0 right-0 p-4">
              <div v-if="show.rating" class="flex items-center justify-center gap-1 text-sm text-text-secondary">
                <svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {{ show.rating.toFixed(1) }}
              </div>
            </div>
          </div>

          <!-- Episode count badge -->
          <div class="absolute top-2 left-2 bg-primary text-white text-xs font-medium px-2 py-1 rounded-full">
            {{ show.episodeCount }} {{ t('tv.episodes', show.episodeCount) }}
          </div>
        </div>

        <!-- Info -->
        <div class="mt-3 px-1">
          <h3 class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">
            {{ show.title }}
          </h3>
          <p v-if="show.year" class="text-xs text-text-muted mt-0.5">
            {{ show.year }} · {{ show.seasonCount }} {{ t('tv.seasons', show.seasonCount) }}
          </p>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
