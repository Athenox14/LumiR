import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { createReadStream, statSync, promises as fs  } from 'fs'
import { extname } from 'path'

// Formats natively supported by browsers (can be served directly with Range)
const BROWSER_NATIVE = new Set(['.mp4', '.webm', '.m4v'])

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Media ID is required',
    })
  }

  const [mediaItem] = await db
    .select()
    .from(media)
    .where(eq(media.id, id))
    .limit(1)

  if (!mediaItem) {
    throw createError({
      statusCode: 404,
      message: 'Media not found',
    })
  }

  // Check file exists
  try {
    await fs.access(mediaItem.filePath)
  } catch {
    throw createError({
      statusCode: 404,
      message: 'Media file not found',
    })
  }

  const ext = extname(mediaItem.filePath).toLowerCase()

  // Only serve browser-native formats directly (with Range support)
  if (!BROWSER_NATIVE.has(ext)) {
    // Non-native format: redirect client to HLS endpoint
    throw createError({
      statusCode: 415,
      message: 'Use HLS endpoint for non-native formats',
      data: { hlsUrl: `/api/stream/${id}/master.m3u8` },
    })
  }

  const stat = statSync(mediaItem.filePath)
  const fileSize = stat.size
  const contentType = MIME_TYPES[ext] || 'video/mp4'

  const rangeHeader = getHeader(event, 'range')

  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10) || 0
    const end = parts[1] && parts[1].trim() !== '' ? parseInt(parts[1], 10) : fileSize - 1
    const clampedStart = Math.max(0, Math.min(start, fileSize - 1))
    const clampedEnd = Math.max(clampedStart, Math.min(end, fileSize - 1))
    const chunkSize = clampedEnd - clampedStart + 1

    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${clampedStart}-${clampedEnd}/${fileSize}`)
    setHeader(event, 'Accept-Ranges', 'bytes')
    setHeader(event, 'Content-Length', chunkSize.toString())
    setHeader(event, 'Content-Type', contentType)

    return sendStream(event, createReadStream(mediaItem.filePath, { start: clampedStart, end: clampedEnd }))
  }

  setHeader(event, 'Content-Length', fileSize.toString())
  setHeader(event, 'Content-Type', contentType)
  setHeader(event, 'Accept-Ranges', 'bytes')

  return sendStream(event, createReadStream(mediaItem.filePath))
})
