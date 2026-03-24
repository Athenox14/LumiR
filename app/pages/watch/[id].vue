<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
  layout: false,
})

const { t } = useI18n()
const route = useRoute()
const trpc = useTrpc()

const mediaId = computed(() => route.params.id as string)

const { data: media, pending, error } = useAsyncData(
  `watch-${mediaId.value}`,
  () => trpc.media.getById.query(mediaId.value)
)

useHead({ title: computed(() => media.value?.title || t('common.loading')) })

// Detect stream type: native (direct) or HLS (transcode)
const { data: streamInfo, pending: streamPending } = useAsyncData(
  `stream-info-${mediaId.value}`,
  () => $fetch<{ isNative: boolean, streamUrl: string, duration: number }>(`/api/stream/${mediaId.value}/info`)
)

// Track current playback position (for resuming after audio track switch)
const currentPosition = ref(0)

// Audio track selection (absolute stream index from ffprobe)
const selectedAudioTrack = ref<number | undefined>(undefined)

const streamUrl = computed(() => {
  let url = streamInfo.value?.streamUrl || ''
  // Append audioTrack param for HLS streams when a specific track is selected
  if (selectedAudioTrack.value !== undefined && url.includes('.m3u8')) {
    url += (url.includes('?') ? '&' : '?') + `audioTrack=${selectedAudioTrack.value}`
  }
  // Append subtitleTrack param for burn-in subtitles (bitmap codecs rendered into video by ffmpeg)
  if (selectedBurnInSubtitle.value !== undefined && url.includes('.m3u8')) {
    url += (url.includes('?') ? '&' : '?') + `subtitleTrack=${selectedBurnInSubtitle.value}`
  }
  return url
})

// Text-based subtitle codecs that ffmpeg can convert to WebVTT
// Bitmap codecs (hdmv_pgs_subtitle, dvd_subtitle, dvb_subtitle) require burn-in
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'srt'])

// Transform DB subtitle tracks into URLs for the VideoPlayer (text subtitles only)
const subtitleUrls = computed(() => {
  if (!media.value?.subtitleTracks?.length) return []
  return media.value.subtitleTracks
    .filter(track => !track.codec || TEXT_SUBTITLE_CODECS.has(track.codec))
    .map(track => ({
      url: `/api/stream/${mediaId.value}/subtitle/${track.trackIndex}`,
      lang: track.language || 'und',
      label: track.title || track.language || `Track ${track.trackIndex}`,
    }))
})

// Bitmap subtitles that require burn-in (rendered into the video by ffmpeg)
const burnInSubtitles = computed(() => {
  if (!media.value?.subtitleTracks?.length) return []
  return media.value.subtitleTracks
    .filter(track => track.codec && !TEXT_SUBTITLE_CODECS.has(track.codec))
    .map(track => ({
      trackIndex: track.trackIndex,
      lang: track.language || 'und',
      label: track.title || track.language || `Track ${track.trackIndex}`,
      codec: track.codec,
    }))
})

// Currently selected burn-in subtitle track index (absolute ffprobe index)
const selectedBurnInSubtitle = ref<number | undefined>(undefined)

const backUrl = computed(() => {
  if (!media.value) return '/'
  if (media.value.mediaType === 'tv' && media.value.tmdbId) {
    return `/tv/${media.value.tmdbId}`
  }
  return `/media/${mediaId.value}`
})

const displayTitle = computed(() => {
  if (!media.value) return ''
  const m = media.value
  if (m.mediaType === 'tv' && m.season != null && m.episode != null) {
    const ep = `S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}`
    return `${m.title} - ${ep}`
  }
  return m.title
})

async function handleProgress(position: number, duration: number) {
  currentPosition.value = position
  try {
    await trpc.media.updateProgress.mutate({
      mediaId: mediaId.value,
      position: Math.floor(position),
      duration: Math.floor(duration),
    })
  } catch (e) {
    console.error('Failed to save progress:', e)
  }
}

function handleAudioTrackChange(trackIndex: number) {
  selectedAudioTrack.value = trackIndex
}

function handleBurnInSubtitleChange(trackIndex: number | undefined) {
  selectedBurnInSubtitle.value = trackIndex
}

async function handleEnded() {
  // For TV shows, try to auto-play next episode
  if (media.value?.mediaType === 'tv') {
    try {
      const next = await trpc.media.getNextEpisode.query(mediaId.value)
      if (next?.nextId) {
        navigateTo(`/watch/${next.nextId}`)
        return
      }
    } catch (e) {
      console.error('Failed to get next episode:', e)
    }
  }
  // Fallback: go back to media/show page
  navigateTo(backUrl.value)
}
</script>

<template>
  <div class="fixed inset-0 bg-black">
    <!-- Loading -->
    <div v-if="pending || streamPending" class="flex items-center justify-center h-full">
      <div class="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex items-center justify-center h-full text-white">
      <p>{{ t('watch.failedToLoad') }}</p>
    </div>

    <!-- Player -->
    <MediaVideoPlayer
      v-else-if="media && streamUrl"
      :src="streamUrl"
      :poster="media.backdropPath || media.posterPath || undefined"
      :media-id="mediaId"
      :title="displayTitle"
      :back-url="backUrl"
      :initial-position="currentPosition > 0 ? currentPosition : (media.watchProgress?.position || 0)"
      :audio-tracks="media.audioTracks"
      :subtitles="subtitleUrls"
      :burn-in-subtitles="burnInSubtitles"
      :active-burn-in-subtitle="selectedBurnInSubtitle"
      :known-duration="streamInfo?.duration || (media.runtime ? media.runtime * 60 : 0)"
      autoplay
      @progress="handleProgress"
      @ended="handleEnded"
      @change-audio-track="handleAudioTrackChange"
      @change-burn-in-subtitle="handleBurnInSubtitleChange"
    />
  </div>
</template>
