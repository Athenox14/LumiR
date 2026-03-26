/**
 * MediaEngine — FFmpeg direct, zéro abstraction tierce.
 *
 * Flow: probe → decide → session (spawn ffmpeg)
 *
 * Remux:     ffmpeg -i input.mkv -c:v copy -c:a aac → HLS segments (~instant)
 * Transcode: ffmpeg -i input.mkv -c:v libx264 -c:a aac → HLS segments (CPU-heavy)
 * Seek:      kill + restart ffmpeg with -ss → new segments from that point
 */

import { execSync, spawn, type ChildProcess } from 'child_process'
import { createReadStream, existsSync, statSync, type ReadStream } from 'fs'
import { mkdir, rm, readFile, readdir } from 'fs/promises'
import { dirname, extname, join } from 'path'
import { tmpdir } from 'os'
import Ffmpeg from 'fluent-ffmpeg'

// ─── Binary resolution ───────────────────────────────────────────────────────

let _ffmpegPath: string | null = null
let _ffprobePath: string | null = null
let _pathsReady = false

async function resolveBinary(name: 'ffmpeg' | 'ffprobe'): Promise<string | null> {
  try {
    const pkg = name === 'ffmpeg' ? 'ffmpeg-static' : 'ffprobe-static'
    const mod = await import(pkg)
    const p = name === 'ffprobe' ? (mod.default?.path || mod.path) : (mod.default || mod)
    if (p && existsSync(p)) return p
  } catch {}

  if (name === 'ffprobe') {
    const ffmpeg = await resolveBinary('ffmpeg')
    if (ffmpeg) {
      const ext = process.platform === 'win32' ? '.exe' : ''
      const p = join(dirname(ffmpeg), `ffprobe${ext}`)
      if (existsSync(p)) return p
    }
  }

  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
    const p = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0]
    if (p) return p
  } catch {}

  return null
}

async function ensureBinaries() {
  if (_pathsReady) return
  _ffmpegPath = await resolveBinary('ffmpeg')
  _ffprobePath = await resolveBinary('ffprobe')
  if (_ffmpegPath) Ffmpeg.setFfmpegPath(_ffmpegPath)
  if (_ffprobePath) Ffmpeg.setFfprobePath(_ffprobePath)
  _pathsReady = true
  console.log(`[MediaEngine] Binaries: ffmpeg=${_ffmpegPath ? 'OK' : 'MISSING'}, ffprobe=${_ffprobePath ? 'OK' : 'MISSING'}`)
}

async function getFfmpegPath(): Promise<string> {
  await ensureBinaries()
  if (!_ffmpegPath) throw new Error('ffmpeg binary not found — install ffmpeg-static or add ffmpeg to PATH')
  return _ffmpegPath
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

export interface SegmentStream {
  stream: ReadStream
  size: number
}

// ─── Codec knowledge ─────────────────────────────────────────────────────────

const BROWSER_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1'])
const BROWSER_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const BROWSER_NATIVE_CONTAINERS = new Set(['.mp4', '.webm', '.m4v'])
const HLS_COMPATIBLE_VIDEO = new Set(['h264'])
const HLS_COMPATIBLE_AUDIO = new Set(['aac', 'mp3'])

// ─── Probe ───────────────────────────────────────────────────────────────────

function rawProbe(filePath: string): Promise<Ffmpeg.FfprobeData | null> {
  return new Promise((resolve) => {
    Ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) { console.error(`[MediaEngine] Probe failed "${filePath}":`, err.message); resolve(null) }
      else resolve(data)
    })
  })
}

function getTag(tags: Record<string, any> | undefined, key: string): string | undefined {
  if (!tags) return undefined
  const v = tags[key] || tags[key.toUpperCase()] || tags[key.toLowerCase()]
  return v != null ? String(v) : undefined
}

// ─── Session Manager ─────────────────────────────────────────────────────────

const SEGMENT_DURATION = 6
const HLS_DIR = join(tmpdir(), 'lumir-hls')
const DISPOSE_TIMEOUT = 2 * 60 * 1000 // 2 min idle → cleanup
const SEGMENT_WAIT_TIMEOUT = 30_000    // 30s max wait for a segment
const SEGMENT_POLL_INTERVAL = 200      // Check every 200ms
const SEEK_THRESHOLD = 30              // Segments ahead → restart ffmpeg with -ss

