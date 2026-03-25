import { db } from '../../../../../../db'
import { media } from '../../../../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { MediaEngine } from '../../../../../../utils/mediaEngine'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID, stream index, and quality are required' })
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
    const session = await MediaEngine.createSession(mediaItem.filePath, id, mediaItem.runtime ? mediaItem.runtime * 60 : undefined)
    // Don't preheat here: the first getSegment() call will start ffmpeg
    // at the correct position (e.g. saved resume position). Preheating at
    // segment 0 wastes work and forces an immediate seek when the player
    // requests segments at the resume position.
    const playlist = session.variantPlaylist()

    setHeader(event, 'Content-Type', 'application/vnd.apple.mpegurl')
    setHeader(event, 'Cache-Control', 'no-cache')

    return send(event, playlist, 'application/vnd.apple.mpegurl')
  } catch (err: any) {
    console.error(`[MediaEngine] Video playlist failed:`, err.message)
    throw createError({ statusCode: 500, message: 'Failed to generate playlist' })
  }
})
