import { MediaEngine } from '../../../utils/mediaEngine'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
  }

  // Actually stop the session and kill the ffmpeg process
  await MediaEngine.stopSession(id)
  console.log(`[MediaEngine] Session cancelled for ${id}`)

  return { cancelled: true }
})
