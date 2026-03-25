/**
 * MediaEngine — Abstraction complète de FFmpeg.
 *
 * Flow: probe → decide → play (session)
 *
 * Usage:
 *   const probe  = await MediaEngine.probe('/path/to/file.mkv')
 *   const plan   = MediaEngine.decide(probe)
 *   const session = await MediaEngine.createSession(filePath, clientId)
 *   const playlist = await session.masterPlaylist()
 *   const segment  = await session.segment('video', quality, streamIndex, segmentNum)
 *   session.stop()   // auto-managed, but explicit is fine
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, extname, join } from 'path'
import { tmpdir } from 'os'
import Ffmpeg from 'fluent-ffmpeg'
import { HLSController, StreamType, VideoQualityEnum, AudioQualityEnum } from '@eleven-am/transcoder'
import type { SegmentStream } from '@eleven-am/transcoder'

// ─── Binary resolution (internal) ────────────────────────────────────────────

let _pathsReady = false

async function resolveBinary(name: 'ffmpeg' | 'ffprobe'): Promise<string | null> {
  // 1. Try static package
  try {
    const pkg = name === 'ffmpeg' ? 'ffmpeg-static' : 'ffprobe-static'
    const mod = await import(pkg)
    const p = name === 'ffprobe' ? (mod.default?.path || mod.path) : (mod.default || mod)
    if (p && existsSync(p)) return p
  } catch {}

  // 2. Try sibling of ffmpeg (for ffprobe)
  if (name === 'ffprobe') {
    const ffmpegPath = await resolveBinary('ffmpeg')
    if (ffmpegPath) {
      const ext = process.platform === 'win32' ? '.exe' : ''
      const p = join(dirname(ffmpegPath), `ffprobe${ext}`)
      if (existsSync(p)) return p
    }
  }

  // 3. Try system PATH
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
    const p = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0]
    if (p) return p
  } catch {}

  return null
}

async function ensureBinaries() {
  if (_pathsReady) return
  const [ffmpeg, ffprobe] = await Promise.all([resolveBinary('ffmpeg'), resolveBinary('ffprobe')])
  if (ffmpeg) Ffmpeg.setFfmpegPath(ffmpeg)
  if (ffprobe) Ffmpeg.setFfprobePath(ffprobe)
  _pathsReady = true
  console.log(`[MediaEngine] Binaries: ffmpeg=${ffmpeg ? 'OK' : 'MISSING'}, ffprobe=${ffprobe ? 'OK' : 'MISSING'}`)
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VideoTrack {
  codec: string
  width: number
  height: number
  bitrate?: number
}

export interface AudioTrack {
  index: number
  codec: string
  language?: string
  title?: string
  channels?: number
  isDefault: boolean
  isForced: boolean
}

export interface SubtitleTrack {
  index: number
  codec: string
  language?: string
  title?: string
  isDefault: boolean
  isForced: boolean
}

export interface ProbeResult {
  filePath: string
  container: string
  duration: number
  video: VideoTrack | null
  audio: AudioTrack[]
  subtitles: SubtitleTrack[]
  metadata: {
    title?: string
    artist?: string
    album?: string
    genre?: string
    date?: string
  }
}

export type PlaybackMode = 'direct' | 'remux' | 'transcode'

export interface PlaybackDecision {
  mode: PlaybackMode
  reason: string
  videoAction: 'passthrough' | 'repackage' | 'reencode'
  audioAction: 'passthrough' | 'repackage' | 'reencode'
  estimatedLoad: 'none' | 'low' | 'high'
  streamUrl: (mediaId: string) => string
}

// ─── Codec knowledge (internal) ──────────────────────────────────────────────

/** Codecs browsers can decode natively */
const BROWSER_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1'])
const BROWSER_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const BROWSER_NATIVE_CONTAINERS = new Set(['.mp4', '.webm', '.m4v'])

/** Codecs that can be remuxed into HLS/TS without re-encoding */
const HLS_COMPATIBLE_VIDEO = new Set(['h264']) // HEVC in TS requires browser HEVC support — unreliable
const HLS_COMPATIBLE_AUDIO = new Set(['aac', 'mp3'])

// ─── Probe ───────────────────────────────────────────────────────────────────

function rawProbe(filePath: string): Promise<Ffmpeg.FfprobeData | null> {
  return new Promise((resolve) => {
    Ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) { console.error(`[MediaEngine] Probe failed for "${filePath}":`, err.message); resolve(null) }
      else resolve(data)
    })
  })
}

function getTag(tags: Record<string, string> | undefined, key: string): string | undefined {
  if (!tags) return undefined
  return tags[key] || tags[key.toUpperCase()] || tags[key.toLowerCase()] || undefined
}

