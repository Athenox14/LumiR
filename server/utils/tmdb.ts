import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'

const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = '/api/images'

// ===== Types (compatible with existing frontend) =====

export interface TmdbSearchResult {
  id: number
  title: string
  image: string
  type: string
  rating: number
  releaseDate: string
}

export interface TmdbEpisode {
  id: string
  title: string
  episode: number
  season: number
  img?: { mobile?: string; hd?: string } | null
  description?: string
}

export interface TmdbInfo {
  id: number
  title: string
  image: string
  cover: string
  description: string
  genres: string[]
  rating: number
  releaseDate: string
  totalEpisodes?: number
  totalSeasons?: number
  duration?: string
  type: string
  recommendations?: TmdbSearchResult[]
  cast?: { id: number; name: string; character: string; profilePath: string | null }[]
  production?: string[]
  episodes?: TmdbEpisode[]
  // Extra fields from TMDB
  tagline?: string
  status?: string
  voteCount?: number
  originalTitle?: string
  collectionId?: number
  collectionName?: string
}

// ===== Helper: get API key =====

async function getTmdbApiKey(): Promise<string | null> {
  const [setting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'tmdbApiKey'))
    .limit(1)

  const key = setting?.value as string | undefined
  return key?.trim() || null
}

async function tmdbFetch(path: string, params: Record<string, string> = {}): Promise<any> {
  const apiKey = await getTmdbApiKey()
  if (!apiKey) throw new Error('TMDB API key not configured')

  const url = new URL(`${TMDB_BASE}${path}`)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('language', 'fr-FR')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString())
  if (!res.ok) {
    console.error(`[TMDB] ${path} failed: ${res.status} ${res.statusText}`)
    return null
  }
  return res.json()
}

// ===== Search =====

export async function searchTmdb(
  query: string,
  type: 'movie' | 'tv'
): Promise<TmdbSearchResult[]> {
  try {
    const endpoint = type === 'tv' ? '/search/tv' : '/search/movie'
    const data = await tmdbFetch(endpoint, { query })
    if (!data?.results) return []

    return data.results.map((r: any) => ({
      id: r.id,
      title: type === 'tv' ? (r.name || r.original_name) : (r.title || r.original_title),
      image: r.poster_path ? `${TMDB_IMAGE_BASE}/w500${r.poster_path}` : '',
      type: type === 'tv' ? 'TV Series' : 'Movie',
      rating: r.vote_average || 0,
      releaseDate: (type === 'tv' ? r.first_air_date : r.release_date) || '',
    }))
  } catch (error) {
    console.error('[TMDB] Search error:', error)
    return []
  }
}

// ===== Trending =====

export async function getTmdbTrending(
  type: 'movie' | 'tv'
): Promise<TmdbSearchResult[]> {
  try {
    const data = await tmdbFetch(`/trending/${type}/week`)
    if (!data?.results) return []

    return data.results.map((r: any) => ({
      id: r.id,
      title: type === 'tv' ? (r.name || r.original_name) : (r.title || r.original_title),
      image: r.poster_path ? `${TMDB_IMAGE_BASE}/w500${r.poster_path}` : '',
      type: type === 'tv' ? 'TV Series' : 'Movie',
      rating: r.vote_average || 0,
      releaseDate: (type === 'tv' ? r.first_air_date : r.release_date) || '',
    }))
  } catch (error) {
    console.error('[TMDB] Trending error:', error)
    return []
  }
}

// ===== Info (movie/tv details) =====

