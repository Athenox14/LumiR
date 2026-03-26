<script setup lang="ts">
import { isHLSProvider, type MediaPlayerElement, type MediaProviderChangeEvent } from 'vidstack'
import type HlsJS from 'hls.js'

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

const playerRef = ref<MediaPlayerElement>()
const usedFallback = ref(false)
let progressInterval: ReturnType<typeof setInterval> | null = null
let hlsInstance: HlsJS | null = null
// Suppress onSeeking during initial load — HLS.js fires seeking events
// as it positions the player, which would trigger spurious preheat-seeks
let playerReady = false

// ─── Timeline hover preheat ──────────────────────────────────────────────────
// When user hovers over the timeline, preemptively tell the server to prepare
// the segment at that position so seeking is instant.
let lastPreheatSegment = -1
let preheatDebounce: ReturnType<typeof setTimeout> | null = null

function preheatSeek(positionSec: number, force = false) {
  // Only for HLS streams (non-native)
  if (!props.src.includes('.m3u8')) return

  const segmentNumber = Math.floor(positionSec / 6)
  // Don't re-preheat the same segment
  if (segmentNumber === lastPreheatSegment) return
  lastPreheatSegment = segmentNumber

  const doFetch = () => {
    $fetch(`/api/stream/${props.mediaId}/preheat-seek`, {
      method: 'POST',
      // force=true only for actual user seeks — allows killing running ffmpeg
      // force=false for hover — only starts ffmpeg if not running
      body: { position: positionSec, force },
    }).catch(() => {}) // Best-effort, ignore errors
  }

  if (force) {
    // User actually seeked — fire immediately, no debounce
    if (preheatDebounce) clearTimeout(preheatDebounce)
    doFetch()
    return
  }

  // Debounce: user is scrubbing, only fire after 300ms pause
  if (preheatDebounce) clearTimeout(preheatDebounce)
  preheatDebounce = setTimeout(doFetch, 300)
}

// Position to restore after source change (e.g. audio track switch)
const pendingSeekPosition = ref<number | null>(null)

// Burn-in subtitle menu state
const showBurnInMenu = ref(false)

// Local audio track menu state (for DB-based tracks, not HLS audio tracks)
const showLocalAudioMenu = ref(false)
const activeLocalAudioTrack = ref<number | null>(null)
const hasLocalAudioMenu = computed(() => (props.audioTracks?.length || 0) > 1)

// Effective duration: prefer knownDuration for fragmented MP4
const effectiveDuration = computed(() => {
  const player = playerRef.value
  const d = player?.duration || 0
  if (props.knownDuration > 0) {
    if (d && isFinite(d) && d >= props.knownDuration * 0.9) return d
    return props.knownDuration
  }
  if (d && isFinite(d) && d > 0) return d
  return 0
})

// Build source with type hint for HLS
const playerSrc = computed(() => {
  const url = usedFallback.value && props.fallbackSrc ? props.fallbackSrc : props.src
  if (url.includes('.m3u8') || url.includes('/hls')) {
    return { src: url, type: 'application/x-mpegurl' }
  }
  return url
})

// Save position before source change and load new source
watch(() => props.src, (newSrc, oldSrc) => {
  if (!oldSrc || newSrc === oldSrc) return
  const player = playerRef.value
  if (player && player.currentTime > 0) {
    pendingSeekPosition.value = player.currentTime
  }
})