// ─── HLS Controller (singleton, internal) ────────────────────────────────────

let _controller: HLSController | null = null
let _initPromise: Promise<void> | null = null

function buildController(): HLSController {
  return new HLSController({
    cacheDirectory: join(tmpdir(), 'lumir-hls-cache'),
    hwAccel: true,
    maxSegmentBatchSize: 50,
    videoQualities: [
      VideoQualityEnum.P480,
      VideoQualityEnum.P720,
      VideoQualityEnum.P1080,
      VideoQualityEnum.ORIGINAL,
    ],
    audioQualities: [
      AudioQualityEnum.AAC,
      AudioQualityEnum.ORIGINAL,
    ],
    config: {
      disposeTimeout: 5 * 60 * 1000,
      enableHardwareAccelFallback: true,
      retryFailedSegments: true,
      maxRetries: 3,
      segmentTimeout: 120,
      metricsInterval: 30000,
    },
  })
}

async function getController(): Promise<HLSController> {
  if (!_controller) {
    _controller = buildController()

    _controller.onSessionChange((s) => {
      console.log(`[MediaEngine] Session: client=${s.clientId} status=${s.status} video=${s.videoProfile.value} audio=${s.audioProfile.value}`)
    })

    let lastCompleted = 0
    let stuckCount = 0
    _controller.onStreamMetrics((e) => {
      const hw = e.isUsingHardwareAcceleration && e.currentAccelerationMethod
        ? e.currentAccelerationMethod
        : 'CPU'

      if (e.segmentsCompleted === lastCompleted && e.segmentsCompleted > 0) {
        stuckCount++
        if (stuckCount === 3) {
          console.warn(`[MediaEngine] Transcoding stuck at ${e.segmentsCompleted}/${e.totalSegments} (${hw})`)
        }
      } else {
        stuckCount = 0
        lastCompleted = e.segmentsCompleted
      }

      if (e.segmentsCompleted % 10 === 0 && e.segmentsCompleted > 0) {
        console.log(`[MediaEngine] Progress: ${e.segmentsCompleted}/${e.totalSegments} (${hw}) avg=${Math.round(e.averageSegmentDuration)}ms/seg`)
      }
    })
  }

  if (!_initPromise) {
    _initPromise = _controller.initialize().then(() => {
      console.log('[MediaEngine] HLS controller initialized')
    }).catch((err) => {
      console.error('[MediaEngine] HLS init failed:', err.message)
      _initPromise = null
      throw err
    })
  }

  await _initPromise
  return _controller
}

// ─── MediaSession ────────────────────────────────────────────────────────────

const SEGMENT_MAX_RETRIES = 6
const SEGMENT_RETRY_DELAY_MS = 3000

export class MediaSession {
  constructor(
    public readonly filePath: string,
    public readonly clientId: string,
    private controller: HLSController,
  ) {}

  /** Get the HLS master playlist (M3U8) */
  async masterPlaylist(): Promise<string> {
    return this.controller.getMasterPlaylist(this.filePath, this.clientId)
  }

  /** Get a variant playlist for a specific stream */
  async playlist(type: 'video' | 'audio', quality: string, streamIndex: number): Promise<string> {
    const streamType = type === 'video' ? StreamType.VIDEO : StreamType.AUDIO
    return this.controller.getIndexPlaylist(this.filePath, this.clientId, streamType, quality, streamIndex)
  }

