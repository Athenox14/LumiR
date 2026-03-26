import { db } from '../../../../../../db'
import { media } from '../../../../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { MediaEngine } from '../../../../../../utils/mediaEngine'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const segmentParam = getRouterParam(event, 'segment') || ''

  const segmentMatch = segmentParam.match(/^segment-(\d+)\.ts$/)
  if (!id || !segmentMatch) {
    throw createError({ statusCode: 400, message: 'Invalid segment request' })
  }

  const segmentNumber = parseInt(segmentMatch[1]!, 10)

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

  // Abort retries/waits when client disconnects
  const abort = new AbortController()
  event.node.req.on('close', () => abort.abort())

  try {
    const session = await MediaEngine.createSession(mediaItem.filePath, id, mediaItem.runtime ? mediaItem.runtime * 60 : undefined)

    // For segments far ahead of ffmpeg's progress AND not cached on disk,
    // return 200 with empty body INSTANTLY. HLS.js will get a demux error
    // (non-fatal), skip this fragment, and load the next nearby one.
    // This prevents HLS.js's VOD binary-search from blocking playback
    // for 60+ seconds while ffmpeg catches up to a far-ahead segment.
    if (session.isSegmentUnavailable(segmentNumber)) {
      setHeader(event, 'Content-Type', 'video/mp2t')
      setHeader(event, 'Content-Length', '0')
      setHeader(event, 'Cache-Control', 'no-store')
      return send(event, '')
    }

    const segmentData = await session.getSegment(segmentNumber, abort.signal)

    setHeader(event, 'Content-Type', 'video/mp2t')
    setHeader(event, 'Content-Length', segmentData.size)
    setHeader(event, 'Cache-Control', 'public, max-age=31536000')

    return sendStream(event, segmentData.stream)
  } catch (err: any) {
    if (abort.signal.aborted) return
    const msg = err.message || ''
    // Abandoned segments (behind ffmpeg position) are expected during
    // seeks — don't log. Only log real errors.
    const isAbandoned = msg.includes('abandoned')
    const isTimeout = msg.includes('not ready')
    if (!isAbandoned && !isTimeout) {
      console.error(`[MediaEngine] Video segment ${segmentNumber} failed:`, msg)
    }
    // 404 for abandoned segments so HLS.js doesn't waste retries on 504
    throw createError({
      statusCode: isAbandoned ? 404 : 504,
      message: isAbandoned ? 'Segment no longer available' : 'Segment not ready',
    })
  }
})
