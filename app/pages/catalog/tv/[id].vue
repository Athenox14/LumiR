<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const { t } = useI18n()
const route = useRoute()
const trpc = useTrpc()
const { catalogEnabled } = useFeatureFlags()

watch(catalogEnabled, (val) => {
  if (!val) navigateTo('/')
}, { immediate: true })

const tmdbId = computed(() => Number(route.params.id))

const { data: info, pending, error } = useAsyncData(
  `catalog-tv-${tmdbId.value}`,
  () => trpc.catalog.info.query({ tmdbId: tmdbId.value, type: 'tv' })
)

useHead({ title: computed(() => info.value?.title || t('common.loading')) })

// Preheat streaming sources for first episode as soon as we have info
watch(() => info.value?.title, (title) => {
  if (!title || !info.value?.episodes?.length) return
  const firstEp = info.value.episodes[0]
  trpc.catalog.preheatSources.mutate({
    tmdbId: tmdbId.value,
    title,
    type: 'tv',
    season: firstEp.season || 1,
    episode: firstEp.episode || 1,
  }).catch(() => {}) // fire-and-forget
}, { immediate: true })

// Group episodes by season
const seasons = computed(() => {
  if (!info.value?.episodes) return []

  const map = new Map<number, typeof info.value.episodes>()
  for (const ep of info.value.episodes) {
    const s = ep.season || 1
    if (!map.has(s)) map.set(s, [])
    map.get(s)!.push(ep)
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([number, episodes]) => ({
      number,
      episodes: episodes.sort((a, b) => (a.episode || 0) - (b.episode || 0)),
    }))
})

const placeholderBackdrop = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"%3E%3Crect fill="%230a0a0a" width="1920" height="1080"/%3E%3C/svg%3E'
const placeholderEpisode = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"%3E%3Crect fill="%231a1a1a" width="320" height="180"/%3E%3C/svg%3E'

function getWatchUrl(ep: any): string {
  const url = `/catalog/watch/${tmdbId.value}?type=tv&title=${encodeURIComponent(info.value?.title || '')}&episodeId=${encodeURIComponent(ep.id)}&season=${ep.season}&episode=${ep.episode}`
  return url
}

function episodeDisplayName(ep: any): string {
  if (ep.title && !ep.title.match(/^[EÉ]pisode\s+\d+$/i)) {
    return ep.title
  }
  return ''
}

const downloading = ref<string | null>(null)
const showDownloadModal = ref(false)
const selectedEpisode = ref<any>(null)

function openDownloadModal(ep: any) {
  selectedEpisode.value = ep
  showDownloadModal.value = true
}

