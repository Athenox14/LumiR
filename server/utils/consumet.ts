import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'

// ===== Types =====

export interface MetaSearchResult {
  id: number
  title: string
  image: string
  type: string
  rating: number
  releaseDate: string
}

export interface MetaEpisode {
  id: string
  title: string
  episode: number
  season: number
  img?: { mobile?: string; hd?: string } | null
  description?: string
}

export interface MetaInfo {
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
  recommendations?: MetaSearchResult[]
  cast?: string[]
  production?: string[]
  episodes?: MetaEpisode[]
}

export interface StreamingSource {
  url: string
  quality: string
  isM3U8: boolean
}

export interface StreamingSubtitle {
  url: string
  lang: string
}

export interface StreamingResponse {
  headers?: Record<string, string>
  sources: StreamingSource[]
  subtitles: StreamingSubtitle[]
}

// ===== Helper: get base URL =====

export async function getConsumetBaseUrl(): Promise<string | null> {
  const [setting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'consumetBaseUrl'))
    .limit(1)

  const url = setting?.value as string | undefined
  if (!url) return null
  // Remove trailing slash
  return url.replace(/\/+$/, '')
}

// ===== Meta/TMDB - Metadata =====

export async function searchMeta(
  query: string,
  type: 'movie' | 'tv'
): Promise<MetaSearchResult[]> {
  const baseUrl = await getConsumetBaseUrl()
  if (!baseUrl) return []

  try {
    const url = `${baseUrl}/meta/tmdb/${encodeURIComponent(query)}?type=${type === 'tv' ? 'tv' : 'movie'}`
    console.log(`[Consumet] Search: "${query}" type=${type} → ${url}`)
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[Consumet] Search failed: ${res.status} ${res.statusText}`)
      return []
    }
    const data = await res.json()
    return data.results || []
  } catch (error) {
    console.error('[Consumet] Search error:', error)
    return []
  }
}

export async function getMetaInfo(
  tmdbId: number,
  type: 'movie' | 'tv'
): Promise<MetaInfo | null> {
  const baseUrl = await getConsumetBaseUrl()
  if (!baseUrl) return null

  try {
    const url = `${baseUrl}/meta/tmdb/info/${tmdbId}?type=${type === 'tv' ? 'tv' : 'movie'}`
    console.log(`[Consumet] Info: tmdbId=${tmdbId} type=${type} → ${url}`)
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[Consumet] Info failed: ${res.status} ${res.statusText}`)
      return null
    }
    return await res.json()
  } catch (error) {
    console.error('[Consumet] Info error:', error)
    return null
  }
}

export async function getMetaTrending(
  type: 'movie' | 'tv'
): Promise<MetaSearchResult[]> {
  const baseUrl = await getConsumetBaseUrl()
  if (!baseUrl) return []

  try {
    const url = `${baseUrl}/meta/tmdb/trending?type=${type === 'tv' ? 'tv' : 'movie'}`
    console.log(`[Consumet] Trending: type=${type} → ${url}`)
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[Consumet] Trending failed: ${res.status} ${res.statusText}`)
      return []
    }
    const data = await res.json()
    return data.results || []
  } catch (error) {
    console.error('[Consumet] Trending error:', error)
    return []
  }
}

// ===== Streaming =====

export async function getStreamingSources(
  episodeId: string,
  tmdbId: number
): Promise<StreamingResponse | null> {
  const baseUrl = await getConsumetBaseUrl()
  if (!baseUrl) return null

  try {
    const url = `${baseUrl}/meta/tmdb/watch/${encodeURIComponent(episodeId)}?id=${tmdbId}`
    console.log(`[Consumet] Streaming sources: episodeId=${episodeId} tmdbId=${tmdbId} → ${url}`)
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[Consumet] Streaming failed: ${res.status} ${res.statusText}`)
      return null
    }
    return await res.json()
  } catch (error) {
    console.error('[Consumet] Streaming error:', error)
    return null
  }
}

