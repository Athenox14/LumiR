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
    return { preheated: false, reason: 'not_found' }
  }

  try {
    await fs.access(mediaItem.filePath)
  } catch {
    return { preheated: false, reason: 'file_not_found' }
  }

  try {
    const probe = await MediaEngine.probe(mediaItem.filePath)
    const decision = MediaEngine.decide(probe)

    if (decision.mode === 'direct') {
      return { preheated: false, reason: 'native' }
    }

    // Start ffmpeg at the resume position (if any) so segments are ready
    const positionParam = getQuery(event).position
    const startPosition = positionParam ? parseFloat(String(positionParam)) : 0
    const knownDuration = mediaItem.runtime ? mediaItem.runtime * 60 : undefined
    if (startPosition > 0) {
      await MediaEngine.preheatSeek(mediaItem.filePath, id, startPosition, knownDuration, true)
    } else {
      await MediaEngine.preheat(mediaItem.filePath, id, knownDuration)
    }
    console.log(`[MediaEngine] Preheat started: ${id} at ${startPosition}s (${decision.mode}: ${decision.reason})`)
    return { preheated: true, mode: decision.mode, reason: decision.reason }
  } catch (err: any) {
    console.error(`[MediaEngine] Preheat failed for ${id}:`, err.message)
    return { preheated: false, reason: 'preheat_failed' }
  }
})