const sessions = new Map<string, FFmpegSession>()

class FFmpegSession {
  private process: ChildProcess | null = null
  private outputDir: string
  private totalSegments: number
  private highestReady = -1
  private disposeTimer: ReturnType<typeof setTimeout> | null = null
  currentStartSegment = 0
  private decision: PlaybackDecision | null = null
  private audioTrackIndex: number | undefined
  private stderrLog = ''
  /** True while start() is between killProcess and spawn — prevents polling loops from restarting */
  private isStarting = false
  /** Debounced seek: collects rapid seek requests and executes only the last one */
  private pendingSeekSegment: number | null = null
  private pendingSeekTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSeekResolvers: Array<() => void> = []

  constructor(
    public readonly filePath: string,
    public readonly clientId: string,
    public probe: ProbeResult,
  ) {
    this.outputDir = join(HLS_DIR, clientId)
    this.totalSegments = Math.max(1, Math.ceil(probe.duration / SEGMENT_DURATION))
    this.decision = MediaEngine.decide(probe)
  }

  /** Update duration (e.g. from TMDB) when probe reported a wrong value */
  overrideDuration(durationSec: number) {
    this.probe.duration = durationSec
    this.totalSegments = Math.max(1, Math.ceil(durationSec / SEGMENT_DURATION))
  }

  /**
   * Schedule a debounced seek. Multiple rapid seek requests (e.g. HLS.js
   * requesting segments 724, 984, 1250 in quick succession) are collapsed
   * into a single ffmpeg restart at the LOWEST requested position — so that
   * all nearby segments can be produced sequentially.
   * Returns a promise that resolves when the seek actually executes.
   */
  private requestSeek(segmentNumber: number): Promise<void> {
    return new Promise<void>((resolve) => {
      // Keep the lowest requested segment (ffmpeg produces sequentially)
      if (this.pendingSeekSegment === null || segmentNumber < this.pendingSeekSegment) {
        this.pendingSeekSegment = segmentNumber
      }
      this.pendingSeekResolvers.push(resolve)

      // Reset the debounce timer
      if (this.pendingSeekTimer) clearTimeout(this.pendingSeekTimer)
      this.pendingSeekTimer = setTimeout(async () => {
        const seg = this.pendingSeekSegment!
        const resolvers = this.pendingSeekResolvers
        this.pendingSeekSegment = null
        this.pendingSeekTimer = null
        this.pendingSeekResolvers = []

        console.log(`[MediaEngine] Debounced seek: restarting at segment ${seg} (${resolvers.length} pending requests)`)
        await this.start({ audioTrack: this.audioTrackIndex, startSegment: seg })
        resolvers.forEach((r) => r())
      }, 100) // 100ms debounce — fast response for user seeks
    })
  }

