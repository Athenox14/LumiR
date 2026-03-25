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

    // Start ffmpeg so segments are ready when the user clicks play
    await MediaEngine.preheat(mediaItem.filePath, id)
    console.log(`[MediaEngine] Preheat started: ${id} (${decision.mode}: ${decision.reason})`)
    return { preheated: true, mode: decision.mode, reason: decision.reason }
  } catch (err: any) {
    console.error(`[MediaEngine] Preheat failed for ${id}:`, err.message)
    return { preheated: false, reason: 'preheat_failed' }
  }
})
