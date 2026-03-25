import { z } from 'zod'
import { router, adminProcedure, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db } from '../../db'
import { media, audioTracks, subtitleTracks, settings, scanHistory } from '../../db/schema'
import { eq, desc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { promises as fs } from 'fs'
import { basename } from 'path'
import fg from 'fast-glob'
import ptt from 'parse-torrent-title'
import { searchTmdb, getTmdbInfo, tmdbInfoToMediaFields } from '../../utils/tmdb'
import { MediaEngine, extractStreams, extractFileMetadata, type FileMetadata } from '../../utils/mediaEngine'
import { askGroqForTitle } from '../../utils/groq'
import { cacheLibraryImages } from '../../utils/imageCache'

// Video file extensions to scan
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v']

// Extract and store audio/subtitle track info for a media file
async function storeStreamTracks(mediaId: string, filePath: string) {
  try {
    const streams = await extractStreams(filePath)
    if (streams.length === 0) return

    // Delete old entries
    await db.delete(audioTracks).where(eq(audioTracks.mediaId, mediaId))
    await db.delete(subtitleTracks).where(eq(subtitleTracks.mediaId, mediaId))

    for (const stream of streams) {
      if (stream.codecType === 'audio') {
        await db.insert(audioTracks).values({
          id: uuidv4(),
          mediaId,
          trackIndex: stream.index,
          language: stream.language || null,
          codec: stream.codecName,
          channels: stream.channels || null,
          title: stream.title || null,
          isDefault: stream.isDefault,
        })
      } else if (stream.codecType === 'subtitle') {
        // Subtitle content is extracted on-demand (Jellyfin-style batch extraction)
        // Only store metadata here — no ffmpeg call at scan time
        await db.insert(subtitleTracks).values({
          id: uuidv4(),
          mediaId,
          trackIndex: stream.index,
          language: stream.language || null,
          codec: stream.codecName,
          title: stream.title || null,
          isDefault: stream.isDefault,
          isForced: stream.isForced,
        })
      }
    }

    const audioCount = streams.filter(s => s.codecType === 'audio').length
    const subCount = streams.filter(s => s.codecType === 'subtitle').length
    if (audioCount > 0 || subCount > 0) {
      console.log(`[Scan] Stored tracks for ${mediaId}: ${audioCount} audio, ${subCount} subtitle`)
    }
  } catch (e: any) {
    console.error(`[Scan] Failed to extract streams for ${filePath}:`, e.message)
  }
}

// Parse filename using parse-torrent-title
function parseFilename(filename: string): { title: string; year: number | null; season: number | null; episode: number | null } {
  const parsed = ptt.parse(filename)
  return {
    title: parsed.title || basename(filename, basename(filename).replace(/^.*\./, '.')),
    year: parsed.year || null,
    season: parsed.season ?? null,
    episode: parsed.episode ?? null,
  }
}

// Scan directory recursively for video files
async function scanDirectory(dirPath: string): Promise<string[]> {
  const exts = VIDEO_EXTENSIONS.map(e => e.slice(1)).join(',')
  const pattern = `**/*.{${exts}}`
  return fg(pattern, { cwd: dirPath, absolute: true, dot: false })
}

// Scan status tracking
let currentScan: {
  id: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  totalFiles: number
  processedFiles: number
  newFiles: number
  updatedFiles: number
  errors: string[]
} | null = null

let scanAbortFlag = false

export const libraryRouter = router({
  // Get scan status
  scanStatus: protectedProcedure.query(async () => {
    if (currentScan) {
      return currentScan
    }

    // Get last scan from history
    const [lastScan] = await db
      .select()
      .from(scanHistory)
      .orderBy(desc(scanHistory.startedAt))
      .limit(1)

    return lastScan || null
  }),

  // Get scan history
  scanHistory: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
    }).optional())
    .query(async ({ input }) => {
      const params = input || { limit: 10 }

      return db
        .select()
        .from(scanHistory)
        .orderBy(desc(scanHistory.startedAt))
        .limit(params.limit)
    }),

  // Start library scan
  startScan: adminProcedure.mutation(async () => {
    if (currentScan?.status === 'running') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A scan is already in progress',
      })
    }

    // Reset previous scan state so status transitions are clean
    currentScan = null

    // Get media path from settings
    const [mediaPathSetting] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'mediaPath'))
      .limit(1)

    if (!mediaPathSetting?.value) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Media path not configured. Please set the media path in settings.',
      })
    }

    const mediaPath = mediaPathSetting.value as string

    // Verify path exists
    let stat
    try {
      stat = await fs.stat(mediaPath)
    } catch (err: any) {
      console.error(`[Scan] fs.stat failed for "${mediaPath}":`, err.code, err.message)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Media path does not exist or is not accessible: ${mediaPath} (${err.code || err.message})`,
      })
    }
    if (!stat.isDirectory()) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Media path is not a directory: ${mediaPath}`,
      })
    }

    // Start scan
    const scanId = uuidv4()
    currentScan = {
      id: scanId,
      status: 'running',
      totalFiles: 0,
      processedFiles: 0,
      newFiles: 0,
      updatedFiles: 0,
      errors: [],
    }

    // Record scan start
    await db.insert(scanHistory).values({
      id: scanId,
      startedAt: new Date(),
      status: 'running',
    })

    // Run scan in background
    scanLibrary(scanId, mediaPath).catch(console.error)

    return { scanId, status: 'running' }
  }),

  // Stop running scan
  stopScan: adminProcedure.mutation(async () => {
    if (!currentScan || currentScan.status !== 'running') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No scan is currently running',
      })
    }

    scanAbortFlag = true
    return { success: true }
  }),

  // Refresh metadata for single media
  refreshMetadata: adminProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      const [item] = await db
        .select()
        .from(media)
        .where(eq(media.id, input))
        .limit(1)

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        })
      }

      const parsed = parseFilename(item.fileName)
      const isTv = item.mediaType === 'tv' || (parsed.season !== null && parsed.episode !== null)
      const type = isTv ? 'tv' : 'movie' as const

      let metadata = null
      if (item.tmdbId) {
        const info = await getTmdbInfo(item.tmdbId, type)
        if (info) metadata = tmdbInfoToMediaFields(info, type)
      } else {
        // 3-tier title resolution
        const fileMetadata = item.filePath ? await extractFileMetadata(item.filePath) : null
        const { results } = await resolveTitle(item.filePath || '', parsed.title, type, fileMetadata)
        if (results.length > 0) {
          const info = await getTmdbInfo(results[0].id, type)
          if (info) metadata = tmdbInfoToMediaFields(info, type)
        }
      }

      if (metadata) {
        await db.update(media).set({
          ...metadata,
          lastScannedAt: new Date(),
        }).where(eq(media.id, input))

        return { success: true, metadata }
      }

      return { success: false, message: 'Could not fetch metadata' }
    }),

  // Search for metadata via TMDB
  searchTMDB: adminProcedure
    .input(z.object({
      query: z.string(),
      year: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const results = await searchTmdb(input.query, 'movie')
      return results.slice(0, 10)
    }),

  // Link media to TMDB ID
  linkToTMDB: adminProcedure
    .input(z.object({
      mediaId: z.string(),
      tmdbId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const [item] = await db
        .select()
        .from(media)
        .where(eq(media.id, input.mediaId))
        .limit(1)

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        })
      }

      const isTv = item.mediaType === 'tv'
      const info = await getTmdbInfo(input.tmdbId, isTv ? 'tv' : 'movie')

      if (info) {
        const metadata = tmdbInfoToMediaFields(info, isTv ? 'tv' : 'movie')
        await db.update(media).set({
          ...metadata,
          tmdbId: input.tmdbId,
          lastScannedAt: new Date(),
        }).where(eq(media.id, input.mediaId))

        return { success: true, metadata }
      }

      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'TMDB ID not found',
      })
    }),

  // Pre-cache all library images for offline use
  cacheImages: adminProcedure.mutation(async () => {
    const result = await cacheLibraryImages()
    return result
  }),
})

