<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const { t } = useI18n()
const route = useRoute()
const trpc = useTrpc()
const { isAdmin } = useAuth()
const { track: analyticsTrack } = useAnalytics()

const mediaId = computed(() => route.params.id as string)
const pageOpenedAt = Date.now()
const maxScrollDepth = ref(0)
const seenSections = ref(new Set<string>())
const overviewSectionRef = ref<HTMLElement | null>(null)
const castSectionRef = ref<HTMLElement | null>(null)
const metadataSectionRef = ref<HTMLElement | null>(null)

const { data: media, pending, error } = useAsyncData(
  `media-${mediaId.value}`,
  () => trpc.media.getById.query(mediaId.value)
)

useHead({ title: computed(() => media.value?.title || t('common.loading')) })

function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes) return ''
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours > 0) {
    return `${hours}h ${mins}m`
  }
  return `${mins}m`
}

function formatProgress(): string {
  if (!media.value?.watchProgress?.position) return ''
  const progress = media.value.watchProgress
  const position = progress.position
  const hours = Math.floor(position / 3600)
  const minutes = Math.floor((position % 3600) / 60)

  if (hours > 0) {
    return t('media.resume', { time: `${hours}h ${minutes}m` })
  }
  return t('media.resume', { time: `${minutes}m` })
}

const progressPercent = computed(() => {
  if (!media.value?.watchProgress?.duration) return 0
  return Math.round((media.value.watchProgress.position / media.value.watchProgress.duration) * 100)
})

// Normalize cast to handle old format (string[]) and new format (object[])
const normalizedCast = computed(() => {
  if (!media.value?.cast) return []
  return (media.value.cast as any[]).map((actor: any) => {
    if (typeof actor === 'string') {
      return { id: null, name: actor, character: '', profilePath: null }
    }
    return {
      id: actor.id || null,
      name: actor.name || '',
      character: actor.character || '',
      profilePath: actor.profilePath || null,
    }
  })
})

// Fetch local recommendations (same genres from library)
const { data: recommendations } = useAsyncData(
  `media-recs-${mediaId.value}`,
  () => trpc.media.recommendations.query({ mediaId: mediaId.value, limit: 10 }),
  { lazy: true }
)

// Fetch collection (same franchise) - only if media has collectionId
const { data: collectionItems } = useAsyncData(
  `media-collection-${mediaId.value}`,
  async () => {
    if (!media.value?.collectionId) return null
    const items = await trpc.media.collection.query({
      collectionId: media.value.collectionId,
      excludeMediaId: mediaId.value,
    })
    return items.length > 0 ? items : null
  },
  { lazy: true, watch: [media] }
)

// Like/Dislike
const myRating = ref<1 | -1 | null>(null)
const likesCount = ref(0)
const dislikesCount = ref(0)
const ratingLoading = ref(false)

watch(media, (m) => {
  if (m) {
    myRating.value = m.myRating || null
    likesCount.value = m.likesCount || 0
    dislikesCount.value = m.dislikesCount || 0
  }
}, { immediate: true })

const totalRatings = computed(() => likesCount.value + dislikesCount.value)
const likePercent = computed(() => {
  if (totalRatings.value === 0) return 50
  return Math.round((likesCount.value / totalRatings.value) * 100)
})

async function handleRate(rating: 1 | -1) {
  if (ratingLoading.value) return
  ratingLoading.value = true
  try {
    const result = await trpc.media.rateMedia.mutate({
      mediaId: mediaId.value,
      rating,
    })
    const oldRating = myRating.value
    myRating.value = result.rating as 1 | -1 | null
    // Update counts locally
    if (oldRating === 1) likesCount.value--
    if (oldRating === -1) dislikesCount.value--
    if (result.rating === 1) likesCount.value++
    if (result.rating === -1) dislikesCount.value++
    if (result.rating) {
      analyticsTrack(result.rating === 1 ? 'MEDIA_LIKE' : 'MEDIA_DISLIKE', mediaId.value, {
        previousRating: oldRating,
        clientAt: new Date().toISOString(),
      })
    }
  } catch (e) {
    console.error('Failed to rate:', e)
  } finally {
    ratingLoading.value = false
  }
}