async function handleDownloadSource(source: { url: string; isM3U8: boolean; headers?: Record<string, string> }) {
  const ep = selectedEpisode.value
  if (!info.value || !ep || downloading.value) return
  downloading.value = ep.id
  try {
    await trpc.catalog.startDownload.mutate({
      tmdbId: tmdbId.value,
      episodeId: ep.id,
      mediaType: 'tv',
      title: info.value.title,
      posterPath: info.value.image || undefined,
      season: ep.season,
      episode: ep.episode,
      sourceUrl: source.url,
      sourceIsM3U8: source.isM3U8,
      sourceHeaders: source.headers,
    })
    showDownloadModal.value = false
    useToast().success(t('downloads.downloadStarted'))
  } catch (e: any) {
    useToast().error(t('downloads.startFailed') + ': ' + (e.message || 'Unknown error'))
  } finally {
    downloading.value = null
  }
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Loading -->
    <div v-if="pending" class="p-6">
      <UiSkeleton class="w-full h-[50vh] rounded-none" />
      <div class="max-w-5xl mx-auto mt-6 space-y-4">
        <UiSkeleton height="2rem" width="60%" />
        <UiSkeleton height="1rem" width="30%" />
        <UiSkeleton height="6rem" />
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="p-6 text-center">
      <p class="text-red-500">{{ t('catalog.failedToLoad') }}</p>
      <NuxtLink to="/catalog" class="text-primary hover:underline mt-2 inline-block">
        {{ t('catalog.backToCatalog') }}
      </NuxtLink>
    </div>

    <!-- Content -->
    <div v-else-if="info">
      <!-- Backdrop -->
      <div class="relative">
        <div class="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent z-10" />
        <img
          :src="info.cover || placeholderBackdrop"
          :alt="info.title"
          class="w-full h-[50vh] object-cover"
        >

        <div class="absolute bottom-0 left-0 right-0 z-20 p-6 md:p-12">
          <div class="max-w-4xl">
            <h1 class="text-3xl md:text-5xl font-bold text-white mb-2">
              {{ info.title }}
            </h1>

            <div class="flex flex-wrap items-center gap-3 text-white/80 mb-4">
              <span v-if="info.releaseDate">{{ info.releaseDate?.substring(0, 4) }}</span>
              <span v-if="info.totalSeasons" class="flex items-center gap-1">
                {{ t('catalog.seasonsCount', { count: info.totalSeasons }) }}
              </span>
              <span v-if="info.totalEpisodes" class="flex items-center gap-1">
                {{ t('catalog.episodesCount', { count: info.totalEpisodes }) }}
              </span>
              <span v-if="info.rating" class="flex items-center gap-1">
                <svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {{ typeof info.rating === 'number' ? info.rating.toFixed(1) : info.rating }}
              </span>
              <span class="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm">{{ t('catalog.online') }}</span>
            </div>

            <div v-if="info.genres?.length" class="flex flex-wrap gap-2 mb-4">
              <span
                v-for="genre in info.genres"
                :key="genre"
                class="px-3 py-1 rounded-full bg-white/10 text-white text-sm"
              >
                {{ genre }}
              </span>
            </div>

            <!-- Local library link -->
            <NuxtLink
              v-if="info.localMediaId"
              :to="`/media/${info.localMediaId}`"
              class="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 text-green-500 font-medium rounded-xl border border-green-500/20 transition-colors hover:bg-green-500/20"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              {{ t('catalog.inYourLibrary') }}
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Details + Episodes -->
      <div class="max-w-5xl mx-auto px-6 py-8">
        <!-- Overview -->
        <div v-if="info.description" class="mb-8">
          <h2 class="text-lg font-semibold text-text-primary mb-2">{{ t('catalog.overview') }}</h2>
          <p class="text-text-secondary leading-relaxed">{{ info.description }}</p>
        </div>

        <!-- Cast -->
        <div v-if="info.cast?.length" class="mb-8">
          <h2 class="text-lg font-semibold text-text-primary mb-4">{{ t('catalog.casting') }}</h2>
          <div class="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
            <NuxtLink
              v-for="actor in info.cast.slice(0, 10)"
              :key="actor.name"
              :to="actor.id ? `/catalog/person/${actor.id}` : '#'"
              class="flex-shrink-0 w-24 text-center group"
            >
              <div class="w-24 h-24 rounded-full overflow-hidden bg-surface mx-auto mb-2 flex items-center justify-center ring-2 ring-transparent group-hover:ring-primary transition-all">
                <img
                  v-if="actor.profilePath"
                  :src="actor.profilePath"
                  :alt="actor.name"
                  class="w-full h-full object-cover"
                  loading="lazy"
                >
                <svg v-else class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <p class="text-xs font-medium text-text-primary truncate group-hover:text-primary transition-colors">{{ actor.name }}</p>
              <p v-if="actor.character" class="text-xs text-text-muted truncate">{{ actor.character }}</p>
            </NuxtLink>
          </div>
        </div>

        <!-- Recommendations -->
        <div v-if="info.recommendations?.length" class="mb-8">
          <h2 class="text-lg font-semibold text-text-primary mb-4">{{ t('catalog.recommendations') }}</h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <NuxtLink
              v-for="rec in info.recommendations.slice(0, 10)"
              :key="rec.id"
              :to="`/catalog/tv/${rec.id}`"
              class="group block"
            >
              <div class="aspect-[2/3] rounded-xl overflow-hidden bg-surface">
                <img
                  :src="rec.image"
                  :alt="rec.title"
                  class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                >
              </div>
              <p class="mt-2 text-sm text-text-primary truncate group-hover:text-primary transition-colors">{{ rec.title }}</p>
            </NuxtLink>
          </div>
        </div>

        <!-- Seasons & Episodes -->
        <div v-if="seasons.length">
          <div v-for="season in seasons" :key="season.number" class="mb-8">
            <h2 class="text-lg font-semibold text-text-primary mb-4">
              {{ t('catalog.season', { number: season.number }) }}
              <span class="text-sm text-text-muted font-normal ml-2">{{ t('catalog.episodesCount', { count: season.episodes.length }) }}</span>
            </h2>

            <!-- Horizontal scroll -->
            <div class="flex gap-3 overflow-x-auto pb-4 -mx-6 px-6 scroll-smooth snap-x">
              <div
                v-for="ep in season.episodes"
                :key="ep.id"
                class="flex-shrink-0 w-48 group snap-center"
              >
                <!-- Thumbnail -->
                <NuxtLink :to="getWatchUrl(ep)" class="block relative aspect-video rounded-lg overflow-hidden bg-surface mb-2">
                  <img
                    :src="ep.img?.hd || ep.img?.mobile || placeholderEpisode"
                    :alt="ep.title"
                    class="w-full h-full object-cover"
                    loading="lazy"
                  >
                  <!-- Play overlay -->
                  <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                      <svg class="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </NuxtLink>

                <!-- Info -->
                <div class="flex items-start justify-between gap-1">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-text-primary truncate">
                      {{ ep.episode }}. {{ episodeDisplayName(ep) || t('tv.episode', { number: ep.episode }) }}
                    </p>
                    <p v-if="ep.description" class="text-xs text-text-muted line-clamp-2 mt-0.5">
                      {{ ep.description }}
                    </p>
                  </div>
                  <!-- Download button -->
                  <button
                    type="button"
                    class="flex-shrink-0 p-1 text-text-muted hover:text-primary transition-colors"
                    :disabled="downloading === ep.id"
                    @click.prevent="openDownloadModal(ep)"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Download source modal -->
    <CatalogDownloadSourceModal
      v-if="info && selectedEpisode"
      v-model="showDownloadModal"
      :tmdb-id="tmdbId"
      :title="info.title"
      type="tv"
      :poster-path="info.image || undefined"
      :episode-id="selectedEpisode.id"
      :season="selectedEpisode.season"
      :episode="selectedEpisode.episode"
      @download="handleDownloadSource"
    />
  </div>
</template>
