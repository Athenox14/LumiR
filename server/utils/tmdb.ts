import { MovieDb } from 'moviedb-promise'
import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'

const TMDB_IMAGE_BASE = '/api/images'

// ===== Types =====

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
  tagline?: string
  status?: string
  voteCount?: number
  originalTitle?: string
  collectionId?: number
  collectionName?: string
}

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

// ===== Client =====

let cachedClient: MovieDb | null = null
let cachedApiKey: string | null = null

async function getClient(): Promise<MovieDb> {
  const [setting] = await db.select().from(settings).where(eq(settings.key, 'tmdbApiKey')).limit(1)
  const key = (setting?.value as string)?.trim()
  if (!key) throw new Error('TMDB API key not configured')
  if (cachedClient && cachedApiKey === key) return cachedClient
  cachedClient = new MovieDb(key)
  cachedApiKey = key
  return cachedClient
}

function img(path: string | null | undefined, size: string): string {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : ''
}

// ===== Search =====

export async function searchTmdb(query: string, type: 'movie' | 'tv'): Promise<TmdbSearchResult[]> {
  try {
    const client = await getClient()
    const data = type === 'tv'
      ? await client.searchTv({ query, language: 'fr-FR' })
      : await client.searchMovie({ query, language: 'fr-FR' })
    if (!data?.results) return []
    return data.results.map((r: any) => ({
      id: r.id,
      title: type === 'tv' ? (r.name || r.original_name) : (r.title || r.original_title),
      image: img(r.poster_path, 'w500'),
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

export async function getTmdbTrending(type: 'movie' | 'tv'): Promise<TmdbSearchResult[]> {
  try {
    const client = await getClient()
    const data = await client.trending({ media_type: type, time_window: 'week', language: 'fr-FR' } as any)
    if (!data?.results) return []
    return data.results.map((r: any) => ({
      id: r.id,
      title: type === 'tv' ? (r.name || r.original_name) : (r.title || r.original_title),
      image: img(r.poster_path, 'w500'),
      type: type === 'tv' ? 'TV Series' : 'Movie',
      rating: r.vote_average || 0,
      releaseDate: (type === 'tv' ? r.first_air_date : r.release_date) || '',
    }))
  } catch (error) {
    console.error('[TMDB] Trending error:', error)
    return []
  }
}

// ===== Info =====

export async function getTmdbInfo(tmdbId: number, type: 'movie' | 'tv'): Promise<TmdbInfo | null> {
  try {
    const client = await getClient()
    const data: any = type === 'tv'
      ? await client.tvInfo({ id: tmdbId, append_to_response: 'credits,recommendations', language: 'fr-FR' })
      : await client.movieInfo({ id: tmdbId, append_to_response: 'credits,recommendations', language: 'fr-FR' })
    if (!data) return null

    const title = type === 'tv' ? (data.name || data.original_name) : (data.title || data.original_title)
    const releaseDate = type === 'tv' ? (data.first_air_date || '') : (data.release_date || '')

    const cast = data.credits?.cast?.slice(0, 15).map((c: any) => ({
      id: c.id, name: c.name, character: c.character || '',
      profilePath: c.profile_path ? img(c.profile_path, 'w185') : null,
    })) || []

    const recommendations: TmdbSearchResult[] = (data.recommendations?.results || []).slice(0, 12).map((r: any) => ({
      id: r.id,
      title: type === 'tv' ? (r.name || r.original_name) : (r.title || r.original_title),
      image: img(r.poster_path, 'w500'),
      type: type === 'tv' ? 'TV Series' : 'Movie',
      rating: r.vote_average || 0,
      releaseDate: (type === 'tv' ? r.first_air_date : r.release_date) || '',
    }))

    let duration: string | undefined
    if (type === 'movie' && data.runtime) duration = `${data.runtime} min`
    else if (type === 'tv' && data.episode_run_time?.length) duration = `${data.episode_run_time[0]} min`

    let episodes: TmdbEpisode[] | undefined
    if (type === 'tv' && data.number_of_seasons) {
      episodes = []
      for (let s = 1; s <= data.number_of_seasons; s++) {
        try {
          const season = await client.seasonInfo({ id: tmdbId, season_number: s, language: 'fr-FR' } as any)
          if (!season?.episodes) continue
          for (const ep of season.episodes as any[]) {
            episodes.push({
              id: `${tmdbId}:${s}:${ep.episode_number}`,
              title: ep.name || `Episode ${ep.episode_number}`,
              episode: ep.episode_number, season: s,
              img: ep.still_path ? { hd: img(ep.still_path, 'w500'), mobile: img(ep.still_path, 'w300') } : null,
              description: ep.overview || undefined,
            })
          }
        } catch { console.error(`[TMDB] Failed to fetch season ${s} for show ${tmdbId}`) }
      }
    }

    return {
      id: data.id, title, image: img(data.poster_path, 'w500'), cover: img(data.backdrop_path, 'original'),
      description: data.overview || '', genres: data.genres?.map((g: any) => g.name) || [],
      rating: data.vote_average || 0, releaseDate,
      totalEpisodes: data.number_of_episodes, totalSeasons: data.number_of_seasons,
      duration, type: type === 'tv' ? 'TV Series' : 'Movie',
      recommendations, cast, production: data.production_companies?.map((p: any) => p.name) || [],
      episodes, tagline: data.tagline || undefined, status: data.status || undefined,
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

// ===== Person =====

export async function getPersonInfo(personId: number): Promise<TmdbPersonInfo | null> {
  try {
    const client = await getClient()
    const data: any = await client.personInfo({ id: personId, append_to_response: 'combined_credits', language: 'fr-FR' })
    if (!data) return null

    const seen = new Set<string>()
    const credits = (data.combined_credits?.cast || [])
      .filter((c: any) => { const k = `${c.media_type}-${c.id}`; if (seen.has(k)) return false; seen.add(k); return true })
      .sort((a: any, b: any) => {
        const dA = (a.media_type === 'tv' ? a.first_air_date : a.release_date) || ''
        const dB = (b.media_type === 'tv' ? b.first_air_date : b.release_date) || ''
        return dB.localeCompare(dA)
      })
      .map((c: any) => ({
        id: c.id,
        title: c.media_type === 'tv' ? (c.name || c.original_name) : (c.title || c.original_title),
        image: img(c.poster_path, 'w500'),
        type: c.media_type === 'tv' ? 'TV Series' as const : 'Movie' as const,
        character: c.character || '', releaseDate: (c.media_type === 'tv' ? c.first_air_date : c.release_date) || '',
        rating: c.vote_average || 0,
      }))

    return {
      id: data.id, name: data.name, biography: data.biography || '',
      birthday: data.birthday || null, deathday: data.deathday || null,
      placeOfBirth: data.place_of_birth || null,
      profilePath: data.profile_path ? img(data.profile_path, 'w500') : null,
      knownForDepartment: data.known_for_department || null, credits,
    }
  } catch (error) {
    console.error('[TMDB] Person info error:', error)
    return null
  }
}

// ===== Person search =====

export async function searchTmdbPerson(query: string): Promise<{
  id: number; name: string; profilePath: string | null; knownFor: string[]
}[]> {
  try {
    const client = await getClient()
    const data = await client.searchPerson({ query, language: 'fr-FR' })
    if (!data?.results) return []
    return (data.results as any[]).slice(0, 10).map((p) => ({
      id: p.id, name: p.name,
      profilePath: p.profile_path ? img(p.profile_path, 'w185') : null,
      knownFor: (p.known_for || []).slice(0, 3).map((m: any) => m.title || m.name).filter(Boolean),
    }))
  } catch (error) {
    console.error('[TMDB] Person search error:', error)
    return []
  }
}

// ===== Converter =====

export function tmdbInfoToMediaFields(info: TmdbInfo, type: 'movie' | 'tv') {
  let year: number | null = null
  if (info.releaseDate) {
    const parsed = parseInt(info.releaseDate.substring(0, 4))
    if (!isNaN(parsed) && parsed >= 1900) year = parsed
  }

  let runtime: number | null = null
  if (info.duration) {
    const match = info.duration.match(/(\d+)/)
    if (match) runtime = parseInt(match[1])
  }

  return {
    tmdbId: info.id, title: info.title, overview: info.description || null,
    posterPath: info.image || null, backdropPath: info.cover || null,
    genres: info.genres || null, rating: info.rating || null, year, runtime,
    mediaType: type, cast: info.cast?.slice(0, 10) || null,
    tagline: info.tagline || null, status: info.status || null, voteCount: info.voteCount || null,
    originalTitle: info.originalTitle || null,
    collectionId: info.collectionId || null, collectionName: info.collectionName || null,
  }
}
