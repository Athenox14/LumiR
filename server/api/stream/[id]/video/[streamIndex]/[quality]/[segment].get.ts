import { db } from '../../../../../../db'
import { media } from '../../../../../../db/schema'
import { eq } from 'drizzle-orm'
import { promises as fs } from 'fs'
import { MediaEngine } from '../../../../../../utils/mediaEngine'

// Minimal valid MPEG-TS with PAT + PMT (no media frames).
// HLS.js needs PAT/PMT to avoid fragParsingError. With these tables
// present but no PES data, the demuxer produces 0 frames and moves on.
function buildEmptyTsSegment(): Buffer {
  // CRC32 for MPEG-TS (ISO 13818-1)
  const crcTable: number[] = []
  for (let i = 0; i < 256; i++) {
    let c = i << 24
    for (let j = 0; j < 8; j++) {
      c = (c & 0x80000000) ? (c << 1) ^ 0x04C11DB7 : c << 1
    }
    crcTable[i] = c >>> 0
  }
  function crc32(data: number[]): number {
    let crc = 0xFFFFFFFF
    for (const byte of data) {
      crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 0xFF]) >>> 0
    }
    return crc
  }

  // PAT: Program 1 → PMT PID 0x1000
  const patData = [0x00, 0xB0, 0x0D, 0x00, 0x01, 0xC1, 0x00, 0x00, 0x00, 0x01, 0xF0, 0x00]
  const patCrc = crc32(patData)
  const pat = Buffer.alloc(188, 0xFF)
  pat[0] = 0x47; pat[1] = 0x40; pat[2] = 0x00; pat[3] = 0x10 // PID 0, payload
  pat[4] = 0x00 // pointer field
  patData.forEach((b, i) => pat[5 + i] = b)
  pat[17] = (patCrc >>> 24) & 0xFF
  pat[18] = (patCrc >>> 16) & 0xFF
  pat[19] = (patCrc >>> 8) & 0xFF
  pat[20] = patCrc & 0xFF

  // PMT: H.264 video PID 0x100, AAC audio PID 0x101
  const pmtData = [0x02, 0xB0, 0x17, 0x00, 0x01, 0xC1, 0x00, 0x00,
    0xE1, 0x00, 0xF0, 0x00,
    0x1B, 0xE1, 0x00, 0xF0, 0x00, // H.264 on PID 0x100
    0x0F, 0xE1, 0x01, 0xF0, 0x00] // AAC on PID 0x101
  const pmtCrc = crc32(pmtData)
  const pmt = Buffer.alloc(188, 0xFF)
  pmt[0] = 0x47; pmt[1] = 0x50; pmt[2] = 0x00; pmt[3] = 0x10 // PID 0x1000, payload
  pmt[4] = 0x00 // pointer field
  pmtData.forEach((b, i) => pmt[5 + i] = b)
  pmt[26] = (pmtCrc >>> 24) & 0xFF
  pmt[27] = (pmtCrc >>> 16) & 0xFF
  pmt[28] = (pmtCrc >>> 8) & 0xFF
  pmt[29] = pmtCrc & 0xFF

  return Buffer.concat([pat, pmt])
}
const EMPTY_TS_SEGMENT = buildEmptyTsSegment()

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const segmentParam = getRouterParam(event, 'segment') || ''

  const segmentMatch = segmentParam.match(/^segment-(\d+)\.ts$/)
  if (!id || !segmentMatch) {
    throw createError({ statusCode: 400, message: 'Invalid segment request' })
  }

  const segmentNumber = parseInt(segmentMatch[1]!, 10)

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

  // Abort retries/waits when client disconnects
  const abort = new AbortController()
  event.node.req.on('close', () => abort.abort())

  try {
    const session = await MediaEngine.createSession(mediaItem.filePath, id, mediaItem.runtime ? mediaItem.runtime * 60 : undefined)

    // For segments far ahead of ffmpeg's progress AND not cached on disk,
    // return 200 with empty body INSTANTLY. HLS.js will get a demux error
    // (non-fatal), skip this fragment, and load the next nearby one.
    // This prevents HLS.js's VOD binary-search from blocking playback
    // for 60+ seconds while ffmpeg catches up to a far-ahead segment.
    if (session.isSegmentUnavailable(segmentNumber)) {
      console.log(`[MediaEngine] Segment ${segmentNumber} unavailable → null TS (startSeg=${session.currentStartSegment} highest=${session.highestReady})`)
      setHeader(event, 'Content-Type', 'video/mp2t')
      setHeader(event, 'Content-Length', String(EMPTY_TS_SEGMENT.length))
      setHeader(event, 'Cache-Control', 'no-store')
      return send(event, EMPTY_TS_SEGMENT)
    }

    const segmentData = await session.getSegment(segmentNumber, abort.signal)

    setHeader(event, 'Content-Type', 'video/mp2t')
    setHeader(event, 'Content-Length', segmentData.size)
    setHeader(event, 'Cache-Control', 'public, max-age=31536000')

    return sendStream(event, segmentData.stream)
  } catch (err: any) {
    if (abort.signal.aborted) return
    const msg = err.message || ''
    // Abandoned segments (behind ffmpeg position) are expected during
    // seeks — don't log. Only log real errors.
    const isAbandoned = msg.includes('abandoned')
    const isTimeout = msg.includes('not ready')
    if (!isAbandoned && !isTimeout) {
      console.error(`[MediaEngine] Video segment ${segmentNumber} failed:`, msg)
    }
    // 404 for abandoned segments so HLS.js doesn't waste retries on 504
    throw createError({
      statusCode: isAbandoned ? 404 : 504,
      message: isAbandoned ? 'Segment no longer available' : 'Segment not ready',
    })
  }
})
