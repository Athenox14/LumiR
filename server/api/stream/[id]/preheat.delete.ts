import { destroyMediaSession } from '../../../utils/transcodeSession'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
  }

  destroyMediaSession(id)
  console.log(`[HLS] Preheat cancelled for ${id}`)

  return { cancelled: true }
})
