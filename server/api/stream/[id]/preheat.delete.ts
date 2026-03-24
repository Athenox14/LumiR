export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
  }

  // With @eleven-am/transcoder, stream disposal is handled automatically
  // via the disposeTimeout config. This endpoint is kept for client compatibility.
  console.log(`[HLS] Preheat cancel requested for ${id} (auto-managed by transcoder)`)

  return { cancelled: true }
})
