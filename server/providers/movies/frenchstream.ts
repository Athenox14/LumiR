import axios from 'axios'
import { load } from 'cheerio'

import MovieParser from '../base/movie-parser'
import type {
  IMovieInfo,
  IEpisodeServer,
  StreamingServers,
  ISource,
  IMovieResult,
  ISearch} from '../types';
import {
  TvType,
} from '../types'
import { MixDrop, Voe, StreamSB, Uqload } from '../extractors'

interface FilmApiResponse {
  error?: boolean
  players?: Record<string, Record<string, string>>
  meta?: {
    affiche?: string
    affiche2?: string
    trailer?: string
    tagz?: string
  }
}

// Cache the resolved domain to avoid fetching fstream.net on every request
let cachedBaseUrl: string | null = null
let cacheTimestamp = 0
const CACHE_TTL = 1000 * 60 * 30 // 30 minutes

function invalidateDomainCache(): void {
  cachedBaseUrl = null
  cacheTimestamp = 0
}

async function resolveCurrentDomain(): Promise<string> {
  // Return cached URL if still valid
  if (cachedBaseUrl && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedBaseUrl
  }

  try {
    console.log('[FrenchStream] Resolving current domain from fstream.net...')
    const { data } = await axios.get('https://fstream.net', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    })
    const $ = load(data)
    // Parse the ephemeral URL from the page
    const href = $('a#mainUrl').attr('href') || $('a#accessBtn').attr('href')
    if (href) {
      const url = new URL(href)
      cachedBaseUrl = `${url.protocol}//${url.host}`
      cacheTimestamp = Date.now()
      console.log(`[FrenchStream] Resolved domain: ${cachedBaseUrl}`)
      return cachedBaseUrl
    }
  } catch (err) {
    console.error('[FrenchStream] Failed to resolve domain from fstream.net:', (err as Error).message)
  }

  // Fallback to hardcoded default
  return 'https://french-stream.pink'
}

class FrenchStream extends MovieParser {
  protected baseUrl = 'https://french-stream.pink'

