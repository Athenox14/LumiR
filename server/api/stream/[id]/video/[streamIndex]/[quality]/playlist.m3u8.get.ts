import { db } from '../../../../../../db'
import { media } from '../../../../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { getIndexPlaylist, StreamType } from '../../../../../../utils/transcodeSession'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const streamIndex = parseInt(getRouterParam(event, 'streamIndex') || '', 10)
  const quality = getRouterParam(event, 'quality')

  if (!id || isNaN(streamIndex) || !quality) {
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

  const clientId = id

  try {
    const playlist = await getIndexPlaylist(
      mediaItem.filePath,
      clientId,
      StreamType.VIDEO,
      quality,
      streamIndex,
    )

    setHeader(event, 'Content-Type', 'application/vnd.apple.mpegurl')
    setHeader(event, 'Cache-Control', 'no-cache')

    return send(event, playlist, 'application/vnd.apple.mpegurl')
  } catch (err: any) {
    console.error(`[HLS] Failed to get video index playlist:`, err.message)
    throw createError({ statusCode: 500, message: 'Failed to generate playlist' })
  }
})
