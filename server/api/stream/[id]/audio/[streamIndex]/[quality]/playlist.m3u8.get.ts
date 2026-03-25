/**
 * Audio playlist — with muxed HLS, audio is included in video segments.
 * This endpoint redirects to the video playlist for compatibility.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Media ID is required' })
  }

  // Audio is muxed into video segments — redirect to video playlist
  return sendRedirect(event, `/api/stream/${id}/video/0/original/playlist.m3u8`, 302)
})
