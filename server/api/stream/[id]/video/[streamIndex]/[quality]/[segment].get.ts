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
    const session = await MediaEngine.createSession(mediaItem.filePath, id)
    const segmentData = await session.getSegment(segmentNumber, abort.signal)

    setHeader(event, 'Content-Type', 'video/mp2t')
    setHeader(event, 'Content-Length', segmentData.size)
    setHeader(event, 'Cache-Control', 'public, max-age=31536000')

    return sendStream(event, segmentData.stream)
  } catch (err: any) {
    if (abort.signal.aborted) return
    // "not ready" after 30s timeout is expected for abandoned segments
    // (user seeked away) — log at info level, not error
    const msg = err.message || ''
    const isTimeout = msg.includes('not ready')
    if (!isTimeout) {
      console.error(`[MediaEngine] Video segment ${segmentNumber} failed:`, msg)
    }
    throw createError({
      statusCode: 504,
      message: 'Segment not ready',
    })
  }
})