export async function getTmdbInfo(
  tmdbId: number,
  type: 'movie' | 'tv'
): Promise<TmdbInfo | null> {
  try {
    const endpoint = type === 'tv' ? `/tv/${tmdbId}` : `/movie/${tmdbId}`
    const data = await tmdbFetch(endpoint, {
      append_to_response: 'credits,recommendations',
    })
    if (!data) return null

    const title = type === 'tv' ? (data.name || data.original_name) : (data.title || data.original_title)
    const releaseDate = type === 'tv' ? (data.first_air_date || '') : (data.release_date || '')

    // Cast with profile images and character names
    const cast = data.credits?.cast?.slice(0, 15).map((c: any) => ({
      id: c.id,
      name: c.name,
      character: c.character || '',
      profilePath: c.profile_path ? `${TMDB_IMAGE_BASE}/w185${c.profile_path}` : null,
    })) || []

    // Production companies
    const production = data.production_companies?.map((p: any) => p.name) || []

    // Genres
    const genres = data.genres?.map((g: any) => g.name) || []

    // Recommendations
    const recommendations: TmdbSearchResult[] = (data.recommendations?.results || []).slice(0, 12).map((r: any) => ({
      id: r.id,
      title: type === 'tv' ? (r.name || r.original_name) : (r.title || r.original_title),
      image: r.poster_path ? `${TMDB_IMAGE_BASE}/w500${r.poster_path}` : '',
      type: type === 'tv' ? 'TV Series' : 'Movie',
      rating: r.vote_average || 0,
      releaseDate: (type === 'tv' ? r.first_air_date : r.release_date) || '',
    }))

    // Duration
    let duration: string | undefined
    if (type === 'movie' && data.runtime) {
      duration = `${data.runtime} min`
    } else if (type === 'tv' && data.episode_run_time?.length) {
      duration = `${data.episode_run_time[0]} min`
    }

    // For TV shows, fetch episodes for all seasons
    let episodes: TmdbEpisode[] | undefined
    if (type === 'tv' && data.number_of_seasons) {
      episodes = await fetchAllTvEpisodes(tmdbId, data.number_of_seasons)
    }

    return {
      id: data.id,
      title,
      image: data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : '',
      cover: data.backdrop_path ? `${TMDB_IMAGE_BASE}/original${data.backdrop_path}` : '',
      description: data.overview || '',
      genres,
      rating: data.vote_average || 0,
      releaseDate,
      totalEpisodes: data.number_of_episodes,
      totalSeasons: data.number_of_seasons,
      duration,
      type: type === 'tv' ? 'TV Series' : 'Movie',
      recommendations,
      cast,
      production,
      episodes,
      tagline: data.tagline || undefined,
      status: data.status || undefined,
      voteCount: data.vote_count || undefined,
      originalTitle: type === 'tv' ? data.original_name : data.original_title,
      collectionId: data.belongs_to_collection?.id || undefined,
      collectionName: data.belongs_to_collection?.name || undefined,
    }
  } catch (error) {
    console.error('[TMDB] Info error:', error)
    return null
  }
}

// Fetch all episodes for a TV show (needed for episode listing + streaming episodeId)
async function fetchAllTvEpisodes(tmdbId: number, totalSeasons: number): Promise<TmdbEpisode[]> {
  const episodes: TmdbEpisode[] = []

  for (let s = 1; s <= totalSeasons; s++) {
    try {
      const data = await tmdbFetch(`/tv/${tmdbId}/season/${s}`)
      if (!data?.episodes) continue

      for (const ep of data.episodes) {
        episodes.push({
          id: `${tmdbId}:${s}:${ep.episode_number}`,
          title: ep.name || `Episode ${ep.episode_number}`,
          episode: ep.episode_number,
          season: s,
          img: ep.still_path ? {
            hd: `${TMDB_IMAGE_BASE}/w500${ep.still_path}`,
            mobile: `${TMDB_IMAGE_BASE}/w300${ep.still_path}`,
          } : null,
          description: ep.overview || undefined,
        })
      }
    } catch {
      console.error(`[TMDB] Failed to fetch season ${s} for show ${tmdbId}`)
    }
  }

  return episodes
}

// ===== Helper: convert TmdbInfo to media DB fields =====

// ===== Person info =====

