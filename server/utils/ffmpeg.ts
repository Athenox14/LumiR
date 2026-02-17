import { execSync, spawn } from 'child_process'
import { existsSync, promises as fsPromises } from 'fs'
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

function ffprobe(filePath: string): Promise<Ffmpeg.FfprobeData | null> {
  return new Promise(async (resolve) => {
    await ensurePaths()
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

// ===== Subtitle utilities =====

const SRT_COPY_CODECS = new Set(['subrip', 'srt'])

export const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text',
  'microdvd', 'mpl2', 'realtext', 'sami', 'stl', 'subviewer',
  'subviewer1', 'ttml', 'vplayer',
])

export function getSubtitleExtension(codec: string): string {
  if (SRT_COPY_CODECS.has(codec)) return 'srt'
  if (codec === 'webvtt') return 'vtt'
  if (codec === 'ass' || codec === 'ssa') return 'ass'
  return 'srt'
}

function srtToVtt(srt: string): string {
  return 'WEBVTT\n\n' + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
}

export async function extractAllSubtitles(
  filePath: string,
  subtitleStreams: Array<{ index: number; codecName: string }>,
  outputDir: string,
): Promise<void> {
  if (subtitleStreams.length === 0) return
  await ensurePaths()

  console.log(`[FFmpeg] Batch extracting ${subtitleStreams.length} subtitle tracks from ${filePath}`)

  // Build manual args since fluent-ffmpeg doesn't handle multi-output subtitle extraction well
  const ffmpegPath = await findFfmpeg()
  if (!ffmpegPath) throw new Error('ffmpeg not found')

  const args: string[] = ['-v', 'error', '-copyts', '-i', filePath]
  for (const stream of subtitleStreams) {
    const ext = getSubtitleExtension(stream.codecName)
    const outputPath = join(outputDir, `${stream.index}.${ext}`)
    args.push('-map', `0:${stream.index}`, '-an', '-vn')
    if (SRT_COPY_CODECS.has(stream.codecName)) args.push('-c:s', 'copy', '-f', 'srt')
    else if (stream.codecName === 'webvtt') args.push('-c:s', 'copy', '-f', 'webvtt')
    else if (stream.codecName === 'ass' || stream.codecName === 'ssa') args.push('-c:s', 'copy')
    else args.push('-c:s', 'srt', '-f', 'srt')
    args.push(outputPath)
  }

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) console.warn(`[FFmpeg] Subtitle extraction exited ${code}:`, stderr.slice(-300))
      else console.log(`[FFmpeg] Subtitle extraction completed`)
      resolve()
    })
    proc.on('error', (err) => { console.error(`[FFmpeg] Subtitle extraction error:`, err.message); resolve() })
    setTimeout(() => { if (!proc.killed) { proc.kill('SIGTERM'); console.warn('[FFmpeg] Subtitle extraction timed out') }; resolve() }, 300000)
  })
}

export async function convertFileToVtt(filePath: string, codec: string): Promise<string> {
  const content = await fsPromises.readFile(filePath, 'utf-8')
  if (codec === 'webvtt') return content
  if (SRT_COPY_CODECS.has(codec) || codec === 'mov_text') return srtToVtt(content)
  if (codec === 'ass' || codec === 'ssa') return await convertAssToVtt(filePath)
  return srtToVtt(content)
}

async function convertAssToVtt(assFilePath: string): Promise<string> {
  await ensurePaths()
  return new Promise((resolve, reject) => {
    let output = ''
    Ffmpeg(assFilePath)
      .outputOptions(['-f', 'webvtt'])
      .pipe()
      .on('data', (chunk: Buffer) => { output += chunk.toString('utf-8') })
      .on('end', () => output.trim() ? resolve(output) : reject(new Error('ASS→VTT produced empty output')))
      .on('error', reject)
  })
}
