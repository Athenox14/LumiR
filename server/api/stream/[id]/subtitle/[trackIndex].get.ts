import { db } from '../../../../db'
import { media } from '../../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { spawn } from 'child_process'
import { findFfmpeg } from '../../../../utils/ffmpeg'

// In-memory cache for extracted subtitles (mediaId:trackIndex → VTT content)
const subtitleCache = new Map<string, string>()

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const trackIndexParam = getRouterParam(event, 'trackIndex')

  if (!id || !trackIndexParam) {
    throw createError({ statusCode: 400, message: 'Media ID and track index are required' })
  }

  const trackIndex = parseInt(trackIndexParam, 10)
  if (isNaN(trackIndex) || trackIndex < 0) {
    throw createError({ statusCode: 400, message: 'Invalid track index' })
  }

  // Check cache first
  const cacheKey = `${id}:${trackIndex}`
  if (subtitleCache.has(cacheKey)) {
    setHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    return subtitleCache.get(cacheKey)
  }

  const [mediaItem] = await db
    .select()
    .from(media)
    .where(eq(media.id, id))
    .limit(1)

  if (!mediaItem) {
    throw createError({ statusCode: 404, message: 'Media not found' })
  }

  try {
    await fs.access(mediaItem.filePath)
  } catch {
    throw createError({ statusCode: 404, message: 'Media file not found' })
  }

  const ffmpegPath = await findFfmpeg()
  if (!ffmpegPath) {
    throw createError({ statusCode: 500, message: 'FFmpeg not available' })
  }

  // Extract subtitle stream as WebVTT using ffmpeg
  const vttContent = await new Promise<string>((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-i', mediaItem.filePath,
      '-map', `0:${trackIndex}`,
      '-f', 'webvtt',
      'pipe:1',
    ]

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let output = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf-8')
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[Subtitle] FFmpeg failed for track ${trackIndex}:`, stderr.slice(-500))
        reject(new Error(`FFmpeg exited with code ${code}`))
      } else {
        resolve(output)
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGTERM')
      reject(new Error('Subtitle extraction timeout'))
    }, 30000)
  })

  // Cache the result
  subtitleCache.set(cacheKey, vttContent)

  setHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=86400')

  return vttContent
})
