import { execSync, spawn, type ChildProcess } from 'child_process'
import { mkdirSync, existsSync, readdirSync, unlinkSync, rmdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { findFfmpeg, extractFileMetadata, extractStreams } from './ffmpeg'

// ===== GPU hardware acceleration detection =====

type HwAccel = 'nvenc' | 'vaapi' | 'videotoolbox' | null
let detectedHwAccel: HwAccel | undefined // undefined = not yet detected

async function detectHwAccel(): Promise<HwAccel> {
  if (detectedHwAccel !== undefined) return detectedHwAccel

  const ffmpegPath = await findFfmpeg()
  if (!ffmpegPath) { detectedHwAccel = null; return null }

  // NVENC (NVIDIA GPU)
  try {
    const out = execSync(`${ffmpegPath} -hide_banner -encoders 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 })
    if (out.includes('h264_nvenc')) {
      // Verify the GPU is actually usable by running a tiny encode
      try {
        execSync(`${ffmpegPath} -hide_banner -f lavfi -i nullsrc=s=16x16:d=0.1 -c:v h264_nvenc -f null - 2>/dev/null`, { timeout: 10000 })
        console.log('[HLS] GPU detected: NVIDIA NVENC')
        detectedHwAccel = 'nvenc'
        return 'nvenc'
      } catch { /* NVENC listed but GPU not usable */ }
    }
  } catch { /* ignore */ }

  // VAAPI (Linux — Intel/AMD integrated GPU)
  if (process.platform === 'linux') {
    try {
      const out = execSync(`${ffmpegPath} -hide_banner -encoders 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 })
      if (out.includes('h264_vaapi') && existsSync('/dev/dri/renderD128')) {
        console.log('[HLS] GPU detected: VAAPI (/dev/dri/renderD128)')
        detectedHwAccel = 'vaapi'
        return 'vaapi'
      }
    } catch { /* ignore */ }
  }

  // VideoToolbox (macOS)
  if (process.platform === 'darwin') {
    try {
      const out = execSync(`${ffmpegPath} -hide_banner -encoders 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 })
      if (out.includes('h264_videotoolbox')) {
        console.log('[HLS] GPU detected: VideoToolbox (macOS)')
        detectedHwAccel = 'videotoolbox'
        return 'videotoolbox'
      }
    } catch { /* ignore */ }
  }

  console.log('[HLS] No GPU encoder detected, using CPU (libx264)')
  detectedHwAccel = null
  return null
}

export const SEGMENT_DURATION = 6 // seconds per segment (6s = faster seek response, good HLS compromise)
const CLEANUP_AFTER_MS = 5 * 60 * 1000 // 5 minutes of inactivity
// Buffer limits: copy mode is near-instant (just I/O), so allow a huge buffer to avoid
// the constant kill/restart cycle that causes A/V desync (video copies from keyframe,
// audio re-encodes from exact seek point → timestamp mismatch on each restart)
const BUFFER_AHEAD_COPY = 300 // 30 minutes — copy is cheap, minimize restarts
const BUFFER_AHEAD_TRANSCODE = 30 // 3 minutes — transcode is CPU-heavy, limit buffer
const BUFFER_RESTART_THRESHOLD = 6 // restart ffmpeg when less than ~36s of buffer remaining
const FAST_START_SEGMENTS = 5 // produce 5 ultrafast segments (~30s) before switching to quality preset

// Video codecs that can be copied into MPEGTS with h264_mp4toannexb and played by browsers
// mpeg4 (DivX/Xvid) is NOT h264 — it cannot use h264_mp4toannexb and browsers can't play it in MPEGTS
const BROWSER_VIDEO_CODECS = new Set(['h264', 'avc1', 'avc'])
// Audio: ONLY AAC is safe for MPEGTS in all browsers
// MP3 sometimes works but AAC is universally supported
// vorbis, opus, flac, ac3, dts, eac3 etc. CANNOT be muxed into MPEGTS
const MPEGTS_SAFE_AUDIO_CODECS = new Set(['aac'])

export interface TranscodeSession {
  id: string
  mediaId: string
  filePath: string
  outputDir: string
  ffmpegProcess: ChildProcess | null
  ffmpegDone: boolean
  duration: number
  totalSegments: number
  startSegment: number
  lastAccess: number
  error: string | null
  codecArgs: string[]
  hwInputArgs: string[] // hardware accel args that go before -i (e.g. -hwaccel cuda)
  hwAccel: HwAccel // detected GPU encoder or null for CPU
  isCopyMode: boolean // true when video is copied (not transcoded) — allows larger buffer
  audioTrackIndex: number | undefined // absolute stream index from ffprobe
  subtitleTrackIndex: number | undefined // absolute stream index for burn-in (bitmap subs only)
  lastRequestedSegment: number // highest segment requested by the player (for buffer limiting)
  fastStartActive: boolean // true = currently encoding with ultrafast preset for instant playback
}

const sessions = new Map<string, TranscodeSession>()
let cleanupInterval: NodeJS.Timeout | null = null

function ensureCleanupRunning() {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, session] of sessions) {
      if (now - session.lastAccess > CLEANUP_AFTER_MS) {
        destroySession(key)
      }
    }
    if (sessions.size === 0 && cleanupInterval) {
      clearInterval(cleanupInterval)
      cleanupInterval = null
    }
  }, 30_000)
}

function cleanDir(dir: string) {
  if (!existsSync(dir)) return
  try {
    for (const f of readdirSync(dir)) {
      unlinkSync(join(dir, f))
    }
    rmdirSync(dir)
  } catch { /* ignore */ }
}

/** Remove segment files >= fromSegment from the output directory.
 * Segments before fromSegment are preserved — they have correct PTS (thanks to -copyts)
 * and can be reused without restarting ffmpeg, which avoids A/V desync from restart cycles. */
function cleanSegmentFilesFrom(session: TranscodeSession, fromSegment: number) {
  try {
    const files = readdirSync(session.outputDir)
    for (const f of files) {
      const match = f.match(/^seg_(\d+)\.ts(\.tmp)?$/)
      if (match) {
        const idx = parseInt(match[1], 10)
        if (idx >= fromSegment) {
          try { unlinkSync(join(session.outputDir, f)) } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }
}

function destroySession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return
  if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
    session.ffmpegProcess.kill('SIGTERM')
  }
  cleanDir(session.outputDir)
  sessions.delete(sessionId)
  console.log(`[HLS] Session destroyed: ${sessionId}`)
}

function buildCodecArgs(videoCodec: string, audioCodec: string, burnInSubtitle: boolean, fastStart: boolean = false, hwAccel: HwAccel = null): { args: string[], isCopyMode: boolean, hwInputArgs: string[] } {
  const videoOk = BROWSER_VIDEO_CODECS.has(videoCodec.toLowerCase())
  const audioOk = MPEGTS_SAFE_AUDIO_CODECS.has(audioCodec.toLowerCase())
  // Copy mode = video is copied (not transcoded). This is near-instant so buffer can be huge.
  const isCopyMode = videoOk && !burnInSubtitle

  const args: string[] = []
  // Hardware input args must go BEFORE -i in the ffmpeg command
  const hwInputArgs: string[] = []

  // Burn-in subtitles FORCE video transcoding (can't overlay on -c:v copy)
  if (isCopyMode) {
    // Copy video but add bitstream filter for MPEGTS compatibility
    args.push('-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb')
  } else if (hwAccel === 'nvenc') {
    // NVIDIA NVENC GPU encoding
    hwInputArgs.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda')
    const preset = fastStart ? 'p1' : 'p4' // p1=fastest, p4=good quality/speed balance
    args.push(
      '-c:v', 'h264_nvenc',
      '-preset', preset,
      '-rc', 'vbr',
      '-cq', '23',
      '-maxrate', '5M',
      '-bufsize', '10M',
      '-profile:v', 'high',
      '-level', '4.0',
      '-pix_fmt', 'yuv420p',
      '-force_key_frames', `expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+${SEGMENT_DURATION}))`,
      '-sc_threshold', '0',
    )
  } else if (hwAccel === 'vaapi') {
    // VAAPI (Intel/AMD on Linux)
    hwInputArgs.push('-hwaccel', 'vaapi', '-hwaccel_device', '/dev/dri/renderD128', '-hwaccel_output_format', 'vaapi')
    args.push(
      '-c:v', 'h264_vaapi',
      '-qp', '23',
      '-maxrate', '5M',
      '-bufsize', '10M',
      '-profile:v', '100', // high profile
      '-level', '40',
      '-force_key_frames', `expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+${SEGMENT_DURATION}))`,
      '-sc_threshold', '0',
    )
  } else if (hwAccel === 'videotoolbox') {
    // macOS VideoToolbox
    args.push(
      '-c:v', 'h264_videotoolbox',
      '-q:v', '65', // quality 0-100, 65 ≈ CRF 23
      '-maxrate', '5M',
      '-bufsize', '10M',
      '-profile:v', 'high',
      '-level', '4.0',
      '-pix_fmt', 'yuv420p',
      '-force_key_frames', `expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+${SEGMENT_DURATION}))`,
      '-sc_threshold', '0',
    )
  } else {
    // CPU fallback: libx264
    const preset = fastStart ? 'ultrafast' : 'veryfast'
    args.push(
      '-c:v', 'libx264',
      '-preset', preset,
      '-tune', 'zerolatency',
      '-crf', '23',
      '-maxrate', '5M',
      '-bufsize', '10M',
      '-profile:v', 'high',
      '-level', '4.0',
      '-pix_fmt', 'yuv420p',
      '-force_key_frames', `expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+${SEGMENT_DURATION}))`,
      '-sc_threshold', '0',
    )
  }

  if (audioOk) {
    args.push('-c:a', 'copy')
  } else {
    args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-af', 'aresample=async=1')
  }

  return { args, isCopyMode, hwInputArgs }
}

function startFfmpeg(session: TranscodeSession, fromSegment: number, fastStart: boolean = false): ChildProcess | null {
  const ffmpegPath = (session as any)._ffmpegPath as string
  if (!ffmpegPath) return null

  // Kill any existing process to prevent orphaned ffmpeg processes
  if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
    session.ffmpegProcess.kill('SIGTERM')
  }
  session.ffmpegProcess = null
  session.ffmpegDone = false
  session.error = null
  const startTime = fromSegment * SEGMENT_DURATION

  const args: string[] = []

  // Seek to start time (before input for fast seeking)
  if (startTime > 0) {
    args.push('-ss', startTime.toString())
  }

  // Hardware acceleration input args (must go before -i)
  if (session.hwInputArgs.length > 0) {
    args.push(...session.hwInputArgs)
  }

  args.push(
    '-probesize', '5000000',
    '-analyzeduration', '5000000',
    '-fflags', '+genpts',
    '-threads', '0',
    '-i', session.filePath,
    // Preserve original timestamps so that segments after seeking have PTS matching
    // the VOD playlist position (e.g. seg 1496 has PTS ~2992s, not 0)
    '-copyts',
    '-avoid_negative_ts', 'disabled',
  )

  // Burn-in subtitle: overlay bitmap subtitle onto video using filter_complex
  if (session.subtitleTrackIndex !== undefined) {
    // filter_complex overlays the subtitle stream onto video, outputs as [vout]
    args.push(
      '-filter_complex', `[0:v:0][0:${session.subtitleTrackIndex}]overlay[vout]`,
      '-map', '[vout]',
      '-map', session.audioTrackIndex !== undefined ? `0:${session.audioTrackIndex}` : '0:a:0?',
    )
  } else {
    // No burn-in: select first video stream and the chosen audio track
    args.push(
      '-map', '0:v:0',
      '-map', session.audioTrackIndex !== undefined ? `0:${session.audioTrackIndex}` : '0:a:0?',
    )
  }

  // In fast-start mode (non-copy), recalculate codec args with ultrafast preset
  // In copy mode, fastStart has no effect (already instant)
  const effectiveFastStart = fastStart && !session.isCopyMode
  session.fastStartActive = effectiveFastStart
  const codecArgs = effectiveFastStart
    ? buildCodecArgs((session as any)._videoCodec, (session as any)._audioCodec, session.subtitleTrackIndex !== undefined, true, session.hwAccel).args
    : session.codecArgs

  args.push(
    ...codecArgs,
    // Small muxing delay to help A/V sync (0 was too aggressive, caused desync)
    '-muxdelay', '0.1',
    '-muxpreload', '0.1',
    '-max_muxing_queue_size', '2048',
    '-f', 'hls',
    '-hls_time', SEGMENT_DURATION.toString(),
    '-hls_list_size', '0',
    '-hls_segment_type', 'mpegts',
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_filename', join(session.outputDir, 'seg_%d.ts'),
    '-start_number', fromSegment.toString(),
    join(session.outputDir, 'playlist.m3u8'),
  )

  console.log(`[HLS] Starting ffmpeg from segment ${fromSegment} (${startTime}s)${effectiveFastStart ? ' [FAST-START ultrafast]' : ''}`)
  console.log(`[HLS] Full ffmpeg args:`, args.join(' '))

  const proc = spawn(ffmpegPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Assign process to session BEFORE setting up event handlers
  // so the race condition guard (session.ffmpegProcess !== proc) works correctly
  session.startSegment = fromSegment
  session.ffmpegProcess = proc

  let stderrBuf = ''
  let lastStderrLog = Date.now()
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString()
    // Log ffmpeg progress every 3 seconds to diagnose hangs
    const now = Date.now()
    if (now - lastStderrLog > 3000) {
      lastStderrLog = now
      const lines = stderrBuf.trim().split('\n')
      const lastLine = lines[lines.length - 1] || ''
      console.log(`[HLS] ffmpeg progress: ${lastLine.substring(0, 200)}`)
    }
  })

  proc.on('error', (err) => {
    // Ignore events from old killed processes (race condition on seek)
    if (session.ffmpegProcess !== proc) return
    console.error('[HLS] FFmpeg error:', err.message)
    session.error = err.message
    session.ffmpegDone = true
  })

  proc.on('close', (code) => {
    // Ignore events from old killed processes (race condition on seek)
    if (session.ffmpegProcess !== proc) {
      console.log(`[HLS] Ignoring close event from old ffmpeg process (code ${code})`)
      return
    }
    // If ffmpegDone was already set (by buffer limiter), don't treat non-zero exit as error
    // On Windows, SIGTERM causes exit code 1 which would incorrectly overwrite error=null
    const wasDone = session.ffmpegDone
    session.ffmpegProcess = null
    session.ffmpegDone = true
    if (code !== 0 && code !== null && !wasDone) {
      const lines = stderrBuf.trim().split('\n')
      console.error(`[HLS] FFmpeg exited with code ${code}`, lines.slice(-5).join('\n'))
      session.error = `FFmpeg exited with code ${code}`
    } else if (code === 0 || code === null) {
      console.log(`[HLS] FFmpeg finished successfully for session ${session.id}`)
    } else {
      console.log(`[HLS] FFmpeg process ended (code ${code}, intentional kill - buffer limit or preheat)`)
    }
  })

  // Buffer limiter: kill ffmpeg when it's far enough ahead of the player
  // Use dynamic buffer size: copy mode allows huge buffer (cheap), transcode mode limits it
  const bufferLimit = session.isCopyMode ? BUFFER_AHEAD_COPY : BUFFER_AHEAD_TRANSCODE
  const bufferCheck = setInterval(() => {
    if (session.ffmpegProcess !== proc || !session.ffmpegProcess || session.ffmpegProcess.killed) {
      clearInterval(bufferCheck)
      return
    }
    // Only count segments from the current run (>= startSegment) to avoid
    // old segments from previous runs triggering premature kills
    const highest = getHighestSegmentFrom(session, session.startSegment)

    // Fast-start upgrade: once we have enough ultrafast segments, switch to quality preset
    if (session.fastStartActive && highest >= session.startSegment + FAST_START_SEGMENTS) {
      console.log(`[HLS] Fast-start complete (${FAST_START_SEGMENTS} segments ready), upgrading to quality preset`)
      session.ffmpegProcess.kill('SIGTERM')
      session.ffmpegDone = true
      session.error = null
      session.fastStartActive = false
      clearInterval(bufferCheck)
      // Restart from highest (not highest+1) so the decoder gets a reference frame overlap
      startFfmpeg(session, highest, false)
      return
    }

    // Use startSegment as minimum for lastRequested — prevents premature kill when
    // lastRequestedSegment hasn't been updated yet (e.g., first buffer check after seek)
    const effectiveLastRequested = Math.max(session.lastRequestedSegment, session.startSegment)
    if (highest >= effectiveLastRequested + bufferLimit) {
      console.log(`[HLS] Buffer limit reached: highest=${highest}, lastRequested=${effectiveLastRequested}, limit=${bufferLimit}, pausing ffmpeg`)
      session.ffmpegProcess.kill('SIGTERM')
      session.ffmpegDone = true
      session.error = null // not an error, just buffer limit
      clearInterval(bufferCheck)
    }
  }, 1000)

  return proc
}

export async function getOrCreateSession(mediaId: string, filePath: string, audioTrackIndex?: number, subtitleTrackIndex?: number): Promise<TranscodeSession | null> {
  // Reuse existing session for same media (but recreate if audio/subtitle track changed)
  if (sessions.has(mediaId)) {
    const session = sessions.get(mediaId)!
    const audioChanged = audioTrackIndex !== undefined && session.audioTrackIndex !== audioTrackIndex
    const subtitleChanged = session.subtitleTrackIndex !== subtitleTrackIndex
    if (audioChanged || subtitleChanged) {
      console.log(`[HLS] Track changed (audio: ${session.audioTrackIndex}→${audioTrackIndex}, subtitle: ${session.subtitleTrackIndex}→${subtitleTrackIndex}), recreating session`)
      destroySession(mediaId)
    } else {
      session.lastAccess = Date.now()
      return session
    }
  }

  const ffmpegPath = await findFfmpeg()
  if (!ffmpegPath) return null

  const metadata = await extractFileMetadata(filePath)
  const duration = metadata?.duration || 0
  if (duration <= 0) {
    console.error(`[HLS] Cannot determine duration for ${filePath}`)
    return null
  }

  const videoCodec = metadata?.videoCodec || ''
  let audioCodec = metadata?.audioCodec || ''

  // If a specific audio track is selected, determine its codec
  if (audioTrackIndex !== undefined) {
    const streams = await extractStreams(filePath)
    const selectedStream = streams.find(s => s.index === audioTrackIndex && s.codecType === 'audio')
    if (selectedStream) {
      audioCodec = selectedStream.codecName
      console.log(`[HLS] Selected audio track ${audioTrackIndex}: codec=${audioCodec}`)
    }
  }

  // Detect GPU hardware acceleration (cached after first call)
  const hwAccel = await detectHwAccel()

  const { args: codecArgs, isCopyMode, hwInputArgs } = buildCodecArgs(videoCodec, audioCodec, subtitleTrackIndex !== undefined, false, hwAccel)

  const totalSegments = Math.ceil(duration / SEGMENT_DURATION)

  const outputDir = join(tmpdir(), `pipouflix-hls-${mediaId}`)
  cleanDir(outputDir) // Clean any previous remnants
  mkdirSync(outputDir, { recursive: true })

  const session: TranscodeSession = {
    id: mediaId,
    mediaId,
    filePath,
    outputDir,
    ffmpegProcess: null,
    ffmpegDone: false,
    duration,
    totalSegments,
    startSegment: 0,
    lastAccess: Date.now(),
    error: null,
    codecArgs,
    hwInputArgs,
    hwAccel,
    isCopyMode,
    audioTrackIndex,
    subtitleTrackIndex,
    lastRequestedSegment: 0,
    fastStartActive: false,
  }

  // Store ffmpeg path and codec info for reuse (needed for fast-start preset recalculation)
  ;(session as any)._ffmpegPath = ffmpegPath
  ;(session as any)._videoCodec = videoCodec
  ;(session as any)._audioCodec = audioCodec

  sessions.set(mediaId, session)
  ensureCleanupRunning()

  // ffmpeg is started lazily on first segment request (waitForSegment)
  // This avoids starting from segment 0 when the player needs segment 748 (resume position)

  const accelLabel = hwAccel ? `GPU:${hwAccel}` : 'CPU'
  console.log(`[HLS] Session created for ${mediaId}: ${totalSegments} segments, ${duration}s, codecs: ${videoCodec}/${audioCodec}, mode: ${isCopyMode ? 'copy' : 'transcode'} (${accelLabel})${subtitleTrackIndex !== undefined ? `, burn-in sub: ${subtitleTrackIndex}` : ''} → ${codecArgs.join(' ')}`)

  return session
}

export function generatePlaylist(session: TranscodeSession): string {
  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${SEGMENT_DURATION}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ]

  for (let i = 0; i < session.totalSegments; i++) {
    const segDuration = (i === session.totalSegments - 1)
      ? (session.duration - i * SEGMENT_DURATION)
      : SEGMENT_DURATION
    lines.push(`#EXTINF:${segDuration.toFixed(3)},`)
    lines.push(`/api/stream/${session.mediaId}/segment/${i}`)
  }

  lines.push('#EXT-X-ENDLIST')
  return lines.join('\n')
}