  /** Start the ffmpeg process to generate HLS segments */
  async start(opts?: { audioTrack?: number, startSegment?: number }) {
    this.audioTrackIndex = opts?.audioTrack
    const startSeg = opts?.startSegment ?? 0
    this.currentStartSegment = startSeg
    this.highestReady = startSeg - 1
    const startTime = startSeg * SEGMENT_DURATION

    // Kill any existing process FIRST, but mark that we're starting a new
    // one so polling loops don't try to restart at the old position.
    this.killProcess()
    this.isStarting = true
    this.stderrLog = ''

    // Ensure output directory
    await mkdir(this.outputDir, { recursive: true })

    const decision = this.decision!
    const probe = this.probe

    // Build ffmpeg args
    const args: string[] = ['-hide_banner', '-y']

    // Input seeking (fast, keyframe-based) — before -i
    if (startTime > 0) {
      args.push('-ss', String(startTime))
    }

    args.push('-i', this.filePath)

    // Stream mapping
    args.push('-map', '0:v:0')
    if (this.audioTrackIndex !== undefined) {
      args.push('-map', `0:${this.audioTrackIndex}`)
    } else {
      args.push('-map', '0:a:0')
    }

    // Video codec
    if (decision.videoAction === 'reencode') {
      args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22')
      args.push('-profile:v', 'high', '-level', '4.1')
      args.push('-pix_fmt', 'yuv420p')
    } else {
      args.push('-c:v', 'copy')
    }

    // Audio codec
    if (decision.audioAction === 'reencode' || !HLS_COMPATIBLE_AUDIO.has(probe.audio[0]?.codec || '')) {
      args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2')
    } else {
      args.push('-c:a', 'copy')
    }

    // HLS output
    args.push(
      '-f', 'hls',
      '-hls_time', String(SEGMENT_DURATION),
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', join(this.outputDir, 'segment-%d.ts'),
      '-hls_list_size', '0',
      '-hls_flags', 'independent_segments+temp_file',
      '-start_number', String(startSeg),
    )

    // Output playlist (ffmpeg writes it)
    args.push(join(this.outputDir, 'ffmpeg-playlist.m3u8'))

    const ffmpeg = await getFfmpegPath()
    console.log(`[MediaEngine] Starting ffmpeg: mode=${decision.mode} startSeg=${startSeg} (${startTime}s) file=${this.filePath}`)
    console.log(`[MediaEngine] ffmpeg cmd: ${ffmpeg} ${args.join(' ')}`)

    const proc = spawn(ffmpeg, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    this.process = proc
    this.isStarting = false

    // Track segment production from ffmpeg stderr.
    // With temp_file flag, ffmpeg writes segment-N.ts.tmp then renames to
    // segment-N.ts. When we see "Opening segment-N.ts.tmp", segment N-1
    // is COMPLETE (renamed to its final name).
    let lastOpenedSeg = -1
    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      // Keep last 2KB of stderr for debugging
      this.stderrLog = (this.stderrLog + text).slice(-2048)
      // Detect segment opens (temp_file: *.ts.tmp)
      const matches = text.matchAll(/Opening '.*segment-(\d+)\.ts/g)
      for (const m of matches) {
        const seg = parseInt(m[1]!, 10)
        // When segment N is opened, segment N-1 is complete
        if (lastOpenedSeg >= 0 && lastOpenedSeg > this.highestReady) {
          this.highestReady = lastOpenedSeg
        }
        if (lastOpenedSeg < 0) {
          console.log(`[MediaEngine] First segment started: ${seg} for ${this.clientId}`)
        }
        lastOpenedSeg = seg
      }
    })

    proc.on('exit', (code, signal) => {
      // Only clear this.process if it's still the same process (avoids race
      // condition where an old process's exit handler fires after a new one
      // has been spawned during seek/restart).
      const isCurrentProcess = this.process === proc
      const killedByUs = code === 255 || signal === 'SIGKILL' || signal === 'SIGTERM'
      if (code !== 0 && !killedByUs) {
        console.error(`[MediaEngine] ffmpeg exited unexpectedly: code=${code} signal=${signal} for ${this.clientId}`)
        if (this.stderrLog) {
          console.error(`[MediaEngine] Last stderr: ${this.stderrLog.slice(-500)}`)
        }
      } else if (isCurrentProcess && !signal) {
        // Normal completion (code 0, no signal)
        console.log(`[MediaEngine] ffmpeg finished for ${this.clientId}`)
      }
      if (isCurrentProcess) {
        this.process = null
      }
    })

    proc.on('error', (err) => {
      console.error(`[MediaEngine] ffmpeg spawn error:`, err.message)
      if (this.process === proc) {
        this.process = null
      }
    })

    this.touchActivity()
  }

