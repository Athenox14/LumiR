import { db } from '../../../../../../db'
import { media } from '../../../../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { getSegmentStream, StreamType } from '../../../../../../utils/transcodeSession'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const streamIndex = parseInt(getRouterParam(event, 'streamIndex') || '', 10)
  const quality = getRouterParam(event, 'quality')
  const segmentParam = getRouterParam(event, 'segment') || ''

  // Parse segment number from "segment-{n}.ts"
  const segmentMatch = segmentParam.match(/^segment-(\d+)\.ts$/)
  if (!id || isNaN(streamIndex) || !quality || !segmentMatch) {
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

  const clientId = id

  // Retry logic: transcoder may need time to seek and produce the segment
  // For ORIGINAL quality (DIRECT_STREAM/remux), segments are near-instant
  // For transcoded qualities, segments may take longer but we cap retries to avoid hanging
  const MAX_RETRIES = 6
  const RETRY_DELAY_MS = 3000

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const segmentData = await getSegmentStream(
        mediaItem.filePath,
        clientId,
        StreamType.VIDEO,
        quality,
        streamIndex,
        segmentNumber,
      )

      setHeader(event, 'Content-Type', 'video/mp2t')
      setHeader(event, 'Content-Length', segmentData.size)
      setHeader(event, 'Cache-Control', 'public, max-age=31536000')

      return sendStream(event, segmentData.stream)
    } catch (err: any) {
      if (attempt < MAX_RETRIES) {
        console.warn(`[HLS] Video segment ${segmentNumber} not ready (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`)
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
      } else {
        console.error(`[HLS] Failed to get video segment ${segmentNumber} after ${MAX_RETRIES + 1} attempts:`, err.message)
        throw createError({ statusCode: 504, message: 'Segment not ready' })
      }
    }
  }
})
