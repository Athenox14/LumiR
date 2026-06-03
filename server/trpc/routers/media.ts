import { z } from 'zod'
import os from 'os'
import { router, protectedProcedure, adminProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db, sqlite } from '../../db'
import { media, audioTracks, subtitleTracks, watchProgress, mediaRatings, downloads, userProfiles, watchlist } from '../../db/schema'
import { eq, and, like, desc, asc, sql, or, isNull } from 'drizzle-orm'
import { getTmdbInfo, searchTmdb, tmdbInfoToMediaFields } from '../../utils/tmdb'
import { calculateUserPreferences, calculateMatchScore } from '../../utils/preferences'
import { getMediaStats, mediaQualityModifier } from '../../utils/mediaStatsEngine'
import { promises as fs } from 'fs'
import { join } from 'path'
// Note: matchScore is only used for personalizedSections filtering, not exposed to clients

// CPU usage tracking (delta-based)
let prevCpuUsage = process.cpuUsage()
let prevTime = process.hrtime.bigint()

function getCpuPercent(): number {
  const now = process.hrtime.bigint()
  const currentCpu = process.cpuUsage()
  const elapsedMs = Number(now - prevTime) / 1e6 // ns → ms
  if (elapsedMs < 1) return 0
  const userDelta = (currentCpu.user - prevCpuUsage.user) / 1000 // μs → ms
  const sysDelta = (currentCpu.system - prevCpuUsage.system) / 1000
  prevCpuUsage = currentCpu
  prevTime = now
  const cpuCount = os.cpus().length || 1
  return Math.min(100, Math.round(((userDelta + sysDelta) / elapsedMs / cpuCount) * 100))
}

function getMaxMapValue(record?: Record<string, number> | null) {
  if (!record) return 0
  const values = Object.values(record).filter(value => Number.isFinite(value))
  return values.length ? Math.max(...values) : 0
}

function normalizeScore(record: Record<string, number> | null | undefined, key: string | null | undefined, scale: number) {
  if (!record || !key) return 0
  const max = getMaxMapValue(record)
  if (max <= 0) return 0
  return ((record[key] || 0) / max) * scale
}

function getRuntimeBucket(runtime: number | null | undefined) {
  if (!runtime) return null
  if (runtime < 60) return 'short'
  if (runtime < 100) return 'standard'
  if (runtime < 140) return 'long'
  return 'epic'
}

function getRecencyBucket(year: number | null | undefined) {
  if (!year) return null
  const delta = new Date().getFullYear() - year
  if (delta <= 2) return 'recent'
  if (delta <= 10) return 'modern'
  return 'classic'
}

function getDecadeKey(year: number | null | undefined) {
  if (!year) return null
  return `${Math.floor(year / 10) * 10}s`
}

