import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { extname } from 'path'
import { preCreateMetadata } from '../../../utils/transcodeSession'

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
    return { preheated: false, reason: 'not_found' }
  }

  const ext = extname(mediaItem.filePath).toLowerCase()
  if (BROWSER_NATIVE.has(ext)) {
    return { preheated: false, reason: 'native' }
  }

  try {
    await fs.access(mediaItem.filePath)
  } catch {
    return { preheated: false, reason: 'file_not_found' }
  }

  try {
    // Pre-generate metadata so first playback is faster
    await preCreateMetadata(mediaItem.filePath)
    console.log(`[HLS] Preheat (metadata pre-created) for ${id}`)
    return { preheated: true }
  } catch (err: any) {
    console.error(`[HLS] Preheat failed for ${id}:`, err.message)
    return { preheated: false, reason: 'preheat_failed' }
  }
})
