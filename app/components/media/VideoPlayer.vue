<script setup lang="ts">
import Hls from 'hls.js'

const { t } = useI18n()

interface Props {
  src: string
  fallbackSrc?: string
  poster?: string
  mediaId: string
  title?: string
  backUrl?: string
  initialPosition?: number
  audioTracks?: Array<{
    id: string
    language?: string | null
    title?: string | null
    trackIndex: number
  }>
  subtitleTracks?: Array<{
    id: string
    language?: string | null
    title?: string | null
    trackIndex: number
  }>
  subtitles?: Array<{
    url: string
    lang: string
    label?: string
  }>
  burnInSubtitles?: Array<{
    trackIndex: number
    lang: string
    label: string
    codec?: string | null
  }>
  activeBurnInSubtitle?: number
  autoplay?: boolean
  knownDuration?: number
}

const props = withDefaults(defineProps<Props>(), {
  initialPosition: 0,
  autoplay: false,
  knownDuration: 0,
})

const emit = defineEmits<{
  progress: [position: number, duration: number]
  ended: []
  error: []
  changeAudioTrack: [trackIndex: number]
  changeBurnInSubtitle: [trackIndex: number | undefined]
}>()

const trpc = useTrpc()
const videoRef = ref<HTMLVideoElement | null>(null)
const containerRef = ref<HTMLElement | null>(null)

const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const muted = ref(false)
const showControls = ref(true)
const isFullscreen = ref(false)
const buffered = ref(0)
const loading = ref(true)
const showSettings = ref(false)
const activeSubtitleIndex = ref(-1)
const showSubtitleMenu = ref(false)
const hlsAudioTracks = ref<Array<{id: number, name: string, lang: string}>>([])
const activeAudioTrack = ref(0)
const showAudioMenu = ref(false)
const hlsQualityLevels = ref<Array<{id: number, height: number, label: string}>>([])
const activeQualityLevel = ref(-1)
const showQualityMenu = ref(false)
const subtitleLoading = ref(false)
const castAvailable = ref(false)
const isCasting = ref(false)
const castSupported = ref(false)
const showCastMenu = ref(false)
const castDeviceName = ref('')

// Subtitle system — fetches the full track once, adds cues via TextTrack API
let activeTextTrack: TextTrack | null = null

// Use knownDuration when available (fragmented MP4 reports growing partial duration).
// Only use video.duration if it's finite AND close to/exceeds knownDuration (i.e. fully loaded).
const effectiveDuration = computed(() => {
  if (props.knownDuration > 0) {
    if (duration.value && isFinite(duration.value) && duration.value >= props.knownDuration * 0.9) {
      return duration.value
    }
    return props.knownDuration
  }
  if (duration.value && isFinite(duration.value) && duration.value > 0) return duration.value
  return 0
})

let hls: Hls | null = null
let hideControlsTimeout: NodeJS.Timeout | null = null
let usedFallback = false
let progressSaveInterval: NodeJS.Timeout | null = null

// Cast: setup detection for Chromecast (Remote Playback API) and AirPlay (WebKit)
function setupCastDetection(video: HTMLVideoElement) {
  // Chrome / Chromium — Remote Playback API
  if ('remote' in video) {
    castSupported.value = true
    const remote = (video as any).remote
    remote.watchAvailability((available: boolean) => {
      castAvailable.value = available
    }).catch(() => {
      // watchAvailability not supported — we can still try prompt()
    })
    remote.addEventListener('connecting', () => {
      isCasting.value = true
      castDeviceName.value = ''
    })
    remote.addEventListener('connect', () => {
      isCasting.value = true
    })
    remote.addEventListener('disconnect', () => {
      isCasting.value = false
      castDeviceName.value = ''
    })
  }

  // Safari — WebKit AirPlay
  if ('webkitShowPlaybackTargetPicker' in video) {
    castSupported.value = true
    video.addEventListener('webkitplaybacktargetavailabilitychanged', ((e: any) => {
      castAvailable.value = e.availability === 'available'
    }) as EventListener)
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', (() => {
      isCasting.value = !!(video as any).webkitCurrentPlaybackTargetIsWireless
    }) as EventListener)
  }
}

