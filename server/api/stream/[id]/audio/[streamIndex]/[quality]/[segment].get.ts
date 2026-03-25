/**
 * Audio segment — with muxed HLS, audio is included in video segments.
 * This endpoint redirects to the video segment for compatibility.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const segmentParam = getRouterParam(event, 'segment') || ''

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
  }

  // Audio is muxed into video segments — redirect to corresponding video segment
  return sendRedirect(event, `/api/stream/${id}/video/0/original/${segmentParam}`, 302)
})
