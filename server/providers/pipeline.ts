import {
  TvType,
  IMovieResult,
  IMovieInfo,
  IEpisodeServer,
  StreamingServers,
  StreamingSource,
  ProviderMatch,
  MoviePipelineResult,
} from './types'
import { compareTwoStrings } from './utils'
import { FlixHQ, FrenchStream } from './movies'
import TMDB from './meta/tmdb'
import { MovieParser } from './base'

// ============================================================
//  Providers disponibles
// ============================================================

function createProviders(): { name: string; instance: MovieParser }[] {
  return [
    { name: 'FlixHQ', instance: new FlixHQ() },
    { name: 'FrenchStream', instance: new FrenchStream() },
  ]
}

// ============================================================
//  Helpers
// ============================================================

function bestMatches(query: string, results: IMovieResult[], type: TvType): IMovieResult[] {
  const normalizedQuery = query.toLowerCase().trim()
  // Dice coefficient threshold — reject anything too dissimilar
  // Short titles (< 8 chars) get a lower bar since Dice penalizes short strings
  const threshold = normalizedQuery.length < 8 ? 0.3 : 0.5

  function scoreResults(candidates: IMovieResult[]) {
    return candidates
      .map(r => {
        const title = typeof r.title === 'string' ? r.title : (r.title as any)?.english || ''
        const normalizedTitle = title.toLowerCase()
        let similarity = compareTwoStrings(normalizedQuery, normalizedTitle)
        // Bonus: if the query is contained exactly in the title, boost similarity
        if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
          similarity = Math.max(similarity, 0.6)
        }
        return { result: r, similarity }
      })
      .sort((a, b) => b.similarity - a.similarity)
      .filter(s => s.similarity > threshold)
      .map(s => s.result)
  }

  // Try matching type first
  const typeMatched = scoreResults(results.filter(r => r.type === type || !r.type))
  if (typeMatched.length > 0) return typeMatched

  // Fallback: providers often miscategorize content (e.g. series tagged as Movie)
  // Try all results regardless of type
  return scoreResults(results)
}

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

// ============================================================
//  Pipeline principale
// ============================================================

export interface PipelineOptions {
  season?: number
  episode?: number
  tmdbApiKey?: string
  releaseYear?: number
}