// HLS.js config passed via provider
function onProviderChange(event: MediaProviderChangeEvent) {
  const provider = event.detail
  if (isHLSProvider(provider)) {
    const startPos = pendingSeekPosition.value ?? props.initialPosition
    provider.config = {
      startPosition: startPos,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
      maxBufferSize: 30 * 1000 * 1000,
      maxBufferHole: 1.5,
      backBufferLength: 15,
      lowLatencyMode: false,
      testBandwidth: false,
      abrEwmaDefaultEstimate: 500_000_000,
      maxFragLookUpTolerance: 0.1,
      // Fragment loading policy tuned for live transcoding:
      // - Short first-byte timeout (8s): nearby segments arrive in 1-3s,
      //   far-ahead speculative requests get no data → fail fast
      // - Minimal retries: far-ahead failures resolve via error recovery
      //   which restarts loading from the current position
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 8000,
          maxLoadTimeMs: 60000,
          timeoutRetry: {
            maxNumRetry: 1,
            retryDelayMs: 500,
            maxRetryDelayMs: 1000,
          },
          errorRetry: {
            maxNumRetry: 2,
            retryDelayMs: 500,
            maxRetryDelayMs: 2000,
          },
        },
      },
      // Robust playlist loading
      playlistLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 15000,
          maxLoadTimeMs: 30000,
          timeoutRetry: {
            maxNumRetry: 4,
            retryDelayMs: 500,
            maxRetryDelayMs: 4000,
          },
          errorRetry: {
            maxNumRetry: 4,
            retryDelayMs: 500,
            maxRetryDelayMs: 4000,
          },
        },
      },
    }

    // Keep a reference to hls.js instance for error recovery
    provider.onInstance((hls) => {
      hlsInstance = hls

      // Force original quality and ensure correct start position.
      // Only run ONCE — MANIFEST_PARSED can fire multiple times (e.g.
      // after error recovery). A second startLoad() resets HLS.js state
      // and can cause premature "ended" events.
      let manifestHandled = false
      hls.on(hls.constructor.Events.MANIFEST_PARSED, () => {
        if (manifestHandled) return
        manifestHandled = true

        if (hls.levels.length > 0) {
          // Lock to the single quality level — prevents ABR from probing
          // other levels and requesting far-ahead segments
          hls.currentLevel = hls.levels.length - 1
          hls.autoLevelEnabled = false
          console.log(`[HLS] Locked quality level ${hls.levels.length - 1}, ABR disabled`)
        }
        if (startPos > 0) {
          console.log(`[HLS] Forcing startLoad at ${startPos}s`)
          hls.startLoad(startPos)
        }
      })

      // Recover from fatal errors with circuit breaker.
      // If the same fragment keeps failing, skip it and restart
      // sequential loading from the current playback position.
      let networkRetries = 0
      let mediaRetries = 0
      let lastErrorFrag = -1
      let sameFragErrors = 0
      const MAX_NETWORK_RETRIES = 3
      const MAX_MEDIA_RETRIES = 3
      hls.on(hls.constructor.Events.ERROR, (_event: any, data: any) => {
        if (data.fatal) {
          const fragSn = data.frag?.sn ?? -1
          // Circuit breaker: detect same fragment failing repeatedly
          if (fragSn === lastErrorFrag) {
            sameFragErrors++
            if (sameFragErrors > 2) {
              console.warn('[HLS] Circuit breaker: skipping fragment', fragSn, '→ restarting from current pos')
              // Reset state and restart sequential loading
              sameFragErrors = 0
              lastErrorFrag = -1
              networkRetries = 0
              mediaRetries = 0
              const pos = playerRef.value?.currentTime || startPos || 0
              // recoverMediaError resets the transmuxer state
              hls.recoverMediaError()
              setTimeout(() => hls.startLoad(pos), 200)
              return
            }
          } else {
            lastErrorFrag = fragSn
            sameFragErrors = 0
          }

          const resumePos = playerRef.value?.currentTime || startPos || 0
          console.warn('[HLS] Fatal error, recovery from', resumePos, 's:', data.type, data.details, 'frag:', fragSn)
          if (data.type === 'networkError' && networkRetries < MAX_NETWORK_RETRIES) {
            networkRetries++
            setTimeout(() => hls.startLoad(resumePos), 1000)
          } else if (data.type === 'mediaError' && mediaRetries < MAX_MEDIA_RETRIES) {
            mediaRetries++
            hls.recoverMediaError()
          }
        } else {
          networkRetries = 0
          mediaRetries = 0
        }
      })
    })
  }
}

function onCanPlay() {
  const player = playerRef.value
  if (!player) return
  // Restore position after source switch or initial load
  const targetPos = pendingSeekPosition.value ?? props.initialPosition
  if (targetPos > 0 && player.currentTime < targetPos - 2) {
    player.currentTime = targetPos
  }
  pendingSeekPosition.value = null
  // Now safe to handle user-initiated seeks
  playerReady = true
}

// When user actually seeks, take control of HLS.js loading to prevent
// its VOD binary-search algorithm from requesting segments ~100+ ahead.
// Sequence: stopLoad → preheat server → startLoad(pos) → sequential load.
function onSeeking() {
  const player = playerRef.value
  if (!player || !props.src.includes('.m3u8')) return
  if (!playerReady) return

  const seekPos = player.currentTime

  // 1. STOP HLS.js loading immediately — kills any pending fragment
  //    requests including the binary-search probes
  if (hlsInstance) {
    hlsInstance.stopLoad()
  }

  // 2. Tell server to start producing at new position
  preheatSeek(seekPos, true)

  // 3. Restart loading in sequential mode after server starts ffmpeg
  //    stopLoad + startLoad = fresh sequential load, no binary search
  if (hlsInstance) {
    setTimeout(() => {
      if (hlsInstance) {
        hlsInstance.startLoad(seekPos)
      }
    }, 300) // 300ms for preheat-seek to reach server
  }
}

function onError() {
  if (props.fallbackSrc && !usedFallback.value) {
    console.log('[VideoPlayer] Primary failed, switching to fallback:', props.fallbackSrc)
    usedFallback.value = true
  } else {
    emit('error')
  }
}

function setBurnInSubtitle(trackIndex: number | undefined) {
  showBurnInMenu.value = false
  emit('changeBurnInSubtitle', trackIndex)
}

function setLocalAudioTrack(trackIndex: number) {
  activeLocalAudioTrack.value = trackIndex
  showLocalAudioMenu.value = false
  emit('changeAudioTrack', trackIndex)
}

