<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const trpc = useTrpc()
const { t, locale } = useI18n()

useHead({ title: computed(() => t('nav.movies')) })

// Filters — persisted in localStorage
const STORAGE_KEY = 'lumirMoviesFilters'

function loadFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

const saved = import.meta.client ? loadFilters() : null
const sortBy = ref<'title' | 'year' | 'rating' | 'addedAt'>(saved?.sortBy ?? 'addedAt')
const sortOrder = ref<'asc' | 'desc'>(saved?.sortOrder ?? 'desc')
const selectedGenre = ref(saved?.selectedGenre ?? '')
const selectedYear = ref<number | ''>(saved?.selectedYear ?? '')
const pageSize = ref(saved?.pageSize ?? 50)

function saveFilters() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sortBy: sortBy.value,
      sortOrder: sortOrder.value,
      selectedGenre: selectedGenre.value,
      selectedYear: selectedYear.value,
      pageSize: pageSize.value,
    }))
  } catch {}
}

watch([sortBy, sortOrder, selectedGenre, selectedYear, pageSize], saveFilters)

// Fetch genres and years for filters
const { data: genres } = useAsyncData('genres', () => trpc.media.genres.query())
const { data: years } = useAsyncData('years', () => trpc.media.years.query())
const { data: youMightAlsoLike, pending: recommendationsLoading } = useAsyncData(
  'movies-you-might-also-like',
  () => trpc.media.youMightAlsoLike.query({ limit: 12, mediaType: 'movie' })
)

// Personalized sections — fetched separately via $fetch to avoid tRPC batching
const personalizedData = ref<{ sections: any[] } | null>(null)
onMounted(() => {
  setTimeout(async () => {
    try {
      personalizedData.value = await trpc.media.personalizedSections.query()
    } catch (e) {
      console.error('[personalizedSections] Error:', e)
    }
  }, 50)
})

// Fetch media
const { data: mediaData, pending } = useAsyncData(
  'movies',
  () => trpc.media.list.query({
    mediaType: 'movie',
    sortBy: sortBy.value,
    sortOrder: sortOrder.value,
    genre: selectedGenre.value || undefined,
    year: selectedYear.value || undefined,
    limit: pageSize.value === 0 ? 10000 : pageSize.value,
  }),
  {
    watch: [sortBy, sortOrder, selectedGenre, selectedYear, pageSize],
  }
)

// French genre articles (grammatical, only for FR locale)
const genreArticlesFr: Record<string, string> = {
  'Action': "l'Action",
  'Aventure': "l'Aventure",
  'Animation': "l'Animation",
  'Comédie': 'la Comédie',
  'Crime': 'le Crime',
  'Documentaire': 'le Documentaire',
  'Drame': 'le Drame',
  'Familial': 'le Familial',
  'Fantastique': 'le Fantastique',
  'Histoire': "l'Histoire",
  'Horreur': "l'Horreur",
  'Musique': 'la Musique',
  'Mystère': 'le Mystère',
  'Romance': 'la Romance',
  'Science-Fiction': 'la Science-Fiction',
  'Téléfilm': 'le Téléfilm',
  'Thriller': 'le Thriller',
  'Guerre': 'la Guerre',
  'Western': 'le Western',
}

function getSectionTitle(section: any): string {
  if (section.sectionType === 'becauseYouLiked') {
    return t('movies.becauseYouLiked', { title: section.param })
  }
  if (section.sectionType === 'becauseYouLikeGenre') {
    const genre = locale.value === 'fr'
      ? (genreArticlesFr[section.param] || section.param)
      : section.param
    return t('movies.becauseYouLikeGenre', { genre })
  }
  return section.param || ''
}

const sortOptions = computed(() => [
  { value: 'addedAt', label: t('movies.recentlyAdded') },
  { value: 'title', label: t('movies.titleSort') },
  { value: 'year', label: t('movies.year') },
  { value: 'rating', label: t('movies.rating') },
])

// Horizontal scroll
const rowRefs = ref<Map<number, HTMLElement>>(new Map())
const initializedRows = new Set<number>() // Guard: only init listeners once per row
const scrollState = ref<Map<number, { canLeft: boolean; canRight: boolean }>>(new Map())

function updateScrollState(idx: number) {
  const el = rowRefs.value.get(idx)
  if (!el) return
  const newState = {
    canLeft: el.scrollLeft > 5,
    canRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 5,
  }
  const current = scrollState.value.get(idx)
  // Only update if changed (avoid triggering unnecessary re-renders)
  if (!current || current.canLeft !== newState.canLeft || current.canRight !== newState.canRight) {
    scrollState.value.set(idx, newState)
  }
}

