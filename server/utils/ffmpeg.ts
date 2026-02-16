import { execSync, execFile, spawn } from 'child_process'
import { existsSync, promises as fsPromises  } from 'fs'
import { dirname, join } from 'path'

/**
 * Find ffmpeg binary: tries ffmpeg-static npm package first, then system PATH.
 */
export async function findFfmpeg(): Promise<string | null> {
  // Try ffmpeg-static package first (bundled static binary)
  try {
    const mod = await import('ffmpeg-static')
    const staticPath = (mod.default || mod) as string
    if (staticPath && existsSync(staticPath)) {
      console.log(`[FFmpeg] Using ffmpeg-static: ${staticPath}`)
      return staticPath
    }
  } catch {
    // ffmpeg-static not installed
  }

  // Fallback to system PATH
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 })
    const ffmpegPath = result.trim().split(/\r?\n/)[0]
    if (ffmpegPath) {
      console.log(`[FFmpeg] Found ffmpeg in PATH: ${ffmpegPath}`)
      return ffmpegPath
    }
    return null
  } catch {
    console.log('[FFmpeg] ffmpeg not found')
    return null
  }
}

/**
 * Find ffprobe binary: tries ffprobe-static npm package first, then next to ffmpeg, then system PATH.
 */
export async function findFfprobe(): Promise<string | null> {
  // Try ffprobe-static package first (bundled static binary)
  try {
    const mod = await import('ffprobe-static')
    const staticPath = (mod.default?.path || mod.path) as string
    if (staticPath && existsSync(staticPath)) {
      console.log(`[FFprobe] Using ffprobe-static: ${staticPath}`)
      return staticPath
    }
  } catch {
    // ffprobe-static not installed
  }

  // Try to derive from ffmpeg-static (ffprobe may exist in same dir)
  const ffmpegPath = await findFfmpeg()
  if (ffmpegPath) {
    const dir = dirname(ffmpegPath)
    const ext = process.platform === 'win32' ? '.exe' : ''
    const ffprobePath = join(dir, `ffprobe${ext}`)
    if (existsSync(ffprobePath)) {
      console.log(`[FFprobe] Found next to ffmpeg: ${ffprobePath}`)
      return ffprobePath
    }
  }

  // Try system PATH
  try {
    const cmd = process.platform === 'win32' ? 'where ffprobe' : 'which ffprobe'
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 })
    const ffprobePath = result.trim().split(/\r?\n/)[0]
    if (ffprobePath) {
      console.log(`[FFprobe] Found in PATH: ${ffprobePath}`)
      return ffprobePath
    }
    return null
  } catch {
    console.log('[FFprobe] ffprobe not found')
    return null
  }
}

export interface StreamInfo {
  index: number
  codecType: 'audio' | 'subtitle'
  codecName: string
  language?: string
  title?: string
  channels?: number
  isDefault: boolean
  isForced: boolean
}

/**
 * Extract all audio and subtitle streams from a video file using ffprobe.
 */
export async function extractStreams(filePath: string): Promise<StreamInfo[]> {
  const ffprobePath = await findFfprobe()
  if (!ffprobePath) return []

  return new Promise((resolve) => {
    execFile(
      ffprobePath,
      [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        filePath,
      ],
      { timeout: 15000 },
      (error, stdout) => {
        if (error) {
          console.error(`[FFprobe] Error extracting streams from "${filePath}":`, error.message)
          resolve([])
          return
        }

        try {
          const data = JSON.parse(stdout)
          const streams: StreamInfo[] = []

          for (const stream of (data.streams || [])) {
            if (stream.codec_type !== 'audio' && stream.codec_type !== 'subtitle') continue

            const tags = stream.tags || {}
            const getTag = (key: string) => tags[key] || tags[key.toUpperCase()] || tags[key.toLowerCase()] || undefined
            const disposition = stream.disposition || {}

            streams.push({
              index: stream.index,
              codecType: stream.codec_type,
              codecName: stream.codec_name || 'unknown',
              language: getTag('language') || undefined,
              title: getTag('title') || undefined,
              channels: stream.codec_type === 'audio' ? (stream.channels || undefined) : undefined,
              isDefault: disposition.default === 1,
              isForced: disposition.forced === 1,
            })
          }

          resolve(streams)
        } catch (e) {
          console.error('[FFprobe] Failed to parse streams output:', e)
          resolve([])
        }
      }
    )
  })
}

