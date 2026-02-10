import { z } from 'zod'
import { router, adminProcedure, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db } from '../../db'
import { media, audioTracks, subtitleTracks, settings, scanHistory } from '../../db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { promises as fs } from 'fs'
import { join, basename, extname, parse } from 'path'
import { searchTmdb, getTmdbInfo, tmdbInfoToMediaFields } from '../../utils/tmdb'
import { extractFileMetadata, extractStreams, type FileMetadata } from '../../utils/ffmpeg'
import { askGroqForTitle } from '../../utils/groq'

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

// Parse filename to extract title, year, season, and episode
function parseFilename(filename: string): { title: string; year: number | null; season: number | null; episode: number | null } {
  const nameWithoutExt = parse(filename).name

  // Normalize separators to spaces BEFORE pattern matching
  const normalized = nameWithoutExt
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  console.log(`[Parser] "${nameWithoutExt}" → normalized: "${normalized}"`)

  // TV show patterns (check these first)
  const tvPatterns = [
    /^(.+?)\s+s(\d+)\s*e(\d+)/i,       // "bref s1 e76", "show s01 e02", "show s1e2"
    /^(.+?)\s*S(\d+)E(\d+)/,            // "Show S01E02"
    /^(.+?)\s+(\d+)x(\d+)/i,            // "Show 1x02"
  ]

  for (const pattern of tvPatterns) {
    const match = normalized.match(pattern)
    if (match) {
      const title = match[1].replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
      console.log(`[Parser] TV match: title="${title}", s=${match[2]}, e=${match[3]}`)
      return {
        title,
        year: null,
        season: parseInt(match[2]),
        episode: parseInt(match[3]),
      }
    }
  }

  // Movie patterns (year extraction)
  const yearPatterns = [
    /^(.+?)\s*\((\d{4})\)/,      // Movie Name (2020)
    /^(.+?)\s+(\d{4})$/,          // Movie Name 2020
    /^(.+?)\s+(\d{4})\s/,         // Movie Name 2020 720p
  ]

  for (const pattern of yearPatterns) {
    const match = normalized.match(pattern)
    if (match) {
      const year = parseInt(match[2])
      if (year >= 1900 && year <= new Date().getFullYear() + 2) {
        const title = match[1].replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
        return { title, year, season: null, episode: null }
      }
    }
  }

  // No pattern found, use normalized name as title
  const title = normalized.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()

  return { title, year: null, season: null, episode: null }
}

// Scan directory recursively for video files
async function scanDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = []

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // Skip hidden directories
        if (!entry.name.startsWith('.')) {
          const subFiles = await scanDirectory(fullPath)
          files.push(...subFiles)
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (VIDEO_EXTENSIONS.includes(ext)) {
          files.push(fullPath)
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error)
  }

  return files
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
    try {
      const stat = await fs.stat(mediaPath)
      if (!stat.isDirectory()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Media path is not a directory',
        })
      }
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Media path does not exist or is not accessible: ${mediaPath}`,
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

  // Search for metadata via Consumet
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
})

/**
 * 3-tier title resolution:
 * 1. Try file metadata title (from ffprobe)
 * 2. Try parsed filename title
 * 3. Ask Groq AI as last resort
 *
 * Returns { title, metadata } where metadata is the Consumet result if found.
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
          // Re-fetch metadata if missing or incomplete (e.g. no cast)
          const needsFetch = !existing.tmdbId || !existing.cast
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

