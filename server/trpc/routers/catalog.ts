import { z } from 'zod'
import { router, protectedProcedure, adminProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db } from '../../db'
import { onlineWatchProgress, downloads, media, settings } from '../../db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { moviePipeline } from '../../providers'
import { searchTmdb, getTmdbInfo, getTmdbTrending, tmdbInfoToMediaFields, getPersonInfo, searchTmdbPerson } from '../../utils/tmdb'
import { findFfmpeg } from '../../utils/ffmpeg'

// Helper: get TMDB API key from settings
async function getTmdbApiKey(): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'tmdbApiKey')).limit(1)
  return (row?.value as string) || null
}

// Feature flag helpers
async function assertCatalogEnabled() {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'catalogEnabled')).limit(1)
  if (row?.value === false) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Catalog is disabled' })
  }
}

async function assertDownloadsEnabled() {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'downloadsEnabled')).limit(1)
  if (row?.value === false) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Downloads are disabled' })
  }
}

// Stream format returned to frontend
interface ResolvedStream {
  provider: string
  server: string
  sources: { url: string; quality: string; isM3U8: boolean }[]
  subtitles: { url: string; lang: string }[]
  headers?: Record<string, string>
}

// Run pipeline and return ALL viable streams
async function resolveAllStreams(opts: {
  title: string
  type: 'movie' | 'tv'
  season?: number
  episode?: number
  releaseYear?: number
}): Promise<ResolvedStream[]> {
  const tmdbApiKey = await getTmdbApiKey()

  const result = await moviePipeline(opts.title, opts.type, {
    season: opts.season,
    episode: opts.episode,
    tmdbApiKey: tmdbApiKey || undefined,
    releaseYear: opts.releaseYear,
  })

  console.log(`[Catalog] Pipeline "${opts.title}" — ${result.timing.total}ms total`)
  for (const [provider, ms] of Object.entries(result.timing.perProvider)) {
    const match = result.providers.find(p => p.provider === provider)
    const streamCount = result.allStreams.filter(s => s.provider === provider).length
    console.log(`  [${provider}] ${ms}ms — ${match?.id ? `matched "${match.title}" (sim=${match.similarity.toFixed(2)})` : 'no match'} — ${streamCount} streams`)
  }
  if (result.errors.length > 0) {
    console.log(`  errors: ${result.errors.map(e => `${e.provider}:${e.step}:${e.message}`).join(' | ')}`)
  }

  return result.allStreams
    .filter(s => s.sources.length > 0)
    .map(s => ({
      provider: s.provider,
      server: s.server,
      sources: s.sources.map(src => ({
        url: src.url,
        quality: src.quality || 'auto',
        isM3U8: src.isM3U8 || false,
      })),
      subtitles: s.subtitles?.map(sub => ({ url: sub.url, lang: sub.lang })) || [],
      headers: s.headers,
    }))
}

// Wrapper for downloads: pick first viable stream
async function resolveWithPipeline(opts: {
  title: string
  type: 'movie' | 'tv'
  season?: number
  episode?: number
  releaseYear?: number
}): Promise<(ResolvedStream & { provider: string }) | null> {
  const streams = await resolveAllStreams(opts)
  if (streams.length === 0) return null
  return streams[0]
}

// Temporary in-memory store for pre-selected download sources
// (used to pass user's source choice from startDownload to processDownload)
const preselectedSources = new Map<string, { url: string, isM3U8: boolean, headers?: Record<string, string> }>()

// ============================================================
//  Streaming sources cache (preheat)
// ============================================================
const SOURCES_CACHE_TTL = 5 * 60 * 1000 // 5 min
interface SourcesCacheEntry {
  streams: ResolvedStream[]
  timestamp: number
  promise?: Promise<ResolvedStream[]> // in-flight promise to deduplicate
}
const sourcesCache = new Map<string, SourcesCacheEntry>()

function sourcesCacheKey(tmdbId: number, type: string, season?: number, episode?: number): string {
  return `${tmdbId}:${type}:${season || ''}:${episode || ''}`
}

