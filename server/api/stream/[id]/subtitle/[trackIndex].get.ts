import { db } from '../../../../db'
import { media, subtitleTracks } from '../../../../db/schema'
import { eq, and } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { extractSubtitleContent, TEXT_SUBTITLE_CODECS } from '../../../../utils/ffmpeg'

// In-memory cache for on-demand extractions (fallback for entries without pre-extracted content)
const subtitleCache = new Map<string, string>()

// Extraction lock: prevents concurrent ffmpeg processes for the same track
const extractionLocks = new Map<string, Promise<string>>()

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

  // Look up the subtitle track in DB
  const [trackInfo] = await db
    .select({
      codec: subtitleTracks.codec,
      content: subtitleTracks.content,
    })
    .from(subtitleTracks)
    .where(and(eq(subtitleTracks.mediaId, id), eq(subtitleTracks.trackIndex, trackIndex)))
    .limit(1)

  // Check codec is text-based
  if (trackInfo?.codec && !TEXT_SUBTITLE_CODECS.has(trackInfo.codec)) {
    throw createError({
      statusCode: 422,
      message: `Subtitle codec "${trackInfo.codec}" is not text-based and cannot be converted to WebVTT`,
    })
  }

  // Fast path: serve pre-extracted content from DB (populated during library scan)
  if (trackInfo?.content) {
    console.log(`[Subtitle] Serving pre-extracted content for track ${trackIndex} (${trackInfo.content.length} bytes)`)
    setHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    return trackInfo.content
  }

  // Fallback: on-demand extraction (for entries added before pre-extraction was implemented)
  const cacheKey = `${id}:${trackIndex}`

  if (subtitleCache.has(cacheKey)) {
    setHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    return subtitleCache.get(cacheKey)
  }

  // Wait for in-progress extraction if any
  if (extractionLocks.has(cacheKey)) {
    console.log(`[Subtitle] Waiting for in-progress extraction: ${cacheKey}`)
    try {
      const result = await extractionLocks.get(cacheKey)!
      setHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
      setHeader(event, 'Cache-Control', 'public, max-age=86400')
      return result
    } catch (err: any) {
      throw createError({ statusCode: 500, message: `Subtitle extraction failed: ${err.message}` })
    }
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

  const codec = trackInfo?.codec || 'unknown'
  console.log(`[Subtitle] On-demand extraction for track ${trackIndex} (codec: ${codec}) — consider re-scanning to pre-extract`)

  // Use shared extraction function (same as scan-time extraction)
  const extractionPromise = extractSubtitleContent(mediaItem.filePath, trackIndex, codec)
    .then(content => content || 'WEBVTT\n\n')

  extractionLocks.set(cacheKey, extractionPromise)

  let vttContent: string
  try {
    vttContent = await extractionPromise
  } catch (err: any) {
    extractionLocks.delete(cacheKey)
    console.error(`[Subtitle] Extraction failed:`, err.message)
    throw createError({ statusCode: 500, message: `Subtitle extraction failed: ${err.message}` })
  }

  extractionLocks.delete(cacheKey)

  console.log(`[Subtitle] Extracted ${vttContent.length} bytes for track ${trackIndex}`)
  subtitleCache.set(cacheKey, vttContent)

  // Also store in DB for future requests
  try {
    await db.update(subtitleTracks)
      .set({ content: vttContent })
      .where(and(eq(subtitleTracks.mediaId, id), eq(subtitleTracks.trackIndex, trackIndex)))
  } catch {
    // Non-critical, just log
    console.warn(`[Subtitle] Failed to cache content in DB for track ${trackIndex}`)
  }

  setHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=86400')

  return vttContent
})
