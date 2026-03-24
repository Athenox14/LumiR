import { db } from '../../../db'
import { media } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { getMasterPlaylist } from '../../../utils/transcodeSession'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
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

  // Use the media ID as client ID (sufficient for personal use)
  const clientId = id

  console.log(`[HLS] Master playlist requested for ${id}`)

  try {
    const playlist = await getMasterPlaylist(mediaItem.filePath, clientId)

    setHeader(event, 'Content-Type', 'application/vnd.apple.mpegurl')
    setHeader(event, 'Cache-Control', 'no-cache')

    return send(event, playlist, 'application/vnd.apple.mpegurl')
  } catch (err: any) {
    console.error(`[HLS] Failed to generate master playlist for ${id}:`, err.message)
    throw createError({
      statusCode: 500,
      message: 'Failed to generate master playlist. FFmpeg may not be installed.',
    })
  }
})
