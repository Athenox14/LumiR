import { execSync, execFile } from 'child_process'
import { existsSync } from 'fs'
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
