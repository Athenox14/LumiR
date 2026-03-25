import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { MediaEngine } from '../../../utils/mediaEngine'

/**
 * Preheat a specific position in the timeline.
 * Called on timeline hover so that when the user seeks, the segment is ready.
 *
 * POST /api/stream/:id/preheat-seek
 * Body: { position: number } (seconds)
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
  }

  const body = await readBody<{ position?: number }>(event)
  const position = body?.position

  if (typeof position !== 'number' || position < 0) {
    throw createError({ statusCode: 400, message: 'Valid position (seconds) is required' })
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

  try {
    const knownDuration = mediaItem.runtime ? mediaItem.runtime * 60 : undefined
    await MediaEngine.preheatSeek(mediaItem.filePath, id, position, knownDuration)
    return { preheated: true, position }
  } catch (err: any) {
    console.error(`[MediaEngine] Preheat seek failed for ${id}:`, err.message)
    return { preheated: false }
  }
})