/**
 * 3-tier title resolution:
 * 1. Try file metadata title (from ffprobe)
 * 2. Try parsed filename title
 * 3. Ask Groq AI as last resort
 *
 * Returns { title, results } where results are TMDB search matches.
 */
async function resolveTitle(
  filePath: string,
  parsedTitle: string,
  type: 'movie' | 'tv',
  fileMetadata: FileMetadata | null
): Promise<{ title: string; results: any[] }> {
  // --- Tier 1: Metadata title from ffprobe ---
  if (fileMetadata?.title) {
    const metaTitle = fileMetadata.title
    console.log(`[Scan] Tier 1 - Trying metadata title: "${metaTitle}"`)
    const results = await searchTmdb(metaTitle, type)
    if (results.length > 0) {
      console.log(`[Scan] Tier 1 - Found match for metadata title: "${metaTitle}" → ${results[0].title}`)
      return { title: metaTitle, results }
    }
    console.log(`[Scan] Tier 1 - No results for metadata title: "${metaTitle}"`)
  }

  // --- Tier 2: Parsed filename title ---
  console.log(`[Scan] Tier 2 - Trying parsed filename: "${parsedTitle}"`)
  const results = await searchTmdb(parsedTitle, type)
  if (results.length > 0) {
    console.log(`[Scan] Tier 2 - Found match for filename: "${parsedTitle}" → ${results[0].title}`)
    return { title: parsedTitle, results }
  }
  console.log(`[Scan] Tier 2 - No results for filename: "${parsedTitle}"`)

  // --- Tier 3: Groq AI ---
  const groqTitle = await askGroqForTitle(filePath, fileMetadata, parsedTitle)
  if (groqTitle) {
    console.log(`[Scan] Tier 3 - Groq suggested: "${groqTitle}"`)
    const groqResults = await searchTmdb(groqTitle, type)
    if (groqResults.length > 0) {
      console.log(`[Scan] Tier 3 - Found match via Groq: "${groqTitle}" → ${groqResults[0].title}`)
      return { title: groqTitle, results: groqResults }
    }
    console.log(`[Scan] Tier 3 - No results for Groq suggestion: "${groqTitle}"`)
  }

  console.log(`[Scan] All tiers failed for "${parsedTitle}" (path: ${filePath})`)
  return { title: parsedTitle, results: [] }
}