// Settings modal (file path)
const showSettingsModal = ref(false)
const editFilePath = ref('')
const filePathSaving = ref(false)
const filePathSaved = ref(false)

async function saveFilePath() {
  if (!media.value || filePathSaving.value) return
  filePathSaving.value = true
  try {
    await trpc.media.updateFilePath.mutate({
      id: mediaId.value,
      filePath: editFilePath.value,
    })
    filePathSaved.value = true
    setTimeout(() => { filePathSaved.value = false }, 2000)
  } catch (e) {
    console.error('Failed to update file path:', e)
  } finally {
    filePathSaving.value = false
  }
}

// TMDB re-identification
const tmdbQuery = ref('')
const tmdbResults = ref<any[]>([])
const tmdbSearching = ref(false)
const tmdbSearched = ref(false)
const reidentifying = ref(false)
const reidentifyDone = ref(false)
let tmdbSearchTimeout: ReturnType<typeof setTimeout> | null = null

function openSettings() {
  if (media.value) {
    editFilePath.value = media.value.filePath || ''
    filePathSaved.value = false
    tmdbQuery.value = media.value.title || ''
    tmdbResults.value = []
    tmdbSearched.value = false
    reidentifyDone.value = false
  }
  showSettingsModal.value = true
}

function searchTmdbDebounced() {
  if (tmdbSearchTimeout) clearTimeout(tmdbSearchTimeout)
  tmdbResults.value = []
  reidentifyDone.value = false
  if (!tmdbQuery.value.trim()) return
  tmdbSearchTimeout = setTimeout(async () => {
    tmdbSearching.value = true
    try {
      const type = media.value?.mediaType === 'tv' ? 'tv' as const : 'movie' as const
      tmdbResults.value = await trpc.media.searchTmdb.query({
        query: tmdbQuery.value.trim(),
        type,
      })
      tmdbSearched.value = true
    } catch (e) {
      console.error('TMDB search error:', e)
    } finally {
      tmdbSearching.value = false
    }
  }, 400)
}

async function reidentifyMedia(tmdbId: number) {
  if (!media.value || reidentifying.value) return
  reidentifying.value = true
  try {
    const type = media.value.mediaType === 'tv' ? 'tv' as const : 'movie' as const
    await trpc.media.reidentify.mutate({
      id: mediaId.value,
      tmdbId,
      mediaType: type,
    })
    reidentifyDone.value = true
    tmdbResults.value = []
    setTimeout(() => {
      showSettingsModal.value = false
      refreshNuxtData(`media-${mediaId.value}`)
    }, 1000)
  } catch (e) {
    console.error('Failed to reidentify:', e)
  } finally {
    reidentifying.value = false
  }
}

// Pre-heat transcode session so playback starts faster when user clicks Play
// Skip if coming back from the watch page (user already watched, no need to preheat)
const cameFromWatch = import.meta.client
  ? !!(window.history?.state?.back as string | undefined)?.startsWith('/watch/')
  : false
const preheated = ref(false)
watch(media, (m) => {
  if (!m?.filePath || cameFromWatch) return
  const position = m.watchProgress?.position || 0
  $fetch(`/api/stream/${m.id}/preheat`, {
    params: { position },
  }).then((res: any) => {
    preheated.value = !!res?.preheated
  }).catch(() => {})
}, { once: true })

// Cancel any HLS session when navigating away (unless going to watch this media)
onBeforeRouteLeave((to) => {
  if (!media.value) return
  if (to.path === `/watch/${media.value.id}`) return
  $fetch(`/api/stream/${media.value.id}/preheat`, { method: 'DELETE' }).catch(() => {})
})

// Also cancel on tab/browser close (onBeforeRouteLeave doesn't fire for that)
function cancelOnUnload() {
  if (!media.value) return
  fetch(`/api/stream/${media.value.id}/preheat`, { method: 'DELETE', keepalive: true })
}
onMounted(() => window.addEventListener('beforeunload', cancelOnUnload))
onUnmounted(() => window.removeEventListener('beforeunload', cancelOnUnload))

