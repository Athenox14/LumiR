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

  // Use probe + decide to check if preheat is needed
  try {
    const probe = await MediaEngine.probe(mediaItem.filePath)
    const decision = MediaEngine.decide(probe)

    if (decision.mode === 'direct') {
      return { preheated: false, reason: 'native' }
    }

    await MediaEngine.preheat(mediaItem.filePath)
    console.log(`[MediaEngine] Preheat done for ${id} (${decision.mode}: ${decision.reason})`)
    return { preheated: true, mode: decision.mode, reason: decision.reason }
  } catch (err: any) {
    console.error(`[MediaEngine] Preheat failed for ${id}:`, err.message)
    return { preheated: false, reason: 'preheat_failed' }
  }
})
