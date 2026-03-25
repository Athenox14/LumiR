import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { MediaEngine } from '../../../utils/mediaEngine'

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

  const info = await MediaEngine.getStreamInfo(
    mediaItem.filePath,
    id,
    mediaItem.runtime || undefined,
  )

  return {
    mediaId: info.mediaId,
    isNative: info.mode === 'direct',
    mode: info.mode,
    reason: info.reason,
    streamUrl: info.streamUrl,
    format: info.mode === 'direct' ? mediaItem.filePath.split('.').pop() : 'hls',
    duration: info.duration,
    estimatedLoad: info.estimatedLoad,
  }
})
