import type {
  IMovieResult,
  IMovieInfo,
  IEpisodeServer,
  StreamingServers,
  StreamingSource,
  ProviderMatch,
  MoviePipelineResult} from './types'
import { TvType } from './types'
import { compareTwoStrings } from './utils'
import { FlixHQ, FrenchStream } from './movies'
import type { MovieParser } from './base'

function createProviders(): { name: string; instance: MovieParser }[] {
  return [
    { name: 'FlixHQ', instance: new FlixHQ() },
    { name: 'FrenchStream', instance: new FrenchStream() },
  ]
}

function bestMatches(query: string, results: IMovieResult[], type: TvType): IMovieResult[] {
  const normalizedQuery = query.toLowerCase().trim()
  const threshold = normalizedQuery.length < 8 ? 0.3 : 0.5

  function scoreResults(candidates: IMovieResult[]) {
    return candidates
      .map(r => {
        const title = typeof r.title === 'string' ? r.title : (r.title as any)?.english || ''
        const normalizedTitle = title.toLowerCase()
        let similarity = compareTwoStrings(normalizedQuery, normalizedTitle)
        if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
          similarity = Math.max(similarity, 0.6)
        }
        return { result: r, similarity }
      })
      .sort((a, b) => b.similarity - a.similarity)
      .filter(s => s.similarity > threshold)
      .map(s => s.result)
  }

  const typeMatched = scoreResults(results.filter(r => r.type === type || !r.type))
  if (typeMatched.length > 0) return typeMatched
  return scoreResults(results)
}

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch { return fallback }
}

export interface PipelineOptions {
  season?: number
  episode?: number
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

  const providerPromises = movieProviders.map(async ({ name, instance }) => {
    const t0 = Date.now()
    const result: ProviderMatch = {
      provider: name, id: '', title: '', similarity: 0, info: null, servers: [], streams: [],
    }

    try {
      const searchResults = await instance.search(query)
      const candidates = bestMatches(query, searchResults.results, tvType)

      if (searchResults.results.length > 0 && candidates.length === 0) {
        console.log(`[Pipeline:${name}] Search for "${query}" returned ${searchResults.results.length} results but none matched (type=${tvType}):`,
          searchResults.results.slice(0, 5).map(r => `"${typeof r.title === 'string' ? r.title : (r.title as any)?.english || ''}" (type=${r.type})`).join(', '))
      }

      if (candidates.length === 0) { providerTimings[name] = Date.now() - t0; return result }

      let match: IMovieResult | null = null
      let info: IMovieInfo | null = null
      let firstValidCandidate: { match: IMovieResult; info: IMovieInfo } | null = null

      for (const candidate of candidates) {
        const candidateInfo = await safeCall(() => instance.fetchMediaInfo(candidate.id), null as IMovieInfo | null)
        if (!candidateInfo?.episodes?.length) continue
        if (!firstValidCandidate) firstValidCandidate = { match: candidate, info: candidateInfo }

        if (options.releaseYear && candidateInfo.releaseDate) {
          const infoYear = parseInt(candidateInfo.releaseDate)
          if (!isNaN(infoYear) && Math.abs(infoYear - options.releaseYear) > 1) {
            console.log(`[Pipeline:${name}] Year mismatch for "${candidate.id}": expected ~${options.releaseYear}, got ${infoYear}, trying next`)
            continue
          }
        }

        match = candidate
        info = candidateInfo
        break
      }

      if (!match && firstValidCandidate) { match = firstValidCandidate.match; info = firstValidCandidate.info }
      if (!match || !info) { providerTimings[name] = Date.now() - t0; return result }

      result.id = match.id
      result.title = typeof match.title === 'string' ? match.title : (match.title as any)?.english || ''
      result.similarity = compareTwoStrings(query.toLowerCase(), result.title.toLowerCase())
      result.info = info

      let episodeId: string
      if (type === 'tv' && options.season && options.episode) {
        const ep = info.episodes.find(e => e.season === options.season && (e.number === options.episode || e.episode === options.episode))
        episodeId = ep?.id || info.episodes[0].id
      } else {
        episodeId = info.episodes[0].id
      }

      const servers = await safeCall(() => instance.fetchEpisodeServers(episodeId, match.id), [] as IEpisodeServer[])
      result.servers = servers

      const streamPromises = servers.map(async (server) => {
        try {
          const source = await instance.fetchEpisodeSources(episodeId, match.id, server.name as StreamingServers)
          let headers = source.headers
          if (!headers && server.url) {
            try { headers = { Referer: new URL(server.url).origin + '/' } } catch {}
          }
          return {
            provider: name, server: server.name,
            sources: source.sources.map(s => ({ url: s.url, quality: s.quality, isM3U8: s.isM3U8, isDASH: s.isDASH })),
            subtitles: source.subtitles || [], headers,
          } as StreamingSource
        } catch (err) {
          errors.push({ provider: name, step: `fetchSources(${server.name})`, message: (err as Error).message })
          return null
        }
      })

      result.streams = (await Promise.all(streamPromises)).filter(Boolean) as StreamingSource[]
    } catch (err) {
      errors.push({ provider: name, step: 'pipeline', message: (err as Error).message })
    }

    providerTimings[name] = Date.now() - t0
    return result
  })

  const providerResults = await Promise.all(providerPromises)

  const allStreams: StreamingSource[] = []
  const allSubtitles: MoviePipelineResult['allSubtitles'] = []
  const seenSubUrls = new Set<string>()

  for (const p of providerResults) {
    if (p.id && p.similarity < 0.4) {
      console.log(`[Pipeline] Dropping ${p.provider} — "${p.title}" sim=${p.similarity.toFixed(2)} too low`)
      continue
    }
    for (const stream of p.streams) {
      allStreams.push(stream)
      for (const sub of stream.subtitles || []) {
        if (!seenSubUrls.has(sub.url)) {
          seenSubUrls.add(sub.url)
          allSubtitles.push({ url: sub.url, lang: sub.lang, source: stream.provider })
        }
      }
    }
  }

  return {
    query, type,
    providers: providerResults.filter(p => p.id),
    allStreams, allSubtitles, errors,
    timing: { total: Date.now() - startTime, perProvider: providerTimings },
  }
}