export interface FileMetadata {
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
 * Extract metadata from a video file using ffprobe.
 * Returns title and other metadata tags if available.
 */
export async function extractFileMetadata(filePath: string): Promise<FileMetadata | null> {
  const ffprobePath = await findFfprobe()
  if (!ffprobePath) return null

  return new Promise((resolve) => {
    execFile(
      ffprobePath,
      [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { timeout: 15000 },
      (error, stdout) => {
        if (error) {
          console.error(`[FFprobe] Error probing "${filePath}":`, error.message)
          resolve(null)
          return
        }

        try {
          const data = JSON.parse(stdout)
          const format = data.format || {}
          const tags = format.tags || {}

          // ffprobe tags can have different casings
          const getTag = (key: string) => tags[key] || tags[key.toUpperCase()] || tags[key.toLowerCase()] || undefined

          const meta: FileMetadata = {}

          const title = getTag('title')
          if (title && title.trim()) meta.title = title.trim()

          const artist = getTag('artist') || getTag('album_artist')
          if (artist) meta.artist = artist

          const date = getTag('date') || getTag('year')
          if (date) meta.date = date

          if (format.duration) {
            meta.duration = Math.round(parseFloat(format.duration))
          }

          // Extract video/audio stream info
          const streams = data.streams || []
          for (const stream of streams) {
            if (stream.codec_type === 'video' && !meta.videoCodec) {
              meta.videoCodec = stream.codec_name
              if (stream.width) meta.width = stream.width
              if (stream.height) meta.height = stream.height
            }
            if (stream.codec_type === 'audio' && !meta.audioCodec) {
              meta.audioCodec = stream.codec_name
            }
          }

          resolve(Object.keys(meta).length > 0 ? meta : null)
        } catch (e) {
          console.error('[FFprobe] Failed to parse output:', e)
          resolve(null)
        }
      }
    )
  })
}

// Codecs where -c:s copy -f srt works (fast, no transcoding)
const SRT_COPY_CODECS = new Set(['subrip', 'srt'])

// Text-based subtitle codecs that can be converted to WebVTT
export const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text',
  'microdvd', 'mpl2', 'realtext', 'sami', 'stl', 'subviewer',
  'subviewer1', 'ttml', 'vplayer',
])

function srtToVtt(srt: string): string {
  return 'WEBVTT\n\n' + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
}

/**
 * Get the file extension for a subtitle codec when extracting to disk.
 */
export function getSubtitleExtension(codec: string): string {
  if (SRT_COPY_CODECS.has(codec)) return 'srt'
  if (codec === 'webvtt') return 'vtt'
  if (codec === 'ass' || codec === 'ssa') return 'ass'
  // mov_text and others: ffmpeg transcodes to SRT
  return 'srt'
}

/**
 * Batch-extract ALL text subtitle tracks from a media file in a single ffmpeg call.
 * Writes one file per track to outputDir: {streamIndex}.{ext}
 * Resolves even on partial failure (some tracks may fail, others succeed).
 */
export async function extractAllSubtitles(
  filePath: string,
  subtitleStreams: Array<{ index: number; codecName: string }>,
  outputDir: string,
): Promise<void> {
  const ffmpegPath = await findFfmpeg()
  if (!ffmpegPath) throw new Error('ffmpeg not found')
  if (subtitleStreams.length === 0) return

  const args: string[] = ['-v', 'error', '-copyts', '-i', filePath]

  for (const stream of subtitleStreams) {
    const ext = getSubtitleExtension(stream.codecName)
    const outputPath = join(outputDir, `${stream.index}.${ext}`)

    args.push('-map', `0:${stream.index}`, '-an', '-vn')

    if (SRT_COPY_CODECS.has(stream.codecName)) {
      args.push('-c:s', 'copy', '-f', 'srt')
    } else if (stream.codecName === 'webvtt') {
      args.push('-c:s', 'copy', '-f', 'webvtt')
    } else if (stream.codecName === 'ass' || stream.codecName === 'ssa') {
      args.push('-c:s', 'copy')
    } else {
      // mov_text, microdvd, etc. — transcode to SRT
      args.push('-c:s', 'srt', '-f', 'srt')
    }

    args.push(outputPath)
  }

  console.log(`[FFmpeg] Batch extracting ${subtitleStreams.length} subtitle tracks from ${filePath}`)

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })

    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[FFmpeg] Batch subtitle extraction exited with code ${code} (partial success possible):`, stderr.slice(-300))
      } else {
        console.log(`[FFmpeg] Batch subtitle extraction completed successfully`)
      }
      resolve()
    })

    proc.on('error', (err) => {
      console.error(`[FFmpeg] Batch subtitle extraction error:`, err.message)
      resolve() // Partial success is OK
    })

    // 5 minute timeout
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGTERM')
        console.warn(`[FFmpeg] Batch subtitle extraction timed out after 5 minutes`)
      }
      resolve()
    }, 300000)
  })
}

/**
 * Read a cached subtitle file from disk and convert to WebVTT string.
 */
export async function convertFileToVtt(filePath: string, codec: string): Promise<string> {
  const content = await fsPromises.readFile(filePath, 'utf-8')

  if (codec === 'webvtt') return content
  if (SRT_COPY_CODECS.has(codec) || codec === 'mov_text') return srtToVtt(content)
  if (codec === 'ass' || codec === 'ssa') return await convertAssToVtt(filePath)

  // Default: try SRT→VTT conversion
  return srtToVtt(content)
}

/**
 * Convert an ASS/SSA file to WebVTT via ffmpeg (loses styling but keeps timing + text).
 */
async function convertAssToVtt(assFilePath: string): Promise<string> {
  const ffmpegPath = await findFfmpeg()
  if (!ffmpegPath) throw new Error('ffmpeg not found')

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-v', 'error', '-i', assFilePath, '-f', 'webvtt', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let output = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf-8') })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })

    proc.on('close', (code) => {
      if (output.trim()) resolve(output)
      else reject(new Error(`ASS→VTT conversion failed (code ${code}): ${stderr.slice(-200)}`))
    })
    proc.on('error', reject)

    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGTERM')
      reject(new Error('ASS→VTT conversion timed out'))
    }, 30000)
  })
}
