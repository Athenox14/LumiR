import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { db } from '../db'
import { media } from '../db/schema'

const TMDB_CDN = 'https://image.tmdb.org/t/p'
const CACHE_DIR = join(process.cwd(), 'data', 'images')

/**
 * Extract the relative image path from a URL.
 * Handles both new format (/api/images/w500/abc.jpg)
 * and legacy format (https://image.tmdb.org/t/p/w500/abc.jpg)
 */
function extractImagePath(url: string): string | null {
  if (!url) return null
  const localPrefix = '/api/images/'
  if (url.startsWith(localPrefix)) {
    return url.substring(localPrefix.length)
  }
  const tmdbPrefix = 'https://image.tmdb.org/t/p/'
  if (url.startsWith(tmdbPrefix)) {
    return url.substring(tmdbPrefix.length)
  }
  return null
}

async function downloadImage(imagePath: string): Promise<boolean> {
  const cachePath = join(CACHE_DIR, imagePath)
  if (existsSync(cachePath)) return true

  try {
    const response = await fetch(`${TMDB_CDN}/${imagePath}`)
    if (!response.ok) return false

    const buffer = Buffer.from(await response.arrayBuffer())
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, buffer)
    return true
  } catch {
    return false
  }
}

/**
 * Pre-download all library images (posters, backdrops, cast photos)
 * so they're available offline from the local cache.
 */
export async function cacheLibraryImages(): Promise<{ cached: number; failed: number; skipped: number }> {
  const allMedia = await db.select({
    posterPath: media.posterPath,
    backdropPath: media.backdropPath,
    cast: media.cast,
  }).from(media)

  // Collect unique image paths
  const imageUrls = new Set<string>()

  for (const m of allMedia) {
    if (m.posterPath) {
      const path = extractImagePath(m.posterPath)
      if (path) imageUrls.add(path)
    }
    if (m.backdropPath) {
      const path = extractImagePath(m.backdropPath)
      if (path) imageUrls.add(path)
    }
    if (m.cast && Array.isArray(m.cast)) {
      for (const actor of m.cast as any[]) {
        if (actor.profilePath) {
          const path = extractImagePath(actor.profilePath)
          if (path) imageUrls.add(path)
        }
      }
    }
  }

  let cached = 0
  let failed = 0
  let skipped = 0

  for (const imagePath of imageUrls) {
    const cachePath = join(CACHE_DIR, imagePath)
    if (existsSync(cachePath)) {
      skipped++
      continue
    }

    const success = await downloadImage(imagePath)
    if (success) {
      cached++
    } else {
      failed++
    }
  }

  console.log(`[ImageCache] Pre-cached: ${cached} new, ${skipped} already cached, ${failed} failed (total: ${imageUrls.size})`)
  return { cached, failed, skipped }
}