// Background scan function
async function scanLibrary(scanId: string, mediaPath: string) {
  scanAbortFlag = false

  try {
    // Scan for files
    const files = await scanDirectory(mediaPath)
    currentScan!.totalFiles = files.length

    // Process each file
    for (const filePath of files) {
      // Check if stop was requested
      if (scanAbortFlag) {
        console.log(`[Scan] Stop requested at ${currentScan!.processedFiles}/${currentScan!.totalFiles} files`)
        currentScan!.status = 'stopped'
        await db.update(scanHistory).set({
          status: 'stopped',
          completedAt: new Date(),
          totalFiles: currentScan!.totalFiles,
          newFiles: currentScan!.newFiles,
          updatedFiles: currentScan!.updatedFiles,
          errors: currentScan!.errors.length > 0 ? currentScan!.errors : null,
        }).where(eq(scanHistory.id, scanId))
        scanAbortFlag = false
        return
      }

      try {
        // Check if file already exists in database
        const [existing] = await db
          .select()
          .from(media)
          .where(eq(media.filePath, filePath))
          .limit(1)

        if (existing) {
          // Skip recently scanned files that already have complete metadata
          const SKIP_THRESHOLD_MS = 12 * 60 * 60 * 1000 // 12 hours
          const lastScan = existing.lastScannedAt ? new Date(existing.lastScannedAt).getTime() : 0
          const isRecentlyScan = (Date.now() - lastScan) < SKIP_THRESHOLD_MS
          const needsFetch = !existing.tmdbId || !existing.cast
          if (isRecentlyScan && !needsFetch) {
            // File was scanned recently and has complete data — skip
            currentScan!.processedFiles++
            continue
          }
          if (needsFetch) {
            const parsed = parseFilename(existing.fileName)
            const isTv = parsed.season !== null && parsed.episode !== null
            const type = isTv ? 'tv' : 'movie' as const
            console.log(`[Scan] Re-fetching "${existing.fileName}" → title="${parsed.title}", isTv=${isTv}, s=${parsed.season}, e=${parsed.episode}`)

            let metadata = null
            if (existing.tmdbId) {
              const info = await getTmdbInfo(existing.tmdbId, type)
              if (info) metadata = tmdbInfoToMediaFields(info, type)
            } else {
              // 3-tier title resolution
              const fileMetadata = await extractFileMetadata(filePath)
              const { results } = await resolveTitle(filePath, parsed.title, type, fileMetadata)
              if (results.length > 0) {
                const info = await getTmdbInfo(results[0].id, type)
                if (info) metadata = tmdbInfoToMediaFields(info, type)
              }
            }

            const updateData: any = { lastScannedAt: new Date() }
            if (metadata) Object.assign(updateData, metadata)
            // Fix mediaType and season/episode if not set
            if (isTv) {
              updateData.mediaType = 'tv'
              updateData.season = parsed.season
              updateData.episode = parsed.episode
              updateData.title = parsed.title
            }
            console.log(`[Scan] Result for "${parsed.title}":`, metadata ? 'found' : 'not found')
            await db.update(media).set(updateData).where(eq(media.id, existing.id))
            // Extract tracks if not yet stored
            const existingTracksForRefetch = await db.select().from(audioTracks).where(eq(audioTracks.mediaId, existing.id)).limit(1)
            if (existingTracksForRefetch.length === 0) {
              await storeStreamTracks(existing.id, filePath)
            }
          } else {
            await db.update(media).set({
              lastScannedAt: new Date(),
            }).where(eq(media.id, existing.id))
            // Extract tracks if not yet stored
            const existingTracks = await db.select().from(audioTracks).where(eq(audioTracks.mediaId, existing.id)).limit(1)
            if (existingTracks.length === 0) {
              await storeStreamTracks(existing.id, filePath)
            }
          }
          currentScan!.updatedFiles++
        } else {
          // Parse filename
          const fileName = basename(filePath)
          const parsed = parseFilename(fileName)
          const isTv = parsed.season !== null && parsed.episode !== null
          const type = isTv ? 'tv' : 'movie' as const

          // Get file stats
          const stat = await fs.stat(filePath)

          // Create media record
          const mediaId = uuidv4()
          let mediaData: any = {
            id: mediaId,
            filePath,
            fileName,
            fileSize: stat.size,
            title: parsed.title,
            year: parsed.year,
            mediaType: type,
            season: parsed.season,
            episode: parsed.episode,
            addedAt: new Date(),
            lastScannedAt: new Date(),
          }

          // 3-tier title resolution: metadata title → filename → Groq AI
          console.log(`[Scan] New file "${fileName}" → title="${parsed.title}", isTv=${isTv}, s=${parsed.season}, e=${parsed.episode}`)
          const fileMetadata = await extractFileMetadata(filePath)
          if (fileMetadata) {
            console.log(`[Scan] ffprobe metadata: title="${fileMetadata.title || 'none'}", duration=${fileMetadata.duration || '?'}s, ${fileMetadata.width}x${fileMetadata.height}`)
          }
          const { results } = await resolveTitle(filePath, parsed.title, type, fileMetadata)
          if (results.length > 0) {
            const info = await getTmdbInfo(results[0].id, type)
            if (info) {
              const metadata = tmdbInfoToMediaFields(info, type)
              console.log(`[Scan] Found metadata for "${parsed.title}": tmdbId=${info.id}, title="${info.title}"`)
              mediaData = { ...mediaData, ...metadata }
            } else {
              console.log(`[Scan] Info not found for matched result`)
            }
          } else {
            console.log(`[Scan] No match found for "${parsed.title}" after all tiers`)
          }

          await db.insert(media).values(mediaData)
          // Extract and store audio/subtitle tracks
          await storeStreamTracks(mediaId, filePath)
          currentScan!.newFiles++
        }
      } catch (error: any) {
        currentScan!.errors.push(`Error processing ${filePath}: ${error.message}`)
      }

      currentScan!.processedFiles++
    }

    // Remove media entries whose files no longer exist on disk
    let removedFiles = 0
    const allMedia = await db.select({ id: media.id, filePath: media.filePath }).from(media)
    for (const item of allMedia) {
      try {
        await fs.access(item.filePath)
      } catch {
        // File no longer exists — remove from DB (cascade deletes tracks, progress, ratings)
        await db.delete(media).where(eq(media.id, item.id))
        removedFiles++
        console.log(`[Scan] Removed missing file: ${item.filePath}`)
      }
    }
    if (removedFiles > 0) {
      console.log(`[Scan] Cleaned up ${removedFiles} missing file(s) from database`)
    }

    // Mark scan as complete
    currentScan!.status = 'completed'
    await db.update(scanHistory).set({
      status: 'completed',
      completedAt: new Date(),
      totalFiles: currentScan!.totalFiles,
      newFiles: currentScan!.newFiles,
      updatedFiles: currentScan!.updatedFiles,
      errors: currentScan!.errors.length > 0 ? currentScan!.errors : null,
    }).where(eq(scanHistory.id, scanId))

    // Pre-cache all library images in background (fire and forget)
    cacheLibraryImages().catch(err => console.error('[Scan] Image pre-cache failed:', err.message))

  } catch (error: any) {
    currentScan!.status = 'failed'
    currentScan!.errors.push(error.message)
    await db.update(scanHistory).set({
      status: 'failed',
      completedAt: new Date(),
      errors: [error.message],
    }).where(eq(scanHistory.id, scanId))
  }
}

