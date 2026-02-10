import { defineEventHandler, getRouterParam, setHeader, sendStream, createError } from 'h3'
import { join, dirname } from 'path'
import { existsSync, createReadStream } from 'fs'
import { mkdir, writeFile } from 'fs/promises'

const TMDB_CDN = 'https://image.tmdb.org/t/p'
const CACHE_DIR = join(process.cwd(), 'data', 'images')

// Content types by extension
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

function getContentType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase()
  return CONTENT_TYPES[ext] || 'image/jpeg'
}

export default defineEventHandler(async (event) => {
  const pathParam = getRouterParam(event, 'path')
  if (!pathParam) {
    throw createError({ statusCode: 400, message: 'Missing path' })
  }

  // Path comes as "w500/abc123.jpg" or "original/xyz.jpg"
  const imagePath = decodeURIComponent(pathParam)

  // Security: prevent path traversal
  if (imagePath.includes('..') || imagePath.startsWith('/')) {
    throw createError({ statusCode: 400, message: 'Invalid path' })
  }

  const cachePath = join(CACHE_DIR, imagePath)

  // Serve from cache if available
  if (existsSync(cachePath)) {
    setHeader(event, 'Content-Type', getContentType(cachePath))
    setHeader(event, 'Cache-Control', 'public, max-age=2592000') // 30 days
    return sendStream(event, createReadStream(cachePath))
  }

  // Download from TMDB
  const tmdbUrl = `${TMDB_CDN}/${imagePath}`

  try {
    const response = await fetch(tmdbUrl)
    if (!response.ok) {
      throw createError({ statusCode: response.status, message: 'Image not found on TMDB' })
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // Cache to disk (fire and forget — don't block response)
    const cacheDir = dirname(cachePath)
    mkdir(cacheDir, { recursive: true })
      .then(() => writeFile(cachePath, buffer))
      .catch((err) => console.error('[ImageCache] Failed to cache:', err.message))

    setHeader(event, 'Content-Type', getContentType(imagePath))
    setHeader(event, 'Cache-Control', 'public, max-age=2592000')
    return buffer
  } catch (err: any) {
    if (err.statusCode) throw err
    // Network error — return 502
    throw createError({ statusCode: 502, message: 'Failed to fetch image from TMDB' })
  }
})