export function getSegmentPath(session: TranscodeSession, segmentIndex: number): string {
  return join(session.outputDir, `seg_${segmentIndex}.ts`)
}

function segmentFileExists(session: TranscodeSession, segmentIndex: number): boolean {
  return existsSync(getSegmentPath(session, segmentIndex))
}

/**
 * With -hls_flags temp_file, ffmpeg writes segments as .tmp then renames
 * atomically when complete. Any .ts file that exists is guaranteed complete.
 */
export function isSegmentReady(session: TranscodeSession, segmentIndex: number): boolean {
  return segmentFileExists(session, segmentIndex)
}

export async function waitForSegment(session: TranscodeSession, segmentIndex: number, timeoutMs = 30_000): Promise<boolean> {
  // Track the highest segment the player has requested (for buffer limiting)
  session.lastRequestedSegment = Math.max(session.lastRequestedSegment, segmentIndex)

  // If segment already exists on disk (from current or previous run), serve it directly.
  // With -copyts, segments have correct PTS regardless of which ffmpeg run produced them.
  if (isSegmentReady(session, segmentIndex)) return true

  // Proactive restart: if ffmpeg was paused (buffer limit) and buffer is running low, restart early
  // Start 1 segment earlier for "warm-up": the overlapping segment ensures the video decoder
  // has proper reference frames, avoiding the "video rollback + audio continues" desync
  if (session.ffmpegDone && !session.error) {
    const highestReady = getHighestSegmentFrom(session, session.startSegment)
    if (highestReady >= 0 && highestReady < session.totalSegments - 1 && highestReady - segmentIndex < BUFFER_RESTART_THRESHOLD) {
      const restartFrom = Math.max(0, highestReady)
      console.log(`[HLS] Buffer running low (${highestReady - segmentIndex} segments ahead), restarting ffmpeg from segment ${restartFrom}`)
      // Only clean segments that will be re-produced (>= restartFrom), preserve earlier ones
      cleanSegmentFilesFrom(session, restartFrom)
      // Proactive restart already has buffer, no need for fast-start
      startFfmpeg(session, restartFrom, false)
    }
  }

  if (isSegmentReady(session, segmentIndex)) return true

  // Lazy start: if ffmpeg hasn't been started yet, start from the requested segment
  if (!session.ffmpegProcess && !session.ffmpegDone) {
    console.log(`[HLS] Lazy start: first segment requested is ${segmentIndex}`)
    // Use fast-start for instant playback (ultrafast → veryfast after 5 segments)
    startFfmpeg(session, segmentIndex, true)
  }

  const highestReady = getHighestSegmentFrom(session, session.startSegment)
  const hasNewSegments = highestReady >= session.startSegment

  // Only seek when the segment truly cannot be served from disk AND ffmpeg won't produce it
  const needsSeek =
    // ffmpeg done but segment doesn't exist on disk (buffer-limit pause or different range)
    (session.ffmpegDone && !segmentFileExists(session, segmentIndex)) ||
    // Far ahead of production, but ONLY if ffmpeg has started producing new segments
    // (prevents thundering herd: concurrent requests after a seek/start won't re-seek)
    (!session.ffmpegDone && segmentIndex > highestReady + 10 && hasNewSegments) ||
    // Backward seek: segment is before ffmpeg's current range and not on disk
    // ffmpeg only produces segments >= startSegment, so it will never reach this segment
    (!session.ffmpegDone && segmentIndex < session.startSegment && !segmentFileExists(session, segmentIndex))

  if (needsSeek) {
    console.log(`[HLS] Seeking: requested seg ${segmentIndex}, highest ready ${highestReady}, startSegment ${session.startSegment}, ffmpegDone=${session.ffmpegDone}`)
    // Only clean segments >= target to preserve earlier segments (reusable with -copyts)
    cleanSegmentFilesFrom(session, segmentIndex)
    // Reset lastRequestedSegment to the new position (Math.max above kept the old high value)
    session.lastRequestedSegment = segmentIndex
    // Use fast-start for instant playback after seek
    startFfmpeg(session, segmentIndex, true)
    // Give ffmpeg a moment to start up
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Poll for the segment to become ready
  const start = Date.now()
  let loggedFirstDetection = false
  while (Date.now() - start < timeoutMs) {
    if (isSegmentReady(session, segmentIndex)) {
      console.log(`[HLS] Segment ${segmentIndex} ready after ${Date.now() - start}ms`)
      return true
    }
    if (session.error) {
      console.error(`[HLS] Error while waiting for segment ${segmentIndex}: ${session.error}`)
      return false
    }
    // Log the first time any segment is detected (shows ffmpeg is producing output)
    if (!loggedFirstDetection) {
      const highest = getHighestReadySegment(session)
      if (highest >= 0) {
        console.log(`[HLS] First segment detected: seg_${highest}.ts (waiting for ${segmentIndex})`)
        loggedFirstDetection = true
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  console.error(`[HLS] Timeout waiting for segment ${segmentIndex}`)
  return false
}

function getHighestReadySegment(session: TranscodeSession): number {
  let highest = -1
  try {
    const files = readdirSync(session.outputDir)
    for (const f of files) {
      const match = f.match(/^seg_(\d+)\.ts$/)
      if (match) {
        const idx = parseInt(match[1], 10)
        if (idx > highest) highest = idx
      }
    }
  } catch { /* ignore */ }
  // With temp_file flag, any .ts file that exists is complete
  return highest
}

/** Get highest ready segment that is >= minIndex.
 * Used by buffer limiter to only count segments from the current ffmpeg run,
 * ignoring stale segments from previous runs that would cause premature kills. */
function getHighestSegmentFrom(session: TranscodeSession, minIndex: number): number {
  let highest = -1
  try {
    const files = readdirSync(session.outputDir)
    for (const f of files) {
      const match = f.match(/^seg_(\d+)\.ts$/)
      if (match) {
        const idx = parseInt(match[1], 10)
        if (idx >= minIndex && idx > highest) highest = idx
      }
    }
  } catch { /* ignore */ }
  return highest
}

export function readSegment(session: TranscodeSession, segmentIndex: number): Buffer | null {
  const segPath = getSegmentPath(session, segmentIndex)
  try {
    return readFileSync(segPath)
  } catch {
    return null
  }
}

export function preheatSession(session: TranscodeSession, fromSegment: number): void {
  if (session.ffmpegProcess || session.ffmpegDone) return
  console.log(`[HLS] Preheating session ${session.id} from segment ${fromSegment}`)
  // Set lastRequestedSegment so the global buffer limiter in startFfmpeg()
  // will stop ffmpeg after BUFFER_AHEAD_SEGMENTS (2 min) ahead of this position
  session.lastRequestedSegment = fromSegment
  startFfmpeg(session, fromSegment)
}

/** Get an existing session without creating or recreating (no track comparison). */
export function getSessionIfExists(mediaId: string): TranscodeSession | null {
  const session = sessions.get(mediaId)
  if (session) session.lastAccess = Date.now()
  return session || null
}

export function destroyMediaSession(mediaId: string) {
  destroySession(mediaId)
}
