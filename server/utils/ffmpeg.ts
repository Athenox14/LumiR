import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import Ffmpeg from 'fluent-ffmpeg'

// ===== Binary resolution =====

export async function findFfmpeg(): Promise<string | null> {
  try {
    const mod = await import('ffmpeg-static')
    const p = (mod.default || mod) as string
    if (p && existsSync(p)) { console.log(`[FFmpeg] Using ffmpeg-static: ${p}`); return p }
  } catch {}
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
    const p = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0]
    if (p) { console.log(`[FFmpeg] Found in PATH: ${p}`); return p }
  } catch {}
  console.log('[FFmpeg] ffmpeg not found')
  return null
}

export async function findFfprobe(): Promise<string | null> {
  try {
    const mod = await import('ffprobe-static')
    const p = (mod.default?.path || mod.path) as string
    if (p && existsSync(p)) { console.log(`[FFprobe] Using ffprobe-static: ${p}`); return p }
  } catch {}
  const ffmpegPath = await findFfmpeg()
  if (ffmpegPath) {
    const ext = process.platform === 'win32' ? '.exe' : ''
    const p = join(dirname(ffmpegPath), `ffprobe${ext}`)
    if (existsSync(p)) { console.log(`[FFprobe] Found next to ffmpeg: ${p}`); return p }
  }
  try {
    const cmd = process.platform === 'win32' ? 'where ffprobe' : 'which ffprobe'
    const p = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0]
    if (p) { console.log(`[FFprobe] Found in PATH: ${p}`); return p }
  } catch {}
  console.log('[FFprobe] ffprobe not found')
  return null
}

// Set paths for fluent-ffmpeg
let pathsInitialized = false
async function ensurePaths() {
  if (pathsInitialized) return
  const ffmpeg = await findFfmpeg()
  const ffprobe = await findFfprobe()
  if (ffmpeg) Ffmpeg.setFfmpegPath(ffmpeg)
  if (ffprobe) Ffmpeg.setFfprobePath(ffprobe)
  pathsInitialized = true
}

// ===== Types =====

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

// ===== ffprobe wrappers =====

async function ffprobe(filePath: string): Promise<Ffmpeg.FfprobeData | null> {
  await ensurePaths()
  return new Promise((resolve) => {
    Ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) { console.error(`[FFprobe] Error probing "${filePath}":`, err.message); resolve(null) }
      else resolve(data)
    })
  })
}

export async function extractStreams(filePath: string): Promise<StreamInfo[]> {
  const data = await ffprobe(filePath)
  if (!data?.streams) return []
  return data.streams
    .filter((s) => s.codec_type === 'audio' || s.codec_type === 'subtitle')
    .map((s) => {
      const tags = (s as any).tags || {}
      const getTag = (k: string) => tags[k] || tags[k.toUpperCase()] || tags[k.toLowerCase()] || undefined
      const disp = (s as any).disposition || {}
      return {
        index: s.index,
        codecType: s.codec_type as 'audio' | 'subtitle',
        codecName: s.codec_name || 'unknown',
        language: getTag('language'),
        title: getTag('title'),
        channels: s.codec_type === 'audio' ? (s.channels || undefined) : undefined,
        isDefault: disp.default === 1,
        isForced: disp.forced === 1,
      }
    })
}

export async function extractFileMetadata(filePath: string): Promise<FileMetadata | null> {
  const data = await ffprobe(filePath)
  if (!data) return null
  const format = data.format || {} as any
  const tags = format.tags || {}
  const getTag = (k: string) => tags[k] || tags[k.toUpperCase()] || tags[k.toLowerCase()] || undefined

  const meta: FileMetadata = {}
  const title = getTag('title')
  if (title?.trim()) meta.title = title.trim()
  const artist = getTag('artist') || getTag('album_artist')
  if (artist) meta.artist = artist
  const date = getTag('date') || getTag('year')
  if (date) meta.date = date
  if (format.duration) meta.duration = Math.round(parseFloat(format.duration))

  for (const s of data.streams || []) {
    if (s.codec_type === 'video' && !meta.videoCodec) {
      meta.videoCodec = s.codec_name
      if (s.width) meta.width = s.width
      if (s.height) meta.height = s.height
    }
    if (s.codec_type === 'audio' && !meta.audioCodec) meta.audioCodec = s.codec_name
  }
  return Object.keys(meta).length > 0 ? meta : null
}