/** Fetch streaming sources with deduplication + caching */
async function fetchStreamingSources(opts: {
  tmdbId: number
  title: string
  type: 'movie' | 'tv'
  season?: number
  episode?: number
}): Promise<ResolvedStream[]> {
  const key = sourcesCacheKey(opts.tmdbId, opts.type, opts.season, opts.episode)

  // Check cache
  const cached = sourcesCache.get(key)
  if (cached) {
    // If there's an in-flight promise, wait for it
    if (cached.promise) {
      return cached.promise
    }
    // If cache is fresh, return it
    if (Date.now() - cached.timestamp < SOURCES_CACHE_TTL) {
      console.log(`[Catalog] Cache HIT for ${key} (${cached.streams.length} streams)`)
      return cached.streams
    }
  }

  // Fetch: get TMDB info for original title + year
  const tmdbInfo = await getTmdbInfo(opts.tmdbId, opts.type)
  const originalTitle = tmdbInfo?.originalTitle || opts.title
  const releaseYear = tmdbInfo?.releaseDate
    ? parseInt(tmdbInfo.releaseDate.substring(0, 4))
    : undefined

  const titles = [opts.title]
  if (originalTitle !== opts.title) titles.push(originalTitle)

  console.log(`[Catalog] Fetching sources for ${key} titles=${JSON.stringify(titles)}`)

  const pipelineOpts = { type: opts.type, season: opts.season, episode: opts.episode, releaseYear: releaseYear || undefined }

  const work = (async () => {
    const allResults = await Promise.all(
      titles.map(async (t) => {
        const result = await resolveAllStreams({ title: t, ...pipelineOpts })
        console.log(`[Catalog] Pipeline "${t}" returned ${result.length} streams`)
        return result
      })
    )

    // Merge and deduplicate
    const seen = new Set<string>()
    const streams: ResolvedStream[] = []
    for (const result of allResults) {
      for (const stream of result) {
        const streamKey = `${stream.provider}:${stream.server}`
        if (!seen.has(streamKey)) {
          seen.add(streamKey)
          streams.push(stream)
        }
      }
    }

    console.log(`[Catalog] Total unique streams for ${key}: ${streams.length}`)
    return streams
  })()

  // Store the in-flight promise so concurrent requests deduplicate
  sourcesCache.set(key, { streams: [], timestamp: Date.now(), promise: work })

  try {
    const streams = await work
    sourcesCache.set(key, { streams, timestamp: Date.now() })
    return streams
  } catch (err) {
    sourcesCache.delete(key)
    throw err
  }
}

