import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { getOrCreateSession } from '../../../utils/transcodeSession'

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

  // Create the transcode session (probes file for duration/codecs)
  const session = await getOrCreateSession(id, mediaItem.filePath, audioTrack, subtitleTrack)
  if (!session) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create transcode session. FFmpeg may not be installed or file duration unknown.',
    })
  }

  console.log(`[HLS] Master playlist requested for ${id}${audioTrack !== undefined ? ` (audioTrack=${audioTrack})` : ''}${subtitleTrack !== undefined ? ` (subtitleTrack=${subtitleTrack})` : ''}`)

  // Propagate audioTrack/subtitleTrack to the playlist URL so HLS.js passes it through
  const params = new URLSearchParams()
  if (audioTrack !== undefined) params.set('audioTrack', audioTrack.toString())
  if (subtitleTrack !== undefined) params.set('subtitleTrack', subtitleTrack.toString())
  const qs = params.toString()
  const playlistUrl = qs
    ? `/api/stream/${id}/playlist.m3u8?${qs}`
    : `/api/stream/${id}/playlist.m3u8`

  // Master playlist with a single variant pointing to the media playlist
  const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
${playlistUrl}
`

  setHeader(event, 'Content-Type', 'application/vnd.apple.mpegurl')
  setHeader(event, 'Cache-Control', 'no-cache')

  return send(event, playlist, 'application/vnd.apple.mpegurl')
})