export async function moviePipeline(
  query: string,
  type: 'movie' | 'tv' = 'movie',
  options: PipelineOptions = {}
): Promise<MoviePipelineResult> {
  const startTime = Date.now()
  const tvType = type === 'movie' ? TvType.MOVIE : TvType.TVSERIES
  const errors: MoviePipelineResult['errors'] = []
  const providerTimings: Record<string, number> = {}

  const movieProviders = createProviders()

  // ----------------------------------------------------------
  //  1. TMDB : metadata riche (en parallele avec les autres)
  // ----------------------------------------------------------
  const tmdbPromise = (async () => {
    if (!options.tmdbApiKey) return null

    const tmdb = new TMDB(options.tmdbApiKey)
    const t0 = Date.now()
    try {
      const search = await tmdb.search(query)
      if (search.results.length === 0) return null

      const match = search.results.find(
        r => r.type === tvType
      ) || search.results[0]

      const info = await tmdb.fetchMediaInfo(
        String(match.id),
        type === 'movie' ? 'movie' : 'tv'
      )

      providerTimings['TMDB'] = Date.now() - t0
      return info
    } catch (err) {
      errors.push({ provider: 'TMDB', step: 'fetchMediaInfo', message: (err as Error).message })
      providerTimings['TMDB'] = Date.now() - t0
      return null
    }
  })()

  // ----------------------------------------------------------
  //  2. Tous les providers : search → info → servers → sources
  // ----------------------------------------------------------
  const providerPromises = movieProviders.map(async ({ name, instance }) => {
    const t0 = Date.now()
    const result: ProviderMatch = {
      provider: name,
      id: '',
      title: '',
      similarity: 0,
      info: null,
      servers: [],
      streams: [],
    }

    try {
      // 2a. Search — get all candidates sorted by similarity
      const searchResults = await instance.search(query)
      const candidates = bestMatches(query, searchResults.results, tvType)

      if (searchResults.results.length > 0 && candidates.length === 0) {
        console.log(`[Pipeline:${name}] Search for "${query}" returned ${searchResults.results.length} results but none matched (type=${tvType}):`,
          searchResults.results.slice(0, 5).map(r => `"${typeof r.title === 'string' ? r.title : (r.title as any)?.english || ''}" (type=${r.type})`).join(', '))
      }

      if (candidates.length === 0) {
        providerTimings[name] = Date.now() - t0
        return result
      }

      // 2b. Try candidates — validate by release year if available
      let match: IMovieResult | null = null
      let info: IMovieInfo | null = null
      let firstValidCandidate: { match: IMovieResult; info: IMovieInfo } | null = null

      for (const candidate of candidates) {
        const candidateInfo = await safeCall(
          () => instance.fetchMediaInfo(candidate.id),
          null as IMovieInfo | null
        )

        if (!candidateInfo || !candidateInfo.episodes || candidateInfo.episodes.length === 0) {
          continue
        }

        // Remember first valid candidate as fallback
        if (!firstValidCandidate) {
          firstValidCandidate = { match: candidate, info: candidateInfo }
        }

        // Check year match if we have a reference year
        if (options.releaseYear && candidateInfo.releaseDate) {
          const infoYear = parseInt(candidateInfo.releaseDate)
          if (!isNaN(infoYear) && Math.abs(infoYear - options.releaseYear) > 1) {
            // Year mismatch (allow ±1 year tolerance) — try next candidate
            console.log(`[Pipeline:${name}] Year mismatch for "${candidate.id}": expected ~${options.releaseYear}, got ${infoYear}, trying next`)
            continue
          }
        }

        // Good match (year matches or no year to compare)
        match = candidate
        info = candidateInfo
        break
      }

      // Fallback: if no year-matched candidate, use first with episodes
      if (!match && firstValidCandidate) {
        match = firstValidCandidate.match
        info = firstValidCandidate.info
      }

      if (!match || !info) {
        providerTimings[name] = Date.now() - t0
        return result
      }

      result.id = match.id
      result.title = typeof match.title === 'string' ? match.title : (match.title as any)?.english || ''
      result.similarity = compareTwoStrings(query.toLowerCase(), result.title.toLowerCase())
      result.info = info

      // 2c. Trouver le bon episode
      let episodeId: string
      if (type === 'tv' && options.season && options.episode) {
        const ep = info.episodes.find(
          e => e.season === options.season && (e.number === options.episode || e.episode === options.episode)
        )
        episodeId = ep?.id || info.episodes[0].id
      } else {
        episodeId = info.episodes[0].id
      }

      // 2d. Servers
      const servers = await safeCall(
        () => instance.fetchEpisodeServers(episodeId, match.id),
        [] as IEpisodeServer[]
      )
      result.servers = servers

      // 2e. Sources de TOUS les serveurs (en parallele)
      const streamPromises = servers.map(async (server) => {
        try {
          const source = await instance.fetchEpisodeSources(
            episodeId,
            match.id,
            server.name as StreamingServers
          )
          // Infer Referer from the server embed URL if provider didn't set headers
          // CDNs (Uqload, MixDrop, etc.) validate Referer to match the embed page origin
          let headers = source.headers
          if (!headers && server.url) {
            try {
              const serverOrigin = new URL(server.url).origin
              headers = { Referer: serverOrigin + '/' }
            } catch {}
          }

          return {
            provider: name,
            server: server.name,
            sources: source.sources.map(s => ({
              url: s.url,
              quality: s.quality,
              isM3U8: s.isM3U8,
              isDASH: s.isDASH,
            })),
            subtitles: source.subtitles || [],
            headers,
          } as StreamingSource
        } catch (err) {
          errors.push({
            provider: name,
            step: `fetchSources(${server.name})`,
            message: (err as Error).message,
          })
          return null
        }
      })

      const streams = (await Promise.all(streamPromises)).filter(Boolean) as StreamingSource[]
      result.streams = streams
    } catch (err) {
      errors.push({ provider: name, step: 'pipeline', message: (err as Error).message })
    }

    providerTimings[name] = Date.now() - t0
    return result
  })

  // ----------------------------------------------------------
  //  3. Attendre tout en parallele
  // ----------------------------------------------------------
  const [tmdbInfo, ...providerResults] = await Promise.all([tmdbPromise, ...providerPromises])

  // ----------------------------------------------------------
  //  4. Agréger le résultat final
  // ----------------------------------------------------------
  const allStreams: StreamingSource[] = []
  const allSubtitles: MoviePipelineResult['allSubtitles'] = []
  const seenSubUrls = new Set<string>()

  for (const p of providerResults) {
    // Skip providers with garbage matches (similarity too low)
    if (p.id && p.similarity < 0.4) {
      console.log(`[Pipeline] Dropping ${p.provider} — "${p.title}" sim=${p.similarity.toFixed(2)} too low`)
      continue
    }
    if (p.streams) {
      for (const stream of p.streams) {
        allStreams.push(stream)

        if (stream.subtitles) {
          for (const sub of stream.subtitles) {
            if (!seenSubUrls.has(sub.url)) {
              seenSubUrls.add(sub.url)
              allSubtitles.push({ url: sub.url, lang: sub.lang, source: stream.provider })
            }
          }
        }
      }
    }
  }

  // Construire le bloc TMDB
  let tmdbBlock: MoviePipelineResult['tmdb'] = null
  if (tmdbInfo) {
    tmdbBlock = {
      id: String(tmdbInfo.id),
      title: typeof tmdbInfo.title === 'string' ? tmdbInfo.title : undefined,
      description: tmdbInfo.description,
      releaseDate: tmdbInfo.releaseDate,
      rating: tmdbInfo.rating,
      duration: tmdbInfo.duration,
      genres: tmdbInfo.genres,
      directors: (tmdbInfo as any).directors,
      writers: (tmdbInfo as any).writers,
      actors: (tmdbInfo as any).actors,
      characters: (tmdbInfo as any).characters,
      production: tmdbInfo.production,
      country: (tmdbInfo as any).country,
      trailer: tmdbInfo.trailer,
      cover: tmdbInfo.cover,
      image: tmdbInfo.image,
      logos: (tmdbInfo as any).logos,
      mappings: (tmdbInfo as any).mappings,
      similar: (tmdbInfo as any).similar,
      recommendations: tmdbInfo.recommendations as any,
      translations: (tmdbInfo as any).translations,
      totalSeasons: (tmdbInfo as any).totalSeasons,
      totalEpisodes: tmdbInfo.totalEpisodes,
      nextAiringEpisode: (tmdbInfo as any).nextAiringEpisode,
      seasons: (tmdbInfo as any).seasons,
    }
  }

  return {
    query,
    type,
    tmdb: tmdbBlock,
    providers: providerResults.filter(p => p.id),
    allStreams,
    allSubtitles,
    errors,
    timing: {
      total: Date.now() - startTime,
      perProvider: providerTimings,
    },
  }
}
