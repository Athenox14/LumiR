<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
  layout: false,
})

const { t } = useI18n()
const route = useRoute()
const trpc = useTrpc()
const { catalogEnabled } = useFeatureFlags()

watch(catalogEnabled, (val) => {
  if (!val) navigateTo('/')
}, { immediate: true })

const tmdbId = computed(() => Number(route.params.id))
const episodeId = computed(() => (route.query.episodeId as string) || undefined)
const mediaType = computed(() => (route.query.type as string) || 'movie')
const seasonNum = computed(() => route.query.season ? Number(route.query.season) : null)
const episodeNum = computed(() => route.query.episode ? Number(route.query.episode) : null)
const titleParam = computed(() => (route.query.title as string) || '')

// Fetch content info for title/metadata (lazy - don't block page render)
const { data: info } = useLazyAsyncData(
  `catalog-watch-info-${tmdbId.value}`,
  () => trpc.catalog.info.query({
    tmdbId: tmdbId.value,
    type: mediaType.value as 'movie' | 'tv',
  })
)

useHead({ title: computed(() => info.value?.title || titleParam.value || t('common.loading')) })

// All available streams from pipeline
const allStreams = ref<Array<{
  provider: string
  server: string
  sources: { url: string; quality: string; isM3U8: boolean }[]
  subtitles: { url: string; lang: string }[]
  headers?: Record<string, string>
}>>([])
const activeStreamIndex = ref(0)
const showSourceMenu = ref(false)
const sourcesLoading = ref(true)
const sourcesError = ref<Error | null>(null)

onMounted(async () => {
  try {
    const title = titleParam.value || info.value?.title || ''
    const result = await trpc.catalog.streamingSources.query({
      tmdbId: tmdbId.value,
      title,
      type: mediaType.value as 'movie' | 'tv',
      episodeId: episodeId.value,
      season: seasonNum.value || undefined,
      episode: episodeNum.value || undefined,
    })
    allStreams.value = result.streams
  } catch (e: any) {
    sourcesError.value = e
  } finally {
    sourcesLoading.value = false
  }
})

// Active stream
const activeStream = computed(() => allStreams.value[activeStreamIndex.value])

// Build stream URLs
// For MP4: proxy is PRIMARY (avoids CORS), direct as fallback
// For HLS: direct is PRIMARY (browser handles natively), proxy as fallback
const streamUrl = computed(() => {
  if (!activeStream.value?.sources?.length) return null
  const src = activeStream.value.sources[0]
  if (!src.isM3U8) {
    // MP4: use proxy as primary to avoid CORS
    return buildProxyUrl(src.url, activeStream.value.headers)
  }
  return src.url
})

const proxyStreamUrl = computed(() => {
  if (!activeStream.value?.sources?.length) return null
  const src = activeStream.value.sources[0]
  if (src.isM3U8) {
    // HLS: fallback = proxy
    return buildProxyUrl(src.url, activeStream.value.headers)
  }
  // MP4: fallback = direct URL
  return src.url
})

function buildProxyUrl(url: string, headers?: Record<string, string>) {
  const headersJson = headers
    ? encodeURIComponent(JSON.stringify(headers))
    : ''
  let proxyUrl = `/api/stream/proxy?url=${encodeURIComponent(url)}`
  if (headersJson) proxyUrl += `&headers=${headersJson}`
  return proxyUrl
}

const subtitleTracks = computed(() => {
  if (!activeStream.value?.subtitles?.length) return []
  return activeStream.value.subtitles.map((sub: any) => {
    const url = buildProxyUrl(sub.url, activeStream.value.headers)
    return {
      url,
      lang: sub.lang,
      label: sub.lang,
    }
  })
})

const displayTitle = computed(() => {
  const title = info.value?.title || titleParam.value || ''
  if (!title) return ''
  if (mediaType.value === 'tv' && seasonNum.value != null && episodeNum.value != null) {
    const ep = `S${String(seasonNum.value).padStart(2, '0')}E${String(episodeNum.value).padStart(2, '0')}`
    return `${title} - ${ep}`
  }
  return title
})

const backUrl = computed(() => {
  if (mediaType.value === 'tv') return `/catalog/tv/${tmdbId.value}`
  return `/catalog/movie/${tmdbId.value}`
})