onMounted(() => {
  progressInterval = setInterval(() => {
    const player = playerRef.value
    if (player && !player.paused && player.currentTime > 0) {
      emit('progress', player.currentTime, effectiveDuration.value)
    }
  }, 10000)

  // Listen for timeline hover to preheat segments at the hovered position
  // Vidstack fires 'media-slider-value-change-event' on the time slider
  nextTick(() => {
    const player = playerRef.value
    if (!player) return
    const slider = player.querySelector('media-time-slider')
    if (slider) {
      slider.addEventListener('pointervalue-change', ((e: CustomEvent) => {
        // pointerValue is 0-100 (percentage of duration)
        const pct = e.detail as number
        if (typeof pct === 'number' && effectiveDuration.value > 0) {
          const positionSec = (pct / 100) * effectiveDuration.value
          preheatSeek(positionSec)
        }
      }) as EventListener)
    }
  })
})

onUnmounted(() => {
  if (progressInterval) clearInterval(progressInterval)
  if (preheatDebounce) clearTimeout(preheatDebounce)
  const player = playerRef.value
  if (player && player.currentTime > 0) {
    emit('progress', player.currentTime, effectiveDuration.value)
  }
})
</script>

<template>
  <div class="relative w-full h-full bg-black">
    <ClientOnly>
      <media-player
        ref="playerRef"
        :src="playerSrc"
        :poster="poster"
        :title="title"
        :autoplay="autoplay"
        playsinline
        crossorigin=""
        key-target="player"
        class="vds-player"
        :style="{ width: '100%', height: '100%' }"
        @provider-change="onProviderChange"
        @can-play="onCanPlay"
        @seeking="onSeeking"
        @error="onError"
        @ended="$emit('ended')"
      >
        <media-provider>
          <track
            v-for="(sub, i) in subtitles"
            :key="i"
            :src="sub.url"
            kind="subtitles"
            :label="sub.label || sub.lang"
            :srclang="sub.lang"
            :data-type="sub.url.endsWith('.srt') ? 'srt' : 'vtt'"
          >
        </media-provider>
        <media-video-layout
          color-scheme="dark"
          :no-gestures="false"
          :seek-step="10"
          :translations="{
            Audio: t('player.audio'),
            Quality: t('player.quality'),
            Auto: t('player.auto'),
            'Closed-Captions Off': t('player.subtitlesOff'),
            Cast: t('player.cast'),
          }"
        />
      </media-player>
    </ClientOnly>

    <!-- Top bar (back + title) -->
    <div
      v-if="title || backUrl"
      class="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent z-30 pointer-events-none"
    >
      <div class="flex items-center gap-3 px-4 pt-4 pb-12 pointer-events-auto">
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

    <!-- Burn-in subtitles (bitmap subs rendered into video by ffmpeg) -->
    <div v-if="burnInSubtitles?.length" class="absolute bottom-20 right-4 z-40">
      <button
        type="button"
        class="p-2 rounded-lg bg-black/60 hover:bg-black/80 transition-colors"
        :class="activeBurnInSubtitle !== undefined ? 'text-primary' : 'text-white'"
        @click.stop="showBurnInMenu = !showBurnInMenu; showLocalAudioMenu = false"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6v-2zm0 4h8v2H6v-2zm10 0h2v2h-2v-2zm-6-4h8v2h-8v-2z" />
        </svg>
      </button>
      <div
        v-if="showBurnInMenu"
        class="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur rounded-lg border border-white/10 py-1 min-w-[200px] max-h-60 overflow-y-auto z-50"
        @click.stop
      >
        <p class="px-3 py-1 text-xs text-white/40 uppercase tracking-wide">{{ t('player.burnInSubtitles') }}</p>
        <button
          type="button"
          class="w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
          :class="activeBurnInSubtitle === undefined ? 'text-primary font-medium' : 'text-white'"
          @click="setBurnInSubtitle(undefined)"
        >
          {{ t('player.subtitlesOff') }}
        </button>
        <button
          v-for="bi in burnInSubtitles"
          :key="bi.trackIndex"
          type="button"
          class="w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors"
          :class="activeBurnInSubtitle === bi.trackIndex ? 'text-primary font-medium' : 'text-white'"
          @click="setBurnInSubtitle(bi.trackIndex)"
        >
          {{ bi.label }}
        </button>
      </div>
    </div>

    <!-- Local audio track menu (DB-based, for transcode session switching) -->
    <div
      v-if="hasLocalAudioMenu"
      class="absolute bottom-20 z-40"
      :class="burnInSubtitles?.length ? 'right-16' : 'right-4'"
    >
      <button
        type="button"
        class="p-2 rounded-lg bg-black/60 hover:bg-black/80 transition-colors text-white"
        @click.stop="showLocalAudioMenu = !showLocalAudioMenu; showBurnInMenu = false"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      </button>
      <div
        v-if="showLocalAudioMenu"
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
  </div>
</template>

<style>
media-player {
  --media-brand: var(--color-primary, #6366f1);
  width: 100% !important;
  height: 100% !important;
}
media-player video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