function setRowRef(idx: number, el: any) {
  if (el && !initializedRows.has(idx)) {
    initializedRows.add(idx)
    rowRefs.value.set(idx, el as HTMLElement)
    const htmlEl = el as HTMLElement
    htmlEl.addEventListener('scroll', () => updateScrollState(idx), { passive: true })
    nextTick(() => updateScrollState(idx))
  }
}

function scrollRow(idx: number, direction: 'left' | 'right') {
  const el = rowRefs.value.get(idx)
  if (!el) return
  const amount = el.clientWidth * 0.75
  el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' })
}

function canScrollLeft(idx: number) {
  return scrollState.value.get(idx)?.canLeft ?? false
}

function canScrollRight(idx: number) {
  return scrollState.value.get(idx)?.canRight ?? false
}
</script>

<template>
  <div class="p-6">
    <!-- Personalized sections -->
    <div v-if="personalizedData?.sections?.length" class="mb-10 space-y-8">
      <div v-for="(section, idx) in personalizedData.sections" :key="idx">
        <h2 class="text-lg font-semibold text-text-primary mb-3">{{ getSectionTitle(section) }}</h2>
        <div class="relative group/row">
          <!-- Scroll left -->
          <button
            v-show="canScrollLeft(idx)"
            class="absolute left-0 top-0 bottom-0 z-10 w-10 bg-gradient-to-r from-background to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity flex items-center justify-center"
            @click="scrollRow(idx, 'left')"
          >
            <svg class="w-6 h-6 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <!-- Scrollable row -->
          <div
            :ref="(el) => setRowRef(idx, el)"
            class="flex gap-4 overflow-x-auto pb-2 scrollbar-hide scroll-smooth"
          >
            <NuxtLink
              v-for="item in section.items"
              :key="item.id"
              :to="`/media/${item.id}`"
              class="group flex-shrink-0 w-36 md:w-44"
            >
              <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface card-hover">
                <img
                  v-if="item.posterPath"
                  :src="item.posterPath"
                  :alt="item.title"
                  class="w-full h-full object-cover"
                  loading="lazy"
                >
                <div v-else class="w-full h-full flex items-center justify-center bg-surface-secondary">
                  <span class="text-text-muted text-xs">{{ t('common.noPoster') }}</span>
                </div>
                <!-- Hover overlay -->
                <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div class="absolute bottom-0 left-0 right-0 p-3">
                    <div class="flex justify-center mb-2">
                      <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center transform scale-0 group-hover:scale-100 transition-transform duration-300">
                        <svg class="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                    <div v-if="item.rating" class="flex items-center justify-center gap-1 text-xs text-text-secondary">
                      <svg class="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      {{ item.rating.toFixed(1) }}
                    </div>
                  </div>
                </div>
              </div>
              <div class="mt-2 px-1">
                <p class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">{{ item.title }}</p>
                <p v-if="item.year" class="text-xs text-text-muted">{{ item.year }}</p>
              </div>
            </NuxtLink>
          </div>

          <!-- Scroll right -->
          <button
            v-show="canScrollRight(idx)"
            class="absolute right-0 top-0 bottom-0 z-10 w-10 bg-gradient-to-l from-background to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity flex items-center justify-center"
            @click="scrollRow(idx, 'right')"
          >
            <svg class="w-6 h-6 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Separator -->
      <div class="border-t border-border pt-6">
        <p class="text-sm text-text-muted uppercase tracking-wider">{{ t('home.wholeLibrary') }}</p>
      </div>
    </div>

    <!-- Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold text-text-primary">{{ t('movies.title') }}</h1>
        <p class="text-text-secondary">
          {{ t('movies.inLibrary', { count: mediaData?.total || 0 }) }}
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

        <select
          v-model="selectedYear"
          class="px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm"
        >
          <option value="">{{ t('movies.allYears') }}</option>
          <option v-for="year in years" :key="year" :value="year">
            {{ year }}
          </option>
        </select>

        <select
          v-model.number="pageSize"
          class="px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm"
        >
          <option :value="10">{{ t('movies.perPage', { count: 10 }) }}</option>
          <option :value="30">{{ t('movies.perPage', { count: 30 }) }}</option>
          <option :value="50">{{ t('movies.perPage', { count: 50 }) }}</option>
          <option :value="100">{{ t('movies.perPage', { count: 100 }) }}</option>
          <option :value="0">{{ t('movies.all') }}</option>
        </select>
      </div>
    </div>

    <div v-if="youMightAlsoLike?.length" class="mb-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-text-primary">{{ t('common.youMightAlsoLike') }}</h2>
      </div>
      <MediaGrid
        :items="youMightAlsoLike || []"
        :loading="recommendationsLoading"
      />
    </div>

    <!-- Media Grid -->
    <MediaGrid
      :items="mediaData?.items || []"
      :loading="pending"
      :empty-message="t('movies.noMoviesFound')"
    />
  </div>
</template>

<style scoped>
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
</style>