  /**
   * Get a segment with automatic retry (transcoding may lag behind).
   * Pass an AbortSignal to cancel retries when the client disconnects.
   */
  async segment(type: 'video' | 'audio', quality: string, streamIndex: number, segmentNumber: number, signal?: AbortSignal): Promise<SegmentStream> {
    const streamType = type === 'video' ? StreamType.VIDEO : StreamType.AUDIO

    for (let attempt = 0; attempt <= SEGMENT_MAX_RETRIES; attempt++) {
      // Stop retrying if the client disconnected
      if (signal?.aborted) {
        throw new Error(`Client disconnected, aborting ${type} segment ${segmentNumber}`)
      }

      try {
        return await this.controller.getSegmentStream(
          this.filePath, this.clientId, streamType, quality, streamIndex, segmentNumber,
        )
      } catch (err: any) {
        if (attempt < SEGMENT_MAX_RETRIES) {
          console.warn(`[MediaEngine] ${type} segment ${segmentNumber} not ready (${attempt + 1}/${SEGMENT_MAX_RETRIES + 1}), retrying...`)
          // Abortable sleep: cancel the wait if client disconnects
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, SEGMENT_RETRY_DELAY_MS)
            signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          })
        } else {
          throw new Error(`Segment ${segmentNumber} not ready after ${SEGMENT_MAX_RETRIES + 1} attempts: ${err.message}`)
        }
      }
    }

    // Unreachable, but TypeScript needs it
    throw new Error('Segment retrieval failed')
  }

  /** Extract a subtitle track as VTT */
  async subtitle(trackIndex: number): Promise<string> {
    return this.controller.getVTTSubtitle(this.filePath, trackIndex)
  }

  /** Extract a subtitle track as a readable stream */
  async subtitleStream(trackIndex: number): Promise<NodeJS.ReadableStream> {
    return this.controller.getVTTSubtitleStream(this.filePath, trackIndex)
  }

  /** Explicit stop (sessions auto-dispose after 5 min idle, but this is cleaner) */
  stop(): void {
    console.log(`[MediaEngine] Session stopped: client=${this.clientId}`)
    // @eleven-am/transcoder manages lifecycle via disposeTimeout
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const MediaEngine = {

  /**
   * Probe a media file. Returns structured info about all streams.
   */
  async probe(filePath: string): Promise<ProbeResult> {
    await ensureBinaries()
    const data = await rawProbe(filePath)

    if (!data) {
      throw new Error(`Failed to probe "${filePath}"`)
    }

    const format = data.format || {} as any
    const fTags = format.tags || {}

    let video: VideoTrack | null = null
    const audio: AudioTrack[] = []
    const subtitles: SubtitleTrack[] = []

    for (const s of data.streams || []) {
      const tags = (s as any).tags || {}
      const disp = (s as any).disposition || {}

      if (s.codec_type === 'video' && !video) {
        video = {
          codec: s.codec_name || 'unknown',
          width: s.width || 0,
          height: s.height || 0,
          bitrate: s.bit_rate ? parseInt(String(s.bit_rate), 10) : undefined,
        }
      }

      if (s.codec_type === 'audio') {
        audio.push({
          index: s.index,
          codec: s.codec_name || 'unknown',
          language: getTag(tags, 'language'),
          title: getTag(tags, 'title'),
          channels: s.channels || undefined,
          isDefault: disp.default === 1,
          isForced: disp.forced === 1,
        })
      }

      if (s.codec_type === 'subtitle') {
        subtitles.push({
          index: s.index,
          codec: s.codec_name || 'unknown',
          language: getTag(tags, 'language'),
          title: getTag(tags, 'title'),
          isDefault: disp.default === 1,
          isForced: disp.forced === 1,
        })
      }
    }

    return {
      filePath,
      container: extname(filePath).toLowerCase(),
      duration: format.duration ? Math.round(parseFloat(format.duration)) : 0,
      video,
      audio,
      subtitles,
      metadata: {
        title: getTag(fTags, 'title')?.trim() || undefined,
        artist: getTag(fTags, 'artist') || getTag(fTags, 'album_artist'),
        album: getTag(fTags, 'album'),
        genre: getTag(fTags, 'genre'),
        date: getTag(fTags, 'date') || getTag(fTags, 'year'),
      },
    }
  },

  /**
   * Decide the optimal playback strategy based on probe results.
   * This is the brain — it knows what browsers can play.
   */
  decide(probe: ProbeResult): PlaybackDecision {
    const videoCodec = probe.video?.codec || 'unknown'
    const audioCodec = probe.audio[0]?.codec || 'unknown'
    const container = probe.container

    // Case 1: Browser-native container with compatible codecs → direct stream
    if (
      BROWSER_NATIVE_CONTAINERS.has(container) &&
      BROWSER_VIDEO_CODECS.has(videoCodec) &&
      BROWSER_AUDIO_CODECS.has(audioCodec)
    ) {
      return {
        mode: 'direct',
        reason: `${videoCodec}/${audioCodec} in ${container} — navigateur natif`,
        videoAction: 'passthrough',
        audioAction: 'passthrough',
        estimatedLoad: 'none',
        streamUrl: (id) => `/api/stream/${id}/direct`,
      }
    }

    // Case 2: Video is HLS-compatible, just need to repackage the container
    const canRemuxVideo = HLS_COMPATIBLE_VIDEO.has(videoCodec)
    const canRemuxAudio = HLS_COMPATIBLE_AUDIO.has(audioCodec)

    if (canRemuxVideo) {
      const audioNote = canRemuxAudio ? 'copie' : `${audioCodec} → AAC`
      return {
        mode: 'remux',
        reason: `${videoCodec} dans ${container} → remux HLS (vidéo: copie, audio: ${audioNote})`,
        videoAction: 'repackage',
        audioAction: canRemuxAudio ? 'repackage' : 'reencode',
        estimatedLoad: canRemuxAudio ? 'low' : 'low', // Audio re-encode is cheap
        streamUrl: (id) => `/api/stream/${id}/master.m3u8`,
      }
    }

    // Case 3: Video needs re-encoding (HEVC, VP9 in MKV, etc.)
    return {
      mode: 'transcode',
      reason: `${videoCodec} incompatible navigateur → transcodage ${videoCodec} → H.264`,
      videoAction: 'reencode',
      audioAction: canRemuxAudio ? 'repackage' : 'reencode',
      estimatedLoad: 'high',
      streamUrl: (id) => `/api/stream/${id}/master.m3u8`,
    }
  },

  /**
   * Create a streaming session for a media file.
   * Returns a MediaSession with .masterPlaylist(), .segment(), etc.
   */
  async createSession(filePath: string, clientId: string): Promise<MediaSession> {
    const controller = await getController()
    return new MediaSession(filePath, clientId, controller)
  },

  /**
   * Pre-generate HLS metadata so first playback is faster.
   */
  async preheat(filePath: string): Promise<void> {
    const controller = await getController()
    await controller.createMetadata(filePath)
  },

  /**
   * Quick stream info for a media file — used by the info endpoint.
   * Returns the playback decision + duration without creating a full session.
   */
  async getStreamInfo(filePath: string, mediaId: string, tmdbDurationMin?: number): Promise<{
    mediaId: string
    mode: PlaybackMode
    reason: string
    streamUrl: string
    duration: number
    estimatedLoad: 'none' | 'low' | 'high'
  }> {
    const probe = await this.probe(filePath)
    const decision = this.decide(probe)

    // Prefer TMDB duration (in minutes → seconds), fallback to ffprobe
    const duration = tmdbDurationMin ? tmdbDurationMin * 60 : probe.duration

    return {
      mediaId,
      mode: decision.mode,
      reason: decision.reason,
      streamUrl: decision.streamUrl(mediaId),
      duration,
      estimatedLoad: decision.estimatedLoad,
    }
  },

  /** Re-export StreamType for route handlers that need it */
  StreamType,
}

// ─── Binary resolution (public, for catalog HLS downloads) ───────────────────

export async function findFfmpeg(): Promise<string | null> {
  return resolveBinary('ffmpeg')
}

export async function findFfprobe(): Promise<string | null> {
  return resolveBinary('ffprobe')
}

// ─── Legacy exports (backward compat for library scanner) ────────────────────

export type StreamInfo = {
  index: number
  codecType: 'audio' | 'subtitle'
  codecName: string
  language?: string
  title?: string
  channels?: number
  isDefault: boolean
  isForced: boolean
}

export type FileMetadata = {
  title?: string
  artist?: string
  album?: string
  genre?: string
  date?: string
  duration?: number
  videoCodec?: string
  audioCodec?: string
  width?: number
  height?: number
}

/**
 * @deprecated Use MediaEngine.probe() instead
 */
export async function extractStreams(filePath: string): Promise<StreamInfo[]> {
  const probe = await MediaEngine.probe(filePath)
  return [
    ...probe.audio.map(a => ({
      index: a.index,
      codecType: 'audio' as const,
      codecName: a.codec,
      language: a.language,
      title: a.title,
      channels: a.channels,
      isDefault: a.isDefault,
      isForced: a.isForced,
    })),
    ...probe.subtitles.map(s => ({
      index: s.index,
      codecType: 'subtitle' as const,
      codecName: s.codec,
      language: s.language,
      title: s.title,
      isDefault: s.isDefault,
      isForced: s.isForced,
    })),
  ]
}

/**
 * @deprecated Use MediaEngine.probe() instead
 */
export async function extractFileMetadata(filePath: string): Promise<FileMetadata | null> {
  try {
    const probe = await MediaEngine.probe(filePath)
    const meta: FileMetadata = {}

    if (probe.metadata.title) meta.title = probe.metadata.title
    if (probe.metadata.artist) meta.artist = probe.metadata.artist
    if (probe.metadata.album) meta.album = probe.metadata.album
    if (probe.metadata.genre) meta.genre = probe.metadata.genre
    if (probe.metadata.date) meta.date = probe.metadata.date
    if (probe.duration) meta.duration = probe.duration
    if (probe.video) {
      meta.videoCodec = probe.video.codec
      meta.width = probe.video.width
      meta.height = probe.video.height
    }
    if (probe.audio[0]) meta.audioCodec = probe.audio[0].codec

    return Object.keys(meta).length > 0 ? meta : null
  } catch {
    return null
  }
}