// Media edit modal (admin only)
const showEditModal = ref(false)
const editTitle = ref('')
const editYear = ref<number | null>(null)
const editRuntime = ref<number | null>(null)
const editOverview = ref('')
const editTagline = ref('')
const editGenres = ref('')
const editRating = ref<number | null>(null)
const editSaving = ref(false)

function openEditModal() {
  if (!media.value) return
  editTitle.value = media.value.title || ''
  editYear.value = media.value.year || null
  editRuntime.value = media.value.runtime || null
  editOverview.value = media.value.overview || ''
  editTagline.value = media.value.tagline || ''
  editGenres.value = (media.value.genres || []).join(', ')
  editRating.value = media.value.rating || null
  showEditModal.value = true
}

async function saveMediaInfo() {
  if (!media.value || editSaving.value) return
  editSaving.value = true
  try {
    await trpc.media.updateInfo.mutate({
      id: mediaId.value,
      title: editTitle.value,
      year: editYear.value,
      runtime: editRuntime.value,
      overview: editOverview.value,
      tagline: editTagline.value,
      genres: editGenres.value.split(',').map((g: string) => g.trim()).filter(Boolean),
      rating: editRating.value,
    })
    useToast().success(t('mediaEdit.saved'))
    showEditModal.value = false
    refreshNuxtData(`media-${mediaId.value}`)
  } catch (e: any) {
    useToast().error(e.message || t('mediaEdit.saveFailed'))
  } finally {
    editSaving.value = false
  }
}

const placeholderBackdrop = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"%3E%3Crect fill="%230a0a0a" width="1920" height="1080"/%3E%3C/svg%3E'

watch(media, (value) => {
  if (!value || !import.meta.client) return
  const visitsKey = `pipouflix:media-visits:${value.id}`
  const previousVisits = Number(localStorage.getItem(visitsKey) || '0')
  localStorage.setItem(visitsKey, String(previousVisits + 1))
  analyticsTrack('MEDIA_VIEW', value.id, {
    mediaType: value.mediaType,
    title: value.title,
    repeatVisit: previousVisits > 0,
    clientAt: new Date().toISOString(),
  })
}, { once: true })

function updateScrollDepth() {
  const scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1)
  maxScrollDepth.value = Math.max(maxScrollDepth.value, window.scrollY / scrollable)
}

function trackSectionView(section: string) {
  if (!media.value || seenSections.value.has(section)) return
  seenSections.value.add(section)
  analyticsTrack('MEDIA_SECTION_VIEW', media.value.id, {
    section,
    clientAt: new Date().toISOString(),
  })
}

function handlePlayIntent() {
  if (!media.value) return
  analyticsTrack('MEDIA_PLAY_INTENT', media.value.id, {
    delayFromOpenMs: Date.now() - pageOpenedAt,
    mediaType: media.value.mediaType,
    clientAt: new Date().toISOString(),
  })
}