async function startCast() {
  const video = videoRef.value
  if (!video) return

  showCastMenu.value = false

  // Chrome — Remote Playback API
  if ('remote' in video) {
    try {
      await (video as any).remote.prompt()
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError') {
        console.log('[Cast] Remote playback prompt failed:', e)
      }
    }
    return
  }

  // Safari — AirPlay
  if ('webkitShowPlaybackTargetPicker' in video) {
    (video as any).webkitShowPlaybackTargetPicker()
  }
}

function stopCast() {
  const video = videoRef.value
  if (!video) return

  showCastMenu.value = false

  // Remote Playback API — prompt again toggles off
  if ('remote' in video) {
    (video as any).remote.prompt().catch(() => {})
    return
  }

  // AirPlay — show picker again to disconnect
  if ('webkitShowPlaybackTargetPicker' in video) {
    (video as any).webkitShowPlaybackTargetPicker()
  }
}

onMounted(() => {
  if (!videoRef.value) return

  const video = videoRef.value

  const isHls = props.src.includes('.m3u8') || props.src.includes('/hls')

  if (isHls && Hls.isSupported()) {
    console.log(`[VideoPlayer] HLS mode, src=${props.src}, initialPosition=${props.initialPosition}`)
    // HLS streaming (for transcoded content)
    hls = new Hls({
      startPosition: props.initialPosition,
      // Faster startup: reduce buffer requirements so playback starts sooner
      maxBufferLength: 10,
      maxMaxBufferLength: 30,
      maxBufferSize: 30 * 1000 * 1000, // 30MB
      maxBufferHole: 0.5,
      // Start playing as soon as first segment is ready
      startFragPrefetch: true,
    })
    hls.loadSource(props.src)
    hls.attachMedia(video)

    hls.on(Hls.Events.MANIFEST_LOADING, () => {
      console.log('[VideoPlayer] HLS manifest loading...')
    })
    hls.on(Hls.Events.MANIFEST_LOADED, (_ev: any, data: any) => {
      console.log(`[VideoPlayer] HLS manifest loaded: ${data.levels?.length || 0} levels, ${data.networkDetails?.response?.length || '?'} bytes`)
    })
    hls.on(Hls.Events.LEVEL_LOADING, (_ev: any, data: any) => {
      console.log(`[VideoPlayer] HLS level loading: level=${data.level}`)
    })
    hls.on(Hls.Events.FRAG_LOADING, (_ev: any, data: any) => {
      console.log(`[VideoPlayer] HLS fragment loading: sn=${data.frag?.sn}, start=${data.frag?.start?.toFixed(1)}s, url=${data.frag?.url}`)
    })
    hls.on(Hls.Events.FRAG_LOADED, (_ev: any, data: any) => {
      console.log(`[VideoPlayer] HLS fragment LOADED: sn=${data.frag?.sn}, bytes=${data.frag?.stats?.total || '?'}`)
    })
    hls.on(Hls.Events.LEVEL_LOADED, (_ev: any, data: any) => {
      const totalDur = data.details?.totalduration
      console.log(`[VideoPlayer] HLS level loaded: level=${data.level}, fragments=${data.details?.fragments?.length || 0}, totalDuration=${totalDur}`)
      // Set duration from HLS playlist ASAP (video.duration may not be set yet)
      if (totalDur && totalDur > 0 && (!duration.value || !isFinite(duration.value) || duration.value <= 0)) {
        duration.value = totalDur
        console.log(`[VideoPlayer] Duration set from HLS playlist: ${totalDur}s`)
      }
    })

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log(`[VideoPlayer] HLS manifest parsed: ${hls!.levels.length} levels`)
      loading.value = false
      hlsQualityLevels.value = hls!.levels.map((level: any, i: number) => ({
        id: i,
        height: level.height,
        label: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)}kbps`,
      }))
      if (props.initialPosition > 0) {
        video.currentTime = props.initialPosition
      }
      if (props.autoplay) video.play().catch(() => {})
    })

    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      hlsAudioTracks.value = hls!.audioTracks.map((t: any) => ({
        id: t.id,
        name: t.name || t.lang || `Audio ${t.id + 1}`,
        lang: t.lang || '',
      }))
      if (hls!.audioTrack >= 0) activeAudioTrack.value = hls!.audioTrack
    })
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_ev: any, data: any) => {
      activeAudioTrack.value = data.id
    })

    let mediaRecoveryAttempts = 0
    hls.on(Hls.Events.ERROR, (_event, data) => {
      console.error('HLS error:', data.type, data.details)

      // Try to recover from non-fatal media errors (bufferAppendError etc.)
      if (!data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (mediaRecoveryAttempts < 3) {
          mediaRecoveryAttempts++
          console.log(`HLS: Recovering from media error (attempt ${mediaRecoveryAttempts})`)
          hls!.recoverMediaError()
          return
        }
      }

      if (data.fatal) {
        // For fatal media errors, try recoverMediaError first
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveryAttempts < 5) {
          mediaRecoveryAttempts++
          console.log(`HLS: Fatal media error recovery (attempt ${mediaRecoveryAttempts})`)
          hls!.recoverMediaError()
          return
        }

        // If we have a fallback source and haven't tried it yet, switch to it
        if (props.fallbackSrc && !usedFallback) {
          console.log('HLS: Primary source failed, trying fallback:', props.fallbackSrc)
          usedFallback = true
          loading.value = true
          hls!.destroy()
          hls = new Hls({
            startPosition: props.initialPosition,
          })
          hls.loadSource(props.fallbackSrc)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            loading.value = false
            if (props.initialPosition > 0) {
              video.currentTime = props.initialPosition
            }
          })
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
            hlsAudioTracks.value = hls!.audioTracks.map((t: any) => ({
              id: t.id,
              name: t.name || t.lang || `Audio ${t.id + 1}`,
              lang: t.lang || '',
            }))
            if (hls!.audioTrack >= 0) activeAudioTrack.value = hls!.audioTrack
          })
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_ev: any, d: any) => {
            activeAudioTrack.value = d.id
          })
          hls.on(Hls.Events.ERROR, (_ev, d) => {
            console.error('HLS fallback error:', d.type, d.details)
            if (d.fatal) {
              loading.value = false
              emit('error')
            }
          })
        } else {
          loading.value = false
        }
      }
    })
  } else {
    // Direct playback (native browser support)
    video.src = props.src
    video.addEventListener('loadedmetadata', () => {
      loading.value = false
      if (props.initialPosition > 0) {
        video.currentTime = props.initialPosition
      }
      if (props.autoplay) video.play().catch(() => {})
    })
    video.addEventListener('error', () => {
      console.error('Video playback error:', video.error)
      // Fallback: try proxy URL if available
      if (props.fallbackSrc && !usedFallback) {
        console.log('MP4: Primary source failed, trying fallback:', props.fallbackSrc)
        usedFallback = true
        loading.value = true
        const fallbackIsHls = props.fallbackSrc.includes('.m3u8') || props.fallbackSrc.includes('/hls')
        if (fallbackIsHls && Hls.isSupported()) {
          hls = new Hls({ startPosition: props.initialPosition })
          hls.loadSource(props.fallbackSrc)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            loading.value = false
            if (props.initialPosition > 0) video.currentTime = props.initialPosition
          })
          hls.on(Hls.Events.ERROR, (_ev, d) => {
            if (d.fatal) {
              loading.value = false
              emit('error')
            }
          })
        } else {
          video.src = props.fallbackSrc
          // loadedmetadata listener above handles the rest
        }
      } else {
        loading.value = false
        emit('error')
      }
    }, { once: true })
  }

  // Event listeners
  video.addEventListener('play', () => {
    playing.value = true
  })
  video.addEventListener('pause', () => {
    playing.value = false
  })
  video.addEventListener('timeupdate', () => {
    currentTime.value = video.currentTime
  })
  video.addEventListener('durationchange', () => {
    duration.value = video.duration
  })
  video.addEventListener('volumechange', () => {
    volume.value = video.volume
    muted.value = video.muted
  })
  video.addEventListener('progress', () => {
    if (video.buffered.length > 0) {
      buffered.value = video.buffered.end(video.buffered.length - 1)
    }
  })
  video.addEventListener('waiting', () => {
    loading.value = true
  })
  video.addEventListener('canplay', () => {
    loading.value = false
    // Retry autoplay on canplay (loadedmetadata may fire before enough data is available)
    if (props.autoplay && !playing.value) {
      video.play().catch(() => {})
    }
  })
  video.addEventListener('ended', () => {
    emit('ended')
  })

  // Fullscreen change
  document.addEventListener('fullscreenchange', () => {
    isFullscreen.value = !!document.fullscreenElement
  })

  // Save progress periodically
  progressSaveInterval = setInterval(() => {
    if (playing.value && currentTime.value > 0) {
      emit('progress', currentTime.value, effectiveDuration.value)
    }
  }, 10000)

  // Keyboard controls
  document.addEventListener('keydown', handleKeydown)

  // Cast detection (Chromecast / AirPlay)
  setupCastDetection(video)

  // Subtitles are loaded lazily when the user selects one (avoids I/O contention at startup)
})

onUnmounted(() => {
  if (hls) {
    hls.destroy()
  }
  if (progressSaveInterval) {
    clearInterval(progressSaveInterval)
  }
  document.removeEventListener('keydown', handleKeydown)

  // Save final progress
  if (currentTime.value > 0) {
    emit('progress', currentTime.value, effectiveDuration.value)
  }
})

function handleKeydown(e: KeyboardEvent) {
  if (!videoRef.value) return

  switch (e.key) {
    case ' ':
    case 'k':
      e.preventDefault()
      togglePlay()
      break
    case 'ArrowLeft':
      e.preventDefault()
      seek(-10)
      break
    case 'ArrowRight':
      e.preventDefault()
      seek(10)
      break
    case 'ArrowUp':
      e.preventDefault()
      adjustVolume(0.1)
      break
    case 'ArrowDown':
      e.preventDefault()
      adjustVolume(-0.1)
      break
    case 'm':
      e.preventDefault()
      toggleMute()
      break
    case 'f':
      e.preventDefault()
      toggleFullscreen()
      break
    case 'c':
      e.preventDefault()
      if (props.subtitles?.length || props.burnInSubtitles?.length) {
        // Toggle: if any subtitle is active, turn off; otherwise activate first available
        if (activeSubtitleIndex.value >= 0 || props.activeBurnInSubtitle !== undefined) {
          setSubtitle(-1)
          setBurnInSubtitle(undefined)
        } else if (props.subtitles?.length) {
          setSubtitle(0)
        } else if (props.burnInSubtitles?.length) {
          setBurnInSubtitle(props.burnInSubtitles[0].trackIndex)
        }
      }
      break
    case 'a':
      e.preventDefault()
      if (hasHlsAudioMenu.value) {
        const next = (activeAudioTrack.value + 1) % hlsAudioTracks.value.length
        setAudioTrack(next)
      } else if (hasLocalAudioMenu.value && props.audioTracks?.length) {
        const currentIdx = props.audioTracks.findIndex(t => t.trackIndex === activeLocalAudioTrack.value)
        const nextIdx = (currentIdx + 1) % props.audioTracks.length
        setLocalAudioTrack(props.audioTracks[nextIdx].trackIndex)
      }
      break
    case 'q':
      e.preventDefault()
      if (hlsQualityLevels.value.length > 1) {
        // Cycle: auto(-1) → 0 → 1 → ... → auto(-1)
        const next = activeQualityLevel.value + 1 >= hlsQualityLevels.value.length ? -1 : activeQualityLevel.value + 1
        setQualityLevel(next)
      }
      break
  }
}

function togglePlay() {
  if (!videoRef.value) return
  showSubtitleMenu.value = false
  showAudioMenu.value = false
  showQualityMenu.value = false

  if (playing.value) {
    videoRef.value.pause()
  } else {
    videoRef.value.play()
  }
}

function seek(seconds: number) {
  if (!videoRef.value) return
  videoRef.value.currentTime = Math.max(0, Math.min(videoRef.value.currentTime + seconds, effectiveDuration.value))
}

function seekTo(time: number) {
  if (!videoRef.value) return
  videoRef.value.currentTime = time
}

function adjustVolume(delta: number) {
  if (!videoRef.value) return
  videoRef.value.volume = Math.max(0, Math.min(1, volume.value + delta))
}

function setVolume(value: number) {
  if (!videoRef.value) return
  videoRef.value.volume = value
}

function toggleMute() {
  if (!videoRef.value) return
  videoRef.value.muted = !videoRef.value.muted
}

function toggleFullscreen() {
  if (!containerRef.value) return

  if (isFullscreen.value) {
    document.exitFullscreen()
  } else {
    containerRef.value.requestFullscreen()
  }
}

// Parse VTT content into individual cues
function parseVttCues(vttText: string): Array<{ start: number, end: number, text: string }> {
  const cues: Array<{ start: number, end: number, text: string }> = []
  // Split on double newlines to get blocks
  const blocks = vttText.split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/)
      if (match) {
        const start = parseVttTime(match[1])
        const end = parseVttTime(match[2])
        const text = lines.slice(i + 1).join('\n').trim()
        if (text) cues.push({ start, end, text })
        break
      }
    }
  }
  return cues
}

function parseVttTime(time: string): number {
  const parts = time.replace(',', '.').split(':')
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])
}

async function setSubtitle(index: number) {
  if (!videoRef.value) return
  const video = videoRef.value

  // Hide all subtitle tracks
  for (let i = 0; i < video.textTracks.length; i++) {
    if (video.textTracks[i].kind === 'subtitles') {
      video.textTracks[i].mode = 'hidden'
    }
  }

  showSubtitleMenu.value = false

  if (index < 0 || !props.subtitles?.[index]) {
    activeSubtitleIndex.value = index
    activeTextTrack = null
    return
  }

  const sub = props.subtitles[index]
  activeSubtitleIndex.value = index

  // Create a new TextTrack
  activeTextTrack = video.addTextTrack('subtitles', sub.label || sub.lang, sub.lang)
  activeTextTrack.mode = 'showing'

  // Fetch the full subtitle track
  subtitleLoading.value = true
  try {
    console.log(`[Subtitles] Fetching full track: ${sub.url}`)
    const res = await fetch(sub.url)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    let text = await res.text()
    // Ensure VTT format (in case server returns SRT)
    if (!text.trimStart().startsWith('WEBVTT')) {
      text = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    }

    const cues = parseVttCues(text)
    console.log(`[Subtitles] Parsed ${cues.length} cues`)

    for (const cue of cues) {
      try {
        activeTextTrack.addCue(new VTTCue(cue.start, cue.end, cue.text))
      } catch (e) {
        // Skip invalid cues silently
      }
    }
  } catch (err) {
    console.error(`[Subtitles] Failed to load subtitle track:`, err)
    activeSubtitleIndex.value = -1
    activeTextTrack = null
  }
  subtitleLoading.value = false
}

function setBurnInSubtitle(trackIndex: number | undefined) {
  showSubtitleMenu.value = false
  // Disable any active text subtitle when switching to burn-in
  if (trackIndex !== undefined && activeSubtitleIndex.value >= 0) {
    setSubtitle(-1)
  }
  emit('changeBurnInSubtitle', trackIndex)
}

function setAudioTrack(index: number) {
  if (hls) {
    hls.audioTrack = index
  }
  activeAudioTrack.value = index
  showAudioMenu.value = false
}

// Local (DB-sourced) audio track selection — emits event to parent which changes the stream URL
const activeLocalAudioTrack = ref<number | null>(null)
function setLocalAudioTrack(trackIndex: number) {
  activeLocalAudioTrack.value = trackIndex
  showAudioMenu.value = false
  emit('changeAudioTrack', trackIndex)
}

// Determine which audio source to show in the menu
const hasHlsAudioMenu = computed(() => hlsAudioTracks.value.length > 1)
const hasLocalAudioMenu = computed(() => !hasHlsAudioMenu.value && (props.audioTracks?.length || 0) > 1)

function setQualityLevel(levelIndex: number) {
  if (hls) hls.currentLevel = levelIndex
  activeQualityLevel.value = levelIndex
  showQualityMenu.value = false
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

function handleProgressClick(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const percent = (e.clientX - rect.left) / rect.width
  seekTo(percent * effectiveDuration.value)
}

function handleMouseMove() {
  showControls.value = true

  if (hideControlsTimeout) {
    clearTimeout(hideControlsTimeout)
  }

  if (playing.value) {
    hideControlsTimeout = setTimeout(() => {
      showControls.value = false
    }, 3000)
  }
}
</script>

<template>
  <div
    ref="containerRef"
    class="relative w-full h-full bg-black group"
    :class="{ 'cursor-none': !showControls && playing }"
    @mousemove="handleMouseMove"
    @mouseleave="playing && (showControls = false)"
  >
    <!-- Video element -->
    <video
      ref="videoRef"
      class="w-full h-full"
      :poster="poster"
      playsinline
      x-webkit-airplay="allow"
      @click="togglePlay"
      @dblclick="toggleFullscreen"
    />

    <!-- Top bar (back + title) -->
    <div
      v-if="title || backUrl"
      :class="[
        'absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 z-30',
        showControls || !playing ? 'opacity-100' : 'opacity-0 pointer-events-none',
      ]"
    >
      <div class="flex items-center gap-3 px-4 pt-4 pb-12">
        <NuxtLink
          v-if="backUrl"
          :to="backUrl"
          class="flex-shrink-0 p-2 rounded-lg hover:bg-white/10 transition-colors"
        >
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </NuxtLink>
        <p v-if="title" class="text-white text-lg font-medium truncate">{{ title }}</p>
      </div>
    </div>

    <!-- Loading overlay -->
    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center bg-black/50"
    >
      <div class="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>

    <!-- Play button overlay (when paused) -->
    <div
      v-if="!playing && !loading"
      class="absolute inset-0 flex items-center justify-center cursor-pointer"
      @click="togglePlay"
    >
      <div class="w-20 h-20 rounded-full bg-primary/90 hover:bg-primary flex items-center justify-center transition-colors">
        <svg class="w-10 h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
    </div>

    <!-- Controls -->
    <div
      :class="[
        'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-300',
        showControls || !playing ? 'opacity-100' : 'opacity-0 pointer-events-none',
      ]"
    >
      <div class="px-4 pb-4 pt-16">
        <!-- Progress bar -->
        <div
          class="relative h-1 bg-white/20 rounded-full cursor-pointer group/progress mb-4"
          @click="handleProgressClick"
        >
          <!-- Buffered -->
          <div
            class="absolute h-full bg-white/30 rounded-full"
            :style="{ width: `${effectiveDuration ? (buffered / effectiveDuration) * 100 : 0}%` }"
          />
          <!-- Progress -->
          <div
            class="absolute h-full bg-primary rounded-full"
            :style="{ width: `${effectiveDuration ? (currentTime / effectiveDuration) * 100 : 0}%` }"
          />
          <!-- Knob -->
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity"
            :style="{ left: `calc(${effectiveDuration ? (currentTime / effectiveDuration) * 100 : 0}% - 6px)` }"
          />
        </div>

        <!-- Controls row -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <!-- Play/Pause -->
            <button
              type="button"
              class="p-2 hover:bg-white/10 rounded-lg transition-colors"
              @click="togglePlay"
            >
              <svg v-if="playing" class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
              <svg v-else class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>

            <!-- Skip buttons -->
            <button
              type="button"
              class="p-2 hover:bg-white/10 rounded-lg transition-colors"
              @click="seek(-10)"
            >
              <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
              </svg>
            </button>
            <button
              type="button"
              class="p-2 hover:bg-white/10 rounded-lg transition-colors"
              @click="seek(10)"
            >
              <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
              </svg>
            </button>

            <!-- Volume -->
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="p-2 hover:bg-white/10 rounded-lg transition-colors"
                @click="toggleMute"
              >
                <svg v-if="muted || volume === 0" class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                </svg>
                <svg v-else-if="volume < 0.5" class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
                </svg>
                <svg v-else class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                :value="volume"
                class="w-20 h-1 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                @input="setVolume(parseFloat(($event.target as HTMLInputElement).value))"
              >
            </div>

            <!-- Time -->
            <span class="text-sm text-white/80">
              {{ formatTime(currentTime) }} / {{ formatTime(effectiveDuration) }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <!-- Audio tracks (HLS-based) -->
            <div v-if="hasHlsAudioMenu" class="relative">
              <button
                type="button"
                class="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
                @click.stop="showAudioMenu = !showAudioMenu; showSubtitleMenu = false; showQualityMenu = false; showCastMenu = false"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </button>
              <div
                v-if="showAudioMenu"
                class="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur rounded-lg border border-white/10 py-1 min-w-[180px] max-h-60 overflow-y-auto z-50"
                @click.stop
              >
                <p class="px-3 py-1 text-xs text-white/40 uppercase tracking-wide">{{ t('player.audio') }}</p>
                <button
                  v-for="track in hlsAudioTracks"
                  :key="track.id"
                  type="button"
                  class="w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
                  :class="activeAudioTrack === track.id ? 'text-primary font-medium' : 'text-white'"
                  @click="setAudioTrack(track.id)"
                >
                  {{ track.name }}
                </button>
              </div>
            </div>
            <!-- Audio tracks (local DB-based, for transcode session audio switching) -->
            <div v-else-if="hasLocalAudioMenu" class="relative">
              <button
                type="button"
                class="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
                @click.stop="showAudioMenu = !showAudioMenu; showSubtitleMenu = false; showQualityMenu = false; showCastMenu = false"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </button>
              <div
                v-if="showAudioMenu"
                class="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur rounded-lg border border-white/10 py-1 min-w-[180px] max-h-60 overflow-y-auto z-50"
                @click.stop
              >
                <p class="px-3 py-1 text-xs text-white/40 uppercase tracking-wide">{{ t('player.audio') }}</p>
                <button
                  v-for="track in audioTracks"
                  :key="track.id"
                  type="button"
                  class="w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
                  :class="activeLocalAudioTrack === track.trackIndex ? 'text-primary font-medium' : 'text-white'"
                  @click="setLocalAudioTrack(track.trackIndex)"
                >
                  {{ track.title || track.language || `Audio ${track.trackIndex}` }}
                </button>
              </div>
            </div>
            <!-- Quality -->
            <div v-if="hlsQualityLevels.length > 1" class="relative">
              <button
                type="button"
                class="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
                @click.stop="showQualityMenu = !showQualityMenu; showAudioMenu = false; showSubtitleMenu = false; showCastMenu = false"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <div
                v-if="showQualityMenu"
                class="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur rounded-lg border border-white/10 py-1 min-w-[140px] max-h-60 overflow-y-auto z-50"
                @click.stop
              >
                <p class="px-3 py-1 text-xs text-white/40 uppercase tracking-wide">{{ t('player.quality') }}</p>
                <button
                  type="button"
                  class="w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
                  :class="activeQualityLevel === -1 ? 'text-primary font-medium' : 'text-white'"
                  @click="setQualityLevel(-1)"
                >
                  {{ t('player.auto') }}
                </button>
                <button
                  v-for="level in hlsQualityLevels"
                  :key="level.id"
                  type="button"
                  class="w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
                  :class="activeQualityLevel === level.id ? 'text-primary font-medium' : 'text-white'"
                  @click="setQualityLevel(level.id)"
                >
                  {{ level.label }}
                </button>
              </div>
            </div>
            <!-- Subtitles (unified menu: text + burn-in) -->
            <div v-if="subtitles?.length || burnInSubtitles?.length" class="relative">
              <button
                type="button"
                class="p-2 hover:bg-white/10 rounded-lg transition-colors"
                :class="activeSubtitleIndex >= 0 || activeBurnInSubtitle !== undefined ? 'text-primary' : 'text-white'"
                @click.stop="showSubtitleMenu = !showSubtitleMenu; showAudioMenu = false; showQualityMenu = false; showCastMenu = false"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6v-2zm0 4h8v2H6v-2zm10 0h2v2h-2v-2zm-6-4h8v2h-8v-2z" />
                </svg>
              </button>
              <div
                v-if="showSubtitleMenu"
                class="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur rounded-lg border border-white/10 py-1 min-w-[200px] max-h-60 overflow-y-auto z-50"
                @click.stop
              >
                <!-- Off -->
                <button
                  type="button"
                  class="w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
                  :class="activeSubtitleIndex === -1 && activeBurnInSubtitle === undefined ? 'text-primary font-medium' : 'text-white'"
                  @click="setSubtitle(-1); setBurnInSubtitle(undefined)"
                >
                  {{ t('player.subtitlesOff') }}
                </button>
                <!-- Text subtitles (VTT) -->
                <template v-if="subtitles?.length">
                  <p class="px-3 py-1 text-xs text-white/40 uppercase tracking-wide mt-1">{{ t('player.textSubtitles') }}</p>
                  <button
                    v-for="(sub, i) in subtitles"
                    :key="`text-${i}`"
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors flex items-center gap-2"
                    :class="activeSubtitleIndex === i ? 'text-primary font-medium' : 'text-white'"
                    :disabled="subtitleLoading"
                    @click="setBurnInSubtitle(undefined); setSubtitle(i)"
                  >
                    <span v-if="subtitleLoading && activeSubtitleIndex === i" class="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    {{ sub.label || sub.lang }}
                  </button>
                </template>
                <!-- Burn-in subtitles (bitmap, rendered into video) -->
                <template v-if="burnInSubtitles?.length">
                  <p class="px-3 py-1 text-xs text-white/40 uppercase tracking-wide mt-1">{{ t('player.burnInSubtitles') }}</p>
                  <button
                    v-for="bi in burnInSubtitles"
                    :key="`burn-${bi.trackIndex}`"
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
                    :class="activeBurnInSubtitle === bi.trackIndex ? 'text-primary font-medium' : 'text-white'"
                    @click="setBurnInSubtitle(bi.trackIndex)"
                  >
                    {{ bi.label }}
                  </button>
                </template>
              </div>
            </div>
            <!-- Cast (Chromecast / AirPlay) -->
            <div class="relative">
              <button
                type="button"
                class="p-2 hover:bg-white/10 rounded-lg transition-colors"
                :class="isCasting ? 'text-primary' : 'text-white'"
                @click.stop="showCastMenu = !showCastMenu; showAudioMenu = false; showQualityMenu = false; showSubtitleMenu = false"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
                </svg>
              </button>
              <div
                v-if="showCastMenu"
                class="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur rounded-lg border border-white/10 py-2 min-w-[220px] z-50"
                @click.stop
              >
                <p class="px-3 py-1 text-xs text-white/40 uppercase tracking-wide">{{ t('player.cast') }}</p>

                <!-- Connected state -->
                <template v-if="isCasting">
                  <div class="px-3 py-2 flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    <span class="text-sm text-green-400">{{ castDeviceName || t('player.castConnected') }}</span>
                  </div>
                  <button
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-white/10 transition-colors"
                    @click="stopCast"
                  >
                    {{ t('player.castDisconnect') }}
                  </button>
                </template>

                <!-- Device available -->
                <template v-else-if="castAvailable">
                  <button
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-white/10 transition-colors flex items-center gap-2"
                    @click="startCast"
                  >
                    <svg class="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
                    </svg>
                    {{ t('player.castDeviceAvailable') }}
                  </button>
                </template>

                <!-- No device / not supported -->
                <template v-else>
                  <div class="px-3 py-2">
                    <p v-if="!castSupported" class="text-sm text-text-muted">
                      {{ t('player.castUnsupportedBrowser') }}
                    </p>
                    <template v-else>
                      <div class="flex items-center gap-2 mb-2">
                        <div class="w-2 h-2 rounded-full bg-white/30 flex-shrink-0" />
                        <span class="text-sm text-text-muted">{{ t('player.castNoDevice') }}</span>
                      </div>
                      <p class="text-xs text-white/40 leading-relaxed">
                        {{ t('player.castNoDeviceHint') }}
                      </p>
                      <button
                        type="button"
                        class="mt-2 w-full text-left px-2 py-1.5 text-xs text-primary hover:bg-white/10 rounded transition-colors"
                        @click="startCast"
                      >
                        {{ t('player.castRetry') }}
                      </button>
                    </template>
                  </div>
                </template>
              </div>
            </div>
            <!-- Fullscreen -->
            <button
              type="button"
              class="p-2 hover:bg-white/10 rounded-lg transition-colors"
              @click="toggleFullscreen"
            >
              <svg v-if="isFullscreen" class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <svg v-else class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
