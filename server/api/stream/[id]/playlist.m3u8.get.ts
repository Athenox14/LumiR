import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { getOrCreateSession, generatePlaylist } from '../../../utils/transcodeSession'

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

  const query = getQuery(event)
  const audioTrack = query.audioTrack ? parseInt(query.audioTrack as string, 10) : undefined
  const subtitleTrack = query.subtitleTrack ? parseInt(query.subtitleTrack as string, 10) : undefined

  const session = await getOrCreateSession(id, mediaItem.filePath, audioTrack, subtitleTrack)
  if (!session) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create transcode session.',
    })
  }

  session.lastAccess = Date.now()
  const playlist = generatePlaylist(session)

  console.log(`[HLS] Serving media playlist: ${playlist.length} bytes, ${session.totalSegments} segments`)

  setHeader(event, 'Content-Type', 'application/vnd.apple.mpegurl')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Content-Length', Buffer.byteLength(playlist).toString())

  return send(event, playlist, 'application/vnd.apple.mpegurl')
})
