import { db } from '../../../../db'
import { media, subtitleTracks } from '../../../../db/schema'
import { eq, and } from 'drizzle-orm'
import { existsSync, mkdirSync } from 'fs'
import { promises as fs } from 'fs'
import { join } from 'path'
import { extractAllSubtitles, convertFileToVtt, getSubtitleExtension, TEXT_SUBTITLE_CODECS } from '../../../../utils/ffmpeg'

// Lock map: keyed by mediaId (not trackIndex) since batch extracts ALL tracks at once
const extractionLocks = new Map<string, Promise<void>>()

const SUBTITLE_CACHE_DIR = join(process.cwd(), 'data', 'subtitles')

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

  // 1. Look up the requested track to get its codec
  const [trackInfo] = await db
    .select({ codec: subtitleTracks.codec })
    .from(subtitleTracks)
    .where(and(eq(subtitleTracks.mediaId, id), eq(subtitleTracks.trackIndex, trackIndex)))
    .limit(1)

  if (!trackInfo) {
    throw createError({ statusCode: 404, message: 'Subtitle track not found' })
  }

  const codec = trackInfo.codec || 'unknown'
  if (!TEXT_SUBTITLE_CODECS.has(codec)) {
    throw createError({
      statusCode: 422,
      message: `Subtitle codec "${codec}" is not text-based and cannot be converted to WebVTT`,
    })
  }

  const ext = getSubtitleExtension(codec)
  const cacheDir = join(SUBTITLE_CACHE_DIR, id)
  const cachedFile = join(cacheDir, `${trackIndex}.${ext}`)

  // 2. Check disk cache — if file exists, serve it immediately
  if (!existsSync(cachedFile)) {
    // 3. Batch extract ALL subtitle tracks for this media (Jellyfin-style)
    // Acquire lock on mediaId — concurrent requests for any track of same media wait on same promise
    if (!extractionLocks.has(id)) {
      const extractionPromise = (async () => {
        const [mediaItem] = await db
          .select({ filePath: media.filePath })
          .from(media)
          .where(eq(media.id, id))
          .limit(1)

        if (!mediaItem) throw new Error('Media not found')

        try {
          await fs.access(mediaItem.filePath)
        } catch {
          throw new Error('Media file not found on disk')
        }

        // Get ALL subtitle tracks for this media
        const allTracks = await db
          .select({ trackIndex: subtitleTracks.trackIndex, codec: subtitleTracks.codec })
          .from(subtitleTracks)
          .where(eq(subtitleTracks.mediaId, id))

        const textTracks = allTracks.filter(t => t.codec && TEXT_SUBTITLE_CODECS.has(t.codec))
        if (textTracks.length === 0) return

        mkdirSync(cacheDir, { recursive: true })

        console.log(`[Subtitle] Batch extracting ${textTracks.length} tracks for media ${id}`)

        // Single ffmpeg call extracts all tracks at once
        await extractAllSubtitles(
          mediaItem.filePath,
          textTracks.map(t => ({ index: t.trackIndex, codecName: t.codec! })),
          cacheDir,
        )
      })()

      extractionLocks.set(id, extractionPromise)
      extractionPromise.finally(() => extractionLocks.delete(id))
    }

    // Wait for extraction to complete
    try {
      await extractionLocks.get(id)
    } catch (err: any) {
      throw createError({ statusCode: 500, message: `Subtitle extraction failed: ${err.message}` })
    }
  }

  // 4. Read cached file and convert to VTT
  if (!existsSync(cachedFile)) {
    throw createError({
      statusCode: 500,
      message: `Subtitle track ${trackIndex} could not be extracted (codec: ${codec})`,
    })
  }

  try {
    const vttContent = await convertFileToVtt(cachedFile, codec)

    setHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    return vttContent
  } catch (err: any) {
    console.error(`[Subtitle] VTT conversion failed for track ${trackIndex}:`, err.message)
    throw createError({ statusCode: 500, message: `VTT conversion failed: ${err.message}` })
  }
})
