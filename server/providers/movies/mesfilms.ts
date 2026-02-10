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
} from '../types'
import { Uqload, MixDrop, Voe, StreamSB } from '../extractors'

class MesFilms extends MovieParser {
  override readonly name = 'MesFilms'
  protected override baseUrl = 'https://mesfilms.lol'
  protected override logo = ''
  protected override classPath = 'MOVIES.MesFilms'
  protected override languages = 'fr'
  override supportedTypes = new Set([TvType.MOVIE])

  override search = async (query: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/?s=${encodeURIComponent(query)}`)
      const $ = load(data)

      const results: ISearch<IMovieResult> = {
        currentPage: page,
        hasNextPage: false,
        results: [],
      }

      $('div.search-page > div.result-item > article').each((_, el) => {
        const $el = $(el)
        const typeText = $el.find('> div.image > div.thumbnail > a > span').text().replace(/[\t\n]/g, '').trim()

        if (typeText.toUpperCase() !== 'FILM') return

        const link = $el.find('> div.details > div.title > a')
        const href = link.attr('href') ?? ''
        const title = link.text().trim()
        const image = $el.find('> div.image > div.thumbnail > a > img').attr('src') ?? ''

        if (!href || !title) return

        results.results.push({
          id: href.replace(this.baseUrl, '').replace(/^\//, ''),
          title,
          url: href,
          image,
          type: TvType.MOVIE,
        })
      })

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

      const title = $('div.sheader > div.data > h1').text().trim()
      const posterSrc = $('div.sheader > div.poster > img').attr('data-src') ?? ''
      const description = $('div.sheader > div.data > div.extra > span.tagline').first().text().trim()
      const genres = $('div.sheader > div.data > div.sgeneros > a').map((_, el) => $(el).text().trim()).get()
      const yearText = $('div.sheader > div.data > div.extra > span.date').text().trim()
      const releaseDate = yearText.length >= 4 ? yearText.slice(-4) : undefined

      let rating: number | undefined
      const ratingText =
        $('div.custom_fields > span.valor > b#repimdb > strong').text() ||
        $('div.custom_fields > span.valor > strong').text()
      if (ratingText) rating = parseFloat(ratingText)

      const postId = $('input[name=postID]').attr('value') ?? ''

      const players: { quality: string; server: string; flag: string; postId: string; index: string }[] = []

      $('ul#playeroptionsul > li').each((_, el) => {
        const $el = $(el)
        if ($el.attr('id') === 'player-option-trailer') return

        const quality = $el.find('span.title').text().trim()
        const server = $el.find('span.server').text().trim()
        const flagImg = $el.find('span.flag > img').attr('data-src') ?? ''
        const flag = flagImg.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
        const pId = $el.attr('data-post') ?? postId
        const index = $el.attr('data-nume') ?? ''

        players.push({ quality, server, flag, postId: pId, index })
      })

      const movieInfo: IMovieInfo = {
        id: mediaId,
        title,
        url,
        image: posterSrc,
        description,
        releaseDate,
        genres,
        rating,
        type: TvType.MOVIE,
        episodes: [
          {
            id: JSON.stringify({ url, postId, players }),
            title,
            url,
          },
        ],
      }

      return movieInfo
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchEpisodeServers = async (episodeId: string, mediaId?: string): Promise<IEpisodeServer[]> => {
    try {
      const episodeData = JSON.parse(episodeId)
      const servers: IEpisodeServer[] = []

      for (const player of episodeData.players) {
        try {
          const formData = new URLSearchParams()
          formData.append('action', 'doo_player_ajax')
          formData.append('post', player.postId)
          formData.append('nume', player.index)
          formData.append('type', 'movie')

          const { data } = await this.client.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, formData.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          })

          const embedUrl = data?.embed_url ?? ''
          if (!embedUrl) continue

          const playerUrl = embedUrl.startsWith('http') ? embedUrl : `https:${embedUrl}`
          const langLabel = player.flag ? ` (${player.flag})` : ''

          servers.push({
            name: `${player.server}${langLabel}`,
            url: playerUrl,
          })
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

        if (hostname.includes('uqload')) {
          return await new Uqload(this.proxyConfig, this.adapter).extract(serverUrl)
        } else if (hostname.includes('mixdrop')) {
          return await new MixDrop(this.proxyConfig, this.adapter).extract(serverUrl)
        } else if (hostname.includes('voe')) {
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

export default MesFilms