  /** Generate master playlist pointing to a single muxed variant */
  masterPlaylist(): string {
    const v = this.probe.video
    const width = v?.width || 1920
    const height = v?.height || 1080
    const bandwidth = v?.bitrate || 8_000_000

    return [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${height},CODECS="avc1.640028,mp4a.40.2"`,
      `video/0/original/playlist.m3u8`,
    ].join('\n')
  }

  /** Generate the full VOD variant playlist (all segments listed upfront) */
  variantPlaylist(): string {
    const lines: string[] = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      `#EXT-X-TARGETDURATION:${SEGMENT_DURATION}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
    ]

    const remaining = this.probe.duration
    for (let i = 0; i < this.totalSegments; i++) {
      const segDur = Math.min(SEGMENT_DURATION, remaining - i * SEGMENT_DURATION)
      lines.push(`#EXTINF:${segDur.toFixed(3)},`)
      // Mark segments that don't exist and won't be produced as GAPs.
      // HLS.js skips GAP fragments instead of requesting them.
      // A segment exists if: it's on disk OR ffmpeg is producing it (>= currentStartSegment).
      if (i < this.currentStartSegment) {
        const segPath = join(this.outputDir, `segment-${i}.ts`)
        if (!existsSync(segPath)) {
          lines.push('#EXT-X-GAP')
        }
      }
      lines.push(`segment-${i}.ts`)
    }

    lines.push('#EXT-X-ENDLIST')
    return lines.join('\n')
  }

  /** Get a segment, waiting for it to be generated. */
  async getSegment(segmentNumber: number, signal?: AbortSignal): Promise<SegmentStream> {
    this.touchActivity()

    const segPath = join(this.outputDir, `segment-${segmentNumber}.ts`)
    console.log(`[MediaEngine] getSegment(${segmentNumber}) cached=${existsSync(segPath)} ffmpeg=${this.process ? 'running' : 'stopped'} startSeg=${this.currentStartSegment} highest=${this.highestReady}`)

    // If segment is already cached on disk, serve it immediately.
    // With temp_file flag, the file only exists once fully written.
    if (existsSync(segPath)) {
      if (segmentNumber > this.highestReady) this.highestReady = segmentNumber
      const stat = statSync(segPath)
      return { stream: createReadStream(segPath), size: stat.size }
    }

    // NOTE: We do NOT trigger seeks here. Only the frontend (via
    // preheat-seek API) controls where ffmpeg is positioned. This avoids
    // cascading restarts when HLS.js speculatively requests segments at
    // positions far from the current playback (prefetch, ABR probing, etc).

    // If ffmpeg hasn't started yet (or was stopped), start from this segment
    // Skip if start() is already in progress (isStarting) to avoid race condition
    if (!this.process && !this.isStarting) {
      await this.start({ audioTrack: this.audioTrackIndex, startSegment: Math.max(0, segmentNumber - 2) })
    }

    // Adaptive timeout: segments near ffmpeg's position get the full 30s.
    // Far-ahead speculative segments (HLS.js probing) get 8s — short enough
    // to free the connection quickly, long enough for HLS.js retries to
    // eventually succeed as ffmpeg catches up.
    const isFarAhead = segmentNumber > this.highestReady + SEEK_THRESHOLD
      && segmentNumber > this.currentStartSegment + SEEK_THRESHOLD
    const timeout = isFarAhead ? 8_000 : SEGMENT_WAIT_TIMEOUT
    const deadline = Date.now() + timeout
    let restartAttempts = 0
    const MAX_RESTART_ATTEMPTS = 2
    while (!existsSync(segPath)) {
      if (signal?.aborted) {
        throw new Error('Client disconnected')
      }
      if (Date.now() > deadline) {
        throw new Error(`Segment ${segmentNumber} not ready after ${timeout / 1000}s`)
      }
      // Segments well behind ffmpeg (will never be produced): fast-fail.
      // Grace zone of 5 segments below startSeg for keyframe alignment.
      if (segmentNumber < this.currentStartSegment - 5) {
        const abandonDeadline = Date.now() + 2_000
        while (Date.now() < abandonDeadline) {
          if (signal?.aborted) throw new Error('Client disconnected')
          await abortableSleep(200, signal)
        }
        throw new Error(`Segment ${segmentNumber} abandoned: behind start ${this.currentStartSegment}`)
      }
      // Restart ffmpeg if it died (not during seek transition)
      if (!this.process && !this.isStarting) {
        if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
          throw new Error(`ffmpeg keeps dying, cannot produce segment ${segmentNumber}`)
        }
        restartAttempts++
        console.log(`[MediaEngine] ffmpeg not running while waiting for segment ${segmentNumber}, restart attempt ${restartAttempts}`)
        await this.start({ audioTrack: this.audioTrackIndex, startSegment: Math.max(0, segmentNumber - 2) })
      }
      await abortableSleep(SEGMENT_POLL_INTERVAL, signal)
    }

