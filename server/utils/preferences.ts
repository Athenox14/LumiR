import { sqlite } from '../db'

export interface UserPreferences {
  genreWeights: Map<string, number>
  decadeWeights: Map<number, number>
  topMedia: Array<{ id: string; title: string; posterPath: string | null; genres: string[]; score: number }>
  topGenres: Array<{ genre: string; weight: number }>
}

// In-memory cache with 60s TTL
const preferencesCache = new Map<string, { data: UserPreferences | null; expiresAt: number }>()
const CACHE_TTL = 60_000

/**
 * Calculate user preferences based on watch history and ratings.
 * Results are cached for 60s per user.
 */
export function calculateUserPreferences(userId: string): UserPreferences | null {
  const cached = preferencesCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  const result = _calculateUserPreferences(userId)
  preferencesCache.set(userId, { data: result, expiresAt: Date.now() + CACHE_TTL })
  return result
}

function _calculateUserPreferences(userId: string): UserPreferences | null {
  // Get all watch progress with media info (simple JOIN, no self-join)
  const watchData = sqlite.prepare(`
    SELECT
      wp.media_id as mediaId,
      wp.position,
      wp.duration,
      wp.completed,
      wp.updated_at as updatedAt,
      m.title,
      m.poster_path as posterPath,
      m.genres,
      m.year,
      m.media_type as mediaType,
      m.rating as tmdbRating
    FROM watch_progress wp
    JOIN media m ON m.id = wp.media_id
    WHERE wp.user_id = ?
  `).all(userId) as any[]

  // Get user ratings
  const ratings = sqlite.prepare(`
    SELECT media_id as mediaId, rating
    FROM media_ratings
    WHERE user_id = ?
  `).all(userId) as any[]

  const ratingMap = new Map<string, number>()
  for (const r of ratings) {
    ratingMap.set(r.mediaId, r.rating)
  }

  if (watchData.length === 0 && ratings.length === 0) return null

  const genreWeights = new Map<string, number>()
  const decadeWeights = new Map<number, number>()
  const mediaScores: Array<{ id: string; title: string; posterPath: string | null; genres: string[]; score: number }> = []

  const now = Date.now()

  for (const row of watchData) {
    let score = 0

    // Completion bonus
    if (row.completed) score += 5

    // Partial watch (proportional)
    if (!row.completed && row.duration && row.position) {
      score += (row.position / row.duration) * 2
    }

    // Rating bonus/penalty
    const rating = ratingMap.get(row.mediaId)
    if (rating === 1) score += 5
    else if (rating === -1) score -= 5

    // Time decay: recent watches are worth more
    const daysSince = row.updatedAt ? (now - row.updatedAt * 1000) / (1000 * 60 * 60 * 24) : 365
    const recencyFactor = 1 / (1 + daysSince / 365)
    score *= recencyFactor

    // Skip negative scores (disliked content)
    if (score <= 0) continue

    // Parse genres
    const genres: string[] = row.genres ? JSON.parse(row.genres) : []

    // Distribute score to genres
    for (const genre of genres) {
      genreWeights.set(genre, (genreWeights.get(genre) || 0) + score)
    }

    // Distribute score to decades
    if (row.year) {
      const decade = Math.floor(row.year / 10) * 10
      decadeWeights.set(decade, (decadeWeights.get(decade) || 0) + score)
    }

    mediaScores.push({
      id: row.mediaId,
      title: row.title,
      posterPath: row.posterPath,
      genres,
      score,
    })
  }

  // Also process rated media that might not be in watch history
  for (const r of ratings) {
    if (r.rating === 1 && !watchData.find(w => w.mediaId === r.mediaId)) {
      const mediaInfo = sqlite.prepare(`
        SELECT id, title, poster_path as posterPath, genres, year
        FROM media WHERE id = ?
      `).get(r.mediaId) as any

      if (mediaInfo) {
        const genres: string[] = mediaInfo.genres ? JSON.parse(mediaInfo.genres) : []
        for (const genre of genres) {
          genreWeights.set(genre, (genreWeights.get(genre) || 0) + 5)
        }
        mediaScores.push({
          id: mediaInfo.id,
          title: mediaInfo.title,
          posterPath: mediaInfo.posterPath,
          genres,
          score: 5,
        })
      }
    }
  }

  // Sort media by score descending
  mediaScores.sort((a, b) => b.score - a.score)

  // Sort genres by weight
  const topGenres = Array.from(genreWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([genre, weight]) => ({ genre, weight }))

  return {
    genreWeights,
    decadeWeights,
    topMedia: mediaScores.slice(0, 10),
    topGenres,
  }
}

/**
 * Calculate match score (0-100) for a media item based on user preferences.
 */
export function calculateMatchScore(
  mediaGenres: string[] | null,
  mediaYear: number | null,
  mediaRating: number | null,
  preferences: UserPreferences
): number {
  if (!preferences.topGenres.length) return 0

  let score = 0
  const maxGenreWeight = preferences.topGenres[0]?.weight || 1

  // Genre overlap (max 50 points)
  const genres = mediaGenres || []
  let genreScore = 0
  for (const genre of genres) {
    const weight = preferences.genreWeights.get(genre) || 0
    genreScore += (weight / maxGenreWeight) * 10
  }
  score += Math.min(50, genreScore)

  // Decade alignment (max 20 points)
  if (mediaYear && preferences.decadeWeights.size > 0) {
    const decade = Math.floor(mediaYear / 10) * 10
    const maxDecadeWeight = Math.max(...preferences.decadeWeights.values())
    const decadeWeight = preferences.decadeWeights.get(decade) || 0
    score += (decadeWeight / maxDecadeWeight) * 20
  }

  // Rating boost (max 15 points)
  if (mediaRating) {
    score += (mediaRating / 10) * 15
  }

  // Base minimum for having any genre match (makes scores less sparse)
  if (genreScore > 0) score = Math.max(score, 30)

  return Math.min(100, Math.round(score))
}
