import { db } from '../../../../db'
import { media, subtitleTracks } from '../../../../db/schema'
import { eq, and } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { getVTTSubtitle } from '../../../../utils/transcodeSession'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const trackIndexParam = getRouterParam(event, 'trackIndex')

  if (!id || !trackIndexParam) {
    throw createError({ statusCode: 400, message: 'Media ID and track index are required' })
  }

  const trackIndex = parseInt(trackIndexParam, 10)
  if (isNaN(trackIndex) || trackIndex < 0) {
    throw createError({ statusCode: 400, message: 'Invalid track index' })
  }

  // Verify the track exists in DB
  const [trackInfo] = await db
    .select({ codec: subtitleTracks.codec })
    .from(subtitleTracks)
    .where(and(eq(subtitleTracks.mediaId, id), eq(subtitleTracks.trackIndex, trackIndex)))
    .limit(1)

  if (!trackInfo) {
    throw createError({ statusCode: 404, message: 'Subtitle track not found' })
  }

  // Get the media file path
  const [mediaItem] = await db
    .select({ filePath: media.filePath })
    .from(media)
    .where(eq(media.id, id))
    .limit(1)

  if (!mediaItem) {
    throw createError({ statusCode: 404, message: 'Media not found' })
  }

  try {
    await fs.access(mediaItem.filePath)
  } catch {
    throw createError({ statusCode: 404, message: 'Media file not found on disk' })
  }

  try {
    // Use @eleven-am/transcoder to extract and convert subtitle to VTT
    const vttContent = await getVTTSubtitle(mediaItem.filePath, trackIndex)

    setHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    return vttContent
  } catch (err: any) {
    console.error(`[Subtitle] VTT extraction failed for track ${trackIndex}:`, err.message)
    throw createError({ statusCode: 500, message: `Subtitle extraction failed: ${err.message}` })
  }
})