  constructor() {
    super()
    this.client.defaults.headers.common['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    this.client.defaults.headers.common['Accept-Language'] = 'fr-FR,fr;q=0.9'
  }

  private async ensureDomain(): Promise<void> {
    // Always resolve from cache/fstream.net to stay up to date
    const resolved = await resolveCurrentDomain()
    if (resolved !== this.baseUrl) {
      console.log(`[FrenchStream] Switching domain: ${this.baseUrl} → ${resolved}`)
      this.baseUrl = resolved
    }
  }

  private mapQuality(text: string): string {
    const q = text.toUpperCase()
    if (q.includes('HDLIGHT')) return 'HD'
    if (q.includes('BDRIP')) return 'BluRay'
    if (q.includes('DVD')) return 'DVD'
    if (q.includes('CAM')) return 'Cam'
    return text
  }

  private versionLabel(version: string): string {
    switch (version) {
      case 'vostfr': return 'VOSTFR'
      case 'vfq': return 'FRENCH'
      case 'vff': return 'TRUEFRENCH'
      default: return version.toUpperCase()
    }
  }

  override search = async (query: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    await this.ensureDomain()
    const emptyResults: ISearch<IMovieResult> = { currentPage: page, hasNextPage: false, results: [] }
    let data: string
    try {
      const response = await this.client.get(
        `${this.baseUrl}/index.php?do=search&subaction=search&story=${encodeURIComponent(query)}`,
        {
          headers: { Referer: this.baseUrl + '/' },
          validateStatus: (status) => status < 500,
        }
      )
      if (response.status >= 400) {
        console.warn(`[FrenchStream] Search returned HTTP ${response.status} for "${query}" — skipping`)
        invalidateDomainCache()
        return emptyResults
      }
      data = response.data
    } catch (err) {
      console.warn(`[FrenchStream] Search request failed for "${query}": ${(err as Error).message}`)
      invalidateDomainCache()
      return emptyResults
    }
    try {
      const $ = load(data)

      const results: ISearch<IMovieResult> = {
        currentPage: page,
        hasNextPage: false,
        results: [],
      }

      $('div#dle-content > div.short').each((_, el) => {
        const $el = $(el)
        const posterEl = $el.find('a.short-poster')
        const href = posterEl.attr('href') ?? ''
        const imgSrc = posterEl.find('img').attr('src') ?? ''
        const title = $el.find('div.short-title').text().trim()
        const qualityText = $el.find('span.film-ripz > a').text().trim()
        const epsText = $el.find('span.mli-eps').text().trim()
        const isVf = $el.find('span.film-verz').text().toUpperCase().includes('VF')

        if (!href || !title) return

        const isSeries = epsText.toLowerCase().includes('eps')

        results.results.push({
          id: href.replace(this.baseUrl, '').replace(/^\//, ''),
          title,
          url: href.startsWith('http') ? href : `${this.baseUrl}${href}`,
          image: imgSrc.startsWith('http') ? imgSrc : `${this.baseUrl}${imgSrc}`,
          type: isSeries ? TvType.TVSERIES : TvType.MOVIE,
          quality: this.mapQuality(qualityText),
          dubStatus: isVf ? 'VF' : 'VOSTFR',
        })
      })

      return results
    } catch (err) {
      console.warn(`[FrenchStream] Failed to parse search results for "${query}": ${(err as Error).message}`)
      return emptyResults
    }
  }

  override fetchMediaInfo = async (mediaId: string): Promise<IMovieInfo> => {
    await this.ensureDomain()
    const url = mediaId.startsWith('http') ? mediaId : `${this.baseUrl}/${mediaId}`

    try {
      const { data } = await this.client.get(url)
      const $ = load(data)

      const filmData = $('div#film-data')
      const newsId = filmData.attr('data-newsid') ?? ''

      const rawTitle = $('h1#s-title').clone().children().remove().end().text().trim()
      const title = rawTitle || $('h1#s-title').text().replace(/\s*-\s*\d{4}\s*$/, '').trim()

      const posterSrc = filmData.attr('data-affiche')
        ?? $('div.fposter img, div.dvd-container img').attr('src')
        ?? ''
      const image = posterSrc.startsWith('http') ? posterSrc : `${this.baseUrl}${posterSrc}`

      const rawDesc = $('div#s-desc').text().trim()
      const description = rawDesc.replace(/^Résumé du film.*?inscription\s*/is, '').trim()

      const yearSpan = $('span.tag.release_date, span.release_date').text().trim()
      let yearMatch = /(\d{4})/.exec(yearSpan)
      if (!yearMatch) yearMatch = /ate de sortie:\s*(\d{4})/.exec($('ul.flist-col').text())
      const releaseDate = yearMatch ? yearMatch[1] : undefined

      let genres = $('span.genres > a').map((_, el) => $(el).text().trim()).get()
      if (genres.length === 0) {
        genres = $('ul.flist-col > li').eq(1).find('a').map((_, el) => $(el).text().trim()).get()
      }

      const duration = $('span.runtime').text().replace('-', '').trim() || undefined

      const ratingText = $('div.fr-count.fr-common div').first().text().trim()
      const ratingNum = parseFloat(ratingText)
      const rating = isNaN(ratingNum) ? undefined : ratingNum

      const trailerCode = filmData.attr('data-trailer')
        ?? $('button.action-see-more').attr('data-trailer')

      const tagz = filmData.attr('data-tagz') ?? ''
      const isSeries = tagz.startsWith('s-')

      const movieInfo: IMovieInfo = {
        id: mediaId,
        title,
        url,
        image,
        description,
        releaseDate,
        genres,
        type: isSeries ? TvType.TVSERIES : TvType.MOVIE,
        episodes: [],
        rating,
        duration,
        trailer: trailerCode
          ? { id: trailerCode, url: `https://www.youtube.com/watch?v=${trailerCode}` }
          : undefined,
      }

      if (!isSeries) {
        movieInfo.episodes = [
          {
            id: JSON.stringify({ url, newsId, isMovie: true }),
            title,
            url,
          },
        ]
      } else {
        movieInfo.episodes = [
          {
            id: JSON.stringify({ url, newsId, isSeries: true }),
            title,
            url,
          },
        ]
      }

      return movieInfo
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchEpisodeServers = async (episodeId: string, _mediaId?: string): Promise<IEpisodeServer[]> => {
    await this.ensureDomain()
    try {
      const epData = JSON.parse(episodeId)
      const servers: IEpisodeServer[] = []
      const { newsId } = epData

      if (!newsId) return servers

      const { data } = await this.client.get(
        `${this.baseUrl}/engine/ajax/film_api.php?id=${newsId}`,
        {
          headers: {
            Referer: epData.url || this.baseUrl,
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      )

      let api: FilmApiResponse
      if (typeof data === 'string') {
        try {
          api = JSON.parse(data)
        } catch {
          const jsonMatch = /^\s*(\{[\s\S]*\})\s*$/.exec(data)
          if (jsonMatch) {
            api = JSON.parse(jsonMatch[1])
          } else {
            return servers
          }
        }
      } else {
        api = data
      }

      if (api.error || !api.players) return servers

      const players = api.players
      const versions = ['default', 'vostfr', 'vfq', 'vff'] as const

      for (const [playerName, playerVersions] of Object.entries(players)) {
        if (playerName === 'premium') continue

        for (const version of versions) {
          const playerUrl = playerVersions[version]
          if (!playerUrl) continue

          let finalUrl: string

          if (playerName === 'netu') {
            finalUrl = `https://1.multiup.us/player/embed_player.php?vid=${playerUrl}&autoplay=no`
          } else {
            finalUrl = playerUrl.startsWith('http') ? playerUrl : `https://${playerUrl}`
          }

          const vLabel = version === 'default'
            ? ''
            : ` (${this.versionLabel(version)})`

          servers.push({
            name: `${playerName.charAt(0).toUpperCase() + playerName.slice(1)}${vLabel}`,
            url: finalUrl,
          })
        }
      }

      return servers
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchEpisodeSources = async (
    episodeId: string,
    mediaId?: string,
    server?: StreamingServers
  ): Promise<ISource> => {
    const allServers = await this.fetchEpisodeServers(episodeId, mediaId)

    // Filter to only the requested server if specified
    const serversToExtract = server
      ? allServers.filter(s => s.name === String(server))
      : allServers

    // Fallback to all servers if no match found
    if (serversToExtract.length === 0) {
      serversToExtract.push(...allServers)
    }

    const sources: ISource = {
      sources: [],
      subtitles: [],
    }

    // Set Referer header from the server embed URL (CDNs validate this)
    const firstServerUrl = serversToExtract[0]?.url
    if (firstServerUrl) {
      try {
        sources.headers = { Referer: new URL(firstServerUrl).origin + '/' }
      } catch {}
    }

    const extractPromises = serversToExtract.map(async (srv) => {
      try {
        const serverUrl = new URL(srv.url)
        const hostname = serverUrl.hostname.toLowerCase()
        const serverNameLower = srv.name.toLowerCase()

        if (hostname.includes('uqload') || serverNameLower.startsWith('uqload')) {
          return await new Uqload(this.proxyConfig, this.adapter).extract(serverUrl)
        } else if (hostname.includes('mixdrop') || serverNameLower.startsWith('mixdrop')) {
          return await new MixDrop(this.proxyConfig, this.adapter).extract(serverUrl)
        } else if (hostname.includes('voe') || serverNameLower.startsWith('voe')) {
          const result = await new Voe(this.proxyConfig, this.adapter).extract(serverUrl)
          if (Array.isArray(result)) return result
          if (result.subtitles) sources.subtitles?.push(...result.subtitles)
          return result.sources
        } else if (hostname.includes('streamsb') || hostname.includes('playersb') || serverNameLower.startsWith('streamsb')) {
          return await new StreamSB(this.proxyConfig, this.adapter).extract(serverUrl)
        }
        return []
      } catch {
        return []
      }
    })

    const results = await Promise.all(extractPromises)
    for (const videos of results) {
      if (Array.isArray(videos)) sources.sources.push(...videos)
    }

    return sources
  }
}

export default FrenchStream