    // With temp_file flag, the file only appears after atomic rename —
    // no need to wait for flushing.

    // Update highest ready
    if (segmentNumber > this.highestReady) {
      this.highestReady = segmentNumber
    }

    const stat = statSync(segPath)
    return {
      stream: createReadStream(segPath),
      size: stat.size,
    }
  }

  /** Extract a subtitle track to VTT using ffmpeg */
  async getSubtitle(trackIndex: number): Promise<string> {
    const ffmpeg = await getFfmpegPath()
    return new Promise((resolve, reject) => {
      const args = [
        '-hide_banner', '-y',
        '-i', this.filePath,
        '-map', `0:${trackIndex}`,
        '-c:s', 'webvtt',
        '-f', 'webvtt',
        'pipe:1',
      ]

      const proc = spawn(ffmpeg, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const chunks: Buffer[] = []
      proc.stdout!.on('data', (d: Buffer) => chunks.push(d))

      let stderr = ''
      proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString() })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks).toString('utf-8'))
        } else {
          reject(new Error(`VTT extraction failed (code ${code}): ${stderr.slice(-300)}`))
        }
      })

      proc.on('error', reject)
    })
  }

  /** Preheat: just start ffmpeg from the beginning so segments start appearing */
  async preheat() {
    if (this.process) return // Already running
    await this.start()
  }

  /**
   * Preheat a specific position.
   * @param force - if true (user actually seeked), can kill running ffmpeg.
   *                if false (timeline hover), only starts if ffmpeg not running.
   */
  async preheatSeek(positionSec: number, force = false) {
    const targetSeg = Math.floor(positionSec / SEGMENT_DURATION)
    // Start a few segments before the target — HLS.js often requests
    // segments before the seek position for keyframe alignment.
    const startSeg = Math.max(0, targetSeg - 10)
    const segPath = join(this.outputDir, `segment-${targetSeg}.ts`)

    // Already cached
    if (existsSync(segPath)) return

    if (!this.process) {
      // No ffmpeg running — always start
      await this.start({ audioTrack: this.audioTrackIndex, startSegment: startSeg })
    } else if (force) {
      // User actually seeked — OK to restart ffmpeg if needed
      const needsSeek = targetSeg > this.highestReady + SEEK_THRESHOLD
        || targetSeg < this.currentStartSegment
      if (needsSeek) {
        console.log(`[MediaEngine] Forced seek to segment ${startSeg} (user seek to ${targetSeg})`)
        await this.requestSeek(startSeg)
      }
    }
    // Hover/non-force: never kill a running ffmpeg, just let it be
  }

  /** Stop the session and clean up */
  async stop() {
    this.killProcess()
    this.clearDispose()
    // Cancel any pending debounced seek
    if (this.pendingSeekTimer) {
      clearTimeout(this.pendingSeekTimer)
      this.pendingSeekTimer = null
      this.pendingSeekSegment = null
      this.pendingSeekResolvers.forEach((r) => r())
      this.pendingSeekResolvers = []
    }
    sessions.delete(this.clientId)
    // Clean up temp files in background
    rm(this.outputDir, { recursive: true, force: true }).catch(() => {})
    console.log(`[MediaEngine] Session stopped & cleaned: ${this.clientId}`)
  }

  // ── Internal ──

  private killProcess() {
    if (this.process) {
      this.process.kill('SIGKILL')
      this.process = null
    }
  }

  private touchActivity() {
    this.clearDispose()
    this.disposeTimer = setTimeout(() => {
      console.log(`[MediaEngine] Session idle, disposing: ${this.clientId}`)
      this.stop()
    }, DISPOSE_TIMEOUT)
  }

  private clearDispose() {
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer)
      this.disposeTimer = null
    }
  }
}

/** Sleep that resolves early if the signal aborts */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

// ─── Session factory ─────────────────────────────────────────────────────────