export const catalogRouter = router({
  // Search online catalog
  search: protectedProcedure
    .input(z.object({
      query: z.string().min(1),
      type: z.enum(['movie', 'tv']).default('movie'),
    }))
    .query(async ({ input }) => {
      await assertCatalogEnabled()
      const results = await searchTmdb(input.query, input.type)
      return results
    }),

  // Get trending
  trending: protectedProcedure
    .input(z.object({
      type: z.enum(['movie', 'tv']).default('movie'),
    }).optional())
    .query(async ({ input }) => {
      await assertCatalogEnabled()
      const type = input?.type || 'movie'
      const results = await getTmdbTrending(type)
      return results
    }),

  // Get info for a movie/tv show
  info: protectedProcedure
    .input(z.object({
      tmdbId: z.number(),
      type: z.enum(['movie', 'tv']),
    }))
    .query(async ({ input }) => {
      await assertCatalogEnabled()
      const info = await getTmdbInfo(input.tmdbId, input.type)
      if (!info) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Content not found',
        })
      }

      // Check if this content exists in local library
      const localMedia = await db
        .select({ id: media.id })
        .from(media)
        .where(eq(media.tmdbId, input.tmdbId))
        .limit(1)

      return {
        ...info,
        localMediaId: localMedia[0]?.id || null,
      }
    }),

  // Get person info (actor/director)
  personInfo: protectedProcedure
    .input(z.object({
      personId: z.number(),
    }))
    .query(async ({ input }) => {
      // Person info is always accessible (even when catalog is disabled)
      const person = await getPersonInfo(input.personId)
      if (!person) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Person not found',
        })
      }
      return person
    }),

  // Preheat: trigger source fetching in background (fire-and-forget from detail pages)
  preheatSources: protectedProcedure
    .input(z.object({
      tmdbId: z.number(),
      title: z.string(),
      type: z.enum(['movie', 'tv']),
      season: z.number().optional(),
      episode: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      await assertCatalogEnabled()
      const key = sourcesCacheKey(input.tmdbId, input.type, input.season, input.episode)
      const cached = sourcesCache.get(key)
      if (cached && (cached.promise || Date.now() - cached.timestamp < SOURCES_CACHE_TTL)) {
        console.log(`[Catalog] Preheat skip — already cached/in-flight for ${key}`)
        return { status: 'already_cached' as const }
      }

      // Fire and forget — don't await
      fetchStreamingSources({
        tmdbId: input.tmdbId,
        title: input.title,
        type: input.type,
        season: input.season,
        episode: input.episode,
      }).catch(err => console.error(`[Catalog] Preheat failed for ${key}:`, err.message))

      console.log(`[Catalog] Preheat started for ${key}`)
      return { status: 'started' as const }
    }),

  // Get streaming sources (uses cache from preheat if available)
  streamingSources: protectedProcedure
    .input(z.object({
      tmdbId: z.number(),
      title: z.string(),
      type: z.enum(['movie', 'tv']),
      episodeId: z.string().optional(),
      season: z.number().optional(),
      episode: z.number().optional(),
    }))
    .query(async ({ input }) => {
      await assertCatalogEnabled()
      const streams = await fetchStreamingSources({
        tmdbId: input.tmdbId,
        title: input.title,
        type: input.type,
        season: input.season,
        episode: input.episode,
      })

      if (streams.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No streaming sources found across all providers',
        })
      }

      return { streams }
    }),

  // Update online watch progress
  updateOnlineProgress: protectedProcedure
    .input(z.object({
      tmdbId: z.number(),
      episodeId: z.string().optional(),
      mediaType: z.enum(['movie', 'tv']),
      title: z.string(),
      posterPath: z.string().optional(),
      season: z.number().optional(),
      episode: z.number().optional(),
      position: z.number().min(0),
      duration: z.number().min(0).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertCatalogEnabled()
      // Build unique condition: user + tmdbId + episodeId (for TV) or user + tmdbId (for movie)
      const conditions = [
        eq(onlineWatchProgress.userId, ctx.user.id),
        eq(onlineWatchProgress.tmdbId, input.tmdbId),
      ]
      if (input.episodeId) {
        conditions.push(eq(onlineWatchProgress.episodeId, input.episodeId))
      } else {
        conditions.push(sql`${onlineWatchProgress.episodeId} IS NULL`)
      }

      const existing = await db
        .select()
        .from(onlineWatchProgress)
        .where(and(...conditions))
        .limit(1)

      const completed = input.duration
        ? input.position >= input.duration * 0.9
        : false

      if (existing.length > 0) {
        await db
          .update(onlineWatchProgress)
          .set({
            position: input.position,
            duration: input.duration || existing[0].duration,
            completed,
            updatedAt: new Date(),
          })
          .where(eq(onlineWatchProgress.id, existing[0].id))
      } else {
        await db.insert(onlineWatchProgress).values({
          id: uuidv4(),
          userId: ctx.user.id,
          tmdbId: input.tmdbId,
          episodeId: input.episodeId || null,
          mediaType: input.mediaType,
          title: input.title,
          posterPath: input.posterPath || null,
          season: input.season || null,
          episode: input.episode || null,
          position: input.position,
          duration: input.duration || null,
          completed,
          updatedAt: new Date(),
        })
      }

      return { success: true }
    }),

  // Get online continue watching list
  onlineContinueWatching: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(20).default(10),
    }).optional())
    .query(async ({ input, ctx }) => {
      await assertCatalogEnabled()
      const params = input || { limit: 10 }

      return db
        .select()
        .from(onlineWatchProgress)
        .where(
          and(
            eq(onlineWatchProgress.userId, ctx.user.id),
            eq(onlineWatchProgress.completed, false),
            sql`${onlineWatchProgress.position} > 0`
          )
        )
        .orderBy(desc(onlineWatchProgress.updatedAt))
        .limit(params.limit)
    }),

  // Start a download (optionally with a pre-selected source from the modal)
  startDownload: adminProcedure
    .input(z.object({
      tmdbId: z.number(),
      episodeId: z.string().optional(),
      mediaType: z.enum(['movie', 'tv']),
      title: z.string(),
      posterPath: z.string().optional(),
      season: z.number().optional(),
      episode: z.number().optional(),
      sourceUrl: z.string().optional(),
      sourceIsM3U8: z.boolean().optional(),
      sourceHeaders: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertCatalogEnabled()
      await assertDownloadsEnabled()
      const downloadId = uuidv4()

      await db.insert(downloads).values({
        id: downloadId,
        userId: ctx.user.id,
        tmdbId: input.tmdbId,
        episodeId: input.episodeId || null,
        mediaType: input.mediaType,
        title: input.title,
        posterPath: input.posterPath || null,
        season: input.season || null,
        episode: input.episode || null,
        status: 'pending',
        progress: 0,
        createdAt: new Date(),
      })

      // Store pre-selected source if provided
      if (input.sourceUrl) {
        preselectedSources.set(downloadId, {
          url: input.sourceUrl,
          isM3U8: input.sourceIsM3U8 || false,
          headers: input.sourceHeaders,
        })
      }

      // Start download in background
      processDownload(downloadId).catch(console.error)

      return { id: downloadId, status: 'pending' }
    }),

  // List downloads
  listDownloads: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(20),
    }).optional())
    .query(async ({ input, ctx }) => {
      await assertDownloadsEnabled()
      const params = input || { limit: 20 }

      return db
        .select()
        .from(downloads)
        .where(eq(downloads.userId, ctx.user.id))
        .orderBy(desc(downloads.createdAt))
        .limit(params.limit)
    }),

  // Cancel a download
  cancelDownload: adminProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      await assertDownloadsEnabled()
      const [download] = await db
        .select()
        .from(downloads)
        .where(eq(downloads.id, input))
        .limit(1)

      if (!download) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Download not found',
        })
      }

      if (download.status === 'downloading' || download.status === 'pending') {
        // Mark as failed/cancelled
        await db
          .update(downloads)
          .set({
            status: 'failed',
            error: 'Cancelled by user',
            completedAt: new Date(),
          })
          .where(eq(downloads.id, input))
      }

      return { success: true }
    }),

  // Search TMDB person (for avatar selection — always accessible)
  searchPerson: protectedProcedure
    .input(z.object({ query: z.string().min(2) }))
    .query(async ({ input }) => {
      return await searchTmdbPerson(input.query)
    }),

  // Check if streaming is configured (just needs TMDB API key)
  isConfigured: protectedProcedure.query(async () => {
    const apiKey = await getTmdbApiKey()
    return { configured: !!apiKey }
  }),
})