// Exported for auto-scan scheduler plugin
export async function triggerAutoScan(): Promise<boolean> {
  if (currentScan?.status === 'running') {
    console.log('[AutoScan] Scan already in progress, skipping')
    return false
  }

  currentScan = null

  const [mediaPathSetting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'mediaPath'))
    .limit(1)

  if (!mediaPathSetting?.value) {
    console.log('[AutoScan] Media path not configured, skipping')
    return false
  }

  const mediaPath = mediaPathSetting.value as string

  try {
    const stat = await fs.stat(mediaPath)
    if (!stat.isDirectory()) {
      console.log('[AutoScan] Media path is not a directory, skipping')
      return false
    }
  } catch {
    console.log(`[AutoScan] Media path not accessible: ${mediaPath}`)
    return false
  }

  const scanId = uuidv4()
  currentScan = {
    id: scanId,
    status: 'running',
    totalFiles: 0,
    processedFiles: 0,
    newFiles: 0,
    updatedFiles: 0,
    errors: [],
  }

  await db.insert(scanHistory).values({
    id: scanId,
    startedAt: new Date(),
    status: 'running',
  })

  console.log(`[AutoScan] Starting scheduled scan (${scanId})`)
  scanLibrary(scanId, mediaPath).catch(console.error)
  return true
}