async function getOrCreateSession(filePath: string, clientId: string, knownDurationSec?: number): Promise<FFmpegSession> {
  let session = sessions.get(clientId)
  if (session && session.filePath === filePath) {
    // Update duration if a better value is now available
    if (knownDurationSec && knownDurationSec > session.probe.duration) {
      session.overrideDuration(knownDurationSec)
    }
    return session
  }

  // Different file or new → create new session
  if (session) await session.stop()

  const probe = await MediaEngine.probe(filePath)
  // Override probe duration with TMDB/known duration if available and larger
  // (ffprobe can report wrong duration for AVI files with VBR)
  if (knownDurationSec && knownDurationSec > probe.duration) {
    probe.duration = knownDurationSec
  }
  session = new FFmpegSession(filePath, clientId, probe)
  sessions.set(clientId, session)
  return session
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const MediaEngine = {

  async probe(filePath: string): Promise<ProbeResult> {
    await ensureBinaries()
    const data = await rawProbe(filePath)
    if (!data) throw new Error(`Failed to probe "${filePath}"`)

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
      duration: format.duration ? Math.round(parseFloat(String(format.duration))) : 0,
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

  decide(probe: ProbeResult): PlaybackDecision {
    const videoCodec = probe.video?.codec || 'unknown'
    const audioCodec = probe.audio[0]?.codec || 'unknown'
    const container = probe.container

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

    const canRemuxVideo = HLS_COMPATIBLE_VIDEO.has(videoCodec)
    const canRemuxAudio = HLS_COMPATIBLE_AUDIO.has(audioCodec)

    if (canRemuxVideo) {
      const audioNote = canRemuxAudio ? 'copie' : `${audioCodec} → AAC`
      return {
        mode: 'remux',
        reason: `${videoCodec} dans ${container} → remux HLS (vidéo: copie, audio: ${audioNote})`,
        videoAction: 'repackage',
        audioAction: canRemuxAudio ? 'repackage' : 'reencode',
        estimatedLoad: 'low',
        streamUrl: (id) => `/api/stream/${id}/master.m3u8`,
      }
    }

    return {
      mode: 'transcode',
      reason: `${videoCodec} incompatible navigateur → transcodage ${videoCodec} → H.264`,
      videoAction: 'reencode',
      audioAction: canRemuxAudio ? 'repackage' : 'reencode',
      estimatedLoad: 'high',
      streamUrl: (id) => `/api/stream/${id}/master.m3u8`,
    }
  },

  /** Create or retrieve a streaming session */
  async createSession(filePath: string, clientId: string, knownDurationSec?: number): Promise<FFmpegSession> {
    return getOrCreateSession(filePath, clientId, knownDurationSec)
  },

  /** Preheat: start ffmpeg so segments are ready when the user clicks play */
  async preheat(filePath: string, clientId: string, knownDurationSec?: number): Promise<void> {
    const session = await getOrCreateSession(filePath, clientId, knownDurationSec)
    await session.preheat()
  },

  /** Preheat a specific timeline position */
  async preheatSeek(filePath: string, clientId: string, positionSec: number, knownDurationSec?: number, force = false): Promise<void> {
    const session = await getOrCreateSession(filePath, clientId, knownDurationSec)
    await session.preheatSeek(positionSec, force)
  },

  /** Quick stream info for the info endpoint */
  async getStreamInfo(filePath: string, mediaId: string, tmdbDurationMin?: number) {
    const probe = await this.probe(filePath)
    const decision = this.decide(probe)
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

  /** Stop a session explicitly (e.g., on page leave) */
  async stopSession(clientId: string): Promise<void> {
    const session = sessions.get(clientId)
    if (session) await session.stop()
  },
}

// ─── Public exports ──────────────────────────────────────────────────────────

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

/** @deprecated Use MediaEngine.probe() instead */
export async function extractStreams(filePath: string): Promise<StreamInfo[]> {
  const probe = await MediaEngine.probe(filePath)
  return [
    ...probe.audio.map(a => ({
      index: a.index, codecType: 'audio' as const, codecName: a.codec,
      language: a.language, title: a.title, channels: a.channels,
      isDefault: a.isDefault, isForced: a.isForced,
    })),
    ...probe.subtitles.map(s => ({
      index: s.index, codecType: 'subtitle' as const, codecName: s.codec,
      language: s.language, title: s.title,
      isDefault: s.isDefault, isForced: s.isForced,
    })),
  ]
}

/** @deprecated Use MediaEngine.probe() instead */
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
