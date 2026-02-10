import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { extname } from 'path'
import { extractFileMetadata } from '../../../utils/ffmpeg'

// Formats natively supported by browsers
const BROWSER_NATIVE = new Set(['.mp4', '.webm', '.m4v'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
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

  const ext = extname(mediaItem.filePath).toLowerCase()
  const isNative = BROWSER_NATIVE.has(ext)

  // Get duration: prefer DB runtime (TMDB), fallback to ffprobe
  let durationSec = mediaItem.runtime ? mediaItem.runtime * 60 : 0
  if (!durationSec && !isNative) {
    const meta = await extractFileMetadata(mediaItem.filePath)
    durationSec = meta?.duration || 0
  }

  return {
    mediaId: id,
    isNative,
    streamUrl: isNative
      ? `/api/stream/${id}/direct`
      : `/api/stream/${id}/master.m3u8`,
    format: ext,
    duration: durationSec,
  }
})
