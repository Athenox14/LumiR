<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const { t } = useI18n()
const route = useRoute()
const trpc = useTrpc()

const tmdbId = computed(() => Number(route.params.id))

const { data: info, pending, error } = useAsyncData(
  `catalog-movie-${tmdbId.value}`,
  () => trpc.catalog.info.query({ tmdbId: tmdbId.value, type: 'movie' })
)

const showDownloadModal = ref(false)
const downloading = ref(false)

async function handleDownloadSource(source: { url: string; isM3U8: boolean; headers?: Record<string, string> }) {
  if (!info.value || downloading.value) return
  downloading.value = true
  try {
    const epId = info.value.episodes?.[0]?.id
    await trpc.catalog.startDownload.mutate({
      tmdbId: tmdbId.value,
      episodeId: epId || undefined,
      mediaType: 'movie',
      title: info.value.title,
      posterPath: info.value.image || undefined,
      sourceUrl: source.url,
      sourceIsM3U8: source.isM3U8,
      sourceHeaders: source.headers,
    })
    showDownloadModal.value = false
    alert(t('downloads.downloadStarted'))
  } catch (e: any) {
    alert(t('downloads.startFailed') + ': ' + (e.message || 'Unknown error'))
  } finally {
    downloading.value = false
  }
}

function formatRuntime(duration: string | undefined): string {
  if (!duration) return ''
  const minMatch = duration.match(/(\d+)/)
  if (!minMatch) return duration
  const totalMin = parseInt(minMatch[1])
  if (isNaN(totalMin) || totalMin <= 0) return duration
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours > 0 && mins > 0) return `${hours}h ${mins}min`
  if (hours > 0) return `${hours}h`
  return `${totalMin}min`
}

// Build the watch URL - pass episodeId if available, title for fallback provider search
const watchUrl = computed(() => {
  if (!info.value) return null
  const epId = info.value.episodes?.[0]?.id
  let url = `/catalog/watch/${tmdbId.value}?type=movie&title=${encodeURIComponent(info.value.title)}`
  if (epId) url += `&episodeId=${encodeURIComponent(epId)}`
  return url
})

const placeholderBackdrop = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"%3E%3Crect fill="%230a0a0a" width="1920" height="1080"/%3E%3C/svg%3E'
</script>

<template>
  <div class="min-h-screen">
    <!-- Loading -->
    <div v-if="pending" class="p-6">
      <UiSkeleton class="w-full h-[60vh] rounded-none" />
      <div class="max-w-4xl mx-auto mt-6 space-y-4">
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
          class="w-full h-[60vh] object-cover"
        />

        <div class="absolute bottom-0 left-0 right-0 z-20 p-6 md:p-12">
          <div class="max-w-4xl">
            <h1 class="text-3xl md:text-5xl font-bold text-white mb-2">
              {{ info.title }}
            </h1>

            <!-- Meta -->
            <div class="flex flex-wrap items-center gap-3 text-white/80 mb-4">
              <span v-if="info.releaseDate">{{ info.releaseDate?.substring(0, 4) }}</span>
              <span v-if="info.duration" class="flex items-center gap-1">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {{ formatRuntime(info.duration) }}
              </span>
              <span v-if="info.rating" class="flex items-center gap-1">
                <svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {{ typeof info.rating === 'number' ? info.rating.toFixed(1) : info.rating }}
              </span>
              <span class="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm">{{ t('catalog.online') }}</span>
            </div>

            <!-- Genres -->
            <div v-if="info.genres?.length" class="flex flex-wrap gap-2 mb-6">
              <span
                v-for="genre in info.genres"
                :key="genre"
                class="px-3 py-1 rounded-full bg-white/10 text-white text-sm"
              >
                {{ genre }}
              </span>
            </div>

            <!-- Actions -->
            <div class="flex flex-wrap gap-3">
              <NuxtLink
                v-if="watchUrl"
                :to="watchUrl"
                class="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-medium rounded-xl transition-colors"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {{ t('catalog.watchOnline') }}
              </NuxtLink>
              <span
                v-else
                class="inline-flex items-center gap-2 px-6 py-3 bg-surface text-text-muted font-medium rounded-xl border border-border cursor-not-allowed"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {{ t('catalog.watchOnline') }}
              </span>

              <button
                type="button"
                class="inline-flex items-center gap-2 px-6 py-3 bg-surface hover:bg-surface-secondary text-text-primary font-medium rounded-xl border border-border transition-colors"
                :disabled="downloading"
                @click="showDownloadModal = true"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {{ downloading ? t('catalog.downloading') : t('catalog.download') }}
              </button>

              <!-- Local library link -->
              <NuxtLink
                v-if="info.localMediaId"
                :to="`/media/${info.localMediaId}`"
                class="inline-flex items-center gap-2 px-6 py-3 bg-green-500/10 text-green-500 font-medium rounded-xl border border-green-500/20 transition-colors hover:bg-green-500/20"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                {{ t('catalog.inYourLibrary') }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>

      <!-- Details -->
      <div class="max-w-4xl mx-auto px-6 py-8">
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
              class="flex-shrink-0 w-28 text-center group"
            >
              <div class="w-28 h-28 rounded-full overflow-hidden bg-surface mx-auto mb-2 flex items-center justify-center ring-2 ring-transparent group-hover:ring-primary transition-all">
                <img
                  v-if="actor.profilePath"
                  :src="actor.profilePath"
                  :alt="actor.name"
                  class="w-full h-full object-cover"
                  loading="lazy"
                >
                <svg v-else class="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <p class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">{{ actor.name }}</p>
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
              :to="`/catalog/movie/${rec.id}`"
              class="group block"
            >
              <div class="aspect-[2/3] rounded-xl overflow-hidden bg-surface">
                <img
                  :src="rec.image"
                  :alt="rec.title"
                  class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
              <p class="mt-2 text-sm text-text-primary truncate group-hover:text-primary transition-colors">{{ rec.title }}</p>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>

    <!-- Download source modal -->
    <CatalogDownloadSourceModal
      v-if="info"
      v-model="showDownloadModal"
      :tmdb-id="tmdbId"
      :title="info.title"
      type="movie"
      :poster-path="info.image || undefined"
      :episode-id="info.episodes?.[0]?.id"
      @download="handleDownloadSource"
    />
  </div>
</template>
