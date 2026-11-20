import { db } from '../../../../db'
import { media, subtitleTracks } from '../../../../db/schema'
import { eq, and } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { MediaEngine } from '../../../../utils/mediaEngine'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const trackIndexParam = getRouterParam(event, 'trackIndex')

  if (!id || !trackIndexParam) {
    throw createError({ statusCode: 400, message: 'Media ID and track index are required' })
  }

  const trackIndex = parseInt(trackIndexParam, 10)
  if (isNaN(trackIndex)) {
    throw createError({ statusCode: 400, message: 'Invalid track index' })
  }

  const [trackInfo] = await db
    .select({ codec: subtitleTracks.codec, filePath: subtitleTracks.filePath })
    .from(subtitleTracks)
    .where(and(eq(subtitleTracks.mediaId, id), eq(subtitleTracks.trackIndex, trackIndex)))
    .limit(1)

  if (!trackInfo) {
    throw createError({ statusCode: 404, message: 'Subtitle track not found' })
  }

  const [mediaItem] = await db
    .select({ filePath: media.filePath, runtime: media.runtime })
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
    const session = await MediaEngine.createSession(mediaItem.filePath, id, mediaItem.runtime ? mediaItem.runtime * 60 : undefined)
    let vttContent: string
    if (trackInfo.filePath) {
      await fs.access(trackInfo.filePath)
      vttContent = await session.getExternalSubtitle(trackInfo.filePath)
    } else {
      vttContent = await session.getSubtitle(trackIndex)
    }

    setHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    return vttContent
  } catch (err: any) {
    console.error(`[MediaEngine] Subtitle extraction failed for track ${trackIndex}:`, err.message)
    throw createError({ statusCode: 500, message: `Subtitle extraction failed: ${err.message}` })
  }
})