// Background download function
async function processDownload(downloadId: string) {
  try {
    const [download] = await db
      .select()
      .from(downloads)
      .where(eq(downloads.id, downloadId))
      .limit(1)

    if (!download || download.status !== 'pending') return

    // Update status to downloading
    await db
      .update(downloads)
      .set({ status: 'downloading' })
      .where(eq(downloads.id, downloadId))

    // Check if user pre-selected a source from the modal
    const preselected = preselectedSources.get(downloadId)
    if (preselected) {
      preselectedSources.delete(downloadId) // Clean up
    }

    let resolved: (ResolvedStream & { provider: string }) | null = null

    if (preselected) {
      // Use the pre-selected source directly (skip pipeline)
      console.log(`[Download] Using pre-selected source: ${preselected.url.substring(0, 80)}`)
      resolved = {
        provider: 'preselected',
        server: 'user-choice',
        sources: [{ url: preselected.url, quality: 'auto', isM3U8: preselected.isM3U8 }],
        subtitles: [],
        headers: preselected.headers,
      }
    } else {
      // Get original (English) title from TMDB for provider search
      const dlTmdbInfo = await getTmdbInfo(download.tmdbId, download.mediaType as 'movie' | 'tv')
      const dlOriginalTitle = dlTmdbInfo?.originalTitle || download.title

      // Resolve streaming sources with local pipeline
      resolved = await resolveWithPipeline({
        title: download.title,
        type: download.mediaType as 'movie' | 'tv',
        season: download.season || undefined,
        episode: download.episode || undefined,
      })

      // Fallback to English title
      if (!resolved && dlOriginalTitle !== download.title) {
        resolved = await resolveWithPipeline({
          title: dlOriginalTitle,
          type: download.mediaType as 'movie' | 'tv',
          season: download.season || undefined,
          episode: download.episode || undefined,
        })
      }
    }

    if (!resolved) {
      await db
        .update(downloads)
        .set({ status: 'failed', error: 'No streaming sources found across all providers', completedAt: new Date() })
        .where(eq(downloads.id, downloadId))
      return
    }

    console.log(`[Download] Using provider: ${resolved.provider}`)

    // Get media path from settings
    const [mediaPathSetting] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'mediaPath'))
      .limit(1)

    if (!mediaPathSetting?.value) {
      await db
        .update(downloads)
        .set({ status: 'failed', error: 'Media path not configured', completedAt: new Date() })
        .where(eq(downloads.id, downloadId))
      return
    }

    const mediaPath = mediaPathSetting.value as string

    // Find best non-M3U8 source (direct MP4), or fallback to first source
    const directSource = resolved.sources.find(s => !s.isM3U8)
    const source = directSource || resolved.sources[0]

    // Build filename
    let fileName: string
    if (download.mediaType === 'tv' && download.season != null && download.episode != null) {
      const s = String(download.season).padStart(2, '0')
      const e = String(download.episode).padStart(2, '0')
      fileName = `${download.title} S${s}E${e}.mp4`
    } else {
      fileName = `${download.title}.mp4`
    }

    // Sanitize filename
    fileName = fileName.replace(/[<>:"/\\|?*]/g, '_')

    const { join } = await import('path')
    const filePath = join(mediaPath, fileName)

    if (source.isM3U8) {
      // Download HLS stream using ffmpeg
      const ffmpegPath = await findFfmpeg()
      if (!ffmpegPath) {
        await db
          .update(downloads)
          .set({
            status: 'failed',
            error: 'HLS download requires ffmpeg. Install ffmpeg and add it to your PATH.',
            completedAt: new Date(),
          })
          .where(eq(downloads.id, downloadId))
        return
      }

      console.log(`[Download] Using ffmpeg for HLS: ${source.url.substring(0, 80)}...`)
      await downloadWithFfmpeg({
        ffmpegPath,
        inputUrl: source.url,
        outputPath: filePath,
        headers: resolved.headers,
        downloadId,
      })

      // Verify output file
      const { existsSync, statSync: fstatSync } = await import('fs')
      if (!existsSync(filePath)) {
        throw new Error('ffmpeg download completed but output file not found')
      }
      const fstat = fstatSync(filePath)
      if (fstat.size < 1000) {
        const { unlinkSync } = await import('fs')
        unlinkSync(filePath)
        throw new Error('ffmpeg produced an empty or invalid file')
      }

      // Create or update media entry
      const { v4: uuid } = await import('uuid')
      const hlsInfo = await getTmdbInfo(download.tmdbId, download.mediaType as 'movie' | 'tv')
      const hlsMetadata = hlsInfo ? tmdbInfoToMediaFields(hlsInfo, download.mediaType as 'movie' | 'tv') : {}

      // Check if a media entry with the same filePath already exists
      const [existingMedia] = await db.select().from(media).where(eq(media.filePath, filePath)).limit(1)
      const hlsMediaId = existingMedia?.id || uuid()

      if (existingMedia) {
        await db.update(media).set({
          fileSize: fstat.size,
          title: download.title,
          mediaType: download.mediaType,
          season: download.season,
          episode: download.episode,
          lastScannedAt: new Date(),
          ...hlsMetadata,
        }).where(eq(media.id, existingMedia.id))
      } else {
        await db.insert(media).values({
          id: hlsMediaId,
          filePath,
          fileName,
          fileSize: fstat.size,
          title: download.title,
          mediaType: download.mediaType,
          season: download.season,
          episode: download.episode,
          addedAt: new Date(),
          lastScannedAt: new Date(),
          ...hlsMetadata,
        })
      }

      await db
        .update(downloads)
        .set({
          status: 'completed',
          progress: 1,
          filePath,
          mediaId: hlsMediaId,
          completedAt: new Date(),
        })
        .where(eq(downloads.id, downloadId))

      console.log(`[Download] HLS completed: "${fileName}" → ${filePath}`)
      return
    }

    // Direct download
    const headers: Record<string, string> = {}
    if (resolved.headers) {
      Object.assign(headers, resolved.headers)
    }

    const response = await fetch(source.url, { headers })
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    const { createWriteStream } = await import('fs')
    const { pipeline } = await import('stream/promises')
    const { Readable } = await import('stream')

    const totalSize = parseInt(response.headers.get('content-length') || '0', 10)
    let downloadedSize = 0

    // Create a transform to track progress
    const { Transform } = await import('stream')
    const progressTracker = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedSize += chunk.length
        if (totalSize > 0) {
          const progress = downloadedSize / totalSize
          // Update progress in DB (throttled - every 5%)
          const progressPercent = Math.floor(progress * 20) * 5
          if (progressPercent > Math.floor(((downloadedSize - chunk.length) / totalSize) * 20) * 5) {
            db.update(downloads)
              .set({ progress })
              .where(eq(downloads.id, downloadId))
              .catch(() => {})
          }
        }
        callback(null, chunk)
      },
    })

    const fileStream = createWriteStream(filePath)
    const body = response.body
    if (!body) throw new Error('No response body')

    // @ts-expect-error - Node.js stream compatibility
    await pipeline(Readable.fromWeb(body), progressTracker, fileStream)

    // Download complete - create or update media entry
    const { v4: uuid } = await import('uuid')
    const { statSync } = await import('fs')
    const stat = statSync(filePath)

    // Fetch metadata
    const info = await getTmdbInfo(download.tmdbId, download.mediaType as 'movie' | 'tv')
    const metadata = info ? tmdbInfoToMediaFields(info, download.mediaType as 'movie' | 'tv') : {}

    // Check if a media entry with the same filePath already exists
    const [existingDirect] = await db.select().from(media).where(eq(media.filePath, filePath)).limit(1)
    const mediaId = existingDirect?.id || uuid()

    if (existingDirect) {
      await db.update(media).set({
        fileSize: stat.size,
        title: download.title,
        mediaType: download.mediaType,
        season: download.season,
        episode: download.episode,
        lastScannedAt: new Date(),
        ...metadata,
      }).where(eq(media.id, existingDirect.id))
    } else {
      await db.insert(media).values({
        id: mediaId,
        filePath,
        fileName,
        fileSize: stat.size,
        title: download.title,
        mediaType: download.mediaType,
        season: download.season,
        episode: download.episode,
        addedAt: new Date(),
        lastScannedAt: new Date(),
        ...metadata,
      })
    }

    // Update download record
    await db
      .update(downloads)
      .set({
        status: 'completed',
        progress: 1,
        filePath,
        mediaId,
        completedAt: new Date(),
      })
      .where(eq(downloads.id, downloadId))

    console.log(`[Download] Completed: "${fileName}" → ${filePath}`)

  } catch (error: any) {
    console.error(`[Download] Failed:`, error)
    await db
      .update(downloads)
      .set({
        status: 'failed',
        error: error.message || 'Unknown error',
        completedAt: new Date(),
      })
      .where(eq(downloads.id, downloadId))
  }
}

