import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { MediaEngine } from '../../../utils/mediaEngine'

/**
 * Preheat a specific position in the timeline.
 * Called on timeline hover so that when the user seeks, the segment is ready.
 *
 * POST /api/stream/:id/preheat-seek
 * Body: { position: number } (seconds)
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
  }

  const body = await readBody<{ position?: number }>(event)
  const position = body?.position

  if (typeof position !== 'number' || position < 0) {
    throw createError({ statusCode: 400, message: 'Valid position (seconds) is required' })
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

  try {
    // Create a session — the transcoder will be asked for a segment near
    // this position, which triggers it to seek there and start producing
    const session = await MediaEngine.createSession(mediaItem.filePath, id)

    // Calculate which segment number corresponds to this position.
    // HLS segments are typically 6 seconds each.
    const segmentDuration = 6
    const segmentNumber = Math.floor(position / segmentDuration)

    // Request the segment in the background — we don't wait for it.
    // This makes the transcoder seek to this position and start buffering.
    // Use a short abort timer so we don't hold resources if something is stuck.
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 10000)

    session.segment('video', 'original', 0, segmentNumber, abort.signal)
      .catch(() => {}) // Swallow errors — this is best-effort
      .finally(() => clearTimeout(timeout))

    console.log(`[MediaEngine] Preheat seek: media=${id} position=${position}s segment=${segmentNumber}`)

    return { preheated: true, segmentNumber }
  } catch (err: any) {
    console.error(`[MediaEngine] Preheat seek failed for ${id}:`, err.message)
    return { preheated: false }
  }
})