export async function getProviderSources(
  provider: string,
  episodeId: string,
  mediaId: string,
  server?: string
): Promise<StreamingResponse | null> {
  const baseUrl = await getConsumetBaseUrl()
  if (!baseUrl) return null

  try {
    let url = `${baseUrl}/movies/${provider}/watch?episodeId=${encodeURIComponent(episodeId)}&mediaId=${encodeURIComponent(mediaId)}`
    if (server) url += `&server=${encodeURIComponent(server)}`
    console.log(`[Consumet] Provider sources: ${provider} episodeId=${episodeId} → ${url}`)
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[Consumet] Provider streaming failed: ${res.status} ${res.statusText}`)
      return null
    }
    return await res.json()
  } catch (error) {
    console.error('[Consumet] Provider streaming error:', error)
    return null
  }
}

// ===== Multi-provider fallback =====

const FALLBACK_PROVIDERS = ['flixhq', 'goku', 'sflix', 'himovies'] as const
type FallbackProvider = typeof FALLBACK_PROVIDERS[number]

// Servers to try per provider (some servers use Cloudflare, others don't)
const PROVIDER_SERVERS: Record<FallbackProvider, string[]> = {
  flixhq: ['vidcloud', 'upcloud', 'mixdrop'],
  goku: [],    // default only
  sflix: [],   // default only
  himovies: [],// default only
}

export async function searchProvider(
  provider: FallbackProvider,
  query: string
): Promise<any[]> {
  const baseUrl = await getConsumetBaseUrl()
  if (!baseUrl) return []

  try {
    const url = `${baseUrl}/movies/${provider}/${encodeURIComponent(query)}`
    console.log(`[Consumet] Provider search: ${provider} "${query}" → ${url}`)
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return data.results || data || []
  } catch (error) {
    console.error(`[Consumet] Provider search error (${provider}):`, error)
    return []
  }
}

export async function getProviderInfo(
  provider: FallbackProvider,
  mediaId: string
): Promise<any | null> {
  const baseUrl = await getConsumetBaseUrl()
  if (!baseUrl) return null

  try {
    const url = `${baseUrl}/movies/${provider}/info?id=${encodeURIComponent(mediaId)}`
    console.log(`[Consumet] Provider info: ${provider} id=${mediaId} → ${url}`)
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json()
  } catch (error) {
    console.error(`[Consumet] Provider info error (${provider}):`, error)
    return null
  }
}

export async function watchProvider(
  provider: FallbackProvider,
  episodeId: string,
  mediaId: string,
  server?: string
): Promise<StreamingResponse | null> {
  const baseUrl = await getConsumetBaseUrl()
  if (!baseUrl) return null

  try {
    let url = `${baseUrl}/movies/${provider}/watch?episodeId=${encodeURIComponent(episodeId)}&mediaId=${encodeURIComponent(mediaId)}`
    if (server) url += `&server=${encodeURIComponent(server)}`
    console.log(`[Consumet] Provider watch: ${provider} episodeId=${episodeId} mediaId=${mediaId} → ${url}`)
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[Consumet] Provider watch failed (${provider}): ${res.status}`)
      return null
    }
    const data = await res.json()
    if (!data?.sources?.length) return null
    return data
  } catch (error) {
    console.error(`[Consumet] Provider watch error (${provider}):`, error)
    return null
  }
}

/** Score how well a result title matches the search title */
function titleSimilarity(resultTitle: string, searchTitle: string): number {
  const a = resultTitle.toLowerCase().trim()
  const b = searchTitle.toLowerCase().trim()
  if (a === b) return 100
  // Normalize: remove special chars for comparison
  const normalize = (s: string) => s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 95
  // One contains the other fully
  if (na.includes(nb)) return 80 + (nb.length / na.length) * 15
  if (nb.includes(na)) return 70 + (na.length / nb.length) * 15
  // Word overlap
  const wordsA = new Set(na.split(' '))
  const wordsB = new Set(nb.split(' '))
  const overlap = [...wordsA].filter(w => wordsB.has(w)).length
  const total = Math.max(wordsA.size, wordsB.size)
  return total > 0 ? (overlap / total) * 60 : 0
}

/** Pick the best matching result from provider search results */
function pickBestMatch(results: any[], searchTitle: string, type: 'movie' | 'tv'): any {
  const typeFilter = type === 'movie' ? 'Movie' : 'TV Series'
  let bestScore = -1
  let bestMatch = results[0]

  for (const r of results) {
    let score = titleSimilarity(r.title || '', searchTitle)
    // Bonus for matching type
    if (r.type === typeFilter) score += 5
    // Penalty for wrong type
    if (r.type && r.type !== typeFilter) score -= 10

    if (score > bestScore) {
      bestScore = score
      bestMatch = r
    }
  }

  console.log(`[Consumet] Best match: "${bestMatch?.title}" (score=${bestScore.toFixed(0)}) for "${searchTitle}"`)
  return bestMatch
}

/**
 * Try to find streaming sources across multiple providers.
 * 1. Try Meta/TMDB with known episodeId if provided
 * 2. Try Meta/TMDB by resolving episodeId from info
 * 3. Fallback to FlixHQ, Goku, SFlix, HiMovies (uses original/English title)
 */
