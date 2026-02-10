import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { extname } from 'path'
import { getOrCreateSession, preheatSession, SEGMENT_DURATION } from '../../../utils/transcodeSession'

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

  const query = getQuery(event)
  const position = parseInt(query.position as string, 10) || 0

  const session = await getOrCreateSession(id, mediaItem.filePath)
  if (!session) {
    return { preheated: false, reason: 'session_failed' }
  }

  const segment = Math.floor(position / SEGMENT_DURATION)
  preheatSession(session, segment)

  console.log(`[HLS] Preheat requested for ${id} at position ${position}s (segment ${segment})`)

  return { preheated: true, segment }
})
