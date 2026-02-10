import { load } from 'cheerio'

import MovieParser from '../base/movie-parser'
import {
  TvType,
  IMovieInfo,
  IEpisodeServer,
  StreamingServers,
  ISource,
  IMovieResult,
  ISearch,
  IMovieEpisode,
} from '../types'
import { Voe, StreamSB } from '../extractors'

interface EmpireSearchResponse {
  status?: boolean
  data?: {
    films: EmpireMedia[]
    series: EmpireMedia[]
  }
}

interface EmpireMedia {
  id?: number
  title?: string
  versions?: string[]
  description?: string
  label?: string
  sym_image?: { poster?: string; backdrop?: string }
  note?: number
  path?: string
  trailer?: string
  urlPath?: string
}

interface EmpireVideo {
  id?: number
  code?: string
  property?: string
  version?: string
  title?: string
}

interface EmpireEpisodeInfo {
  id?: number
  versions?: string[]
  title?: string
  description?: string
  episode?: number
  saison?: number
  sym_image?: string
  video?: EmpireVideo[]
  image?: { path?: string; property?: string; size?: string }[]
}

interface EmpireMovieJson {
  Iframe?: EmpireVideo[]
  Distribution?: { id?: number; name?: string; image?: { path?: string }[] }[]
}

class EmpireStreaming extends MovieParser {
  override readonly name = 'EmpireStreaming'
  protected override baseUrl = 'https://empire-streaming.app'
  protected override logo = ''
  protected override classPath = 'MOVIES.EmpireStreaming'
  protected override languages = 'fr'
  override supportedTypes = new Set([TvType.MOVIE, TvType.TVSERIES])

  private findVideoLink(property?: string, code?: string): string {
    switch (property) {
      case 'voe':
        return `https://voe.sx/e/${code}`
      case 'streamsb':
        return `https://playersb.com/e/${code}`
      case 'doodstream':
        return `https://dood.pm/e/${code}`
      default:
        return code ?? ''
    }
  }

