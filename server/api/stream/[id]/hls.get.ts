import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { extname } from 'path'
import {
  getOrCreateSession,
  generatePlaylist,
  waitForSegment,
  readSegment,
} from '../../../utils/transcodeSession'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
  }

  const query = getQuery(event)
  const segParam = query.seg as string | undefined

  console.log(`[HLS] Request: /api/stream/${id}/hls${segParam !== undefined ? `?seg=${segParam}` : ' (playlist)'}`)

  const [mediaItem] = await db
    .select()
    .from(media)
    .where(eq(media.id, id))
    .limit(1)

  if (!mediaItem) {
    throw createError({ statusCode: 404, message: 'Media not found' })
  }

  // Check file exists
  try {
    await fs.access(mediaItem.filePath)
  } catch {
    throw createError({ statusCode: 404, message: 'Media file not found' })
  }

  // Get or create transcode session
  const audioTrack = query.audioTrack ? parseInt(query.audioTrack as string, 10) : undefined
  const session = await getOrCreateSession(id, mediaItem.filePath, audioTrack)
  if (!session) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create transcode session. FFmpeg may not be installed or file duration unknown.',
    })
  }

  // Serve a segment
  if (segParam !== undefined) {
    const segIndex = parseInt(segParam, 10)
    if (isNaN(segIndex) || segIndex < 0 || segIndex >= session.totalSegments) {
      throw createError({ statusCode: 400, message: 'Invalid segment index' })
    }

    session.lastAccess = Date.now()

    // Wait for the segment to be ready (triggers seeking if needed)
    const ready = await waitForSegment(session, segIndex)
    if (!ready) {
      throw createError({ statusCode: 504, message: 'Segment not ready in time' })
    }

    const data = readSegment(session, segIndex)
    if (!data) {
      throw createError({ statusCode: 500, message: 'Failed to read segment' })
    }

    setHeader(event, 'Content-Type', 'video/mp2t')
    setHeader(event, 'Content-Length', data.length.toString())
    setHeader(event, 'Cache-Control', 'public, max-age=86400')

    return data
  }

  // Serve the M3U8 playlist
  session.lastAccess = Date.now()
  const playlist = generatePlaylist(session)

  console.log(`[HLS] Serving playlist: ${playlist.length} bytes, ${session.totalSegments} segments`)

  setHeader(event, 'Content-Type', 'application/vnd.apple.mpegurl')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Content-Length', Buffer.byteLength(playlist).toString())

  return send(event, playlist, 'application/vnd.apple.mpegurl')
})
