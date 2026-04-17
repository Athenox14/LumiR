<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
  layout: false,
})

const { t } = useI18n()
const route = useRoute()
const trpc = useTrpc()
const { track: analyticsTrack } = useAnalytics()

const mediaId = computed(() => route.params.id as string)
const watchOpenedAt = Date.now()
const watchStarted = ref(false)
const watchCompleted = ref(false)
const watchPaused = ref(false)

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
let lastTrackedWatchBucket = -1

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

  const watchBucket = Math.floor(position / 120)
  if (watchBucket > lastTrackedWatchBucket) {
    lastTrackedWatchBucket = watchBucket
    analyticsTrack('WATCH_PROGRESS', mediaId.value, {
      position: Math.floor(position),
      duration: Math.floor(duration),
      deltaSeconds: 120,
      completionRate: duration > 0 ? position / duration : 0,
      clientAt: new Date().toISOString(),
    })
  }

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
  const selectedTrack = media.value?.audioTracks?.find(track => track.trackIndex === trackIndex)
  analyticsTrack('WATCH_AUDIO_CHANGE', mediaId.value, {
    trackIndex,
    language: selectedTrack?.language || null,
    label: selectedTrack?.title || null,
    clientAt: new Date().toISOString(),
  })
}

function handleBurnInSubtitleChange(trackIndex: number | undefined) {
  selectedBurnInSubtitle.value = trackIndex
  const selectedTrack = media.value?.subtitleTracks?.find(track => track.trackIndex === trackIndex)
  analyticsTrack('WATCH_SUBTITLE_CHANGE', mediaId.value, {
    trackIndex,
    mode: trackIndex == null ? 'off' : 'burn-in',
    language: selectedTrack?.language || null,
    label: selectedTrack?.title || null,
    clientAt: new Date().toISOString(),
  })
}

function handlePlay(position: number) {
  const now = new Date().toISOString()
  if (!watchStarted.value) {
    watchStarted.value = true
    analyticsTrack('WATCH_START', mediaId.value, {
      position: Math.floor(position),
      resume: (media.value?.watchProgress?.position || 0) > 0,
      delayFromOpenMs: Date.now() - watchOpenedAt,
      clientAt: now,
    })
    return
  }
  if (watchPaused.value) {
    watchPaused.value = false
    analyticsTrack('WATCH_RESUME', mediaId.value, {
      position: Math.floor(position),
      clientAt: now,
    })
  }
}

function handlePause(position: number) {
  watchPaused.value = true
  analyticsTrack('WATCH_PAUSE', mediaId.value, {
    position: Math.floor(position),
    clientAt: new Date().toISOString(),
  })
}

function handleSeek(from: number, to: number) {
  analyticsTrack('WATCH_SEEK', mediaId.value, {
    from: Math.floor(from),
    to: Math.floor(to),
    delta: Math.floor(to - from),
    direction: to >= from ? 'forward' : 'backward',
    clientAt: new Date().toISOString(),
  })
}

function handleFullscreenChange(fullscreen: boolean) {
  analyticsTrack('WATCH_FULLSCREEN_CHANGE', mediaId.value, {
    fullscreen,
    clientAt: new Date().toISOString(),
  })
}

async function handleEnded() {
  // Guard: only navigate if we're actually near the end of the video.
  // HLS.js may emit 'ended' on fatal errors (e.g. after seek failures),
  // which would incorrectly navigate the user away from the player.
  const duration = streamInfo.value?.duration || (media.value?.runtime ? media.value.runtime * 60 : 0)
  if (duration > 0 && currentPosition.value < duration - 120) {
    console.warn('[Watch] Premature ended event at', currentPosition.value, '- resuming (end is', duration, ')')
    // HLS.js can fire spurious ended events after seeks. Resume playback.
    nextTick(() => {
      const player = document.querySelector('media-player') as any
      if (player) {
        player.play?.()
      }
    })
    return
  }

  watchCompleted.value = true
  analyticsTrack('WATCH_COMPLETE', mediaId.value, {
    position: Math.floor(currentPosition.value),
    duration: Math.floor(duration),
    positionRatio: duration > 0 ? currentPosition.value / duration : 1,
    clientAt: new Date().toISOString(),
  })

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

onUnmounted(() => {
  const duration = streamInfo.value?.duration || (media.value?.runtime ? media.value.runtime * 60 : 0)
  if (!watchStarted.value || watchCompleted.value || !media.value) return
  analyticsTrack('WATCH_STOP', mediaId.value, {
    position: Math.floor(currentPosition.value),
    duration: Math.floor(duration),
    positionRatio: duration > 0 ? currentPosition.value / duration : 0,
    quickAbandon: currentPosition.value < 300,
    reason: watchPaused.value ? 'paused-exit' : 'left-player',
    timeSinceOpenMs: Date.now() - watchOpenedAt,
    clientAt: new Date().toISOString(),
  })
})
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
      @play="handlePlay"
      @pause="handlePause"
      @seek="handleSeek"
      @change-audio-track="handleAudioTrackChange"
      @change-burn-in-subtitle="handleBurnInSubtitleChange"
      @fullscreen-change="handleFullscreenChange"
    />
  </div>
</template>