onMounted(() => {
  updateScrollDepth()
  window.addEventListener('scroll', updateScrollDepth, { passive: true })

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      if (entry.target === overviewSectionRef.value) trackSectionView('synopsis')
      if (entry.target === castSectionRef.value) trackSectionView('cast')
      if (entry.target === metadataSectionRef.value) trackSectionView('metadata')
    }
  }, { threshold: 0.35 })

  if (overviewSectionRef.value) observer.observe(overviewSectionRef.value)
  if (castSectionRef.value) observer.observe(castSectionRef.value)
  if (metadataSectionRef.value) observer.observe(metadataSectionRef.value)

  onUnmounted(() => {
    observer.disconnect()
    window.removeEventListener('scroll', updateScrollDepth)
    if (!media.value) return
    const timeOnPageMs = Date.now() - pageOpenedAt
    analyticsTrack('MEDIA_DETAIL_ENGAGEMENT', media.value.id, {
      timeOnPageMs,
      scrollDepth: Math.round(maxScrollDepth.value * 100),
      immediateExit: timeOnPageMs < 4000,
      sectionsSeen: Array.from(seenSections.value),
      clientAt: new Date().toISOString(),
    })
  })
})
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
      <p class="text-red-500">{{ t('media.failedToLoad') }}</p>
      <NuxtLink to="/" class="text-primary hover:underline mt-2 inline-block">
        {{ t('media.goBackHome') }}
      </NuxtLink>
    </div>

    <!-- Content -->
    <div v-else-if="media">
      <!-- Backdrop -->
      <div class="relative">
        <div class="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent z-10" />

        <!-- Admin action buttons (top right) -->
        <div class="absolute top-4 right-4 z-20 flex items-center gap-2">
          <!-- Edit media info (admin only) -->
          <button
            v-if="isAdmin"
            type="button"
            class="p-2.5 rounded-full bg-black/40 text-white/70 hover:bg-black/60 hover:text-white transition-colors backdrop-blur-sm"
            :title="t('mediaEdit.title')"
            @click="openEditModal"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94L14.7 6.3z" />
            </svg>
          </button>

          <!-- Settings gear button -->
          <button
            v-if="media.filePath || isAdmin"
            type="button"
            class="p-2.5 rounded-full bg-black/40 text-white/70 hover:bg-black/60 hover:text-white transition-colors backdrop-blur-sm"
            :title="t('media.fileInfo')"
            @click="openSettings"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        <img
          :src="media.backdropPath || placeholderBackdrop"
          :alt="media.title"
          class="w-full h-[60vh] object-cover"
        >

        <!-- Rating ratio macaron (bottom right) -->
        <div
          v-if="totalRatings > 0"
          class="absolute bottom-8 right-6 md:right-12 z-20 w-14 h-14 rounded-full"
          :style="{
            background: `conic-gradient(#22c55e 0% ${likePercent}%, #ef4444 ${likePercent}% 100%)`,
          }"
          :title="t('media.positivePercent', { percent: likePercent })"
        >
          <div class="absolute inset-1.5 rounded-full bg-black/80 flex items-center justify-center">
            <span class="text-xs font-bold text-white">{{ likePercent }}%</span>
          </div>
        </div>

        <!-- Content overlay -->
        <div class="absolute bottom-0 left-0 right-0 z-20 p-6 md:p-12">
          <div class="max-w-4xl">
            <!-- Title -->
            <h1 class="text-3xl md:text-5xl font-bold text-white mb-2">
              {{ media.title }}
            </h1>

            <!-- Season/Episode badge -->
            <div
              v-if="media.mediaType === 'tv' && media.season != null && media.episode != null"
              class="mb-3"
            >
              <span class="inline-block px-3 py-1 bg-primary text-white text-sm font-medium rounded-full">
                {{ t('tv.season', { number: media.season }) }} - {{ t('tv.episode', { number: media.episode }) }}
              </span>
            </div>

            <!-- Meta info -->
            <div class="flex flex-wrap items-center gap-3 text-white/80 mb-4">
              <span v-if="media.year">{{ media.year }}</span>
              <span v-if="media.runtime" class="flex items-center gap-1">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {{ formatRuntime(media.runtime) }}
              </span>
              <span v-if="media.rating" class="flex items-center gap-1">
                <svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {{ media.rating.toFixed(1) }}
              </span>
            </div>

            <!-- Genres -->
            <div v-if="media.genres?.length" class="flex flex-wrap gap-2 mb-6">
              <span
                v-for="genre in media.genres"
                :key="genre"
                class="px-3 py-1 rounded-full bg-white/10 text-white text-sm"
              >
                {{ genre }}
              </span>
            </div>

            <!-- Actions -->
            <div class="flex flex-wrap items-center gap-3">
              <NuxtLink
                :to="`/watch/${media.id}`"
                class="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-medium rounded-xl transition-colors"
                @click="handlePlayIntent"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {{ media.watchProgress && !media.watchProgress.completed ? formatProgress() : t('common.play') }}
              </NuxtLink>

              <!-- Like/Dislike buttons -->
              <button
                type="button"
                class="flex items-center gap-1.5 px-4 py-3 rounded-xl transition-colors"
                :class="myRating === 1 ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'"
                :disabled="ratingLoading"
                @click="handleRate(1)"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" :stroke-width="myRating === 1 ? 2.5 : 2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z M4 22h-1a2 2 0 01-2-2v-7a2 2 0 012-2h1" />
                </svg>
                <span v-if="likesCount > 0" class="text-sm font-medium">{{ likesCount }}</span>
              </button>

              <button
                type="button"
                class="flex items-center gap-1.5 px-4 py-3 rounded-xl transition-colors"
                :class="myRating === -1 ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'"
                :disabled="ratingLoading"
                @click="handleRate(-1)"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" :stroke-width="myRating === -1 ? 2.5 : 2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z M20 2h1a2 2 0 012 2v7a2 2 0 01-2 2h-1" />
                </svg>
              </button>

            </div>

            <!-- Progress bar -->
            <div
              v-if="media.watchProgress && !media.watchProgress.completed && progressPercent > 0"
              class="mt-4 max-w-md"
            >
              <div class="h-1 bg-white/20 rounded-full overflow-hidden">
                <div
                  class="h-full bg-primary"
                  :style="{ width: `${progressPercent}%` }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Details -->
      <div class="max-w-4xl mx-auto px-6 py-8">
        <!-- Tagline -->
        <p v-if="media.tagline" class="text-lg text-text-secondary italic mb-4">
          "{{ media.tagline }}"
        </p>

        <!-- Overview -->
        <div v-if="media.overview" class="mb-8">
          <div ref="overviewSectionRef">
          <h2 class="text-lg font-semibold text-text-primary mb-2">{{ t('media.overview') }}</h2>
          <p class="text-text-secondary leading-relaxed">
            {{ media.overview }}
          </p>
          </div>
        </div>

        <!-- Cast -->
        <div v-if="normalizedCast.length" ref="castSectionRef" class="mb-8">
          <h2 class="text-lg font-semibold text-text-primary mb-4">{{ t('media.casting') }}</h2>
          <div class="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
            <div
              v-for="actor in normalizedCast"
              :key="actor.name"
              class="flex-shrink-0 w-28 text-center group"
            >
              <div class="w-28 h-28 rounded-full overflow-hidden bg-surface mx-auto mb-2 ring-2 ring-transparent group-hover:ring-primary transition-all">
                <img
                  v-if="actor.profilePath"
                  :src="actor.profilePath"
                  :alt="actor.name"
                  class="w-full h-full object-cover"
                  loading="lazy"
                >
                <div v-else class="w-full h-full flex items-center justify-center">
                  <svg class="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
              <p class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">{{ actor.name }}</p>
              <p v-if="actor.character" class="text-xs text-text-muted truncate">{{ actor.character }}</p>
            </div>
          </div>
        </div>

        <!-- Technical info -->
        <div ref="metadataSectionRef" class="grid md:grid-cols-2 gap-6">
          <!-- Audio tracks -->
          <div v-if="media.audioTracks?.length">
            <h3 class="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">
              {{ t('media.audioTracks') }}
            </h3>
            <div class="space-y-2">
              <div
                v-for="audioTrack in media.audioTracks"
                :key="audioTrack.id"
                class="flex items-center gap-3 p-3 bg-surface rounded-lg"
              >
                <svg class="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
                <div>
                  <p class="text-sm text-text-primary">
                    {{ audioTrack.title || audioTrack.language || t('common.unknown') }}
                  </p>
                  <p class="text-xs text-text-muted">
                    {{ audioTrack.codec }} {{ audioTrack.channels ? `(${audioTrack.channels}ch)` : '' }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Subtitle tracks -->
          <div v-if="media.subtitleTracks?.length">
            <h3 class="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">
              {{ t('media.subtitles') }}
            </h3>
            <div class="space-y-2">
              <div
                v-for="subtitleTrack in media.subtitleTracks"
                :key="subtitleTrack.id"
                class="flex items-center gap-3 p-3 bg-surface rounded-lg"
              >
                <svg class="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                <div>
                  <p class="text-sm text-text-primary">
                    {{ subtitleTrack.title || subtitleTrack.language || t('common.unknown') }}
                  </p>
                  <p class="text-xs text-text-muted">
                    {{ subtitleTrack.codec }}
                    {{ subtitleTrack.isForced ? `(${t('media.forced')})` : '' }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Collection / Franchise -->
        <div v-if="collectionItems?.length" class="mt-8">
          <h2 class="text-lg font-semibold text-text-primary mb-4">
            {{ media.collectionName || t('media.sameCollection') }}
          </h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <NuxtLink
              v-for="item in collectionItems"
              :key="item.id"
              :to="`/media/${item.id}`"
              class="group block"
            >
              <div class="aspect-[2/3] rounded-xl overflow-hidden bg-surface">
                <img
                  v-if="item.posterPath"
                  :src="item.posterPath"
                  :alt="item.title"
                  class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                >
                <div v-else class="w-full h-full flex items-center justify-center">
                  <svg class="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                  </svg>
                </div>
              </div>
              <div class="mt-2 px-1">
                <p class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">{{ item.title }}</p>
                <p v-if="item.year" class="text-xs text-text-muted">{{ item.year }}</p>
              </div>
            </NuxtLink>
          </div>
        </div>

        <!-- Recommendations (local library) -->
        <div v-if="recommendations?.length" class="mt-8">
          <h2 class="text-lg font-semibold text-text-primary mb-4">{{ t('media.similarInLibrary') }}</h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <NuxtLink
              v-for="rec in recommendations"
              :key="rec.id"
              :to="`/media/${rec.id}`"
              class="group block"
            >
              <div class="aspect-[2/3] rounded-xl overflow-hidden bg-surface">
                <img
                  v-if="rec.posterPath"
                  :src="rec.posterPath"
                  :alt="rec.title"
                  class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                >
                <div v-else class="w-full h-full flex items-center justify-center">
                  <svg class="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                  </svg>
                </div>
              </div>
              <div class="mt-2 px-1">
                <p class="text-sm text-text-primary truncate group-hover:text-primary transition-colors">{{ rec.title }}</p>
                <p v-if="rec.year" class="text-xs text-text-muted">{{ rec.year }}</p>
              </div>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Media Edit Modal (admin only) -->
      <UiModal v-model="showEditModal" :title="t('mediaEdit.title')" size="lg">
        <form class="space-y-4" @submit.prevent="saveMediaInfo">
          <UiInput
            v-model="editTitle"
            :label="t('mediaEdit.titleLabel')"
          />

          <div class="grid grid-cols-2 gap-4">
            <UiInput
              v-model.number="editYear"
              type="number"
              :label="t('mediaEdit.year')"
              :min="1888"
              :max="2100"
            />
            <UiInput
              v-model.number="editRuntime"
              type="number"
              :label="t('mediaEdit.runtime')"
              :min="0"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              {{ t('mediaEdit.overview') }}
            </label>
            <textarea
              v-model="editOverview"
              class="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y min-h-[100px]"
              rows="4"
            />
          </div>

          <UiInput
            v-model="editTagline"
            :label="t('mediaEdit.tagline')"
          />

          <UiInput
            v-model="editGenres"
            :label="t('mediaEdit.genres')"
            :placeholder="t('mediaEdit.genresPlaceholder')"
          />

          <UiInput
            v-model.number="editRating"
            type="number"
            :label="t('mediaEdit.rating')"
            :min="0"
            :max="10"
            :step="0.1"
          />
        </form>

        <template #footer>
          <button
            type="button"
            class="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
            @click="showEditModal = false"
          >
            {{ t('common.cancel') }}
          </button>
          <UiButton
            :loading="editSaving"
            @click="saveMediaInfo"
          >
            {{ t('common.save') }}
          </UiButton>
        </template>
      </UiModal>

      <!-- Settings Modal -->
      <Teleport to="body">
        <div
          v-if="showSettingsModal"
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
          @click.self="showSettingsModal = false"
        >
          <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="showSettingsModal = false" />
          <div class="relative bg-surface rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-semibold text-text-primary">{{ t('media.fileInfo') }}</h3>
              <button
                type="button"
                class="p-1 text-text-muted hover:text-text-primary transition-colors"
                @click="showSettingsModal = false"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="overflow-y-auto space-y-4 flex-1 min-h-0">
              <!-- File path section -->
              <div class="space-y-3">
                <label class="block text-sm font-medium text-text-muted">{{ t('media.filePath') }}</label>
                <div v-if="isAdmin">
                  <input
                    v-model="editFilePath"
                    type="text"
                    class="w-full px-4 py-2.5 bg-background border border-white/10 rounded-xl text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                    :placeholder="t('media.filePathPlaceholder')"
                  >
                  <div class="flex items-center gap-3 mt-3">
                    <button
                      type="button"
                      class="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
                      :disabled="filePathSaving || editFilePath === media?.filePath"
                      @click="saveFilePath"
                    >
                      {{ filePathSaving ? t('media.saving') : t('common.save') }}
                    </button>
                    <span v-if="filePathSaved" class="text-sm text-green-400">{{ t('media.saved') }}</span>
                  </div>
                </div>
                <div v-else>
                  <p class="px-4 py-2.5 bg-background border border-white/10 rounded-xl text-text-secondary text-sm font-mono break-all select-all">
                    {{ media?.filePath || t('common.unknown') }}
                  </p>
                </div>
              </div>

              <!-- TMDB Re-identification (admin only) -->
              <div v-if="isAdmin" class="border-t border-border pt-4 space-y-3">
                <div>
                  <h4 class="text-sm font-semibold text-text-primary">{{ t('media.reidentify') }}</h4>
                  <p class="text-xs text-text-muted mt-0.5">{{ t('media.reidentifyDesc') }}</p>
                </div>

                <!-- Current TMDB ID -->
                <p class="text-xs text-text-muted">
                  {{ media?.tmdbId ? t('media.currentTmdbId', { id: media.tmdbId }) : t('media.noTmdbId') }}
                </p>

                <!-- Success message -->
                <div v-if="reidentifyDone" class="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl">
                  <svg class="w-4 h-4 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span class="text-sm text-green-400">{{ t('media.reidentifySuccess') }}</span>
                </div>

                <!-- Search input -->
                <div v-if="!reidentifyDone" class="relative">
                  <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    v-model="tmdbQuery"
                    type="text"
                    class="w-full pl-10 pr-4 py-2.5 bg-background border border-white/10 rounded-xl text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    :placeholder="t('media.tmdbSearchPlaceholder')"
                    @input="searchTmdbDebounced"
                  >
                </div>

                <!-- Loading -->
                <div v-if="tmdbSearching" class="flex items-center justify-center py-4">
                  <div class="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span class="ml-2 text-sm text-text-muted">{{ t('media.searching') }}</span>
                </div>

                <!-- Results -->
                <div v-if="tmdbResults.length > 0 && !reidentifyDone" class="space-y-2 max-h-60 overflow-y-auto">
                  <button
                    v-for="result in tmdbResults"
                    :key="result.id"
                    type="button"
                    class="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors text-left"
                    :disabled="reidentifying"
                    @click="reidentifyMedia(result.id)"
                  >
                    <div class="w-10 h-14 rounded-lg overflow-hidden bg-surface-secondary flex-shrink-0">
                      <img
                        v-if="result.image"
                        :src="result.image"
                        :alt="result.title"
                        class="w-full h-full object-cover"
                      >
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-text-primary truncate">{{ result.title }}</p>
                      <div class="flex items-center gap-2 text-xs text-text-muted">
                        <span v-if="result.releaseDate">{{ result.releaseDate.substring(0, 4) }}</span>
                        <span v-if="result.rating" class="flex items-center gap-0.5">
                          <svg class="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                          {{ result.rating.toFixed(1) }}
                        </span>
                        <span class="text-text-muted/50">ID: {{ result.id }}</span>
                      </div>
                    </div>
                    <div v-if="reidentifying" class="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  </button>
                </div>

                <!-- No results -->
                <p v-if="!tmdbSearching && tmdbSearched && tmdbResults.length === 0 && !reidentifyDone" class="text-sm text-text-muted text-center py-3">
                  {{ t('media.noResults') }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </div>
</template>