// ===== FFmpeg helpers =====

async function downloadWithFfmpeg(opts: {
  ffmpegPath: string
  inputUrl: string
  outputPath: string
  headers?: Record<string, string>
  downloadId: string
}): Promise<void> {
  const { spawn } = await import('child_process')

  const args: string[] = []

  // Add headers if present (Referer, etc.)
  if (opts.headers && Object.keys(opts.headers).length > 0) {
    const headerStr = Object.entries(opts.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n') + '\r\n'
    args.push('-headers', headerStr)
  }

  args.push(
    '-i', opts.inputUrl,
    '-c', 'copy',        // Copy streams without re-encoding (fast)
    '-bsf:a', 'aac_adtstoasc', // Fix AAC audio for MP4 container
    '-y',                 // Overwrite output
    opts.outputPath
  )

  console.log(`[Download] ffmpeg args: ${args.map(a => a.length > 60 ? a.substring(0, 60) + '...' : a).join(' ')}`)

  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(opts.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let totalDuration = 0
    let lastProgressUpdate = 0
    let stderrOutput = ''

    ffmpeg.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderrOutput += text

      // Parse total duration from input metadata
      if (totalDuration === 0) {
        const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
        if (durationMatch) {
          totalDuration = parseInt(durationMatch[1]) * 3600
            + parseInt(durationMatch[2]) * 60
            + parseInt(durationMatch[3])
          console.log(`[Download] Total duration: ${totalDuration}s`)
        }
      }

      // Parse current encoding time
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/)
      if (timeMatch && totalDuration > 0) {
        const currentSeconds = parseInt(timeMatch[1]) * 3600
          + parseInt(timeMatch[2]) * 60
          + parseInt(timeMatch[3])
        const progress = Math.min(0.99, currentSeconds / totalDuration)

        // Throttle DB updates (every 2%)
        if (progress - lastProgressUpdate >= 0.02) {
          lastProgressUpdate = progress
          db.update(downloads)
            .set({ progress })
            .where(eq(downloads.id, opts.downloadId))
            .catch(() => {})
        }
      }
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`[Download] ffmpeg finished successfully`)
        resolve()
      } else {
        const errorMsg = stderrOutput.slice(-500).trim()
        reject(new Error(`ffmpeg exited with code ${code}: ${errorMsg}`))
      }
    })

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`))
    })
  })
}
