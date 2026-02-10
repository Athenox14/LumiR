import { db } from '../../../../db'
import { media } from '../../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import {
  getOrCreateSession,
  waitForSegment,
  readSegment,
} from '../../../../utils/transcodeSession'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const segmentParam = getRouterParam(event, 'segment')

  if (!id || !segmentParam) {
    throw createError({ statusCode: 400, message: 'Media ID and segment index are required' })
  }

  // Parse segment index (remove .ts extension if present)
  const segmentIndex = parseInt(segmentParam.replace('.ts', ''))

  if (isNaN(segmentIndex) || segmentIndex < 0) {
    throw createError({ statusCode: 400, message: 'Invalid segment index' })
  }

  console.log(`[HLS] Segment request: ${id} seg=${segmentIndex}`)

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

  const session = await getOrCreateSession(id, mediaItem.filePath)
  if (!session) {
    throw createError({ statusCode: 500, message: 'Failed to create transcode session.' })
  }

  if (segmentIndex >= session.totalSegments) {
    throw createError({ statusCode: 400, message: 'Segment index out of range' })
  }

  session.lastAccess = Date.now()

  // Wait for the segment to be ready (triggers ffmpeg seeking if needed)
  const ready = await waitForSegment(session, segmentIndex)
  if (!ready) {
    throw createError({ statusCode: 504, message: 'Segment not ready in time' })
  }

  const data = readSegment(session, segmentIndex)
  if (!data) {
    throw createError({ statusCode: 500, message: 'Failed to read segment' })
  }

  setHeader(event, 'Content-Type', 'video/mp2t')
  setHeader(event, 'Content-Length', data.length.toString())
  setHeader(event, 'Cache-Control', 'public, max-age=86400')

  return data
})