export interface TmdbPersonInfo {
  id: number
  name: string
  biography: string
  birthday: string | null
  deathday: string | null
  placeOfBirth: string | null
  profilePath: string | null
  knownForDepartment: string | null
  credits: {
    id: number
    title: string
    image: string
    type: 'Movie' | 'TV Series'
    character: string
    releaseDate: string
    rating: number
  }[]
}

export async function getPersonInfo(personId: number): Promise<TmdbPersonInfo | null> {
  try {
    const data = await tmdbFetch(`/person/${personId}`, {
      append_to_response: 'combined_credits',
    })
    if (!data) return null

    // Combine and deduplicate credits, sort by popularity
    const allCredits: any[] = data.combined_credits?.cast || []
    const seen = new Set<string>()
    const credits = allCredits
      .filter((c: any) => {
        const key = `${c.media_type}-${c.id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a: any, b: any) => {
        // Sort by release date descending (most recent first)
        const dateA = (a.media_type === 'tv' ? a.first_air_date : a.release_date) || ''
        const dateB = (b.media_type === 'tv' ? b.first_air_date : b.release_date) || ''
        return dateB.localeCompare(dateA)
      })
      .map((c: any) => ({
        id: c.id,
        title: c.media_type === 'tv' ? (c.name || c.original_name) : (c.title || c.original_title),
        image: c.poster_path ? `${TMDB_IMAGE_BASE}/w500${c.poster_path}` : '',
        type: c.media_type === 'tv' ? 'TV Series' as const : 'Movie' as const,
        character: c.character || '',
        releaseDate: (c.media_type === 'tv' ? c.first_air_date : c.release_date) || '',
        rating: c.vote_average || 0,
      }))

    return {
      id: data.id,
      name: data.name,
      biography: data.biography || '',
      birthday: data.birthday || null,
      deathday: data.deathday || null,
      placeOfBirth: data.place_of_birth || null,
      profilePath: data.profile_path ? `${TMDB_IMAGE_BASE}/w500${data.profile_path}` : null,
      knownForDepartment: data.known_for_department || null,
      credits,
    }
  } catch (error) {
    console.error('[TMDB] Person info error:', error)
    return null
  }
}

// ===== Person search (for avatar selection) =====

export async function searchTmdbPerson(query: string): Promise<{
  id: number
  name: string
  profilePath: string | null
  knownFor: string[]
}[]> {
  try {
    const data = await tmdbFetch('/search/person', { query })
    if (!data?.results) return []
    return data.results.slice(0, 10).map((p: any) => ({
      id: p.id,
      name: p.name,
      profilePath: p.profile_path ? `${TMDB_IMAGE_BASE}/w185${p.profile_path}` : null,
      knownFor: (p.known_for || []).slice(0, 3).map((m: any) => m.title || m.name).filter(Boolean),
    }))
  } catch (error) {
    console.error('[TMDB] Person search error:', error)
    return []
  }
}

export function tmdbInfoToMediaFields(info: TmdbInfo, type: 'movie' | 'tv') {
  let year: number | null = null
  if (info.releaseDate) {
    const parsed = parseInt(info.releaseDate.substring(0, 4))
    if (!isNaN(parsed) && parsed >= 1900) year = parsed
  }

  const cast = info.cast?.slice(0, 10) || null

  let runtime: number | null = null
  if (info.duration) {
    const match = info.duration.match(/(\d+)/)
    if (match) runtime = parseInt(match[1])
  }

  return {
    tmdbId: info.id,
    title: info.title,
    overview: info.description || null,
    posterPath: info.image || null,
    backdropPath: info.cover || null,
    genres: info.genres || null,
    rating: info.rating || null,
    year,
    runtime,
    mediaType: type,
    cast: cast && cast.length > 0 ? cast : null,
    tagline: info.tagline || null,
    status: info.status || null,
    voteCount: info.voteCount || null,
    originalTitle: info.originalTitle || null,
    collectionId: info.collectionId || null,
    collectionName: info.collectionName || null,
  }
}