function getDaypart(hour: number): string {
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

type ScoreExtras = {
  statsModifier?: number
  watchlistGenres?: Set<string>
  now?: Date
}

function scoreCandidateWithProfile(candidate: any, preferences: ReturnType<typeof calculateUserPreferences>, profileData: Record<string, any> | null | undefined, extras?: ScoreExtras) {
  const genres = candidate.genres ? JSON.parse(candidate.genres) : []
  const baseScore = preferences ? calculateMatchScore(genres, candidate.year, candidate.rating, preferences) : 0
  const profile = profileData || {}
  const preferenceProfile = profile.preferences || {}
  const playback = profile.playback || {}
  const search = profile.search || {}
  const browsing = profile.browsing || {}
  const details = profile.details || {}
  const navigation = profile.navigation || {}
  const temporal = profile.temporal || {}
  const device = profile.device || {}
  const binge = profile.binge || {}
  const tags = preferenceProfile.tags || {}
  const now = extras?.now || new Date()

  let score = baseScore

  for (const genre of genres) {
    score += normalizeScore(preferenceProfile.genreScores, genre, 16)
  }

  const castEntries = Array.isArray(candidate.cast) ? candidate.cast : []
  const actorNames = castEntries
    .map((actor: any) => typeof actor === 'string' ? actor : actor?.name)
    .filter(Boolean)
  for (const actorName of actorNames.slice(0, 5)) {
    score += normalizeScore(preferenceProfile.actorScores, actorName, 10)
  }

  score += normalizeScore(preferenceProfile.decadeScores, getDecadeKey(candidate.year), 8)
  score += normalizeScore(preferenceProfile.runtimeScores, getRuntimeBucket(candidate.runtime), 8)
  score += normalizeScore(preferenceProfile.recencyScores, getRecencyBucket(candidate.year), 7)

  if (Array.isArray(preferenceProfile.lastGenres)) {
    const overlap = genres.filter((genre: string) => preferenceProfile.lastGenres.includes(genre)).length
    score += Math.min(8, overlap * 2.5)
  }

  if (Array.isArray(preferenceProfile.lastMediaIds) && preferenceProfile.lastMediaIds.includes(candidate.id)) {
    score -= 6
  }

  if ((search.clicks || 0) > 0) score += 1
  if ((search.refinements || 0) > 2) score += 1
  if ((search.abandonments || 0) > 0) score += 0.5
  if ((search.repeatedQueries && Object.keys(search.repeatedQueries).length) > 0) {
    score += Math.min(3, Object.keys(search.repeatedQueries).length * 0.4)
  }

  if ((browsing.hesitationSignals || 0) > 3) score += 1.5
  if ((browsing.longHovers || 0) > 0) score += 0.5
  if ((browsing.noClickBrowseMs || 0) > 10000) score += 1

  if ((details.repeatVisits || 0) > 0) score += 1
  if ((details.playIntentCount || 0) > 0) score += 1
  if ((details.immediateExits || 0) > 2) score -= 1

  if ((playback.completes || 0) > 0) score += 1.5
  if ((playback.quickAbandons || 0) > 0) score -= 1
  if ((playback.rewatches || 0) > 0 && genres.some((genre: string) => (preferenceProfile.genreScores?.[genre] || 0) > 0)) {
    score += 2
  }

  if ((navigation.sessions || 0) > 0) score += 0.5
  if ((navigation.backtracks || 0) > 0) score += 0.5

  const hourBuckets = temporal.hourBuckets || {}
  const currentHour = String(new Date().getHours())
  if ((hourBuckets[currentHour] || 0) > 0) score += 1

  const deviceTypes = device.types || {}
  const prefersMobile = (deviceTypes.mobile || 0) > (deviceTypes.desktop || 0)
  if (prefersMobile && getRuntimeBucket(candidate.runtime) === 'short') score += 2
  if (prefersMobile && getRuntimeBucket(candidate.runtime) === 'epic') score -= 1.5

  if ((tags['navbar-search'] || 0) > 0 && genres.length > 0) score += 1.5
  if ((tags['refined-search'] || 0) > 0 && (candidate.rating || 0) >= 7) score += 1.5
  if ((tags['catalog-fatigue'] || 0) > 0 && (candidate.rating || 0) >= 7.5) score += 1
  if ((tags['recent-abandon'] || 0) > 0 && getRuntimeBucket(candidate.runtime) === 'standard') score += 1
  if ((tags['quick-abandon'] || 0) > 0 && getRuntimeBucket(candidate.runtime) === 'short') score += 1.5
  if ((tags['completion-positive'] || 0) > 0 && genres.some((genre: string) => (preferenceProfile.genreScores?.[genre] || 0) > 0)) {
    score += 2
  }

  // ── Content metadata signals ────────────────────────────────────────────
  // Keywords / themes overlap
  let candidateKeywords: string[] = []
  try { candidateKeywords = candidate.keywords ? JSON.parse(candidate.keywords) : [] } catch { candidateKeywords = [] }
  for (const kw of candidateKeywords.slice(0, 12)) {
    score += normalizeScore(preferenceProfile.keywordScores, kw, 10)
  }

  // Director / composer affinity
  score += normalizeScore(preferenceProfile.directorScores, candidate.director, 8)
  score += normalizeScore(preferenceProfile.composerScores, candidate.composer, 5)

  // Age-rating (certification) affinity
  score += normalizeScore(preferenceProfile.certificationScores, candidate.certification, 5)

  // Collection / saga: same franchise as something the user engaged with
  score += normalizeScore(preferenceProfile.collectionScores, candidate.collectionName, 12)

  // Popularity (crowd signal) + novelty (recent releases)
  if (typeof candidate.popularity === 'number' && candidate.popularity > 0) {
    score += Math.min(4, Math.log10(1 + candidate.popularity))
  }
  if (getRecencyBucket(candidate.year) === 'recent') score += 2

  // ── Genre × moment ──────────────────────────────────────────────────────
  // Boost genres the user tends to watch at the *current* weekday × daypart.
  const momentKey = `${now.getDay()}-${getDaypart(now.getHours())}`
  const momentGenres = (temporal.genreMoment || {})[momentKey] || {}
  for (const genre of genres) {
    score += normalizeScore(momentGenres, genre, 8)
  }

  // ── Binge / saga continuation ───────────────────────────────────────────
  if ((binge.bingeSessions || 0) > 0 && candidate.collectionName
      && (preferenceProfile.collectionScores?.[candidate.collectionName] || 0) > 0) {
    score += 3
  }

  // ── Watchlist affinity ──────────────────────────────────────────────────
  const watchlistGenres = extras?.watchlistGenres
  if (watchlistGenres && genres.some((g: string) => watchlistGenres.has(g))) {
    score += 3
  }

  // ── Title-level audience quality (abandonment curve, effective completion…)
  score += extras?.statsModifier || 0

  return Math.round(score)
}

export const mediaRouter = router({
  // List all media with filtering and sorting
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      genre: z.string().optional(),
      year: z.number().optional(),
      mediaType: z.enum(['movie', 'tv', 'unknown']).optional(),
      sortBy: z.enum(['title', 'year', 'rating', 'addedAt']).default('addedAt'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
      limit: z.number().min(1).max(10000).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const params = input || {}
      const conditions = []

      if (params.search) {
        // Search by file path when query is wrapped in quotes: "K:\Films\movie.mkv"
        const pathMatch = params.search.match(/^"(.+)"$/)
        if (pathMatch) {
          conditions.push(like(media.filePath, `%${pathMatch[1]}%`))
        } else {
          // Fuzzy search: normalize() strips accents + lowercases (Â→a, é→e, etc.)
          const term = params.search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          const maxDist = Math.max(2, Math.floor(term.length * 0.35))
          conditions.push(
            or(
              sql`normalize(${media.title}) LIKE ${`%${term}%`}`,
              sql`normalize(${media.originalTitle}) LIKE ${`%${term}%`}`,
              sql`levenshtein(${media.title}, ${term}) <= ${maxDist}`,
              sql`levenshtein(${media.originalTitle}, ${term}) <= ${maxDist}`
            )
          )
        }
      }

      if (params.genre) {
        conditions.push(like(media.genres, `%${params.genre}%`))
      }

      if (params.year) {
        conditions.push(eq(media.year, params.year))
      }

      if (params.mediaType) {
        conditions.push(eq(media.mediaType, params.mediaType))
      }

      const orderColumn = {
        title: media.title,
        year: media.year,
        rating: media.rating,
        addedAt: media.addedAt,
      }[params.sortBy || 'addedAt']

      const orderFn = params.sortOrder === 'asc' ? asc : desc

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Only select columns needed for the grid view (avoid heavy cast/overview/filePath)
      const [items, countResult] = await Promise.all([
        db
          .select({
            id: media.id,
            title: media.title,
            year: media.year,
            posterPath: media.posterPath,
            rating: media.rating,
            mediaType: media.mediaType,
            season: media.season,
            episode: media.episode,
            addedAt: media.addedAt,
          })
          .from(media)
          .where(whereClause)
          .orderBy(orderFn(orderColumn))
          .limit(params.limit || 50)
          .offset(params.offset || 0),
        db
          .select({ count: sql<number>`count(*)` })
          .from(media)
          .where(whereClause),
      ])

      // Get watch progress for current user
      const mediaIds = items.map(m => m.id)
      const progress = mediaIds.length > 0
        ? await db
            .select()
            .from(watchProgress)
            .where(
              and(
                eq(watchProgress.userId, ctx.user.id),
                sql`${watchProgress.mediaId} IN (${sql.join(mediaIds.map(id => sql`${id}`), sql`, `)})`
              )
            )
        : []

      const progressMap = new Map(progress.map(p => [p.mediaId, p]))

      const itemsWithProgress = items.map(item => ({
        id: item.id,
        title: item.title,
        year: item.year,
        posterPath: item.posterPath,
        rating: item.rating,
        mediaType: item.mediaType,
        season: item.season,
        episode: item.episode,
        watchProgress: progressMap.get(item.id) || null,
      }))

      return {
        items: itemsWithProgress,
        total: countResult[0]?.count || 0,
        hasMore: (params.offset || 0) + items.length < (countResult[0]?.count || 0),
      }
    }),

  // Get single media by ID
  getById: protectedProcedure
    .input(z.string())
    .query(async ({ input, ctx }) => {
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

      // Get audio and subtitle tracks
      const [audio, subtitles, progress, myRatingRow, watchlistRow] = await Promise.all([
        db.select().from(audioTracks).where(eq(audioTracks.mediaId, input)),
        db.select().from(subtitleTracks).where(eq(subtitleTracks.mediaId, input)),
        db
          .select()
          .from(watchProgress)
          .where(and(eq(watchProgress.userId, ctx.user.id), eq(watchProgress.mediaId, input)))
          .limit(1),
        db
          .select({ rating: mediaRatings.rating })
          .from(mediaRatings)
          .where(and(eq(mediaRatings.userId, ctx.user.id), eq(mediaRatings.mediaId, input)))
          .limit(1),
        db
          .select({ id: watchlist.id })
          .from(watchlist)
          .where(and(eq(watchlist.userId, ctx.user.id), eq(watchlist.mediaId, input)))
          .limit(1),
      ])

      // Get total likes and dislikes count for this media
      const [[likesCount], [dislikesCount]] = await Promise.all([
        db.select({ count: sql<number>`count(*)` })
          .from(mediaRatings)
          .where(and(eq(mediaRatings.mediaId, input), eq(mediaRatings.rating, 1))),
        db.select({ count: sql<number>`count(*)` })
          .from(mediaRatings)
          .where(and(eq(mediaRatings.mediaId, input), eq(mediaRatings.rating, -1))),
      ])

      // Enrich cast + collection if outdated (missing from old scans)
      let cast = item.cast
      let collectionId = item.collectionId
      let collectionName = item.collectionName
      if (item.tmdbId) {
        const needsCastEnrich = cast && cast.some((a: any) => typeof a === 'string' || !a.id)
        const needsCollectionEnrich = !collectionId && item.mediaType === 'movie'
        if (needsCastEnrich || needsCollectionEnrich) {
          try {
            const tmdbType = item.mediaType === 'tv' ? 'tv' : 'movie'
            const tmdbInfo = await getTmdbInfo(item.tmdbId, tmdbType as 'movie' | 'tv')
            const updates: any = {}
            if (needsCastEnrich && tmdbInfo?.cast?.length) {
              cast = tmdbInfo.cast.slice(0, 10)
              updates.cast = cast
            }
            if (tmdbInfo?.collectionId) {
              collectionId = tmdbInfo.collectionId
              collectionName = tmdbInfo.collectionName || null
              updates.collectionId = collectionId
              updates.collectionName = collectionName
            }
            if (Object.keys(updates).length > 0) {
              db.update(media).set(updates).where(eq(media.id, input)).catch(() => {})
            }
          } catch {}
        }
      }

      return {
        ...item,
        cast,
        collectionId,
        collectionName,
        audioTracks: audio,
        subtitleTracks: subtitles,
        watchProgress: progress[0] || null,
        myRating: (myRatingRow[0]?.rating as 1 | -1) || null,
        likesCount: likesCount?.count || 0,
        dislikesCount: dislikesCount?.count || 0,
        inWatchlist: !!watchlistRow[0],
      }
    }),

  // Update watch progress
  updateProgress: protectedProcedure
    .input(z.object({
      mediaId: z.string(),
      position: z.number().min(0),
      duration: z.number().min(0).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await db
        .select()
        .from(watchProgress)
        .where(
          and(
            eq(watchProgress.userId, ctx.user.id),
            eq(watchProgress.mediaId, input.mediaId)
          )
        )
        .limit(1)

      const completed = input.duration
        ? input.position >= input.duration * 0.9
        : false

      if (existing.length > 0) {
        await db
          .update(watchProgress)
          .set({
            position: input.position,
            duration: input.duration || existing[0].duration,
            completed,
            updatedAt: new Date(),
          })
          .where(eq(watchProgress.id, existing[0].id))
      } else {
        const { v4: uuidv4 } = await import('uuid')
        await db.insert(watchProgress).values({
          id: uuidv4(),
          userId: ctx.user.id,
          mediaId: input.mediaId,
          position: input.position,
          duration: input.duration,
          completed,
          updatedAt: new Date(),
        })
      }

      return { success: true }
    }),

  // Remove an item from continue watching (delete watch progress)
  deleteProgress: protectedProcedure
    .input(z.string())
    .mutation(async ({ input: mediaId, ctx }) => {
      await db.delete(watchProgress).where(
        and(
          eq(watchProgress.userId, ctx.user.id),
          eq(watchProgress.mediaId, mediaId)
        )
      )
      return { success: true }
    }),

  // Get continue watching list
  continueWatching: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(20).default(10),
    }).optional())
    .query(async ({ input, ctx }) => {
      const params = input || { limit: 10 }

      const progress = await db
        .select({
          watchProgress,
          media,
        })
        .from(watchProgress)
        .innerJoin(media, eq(media.id, watchProgress.mediaId))
        .where(
          and(
            eq(watchProgress.userId, ctx.user.id),
            eq(watchProgress.completed, false),
            sql`${watchProgress.position} > 0`
          )
        )
        .orderBy(desc(watchProgress.updatedAt))
        .limit(params.limit)

      return progress.map(p => ({
        ...p.media,
        watchProgress: p.watchProgress,
      }))
    }),

  // Get recently added media
  recentlyAdded: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(20),
    }).optional())
    .query(async ({ input }) => {
      const params = input || { limit: 20 }

      return db
        .select()
        .from(media)
        .orderBy(desc(media.addedAt))
        .limit(params.limit)
    }),

  // Get all genres
  genres: protectedProcedure.query(async () => {
    const allMedia = await db
      .select({ genres: media.genres })
      .from(media)
      .where(sql`${media.genres} IS NOT NULL`)

    const genreSet = new Set<string>()
    allMedia.forEach(m => {
      const genres = m.genres as string[] | null
      if (genres) {
        genres.forEach(g => genreSet.add(g))
      }
    })

    return Array.from(genreSet).sort()
  }),

  // Get all years
  years: protectedProcedure.query(async () => {
    const years = await db
      .selectDistinct({ year: media.year })
      .from(media)
      .where(sql`${media.year} IS NOT NULL`)
      .orderBy(desc(media.year))

    return years.map(y => y.year).filter(Boolean) as number[]
  }),

  // Recommendations: find similar local media by shared genres
  // Get other movies from the same collection/franchise
  collection: protectedProcedure
    .input(z.object({
      collectionId: z.number(),
      excludeMediaId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: media.id,
          title: media.title,
          posterPath: media.posterPath,
          year: media.year,
          rating: media.rating,
        })
        .from(media)
        .where(
          input.excludeMediaId
            ? and(eq(media.collectionId, input.collectionId), sql`${media.id} != ${input.excludeMediaId}`)
            : eq(media.collectionId, input.collectionId)
        )
        .orderBy(asc(media.year))

      return rows
    }),

  recommendations: protectedProcedure
    .input(z.object({
      mediaId: z.string(),
      limit: z.number().min(1).max(20).default(10),
    }))
    .query(async ({ input, ctx }) => {
      const [item] = await db
        .select({ id: media.id, genres: media.genres, mediaType: media.mediaType, year: media.year })
        .from(media)
        .where(eq(media.id, input.mediaId))
        .limit(1)

      if (!item || !item.genres || item.genres.length === 0) return []

      // Score composite:
      // - genre_score: nombre de genres en commun (0-N) × 10
      // - type_bonus: +5 si même type de média (film→film, série→série)
      // - year_proximity: +3 si écart < 5 ans, +1 si écart < 15 ans
      // - rating_bonus: note / 2 (0-5 points)
      // - already_watched: -20 si l'utilisateur a déjà terminé ce média
      const genreScoreParts = item.genres
        .map(g => `(CASE WHEN genres LIKE '%${g.replace(/'/g, "''")}%' THEN 10 ELSE 0 END)`)
        .join(' + ')

      const yearProximity = item.year
        ? `(CASE WHEN year IS NOT NULL AND ABS(year - ${item.year}) < 5 THEN 3 WHEN year IS NOT NULL AND ABS(year - ${item.year}) < 15 THEN 1 ELSE 0 END)`
        : '0'

      const typeBonus = `(CASE WHEN media_type = '${item.mediaType}' THEN 5 ELSE 0 END)`

      const genreFilter = item.genres
        .map(g => `genres LIKE '%${g.replace(/'/g, "''")}%'`)
        .join(' OR ')

      const rows = sqlite.prepare(`
        SELECT
          m.id, m.title, m.poster_path as posterPath, m.year, m.rating, m.media_type as mediaType,
          (
            ${genreScoreParts}
            + ${typeBonus}
            + ${yearProximity}
            + COALESCE(m.rating, 0) / 2.0
            - (CASE WHEN wp.completed = 1 THEN 20 ELSE 0 END)
          ) as score
        FROM media m
        LEFT JOIN watch_progress wp ON wp.media_id = m.id AND wp.user_id = ?
        WHERE m.id != ? AND (${genreFilter})
        GROUP BY COALESCE(m.tmdb_id, m.title)
        ORDER BY score DESC, m.rating DESC
        LIMIT ?
      `).all(ctx.user.id, input.mediaId, input.limit) as any[]

      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        posterPath: r.posterPath,
        year: r.year,
        rating: r.rating,
        mediaType: r.mediaType,
      }))
    }),

  // Admin: Update media metadata manually
  updateMetadata: adminProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().optional(),
      overview: z.string().optional(),
      year: z.number().optional(),
      genres: z.array(z.string()).optional(),
      posterPath: z.string().optional(),
      backdropPath: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...updates } = input

      const [item] = await db
        .select()
        .from(media)
        .where(eq(media.id, id))
        .limit(1)

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        })
      }

      await db.update(media).set(updates).where(eq(media.id, id))

      return { success: true }
    }),

  // Admin: Update file path
  updateFilePath: adminProcedure
    .input(z.object({
      id: z.string(),
      filePath: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const [item] = await db
        .select()
        .from(media)
        .where(eq(media.id, input.id))
        .limit(1)

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        })
      }

      await db.update(media).set({ filePath: input.filePath }).where(eq(media.id, input.id))

      return { success: true, filePath: input.filePath }
    }),

  // Admin: Delete media
  delete: adminProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      // downloads.media_id has a FK to media.id without ON DELETE action.
      // Nullify references first to avoid SQLITE_CONSTRAINT on old rows.
      await db.update(downloads).set({ mediaId: null }).where(eq(downloads.mediaId, input))
      await db.delete(media).where(eq(media.id, input))

      // Clean up subtitle cache directory
      const cacheDir = join(process.cwd(), 'data', 'subtitles', input)
      await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {})

      return { success: true }
    }),

  // Admin: Search TMDB for re-identification
  searchTmdb: adminProcedure
    .input(z.object({
      query: z.string().min(1),
      type: z.enum(['movie', 'tv']),
    }))
    .query(async ({ input }) => {
      return await searchTmdb(input.query, input.type)
    }),

  // Admin: Re-identify media with a different TMDB ID
  reidentify: adminProcedure
    .input(z.object({
      id: z.string(),
      tmdbId: z.number(),
      mediaType: z.enum(['movie', 'tv']),
    }))
    .mutation(async ({ input }) => {
      const [item] = await db
        .select()
        .from(media)
        .where(eq(media.id, input.id))
        .limit(1)

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        })
      }

      const tmdbInfo = await getTmdbInfo(input.tmdbId, input.mediaType)
      if (!tmdbInfo) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Could not fetch TMDB info',
        })
      }

      const fields = tmdbInfoToMediaFields(tmdbInfo, input.mediaType)
      await db.update(media).set(fields).where(eq(media.id, input.id))

      return { success: true }
    }),

  // List TV shows grouped (one entry per show)
  listShows: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      genre: z.string().optional(),
      sortBy: z.enum(['title', 'year', 'rating', 'addedAt']).default('addedAt'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const params = input || {}

      // Build WHERE conditions and params array
      const conditions: string[] = [`media_type = 'tv'`]
      const queryParams: any[] = []

      if (params.search) {
        const term = params.search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        const maxDist = Math.max(2, Math.floor(term.length * 0.35))
        conditions.push(`(normalize(title) LIKE ? OR normalize(original_title) LIKE ? OR levenshtein(title, ?) <= ? OR levenshtein(original_title, ?) <= ?)`)
        queryParams.push(`%${term}%`, `%${term}%`, term, maxDist, term, maxDist)
      }
      if (params.genre) {
        conditions.push(`genres LIKE ?`)
        queryParams.push(`%${params.genre}%`)
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`

      // Map sort options to SQL expressions (aliases from SELECT)
      const orderMap: Record<string, string> = {
        title: 'title',
        year: 'year',
        rating: 'rating',
        addedAt: 'lastAddedAt',
      }
      const orderCol = orderMap[params.sortBy || 'addedAt'] || 'lastAddedAt'
      const orderDir = params.sortOrder === 'asc' ? 'ASC' : 'DESC'

      const querySQL = `
        SELECT
          title,
          poster_path as posterPath,
          backdrop_path as backdropPath,
          rating,
          year,
          genres,
          tmdb_id as tmdbId,
          overview,
          tagline,
          COUNT(*) as episodeCount,
          COUNT(DISTINCT season) as seasonCount,
          MAX(added_at) as lastAddedAt
        FROM media
        ${whereClause}
        GROUP BY COALESCE(tmdb_id, title)
        ORDER BY ${orderCol} ${orderDir}
        LIMIT ? OFFSET ?
      `
      const rows = sqlite.prepare(querySQL).all(...queryParams, params.limit || 50, params.offset || 0)

      const countRow = sqlite.prepare(`
        SELECT COUNT(*) as total FROM (
          SELECT 1 FROM media ${whereClause} GROUP BY COALESCE(tmdb_id, title)
        )
      `).get(...queryParams) as any

      const items = rows.map((row: any) => ({
        ...row,
        genres: row.genres ? JSON.parse(row.genres) : null,
      }))

      return {
        items,
        total: countRow?.total || 0,
        hasMore: (params.offset || 0) + items.length < (countRow?.total || 0),
      }
    }),

  // Get all episodes for a TV show, grouped by season
  getShowEpisodes: protectedProcedure
    .input(z.object({
      tmdbId: z.number().optional(),
      title: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      if (!input.tmdbId && !input.title) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Either tmdbId or title is required',
        })
      }

      const condition = input.tmdbId
        ? and(eq(media.mediaType, 'tv'), eq(media.tmdbId, input.tmdbId))
        : and(eq(media.mediaType, 'tv'), eq(media.title, input.title!))

      const episodes = await db
        .select()
        .from(media)
        .where(condition)
        .orderBy(asc(media.season), asc(media.episode))

      if (episodes.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Show not found',
        })
      }

      // Get watch progress for all episodes
      const mediaIds = episodes.map(e => e.id)
      const progress = mediaIds.length > 0
        ? await db
            .select()
            .from(watchProgress)
            .where(
              and(
                eq(watchProgress.userId, ctx.user.id),
                sql`${watchProgress.mediaId} IN (${sql.join(mediaIds.map(id => sql`${id}`), sql`, `)})`
              )
            )
        : []

      const progressMap = new Map(progress.map(p => [p.mediaId, p]))

      // Use first episode for show-level info
      const first = episodes[0]

      // Fetch episode details (thumbnails + names) from TMDB if tmdbId is available
      const episodeInfoMap = new Map<string, { name: string; overview: string; stillPath: string | null }>()
      if (first.tmdbId) {
        try {
          const info = await getTmdbInfo(first.tmdbId, 'tv')
          if (info?.episodes) {
            for (const ep of info.episodes) {
              const key = `${ep.season}-${ep.episode}`
              episodeInfoMap.set(key, {
                name: ep.title || '',
                overview: ep.description || '',
                stillPath: ep.img?.hd || ep.img?.mobile || null,
              })
            }
          }
        } catch (error) {
          console.error('[getShowEpisodes] Failed to fetch TMDB episode details:', error)
        }
      }

      // Group episodes by season
      const seasonMap = new Map<number, typeof episodes>()
      for (const ep of episodes) {
        const s = ep.season ?? 0
        if (!seasonMap.has(s)) seasonMap.set(s, [])
        seasonMap.get(s)!.push(ep)
      }

      const seasons = Array.from(seasonMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([number, eps]) => ({
          number,
          episodes: eps.map(ep => {
            const tmdbInfo = episodeInfoMap.get(`${ep.season}-${ep.episode}`)
            return {
              id: ep.id,
              title: ep.title,
              episodeName: tmdbInfo?.name || null,
              episodeOverview: tmdbInfo?.overview || null,
              stillPath: tmdbInfo?.stillPath || null,
              season: ep.season,
              episode: ep.episode,
              runtime: ep.runtime,
              watchProgress: progressMap.get(ep.id) || null,
            }
          }),
        }))

      return {
        show: {
          title: first.title,
          posterPath: first.posterPath,
          backdropPath: first.backdropPath,
          overview: first.overview,
          genres: first.genres,
          rating: first.rating,
          year: first.year,
          tagline: first.tagline,
          tmdbId: first.tmdbId,
          originalTitle: first.originalTitle,
          cast: first.cast,
        },
        seasons,
        totalEpisodes: episodes.length,
      }
    }),

  // Get next episode in a TV show
  getNextEpisode: protectedProcedure
    .input(z.string()) // current media ID
    .query(async ({ input }) => {
      // Get current episode
      const [current] = await db
        .select()
        .from(media)
        .where(eq(media.id, input))
        .limit(1)

      if (!current || current.mediaType !== 'tv') {
        return null
      }

      // Find next episode: same show, next episode in same season or first of next season
      const condition = current.tmdbId
        ? and(eq(media.mediaType, 'tv'), eq(media.tmdbId, current.tmdbId))
        : and(eq(media.mediaType, 'tv'), eq(media.title, current.title))

      const allEpisodes = await db
        .select({ id: media.id, season: media.season, episode: media.episode })
        .from(media)
        .where(condition)
        .orderBy(asc(media.season), asc(media.episode))

      // Find current index and return next
      const currentIdx = allEpisodes.findIndex(e => e.id === input)
      if (currentIdx >= 0 && currentIdx < allEpisodes.length - 1) {
        return { nextId: allEpisodes[currentIdx + 1].id }
      }

      return null
    }),

  // Rate media (like/dislike with toggle)
  rateMedia: protectedProcedure
    .input(z.object({
      mediaId: z.string(),
      rating: z.union([z.literal(1), z.literal(-1)]),
    }))
    .mutation(async ({ input, ctx }) => {
      // Check if user already rated this media
      const [existing] = await db
        .select()
        .from(mediaRatings)
        .where(and(eq(mediaRatings.userId, ctx.user.id), eq(mediaRatings.mediaId, input.mediaId)))
        .limit(1)

      if (existing) {
        if (existing.rating === input.rating) {
          // Same rating → toggle off (remove)
          await db.delete(mediaRatings).where(eq(mediaRatings.id, existing.id))
          return { rating: null }
        }
        // Different rating → update
        await db.update(mediaRatings)
          .set({ rating: input.rating })
          .where(eq(mediaRatings.id, existing.id))
        return { rating: input.rating }
      }

      // New rating
      const { v4: uuidv4 } = await import('uuid')
      await db.insert(mediaRatings).values({
        id: uuidv4(),
        userId: ctx.user.id,
        mediaId: input.mediaId,
        rating: input.rating,
        createdAt: new Date(),
      })
      return { rating: input.rating }
    }),

  // Remove rating
  removeRating: protectedProcedure
    .input(z.object({ mediaId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.delete(mediaRatings)
        .where(and(eq(mediaRatings.userId, ctx.user.id), eq(mediaRatings.mediaId, input.mediaId)))
      return { success: true }
    }),

  // ── Watchlist ────────────────────────────────────────────────────────────
  // Toggle a media item in the user's watchlist. Returns the new state.
  toggleWatchlist: protectedProcedure
    .input(z.object({ mediaId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db
        .select({ id: watchlist.id })
        .from(watchlist)
        .where(and(eq(watchlist.userId, ctx.user.id), eq(watchlist.mediaId, input.mediaId)))
        .limit(1)

      if (existing) {
        await db.delete(watchlist).where(eq(watchlist.id, existing.id))
        return { inWatchlist: false }
      }

      // Guard against dangling references
      const [exists] = await db.select({ id: media.id }).from(media).where(eq(media.id, input.mediaId)).limit(1)
      if (!exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Media not found' })

      const { v4: uuidv4 } = await import('uuid')
      await db.insert(watchlist).values({
        id: uuidv4(),
        userId: ctx.user.id,
        mediaId: input.mediaId,
        createdAt: new Date(),
      })
      return { inWatchlist: true }
    }),

  // Whether a specific media item is in the user's watchlist
  watchlistStatus: protectedProcedure
    .input(z.object({ mediaId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [row] = await db
        .select({ id: watchlist.id })
        .from(watchlist)
        .where(and(eq(watchlist.userId, ctx.user.id), eq(watchlist.mediaId, input.mediaId)))
        .limit(1)
      return { inWatchlist: !!row }
    }),

  // The user's full watchlist (most recently added first)
  getWatchlist: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 30
      const rows = sqlite.prepare(`
        SELECT m.id, m.title, m.poster_path as posterPath, m.year, m.rating,
               m.media_type as mediaType, m.season, m.episode, w.created_at as addedAt
        FROM watchlist w
        JOIN media m ON m.id = w.media_id
        WHERE w.user_id = ?
        ORDER BY w.created_at DESC
        LIMIT ?
      `).all(ctx.user.id, limit) as any[]
      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        posterPath: r.posterPath,
        year: r.year,
        rating: r.rating,
        mediaType: r.mediaType,
        season: r.season,
        episode: r.episode,
      }))
    }),

  // Personalized recommendation sections
  personalizedSections: protectedProcedure
    .query(async ({ ctx }) => {
      const preferences = calculateUserPreferences(ctx.user.id)

      if (!preferences || preferences.topMedia.length === 0) {
        return { sections: [] }
      }

      const sections: Array<{ sectionType: string; param: string; items: any[] }> = []
      const usedIds = new Set<string>()
      const MIN_MATCH = 40

      // Get IDs of media the user has already watched (completed)
      const watchedRows = sqlite.prepare(`
        SELECT media_id FROM watch_progress WHERE user_id = ? AND completed = 1
      `).all(ctx.user.id) as any[]
      const watchedIds = new Set(watchedRows.map((r: any) => r.media_id))

      // Genre articles moved to client-side for i18n support

      // Helper: build scored items from raw SQL rows, excluding watched + already used
      function buildItems(rows: any[]) {
        return rows
          .filter((m: any) => !watchedIds.has(m.id) && !usedIds.has(m.id))
          .map((m: any) => {
            const genres = m.genres ? JSON.parse(m.genres) : null
            const matchScore = calculateMatchScore(genres, m.year, m.rating, preferences)
            return {
              id: m.id,
              title: m.title,
              posterPath: m.posterPath,
              year: m.year,
              rating: m.rating,
              matchScore,
            }
          })
          .filter((m: any) => m.matchScore >= MIN_MATCH)
          .sort((a: any, b: any) => (b.matchScore || 0) - (a.matchScore || 0))
      }

      // 1) "Parce que vous avez aimé {titre}" — top liked film
      const topLiked = preferences.topMedia.find(m => m.genres.length > 0)
      if (topLiked) {
        const genreFilter = topLiked.genres
          .map(g => `genres LIKE '%${g.replace(/'/g, "''")}%'`)
          .join(' OR ')

        const similar = sqlite.prepare(`
          SELECT id, title, poster_path as posterPath, year, rating, genres
          FROM media
          WHERE id != ? AND media_type = 'movie' AND (${genreFilter})
          GROUP BY COALESCE(tmdb_id, title)
          ORDER BY rating DESC NULLS LAST
          LIMIT 30
        `).all(topLiked.id) as any[]

        const filtered = buildItems(similar)
        if (filtered.length >= 3) {
          for (const item of filtered) usedIds.add(item.id)
          sections.push({
            sectionType: 'becauseYouLiked',
            param: topLiked.title,
            items: filtered,
          })
        }
      }

      // 2) "Parce que vous aimez {genre}" — top preferred genre
      const topGenre = preferences.topGenres[0]
      if (topGenre) {
        const genreMovies = sqlite.prepare(`
          SELECT id, title, poster_path as posterPath, year, rating, genres
          FROM media
          WHERE media_type = 'movie' AND genres LIKE ?
          GROUP BY COALESCE(tmdb_id, title)
          ORDER BY rating DESC NULLS LAST
          LIMIT 30
        `).all(`%${topGenre.genre}%`) as any[]

        const filtered = buildItems(genreMovies)
        if (filtered.length >= 3) {
          for (const item of filtered) usedIds.add(item.id)
          sections.push({
            sectionType: 'becauseYouLikeGenre',
            param: topGenre.genre,
            items: filtered,
          })
        }
      }

      return { sections }
    }),

  youMightAlsoLike: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(24).default(12),
      mediaType: z.enum(['movie', 'tv', 'all']).default('movie'),
    }).optional())
    .query(async ({ input, ctx }) => {
      const params = input || { limit: 12, mediaType: 'movie' as const }
      const preferences = calculateUserPreferences(ctx.user.id)
      const [profile] = await db
        .select({ profileData: userProfiles.profileData })
        .from(userProfiles)
        .where(eq(userProfiles.userId, ctx.user.id))
        .limit(1)

      const profileData = profile?.profileData as Record<string, any> | null | undefined
      const topGenresFromPreferences = preferences?.topGenres || []
      const topGenresFromProfile = Object.entries((profileData?.preferences?.genreScores || {}) as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([genre]) => genre)

      if ((!preferences || preferences.topGenres.length === 0) && topGenresFromProfile.length === 0) {
        return []
      }

      const watchedRows = sqlite.prepare(`
        SELECT media_id
        FROM watch_progress
        WHERE user_id = ? AND completed = 1
      `).all(ctx.user.id) as Array<{ media_id: string }>

      const ratedRows = sqlite.prepare(`
        SELECT media_id, rating
        FROM media_ratings
        WHERE user_id = ?
      `).all(ctx.user.id) as Array<{ media_id: string, rating: number }>

      // Watchlisted items: surfaced in their own rail, so exclude from discovery,
      // but use their genres as a positive affinity signal.
      const watchlistRows = sqlite.prepare(`
        SELECT m.id as id, m.genres as genres
        FROM watchlist w JOIN media m ON m.id = w.media_id
        WHERE w.user_id = ?
      `).all(ctx.user.id) as Array<{ id: string, genres: string | null }>

      const watchlistGenres = new Set<string>()
      for (const row of watchlistRows) {
        try { for (const g of JSON.parse(row.genres || '[]')) watchlistGenres.add(g) } catch {}
      }

      const excludedIds = new Set<string>(watchedRows.map(row => row.media_id))
      for (const row of ratedRows) {
        if (row.rating === -1) excludedIds.add(row.media_id)
      }
      for (const row of watchlistRows) excludedIds.add(row.id)

      const topGenres = [...new Set([
        ...topGenresFromPreferences.slice(0, 4).map(entry => entry.genre),
        ...topGenresFromProfile,
      ])].slice(0, 6)
      const genreFilter = topGenres
        .map(genre => `m.genres LIKE '%${genre.replace(/'/g, "''")}%'`)
        .join(' OR ')

      if (!genreFilter) {
        return []
      }

      const typeFilter = params.mediaType === 'all'
        ? ''
        : `AND m.media_type = '${params.mediaType}'`

      const candidates = sqlite.prepare(`
        SELECT
          m.id,
          m.title,
          m.poster_path as posterPath,
          m.year,
          m.rating,
          m.media_type as mediaType,
          m.season,
          m.episode,
          m.genres,
          m.runtime,
          m.cast,
          m.keywords,
          m.director,
          m.composer,
          m.certification,
          m.popularity,
          m.collection_name as collectionName
        FROM media m
        WHERE (${genreFilter}) ${typeFilter}
        GROUP BY COALESCE(m.tmdb_id, m.title)
        ORDER BY m.rating DESC NULLS LAST, m.added_at DESC
        LIMIT 150
      `).all() as any[]

      const eligible = candidates.filter(candidate => !excludedIds.has(candidate.id))
      const statsMap = getMediaStats(eligible.map(c => c.id))
      const now = new Date()

      const scored = eligible
        .map((candidate) => {
          const matchScore = scoreCandidateWithProfile(candidate, preferences, profileData, {
            statsModifier: mediaQualityModifier(statsMap.get(candidate.id)),
            watchlistGenres,
            now,
          })
          return {
            id: candidate.id,
            title: candidate.title,
            posterPath: candidate.posterPath,
            year: candidate.year,
            rating: candidate.rating,
            mediaType: candidate.mediaType,
            season: candidate.season,
            episode: candidate.episode,
            matchScore,
          }
        })
        .filter(candidate => candidate.matchScore >= 30)
        .sort((a, b) => {
          if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
          return (b.rating || 0) - (a.rating || 0)
        })
        .slice(0, params.limit)

      return scored
    }),

  // Get media without TMDB ID (admin)
  noTmdbMedia: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      mediaType: z.enum(['movie', 'tv']).optional(),
    }).optional())
    .query(async ({ input }) => {
      const params = input || { limit: 50 }
      const conditions = [isNull(media.tmdbId)]
      if (params.mediaType) conditions.push(eq(media.mediaType, params.mediaType))

      return db
        .select({
          id: media.id,
          title: media.title,
          fileName: media.fileName,
          filePath: media.filePath,
          year: media.year,
          posterPath: media.posterPath,
          mediaType: media.mediaType,
          season: media.season,
          episode: media.episode,
          fileSize: media.fileSize,
        })
        .from(media)
        .where(and(...conditions))
        .orderBy(asc(media.title))
        .limit(params.limit)
    }),

  // Get duplicate media (same tmdb_id or same title, grouped)
  duplicateMedia: adminProcedure.query(async () => {
    // Find titles that appear more than once (for movies only)
    const rows = sqlite.prepare(`
      SELECT title, tmdb_id, media_type, COUNT(*) as count,
        GROUP_CONCAT(id, '||') as ids,
        GROUP_CONCAT(file_name, '||') as fileNames,
        GROUP_CONCAT(COALESCE(file_size, 0), '||') as fileSizes
      FROM media
      WHERE media_type = 'movie'
      GROUP BY COALESCE(tmdb_id, ''), title
      HAVING COUNT(*) > 1
      ORDER BY title ASC
    `).all() as Array<{
      title: string
      tmdb_id: number | null
      media_type: string
      count: number
      ids: string
      fileNames: string
      fileSizes: string
    }>

    return rows.map(r => ({
      title: r.title,
      tmdbId: r.tmdb_id,
      mediaType: r.media_type,
      count: r.count,
      items: r.ids.split('||').map((id, i) => ({
        id,
        fileName: r.fileNames.split('||')[i],
        fileSize: parseInt(r.fileSizes.split('||')[i]) || null,
      })),
    }))
  }),

  // System stats (CPU + RAM) for admin dashboard
  systemStats: adminProcedure.query(() => {
    const mem = process.memoryUsage()
    const cpuPercent = getCpuPercent()
    return {
      cpu: { percent: cpuPercent, cores: os.cpus().length },
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        totalSystem: os.totalmem(),
        freeSystem: os.freemem(),
      },
      uptime: process.uptime(),
    }
  }),

  // Get stats
  stats: protectedProcedure.query(async ({ ctx }) => {
    const [totalMedia, totalMovies, recentlyWatched] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(media),
      db.select({ count: sql<number>`count(*)` }).from(media).where(eq(media.mediaType, 'movie')),
      db
        .select({ count: sql<number>`count(*)` })
        .from(watchProgress)
        .where(eq(watchProgress.userId, ctx.user.id)),
    ])

    // Count distinct TV shows, not individual episodes
    const tvShowCount = await db
      .select({ count: sql<number>`COUNT(DISTINCT COALESCE(tmdb_id, title))` })
      .from(media)
      .where(eq(media.mediaType, 'tv'))

    return {
      totalMedia: totalMedia[0]?.count || 0,
      totalMovies: totalMovies[0]?.count || 0,
      totalTv: tvShowCount[0]?.count || 0,
      totalWatched: recentlyWatched[0]?.count || 0,
    }
  }),

  // Update media info (admin only)
  updateInfo: adminProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().optional(),
      year: z.number().optional(),
      runtime: z.number().optional(),
      overview: z.string().optional(),
      tagline: z.string().optional(),
      rating: z.number().optional(),
      genres: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input

      const [existing] = await db
        .select()
        .from(media)
        .where(eq(media.id, id))
        .limit(1)

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        })
      }

      const updates: Record<string, unknown> = {}
      if (fields.title !== undefined) updates.title = fields.title
      if (fields.year !== undefined) updates.year = fields.year
      if (fields.runtime !== undefined) updates.runtime = fields.runtime
      if (fields.overview !== undefined) updates.overview = fields.overview
      if (fields.tagline !== undefined) updates.tagline = fields.tagline
      if (fields.rating !== undefined) updates.rating = fields.rating
      if (fields.genres !== undefined) updates.genres = fields.genres

      if (Object.keys(updates).length === 0) {
        return { success: true }
      }

      await db
        .update(media)
        .set(updates)
        .where(eq(media.id, id))

      return { success: true }
    }),
})