  override search = async (query: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    try {
      const { data } = await this.client.post(
        `${this.baseUrl}/api/views/search`,
        { search: query },
        { headers: { 'Content-Type': 'application/json' } }
      )

      const json = data as EmpireSearchResponse

      const results: ISearch<IMovieResult> = {
        currentPage: page,
        hasNextPage: false,
        results: [],
      }

      if (json.data?.series) {
        for (const item of json.data.series) {
          if (!item.title || !item.urlPath) continue
          const posterPath = item.sym_image?.poster ?? ''

          results.results.push({
            id: item.urlPath.replace(/^\//, ''),
            title: item.title,
            url: `${this.baseUrl}${item.urlPath}`,
            image: posterPath ? `${this.baseUrl}/images/medias${posterPath}` : '',
            type: TvType.TVSERIES,
            dubStatus: item.versions?.some(v => v.includes('vf')) ? 'VF' : 'VOSTFR',
          })
        }
      }

      if (json.data?.films) {
        for (const item of json.data.films) {
          if (!item.title || !item.urlPath) continue
          const posterPath = item.sym_image?.poster ?? ''

          results.results.push({
            id: item.urlPath.replace(/^\//, ''),
            title: item.title,
            url: `${this.baseUrl}${item.urlPath}`,
            image: posterPath ? `${this.baseUrl}/images/medias${posterPath}` : '',
            type: TvType.MOVIE,
            dubStatus: item.versions?.some(v => v.includes('vf')) ? 'VF' : 'VOSTFR',
          })
        }
      }

      return results
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchMediaInfo = async (mediaId: string): Promise<IMovieInfo> => {
    const url = mediaId.startsWith('http') ? mediaId : `${this.baseUrl}/${mediaId}`

    try {
      const { data } = await this.client.get(url)
      const $ = load(data)
      const htmlText = typeof data === 'string' ? data : ''

      const title = $('h1.fs-40.c-w.ff-bb.tt-u.mb-0.ta-md-c.fs-md-30.mb-2').text().trim()
        || $('h1').first().text().trim()
      const posterSrc = $('picture > img').attr('data-src') ?? ''
      const image = posterSrc ? `${this.baseUrl}${posterSrc}` : ''
      const description = $('p.description').text().trim()
      const yearText = $('span.c-w.ff-cond.ml-2.ml-md-0.mt-md-1').text().trim()
      const releaseDate = yearText.match(/\d{4}/)?.[0]
      const genres = $('ul.d-f.f-w.ls-n.mb-2.jc-md-c > li').map((_, el) => $(el).text().trim()).get()
      const trailerCode = $('button.action-see-more').attr('data-trailer')

      const isSeries = $('article > div > span.ff-fb').text().toLowerCase().includes('serie')

      const jsonMatch = /result\s+=([\s\S]*?\}\]\})\s*;/.exec(htmlText)

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
        trailer: trailerCode ? { id: trailerCode, url: `https://www.youtube.com/watch?v=${trailerCode}` } : undefined,
      }

      if (jsonMatch) {
        const jsonText = jsonMatch[1]

        if (isSeries) {
          const seasonMatches = /(\[\{"id".*?\}\]\}\])/g
          let seasonMatch
          while ((seasonMatch = seasonMatches.exec(jsonText)) !== null) {
            const episodeRegex = /(\{"id".*?\}\]\})/g
            let epMatch
            while ((epMatch = episodeRegex.exec(seasonMatch[1])) !== null) {
              try {
                const epInfo = JSON.parse(epMatch[1]) as EmpireEpisodeInfo
                if (!epInfo.video) continue

                for (const vid of epInfo.video) {
                  const videoUrl = this.findVideoLink(vid.property, vid.code)
                  const dubLabel = vid.version === 'vf' ? 'VF' : 'VOSTFR'

                  movieInfo.episodes!.push({
                    id: JSON.stringify({
                      videoUrls: [videoUrl],
                      dub: dubLabel,
                    }),
                    title: `${epInfo.title ?? `Episode ${epInfo.episode}`} (${dubLabel})`,
                    number: epInfo.episode,
                    season: epInfo.saison,
                    description: epInfo.description,
                    image: epInfo.sym_image ? `${this.baseUrl}/images/episodes${epInfo.sym_image}` : undefined,
                    url,
                  })
                }
              } catch {
                continue
              }
            }
          }
        } else {
          try {
            const movieJson = JSON.parse(jsonText) as EmpireMovieJson
            if (movieJson.Iframe) {
              const vfUrls: string[] = []
              const vostfrUrls: string[] = []

              for (const vid of movieJson.Iframe) {
                const videoUrl = this.findVideoLink(vid.property, vid.code)
                if (vid.version === 'vf') {
                  vfUrls.push(videoUrl)
                } else {
                  vostfrUrls.push(videoUrl)
                }
              }

              const episodes: IMovieEpisode[] = []
              if (vfUrls.length > 0) {
                episodes.push({
                  id: JSON.stringify({ videoUrls: vfUrls, dub: 'VF', isMovie: true }),
                  title: `${title} (VF)`,
                  url,
                })
              }
              if (vostfrUrls.length > 0) {
                episodes.push({
                  id: JSON.stringify({ videoUrls: vostfrUrls, dub: 'VOSTFR', isMovie: true }),
                  title: `${title} (VOSTFR)`,
                  url,
                })
              }
              if (episodes.length === 0) {
                const allUrls = [...vfUrls, ...vostfrUrls]
                episodes.push({
                  id: JSON.stringify({ videoUrls: allUrls, isMovie: true }),
                  title,
                  url,
                })
              }
              movieInfo.episodes = episodes
            }
          } catch {
            // JSON parse failed
          }
        }
      }

      if (movieInfo.episodes!.length === 0) {
        movieInfo.episodes = [
          {
            id: JSON.stringify({ url, isMovie: true, videoUrls: [] }),
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

  override fetchEpisodeServers = async (episodeId: string, mediaId?: string): Promise<IEpisodeServer[]> => {
    try {
      const epData = JSON.parse(episodeId)
      const servers: IEpisodeServer[] = []

      const videoUrls: string[] = epData.videoUrls ?? []
      const dub = epData.dub ?? ''

      for (const videoUrl of videoUrls) {
        if (!videoUrl) continue
        try {
          const hostname = new URL(videoUrl).hostname
          const dubLabel = dub ? ` (${dub})` : ''
          servers.push({ name: `${hostname}${dubLabel}`, url: videoUrl })
        } catch {
          continue
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
    if (serversToExtract.length === 0) serversToExtract.push(...allServers)

    const sources: ISource = {
      sources: [],
      subtitles: [],
    }

    // Set Referer header from the server embed URL (CDNs validate this)
    const firstUrl = serversToExtract[0]?.url
    if (firstUrl) {
      try { sources.headers = { Referer: new URL(firstUrl).origin + '/' } } catch {}
    }

    const extractPromises = serversToExtract.map(async (srv) => {
      try {
        const serverUrl = new URL(srv.url)
        const hostname = serverUrl.hostname.toLowerCase()

        if (hostname.includes('voe')) {
          const result = await new Voe(this.proxyConfig, this.adapter).extract(serverUrl)
          if (Array.isArray(result)) return result
          if (result.subtitles) sources.subtitles?.push(...result.subtitles)
          return result.sources
        } else if (hostname.includes('streamsb') || hostname.includes('playersb')) {
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

export default EmpireStreaming