function handlePlayerError() {
  // Auto-fallback: try next stream
  if (activeStreamIndex.value < allStreams.value.length - 1) {
    activeStreamIndex.value++
  }
}

function selectStream(index: number) {
  activeStreamIndex.value = index
  showSourceMenu.value = false
}

async function handleProgress(position: number, duration: number) {
  try {
    await trpc.catalog.updateOnlineProgress.mutate({
      tmdbId: tmdbId.value,
      episodeId: mediaType.value === 'tv' ? episodeId.value : undefined,
      mediaType: mediaType.value as 'movie' | 'tv',
      title: info.value?.title || '',
      posterPath: info.value?.image,
      season: seasonNum.value || undefined,
      episode: episodeNum.value || undefined,
      position: Math.floor(position),
      duration: Math.floor(duration),
    })
  } catch (e) {
    console.error('Failed to save online progress:', e)
  }
}

function handleEnded() {
  navigateTo(backUrl.value)
}
</script>

<template>
  <div class="fixed inset-0 bg-black">
    <!-- Loading -->
    <div v-if="sourcesLoading" class="flex items-center justify-center h-full">
      <div class="text-center">
        <div class="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p class="text-white/60">{{ t('catalogWatch.searchingSources') }}</p>
        <p class="text-white/40 text-sm mt-2">{{ t('catalogWatch.searchingSourcesDesc') }}</p>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="sourcesError || !streamUrl" class="flex items-center justify-center h-full text-white">
      <div class="text-center">
        <p class="text-lg mb-2">{{ t('catalogWatch.noSourcesFound') }}</p>
        <p class="text-white/60 mb-4 text-sm">{{ sourcesError?.message || t('catalogWatch.noSourcesAvailable') }}</p>
        <NuxtLink
          :to="backUrl"
          class="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover rounded-lg transition-colors"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {{ t('catalogWatch.back') }}
        </NuxtLink>
      </div>
    </div>

    <!-- Player -->
    <template v-else>
      <MediaVideoPlayer
        :key="`stream-${activeStreamIndex}`"
        :src="streamUrl"
        :fallback-src="proxyStreamUrl"
        :poster="info?.cover || info?.image || undefined"
        :media-id="`online-${tmdbId}`"
        :title="displayTitle"
        :back-url="backUrl"
        :initial-position="0"
        :subtitles="subtitleTracks"
        @progress="handleProgress"
        @ended="handleEnded"
        @error="handlePlayerError"
      />

      <!-- Source selector button -->
      <div
        v-if="allStreams.length > 1"
        class="absolute top-4 right-4 z-40"
      >
        <button
          type="button"
          class="px-3 py-1.5 bg-black/70 backdrop-blur text-white text-xs rounded-lg border border-white/10 hover:bg-black/90 transition-colors"
          @click.stop="showSourceMenu = !showSourceMenu"
        >
          {{ activeStream?.provider }} - {{ activeStream?.server }}
          <span class="ml-1 text-white/40">({{ activeStreamIndex + 1 }}/{{ allStreams.length }})</span>
        </button>

        <!-- Source menu -->
        <div
          v-if="showSourceMenu"
          class="absolute top-full right-0 mt-2 bg-black/90 backdrop-blur rounded-lg border border-white/10 py-1 min-w-[220px] max-h-80 overflow-y-auto z-50"
          @click.stop
        >
          <p class="px-3 py-1 text-xs text-white/40 uppercase tracking-wide">{{ t('catalogWatch.sources') }}</p>
          <button
            v-for="(stream, i) in allStreams"
            :key="i"
            type="button"
            class="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors"
            :class="activeStreamIndex === i ? 'text-primary font-medium' : 'text-white'"
            @click="selectStream(i)"
          >
            <span class="block">{{ stream.provider }} - {{ stream.server }}</span>
            <span class="block text-xs text-white/40">
              {{ stream.sources[0]?.isM3U8 ? t('catalogWatch.hls') : t('catalogWatch.direct') }}
              <span v-if="stream.sources[0]?.quality"> - {{ stream.sources[0].quality }}</span>
              <span v-if="stream.subtitles.length"> - {{ t('catalogWatch.subtitles', { count: stream.subtitles.length }) }}</span>
            </span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
