import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync, existsSync, readdirSync, unlinkSync, rmdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { findFfmpeg, extractFileMetadata, extractStreams } from './ffmpeg'

export const SEGMENT_DURATION = 10 // seconds per segment (10s = standard VOD, fewer boundaries = less A/V desync)
const CLEANUP_AFTER_MS = 5 * 60 * 1000 // 5 minutes of inactivity
const BUFFER_AHEAD_SEGMENTS = 12 // max 2 minutes (12 * 10s) ahead of player position
const BUFFER_RESTART_THRESHOLD = 3 // restart ffmpeg when less than 30s of buffer remaining

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
  audioTrackIndex: number | undefined // absolute stream index from ffprobe
  lastRequestedSegment: number // highest segment requested by the player (for buffer limiting)
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

/** Remove all segment files (.ts and .tmp) from the output directory without deleting the dir itself */
function cleanSegmentFiles(session: TranscodeSession) {
  try {
    const files = readdirSync(session.outputDir)
    for (const f of files) {
      if (/^seg_\d+\.ts(\.tmp)?$/.test(f)) {
        try { unlinkSync(join(session.outputDir, f)) } catch { /* ignore */ }
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

function buildCodecArgs(videoCodec: string, audioCodec: string): string[] {
  const videoOk = BROWSER_VIDEO_CODECS.has(videoCodec.toLowerCase())
  const audioOk = MPEGTS_SAFE_AUDIO_CODECS.has(audioCodec.toLowerCase())

  const args: string[] = []

  if (videoOk) {
    // Copy video but add bitstream filter for MPEGTS compatibility
    args.push('-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb')
  } else {
    // Transcode to H.264 for maximum compatibility
    args.push(
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-profile:v', 'high',
      '-level', '4.0',
      '-pix_fmt', 'yuv420p',
      // Force keyframes every SEGMENT_DURATION seconds (relative to previous keyframe)
      // Uses prev_forced_t to work correctly with -copyts (large timestamp offsets)
      '-force_key_frames', `expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+${SEGMENT_DURATION}))`,
      '-sc_threshold', '0',
    )
  }

  if (audioOk) {
    args.push('-c:a', 'copy')
  } else {
    // Always transcode audio to AAC (only codec safe in MPEGTS for all browsers)
    // -af aresample=async=1 keeps audio in sync with video when transcoding audio but copying video
    args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-af', 'aresample=async=1')
  }

  return args
}

function startFfmpeg(session: TranscodeSession, fromSegment: number): ChildProcess | null {
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

  args.push(
    // Faster startup: reduce probe/analyze time (default is 5M/5M which is slow for large MKV)
    '-probesize', '3000000',
    '-analyzeduration', '3000000',
    '-fflags', '+genpts+discardcorrupt',
    '-threads', '0',
    '-i', session.filePath,
    // Preserve original timestamps so that segments after seeking have PTS matching
    // the VOD playlist position (e.g. seg 1496 has PTS ~2992s, not 0)
    '-copyts',
    '-avoid_negative_ts', 'disabled',
    // Select first video stream and the chosen audio track
    '-map', '0:v:0',
    '-map', session.audioTrackIndex !== undefined ? `0:${session.audioTrackIndex}` : '0:a:0?',
    ...session.codecArgs,
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

  console.log(`[HLS] Starting ffmpeg from segment ${fromSegment} (${startTime}s)`)
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

  // Buffer limiter: kill ffmpeg when it's BUFFER_AHEAD_SEGMENTS ahead of the player
  // waitForSegment() will restart it when the player needs more segments
  const bufferCheck = setInterval(() => {
    if (session.ffmpegProcess !== proc || !session.ffmpegProcess || session.ffmpegProcess.killed) {
      clearInterval(bufferCheck)
      return
    }
    const highest = getHighestReadySegment(session)
    if (highest >= session.lastRequestedSegment + BUFFER_AHEAD_SEGMENTS) {
      console.log(`[HLS] Buffer limit reached: highest=${highest}, lastRequested=${session.lastRequestedSegment}, pausing ffmpeg`)
      session.ffmpegProcess.kill('SIGTERM')
      session.ffmpegDone = true
      session.error = null // not an error, just buffer limit
      clearInterval(bufferCheck)
    }
  }, 1000)

  return proc
}

export async function getOrCreateSession(mediaId: string, filePath: string, audioTrackIndex?: number): Promise<TranscodeSession | null> {
  // Reuse existing session for same media (but recreate if audio track changed)
  if (sessions.has(mediaId)) {
    const session = sessions.get(mediaId)!
    if (audioTrackIndex !== undefined && session.audioTrackIndex !== audioTrackIndex) {
      console.log(`[HLS] Audio track changed from ${session.audioTrackIndex} to ${audioTrackIndex}, recreating session`)
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

  const codecArgs = buildCodecArgs(videoCodec, audioCodec)

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
    audioTrackIndex,
    lastRequestedSegment: 0,
  }

  // Store ffmpeg path for reuse
  ;(session as any)._ffmpegPath = ffmpegPath

  sessions.set(mediaId, session)
  ensureCleanupRunning()

  // ffmpeg is started lazily on first segment request (waitForSegment)
  // This avoids starting from segment 0 when the player needs segment 748 (resume position)

  console.log(`[HLS] Session created for ${mediaId}: ${totalSegments} segments, ${duration}s, codecs: ${videoCodec}/${audioCodec} → ${codecArgs.join(' ')}`)

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

  // Proactive restart: if ffmpeg was paused (buffer limit) and buffer is running low, restart early
  // This avoids waiting until buffer hits 0 — keeps playback smooth
  if (session.ffmpegDone && !session.error) {
    const highestReady = getHighestReadySegment(session)
    if (highestReady >= 0 && highestReady < session.totalSegments - 1 && highestReady - segmentIndex < BUFFER_RESTART_THRESHOLD) {
      console.log(`[HLS] Buffer running low (${highestReady - segmentIndex} segments ahead), restarting ffmpeg from segment ${highestReady + 1}`)
      startFfmpeg(session, highestReady + 1)
    }
  }

  if (isSegmentReady(session, segmentIndex)) return true

  // Lazy start: if ffmpeg hasn't been started yet, start from the requested segment
  if (!session.ffmpegProcess && !session.ffmpegDone) {
    console.log(`[HLS] Lazy start: first segment requested is ${segmentIndex}`)
    startFfmpeg(session, segmentIndex)
  }

  const highestReady = getHighestReadySegment(session)
  const hasNewSegments = highestReady >= session.startSegment

  const needsSeek =
    // Backward: segment is before where ffmpeg started
    segmentIndex < session.startSegment ||
    // ffmpeg done but segment doesn't exist (includes buffer-limit pause)
    (session.ffmpegDone && !segmentFileExists(session, segmentIndex)) ||
    // Far ahead of production, but ONLY if ffmpeg has started producing new segments
    // (prevents thundering herd: concurrent requests after a seek/start won't re-seek)
    (!session.ffmpegDone && segmentIndex > highestReady + 10 && hasNewSegments)

  if (needsSeek) {
    console.log(`[HLS] Seeking: requested seg ${segmentIndex}, highest ready ${highestReady}, startSegment ${session.startSegment}, ffmpegDone=${session.ffmpegDone}`)
    // Clean old segment files so buffer limiter doesn't see stale segments from previous runs
    // (e.g., seeking from seg 272 back to seg 64 — old seg_284.ts would confuse the limiter)
    cleanSegmentFiles(session)
    // Reset lastRequestedSegment to the new position (Math.max above kept the old high value)
    session.lastRequestedSegment = segmentIndex
    startFfmpeg(session, segmentIndex)
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

export function destroyMediaSession(mediaId: string) {
  destroySession(mediaId)
}