export async function resolveStreamingSources(opts: {
  tmdbId: number
  title: string
  originalTitle?: string  // English title for provider search (providers use English titles)
  type: 'movie' | 'tv'
  metaEpisodeId?: string  // episodeId from Meta/TMDB info if known
  season?: number
  episode?: number
}): Promise<{ sources: StreamingResponse; provider: string } | null> {
  const { tmdbId, title, type, metaEpisodeId, season, episode } = opts
  // Providers (FlixHQ, Goku, etc.) use English titles
  const providerSearchTitle = opts.originalTitle || title

  // --- Step 1: Try Meta/TMDB with known episodeId ---
  if (metaEpisodeId) {
    console.log(`[Consumet] Trying Meta/TMDB with episodeId=${metaEpisodeId}`)
    const result = await getStreamingSources(metaEpisodeId, tmdbId)
    if (result?.sources?.length) {
      console.log(`[Consumet] ✓ Meta/TMDB succeeded with provided episodeId`)
      return { sources: result, provider: 'meta-tmdb' }
    }
  }

  // --- Step 2: Try Meta/TMDB by resolving episodeId from info ---
  if (!metaEpisodeId) {
    console.log(`[Consumet] Trying to resolve episodeId from Meta/TMDB info...`)
    const info = await getMetaInfo(tmdbId, type)
    if (info?.episodes?.length) {
      let epId: string | undefined
      if (type === 'tv' && season != null && episode != null) {
        const ep = info.episodes.find(
          e => e.season === season && e.episode === episode
        )
        epId = ep?.id
      } else {
        epId = info.episodes[0].id
      }

      if (epId) {
        const result = await getStreamingSources(epId, tmdbId)
        if (result?.sources?.length) {
          console.log(`[Consumet] ✓ Meta/TMDB succeeded with resolved episodeId=${epId}`)
          return { sources: result, provider: 'meta-tmdb' }
        }
      }
    }
  }

  // --- Step 3: Fallback to other providers (use English title) ---
  for (const provider of FALLBACK_PROVIDERS) {
    console.log(`[Consumet] Trying fallback provider: ${provider} with "${providerSearchTitle}"...`)
    try {
      // Search with English/original title
      const results = await searchProvider(provider, providerSearchTitle)
      if (!results.length) {
        console.log(`[Consumet] ${provider}: no search results`)
        continue
      }

      // Pick the best match by title similarity
      const match = pickBestMatch(results, providerSearchTitle, type)

      const mediaId = match.id
      if (!mediaId) continue

      // Get info to find episodes
      const info = await getProviderInfo(provider, mediaId)
      if (!info?.episodes?.length) {
        console.log(`[Consumet] ${provider}: no episodes in info`)
        continue
      }

      // Find the right episode
      let episodeId: string | undefined
      if (type === 'tv' && season != null && episode != null) {
        const ep = info.episodes.find(
          (e: any) => e.season === season && e.number === episode
        )
        episodeId = ep?.id
      } else {
        // For movies, the first (and usually only) episode is the movie
        episodeId = info.episodes[0].id
      }

      if (!episodeId) {
        console.log(`[Consumet] ${provider}: could not find matching episode`)
        continue
      }

      // Get streaming links - try multiple servers
      const servers = PROVIDER_SERVERS[provider]
      const serversToTry = servers.length > 0 ? servers : [undefined] // undefined = default server
      for (const server of serversToTry) {
        const streamResult = await watchProvider(provider, episodeId, mediaId, server)
        if (streamResult?.sources?.length) {
          console.log(`[Consumet] ✓ Fallback provider ${provider}${server ? ` (server: ${server})` : ''} succeeded!`)
          return { sources: streamResult, provider: server ? `${provider}:${server}` : provider }
        }
      }
    } catch (error) {
      console.error(`[Consumet] Fallback provider ${provider} error:`, error)
    }
  }

  console.log(`[Consumet] ✗ All providers failed for "${providerSearchTitle}" (tmdbId=${tmdbId})`)
  return null
}

// ===== Helper: convert Consumet MetaInfo to media fields =====

export function metaInfoToMediaFields(info: MetaInfo, type: 'movie' | 'tv') {
  // Extract year from releaseDate (format: "2024-01-15" or "2024")
  let year: number | null = null
  if (info.releaseDate) {
    const parsed = parseInt(info.releaseDate.substring(0, 4))
    if (!isNaN(parsed) && parsed >= 1900) year = parsed
  }

  // Convert cast from string[] to the format stored in DB
  const cast = info.cast?.slice(0, 10).map(name => ({
    name,
    character: '',
    profilePath: null as string | null,
  })) || null

  // Parse runtime from duration string like "120 min" or "45m"
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
    tagline: null,
    status: null,
    voteCount: null,
    originalTitle: null,
  }
}
