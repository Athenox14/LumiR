import { load } from 'cheerio'

import MovieParser from '../base/movie-parser'
import type {
  IMovieInfo,
  IEpisodeServer,
  ISource,
  IMovieResult,
  ISearch} from '../types';
import {
  TvType,
  StreamingServers
} from '../types'
import { MixDrop, VidCloud } from '../extractors'

class FlixHQ extends MovieParser {
  override readonly name = 'FlixHQ'
  protected override baseUrl = 'https://flixhq.to'
  protected override logo = ''
  protected override classPath = 'MOVIES.FlixHQ'
  override supportedTypes = new Set([TvType.MOVIE, TvType.TVSERIES])

  private static readonly NAV_SELECTOR = 'div.pre-pagination:nth-child(3) > nav:nth-child(1) > ul:nth-child(1)'

  override search = async (query: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    try {
      const sanitizedQuery = query.replace(/[\W_]+/g, '-')
      const { data } = await this.client.get(`${this.baseUrl}/search/${sanitizedQuery}?page=${page}`)
      const $ = load(data)
      const searchResult: ISearch<IMovieResult> = { currentPage: page, hasNextPage: false, results: [] }
      searchResult.hasNextPage = $(FlixHQ.NAV_SELECTOR).length > 0 && !$(FlixHQ.NAV_SELECTOR).children().last().hasClass('active')

      $('.film_list-wrap > div.flw-item').each((_, el) => {
        const $el = $(el)
        const releaseDate = $el.find('div.film-detail > div.fd-infor > span:nth-child(1)').text()
        searchResult.results.push({
          id: $el.find('div.film-poster > a').attr('href')?.slice(1) ?? '',
          title: $el.find('div.film-detail > h2 > a').attr('title')!,
          url: `${this.baseUrl}${$el.find('div.film-poster > a').attr('href')}`,
          image: $el.find('div.film-poster > img').attr('data-src'),
          releaseDate: isNaN(parseInt(releaseDate)) ? undefined : releaseDate,
          seasons: releaseDate.includes('SS') ? parseInt(releaseDate.split('SS')[1]) : undefined,
          type: this.parseMediaType($el.find('div.film-detail > div.fd-infor > span.float-right').text()),
        })
      })
      return searchResult
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchMediaInfo = async (mediaId: string): Promise<IMovieInfo> => {
    if (!mediaId.startsWith(this.baseUrl)) mediaId = `${this.baseUrl}/${mediaId}`
    const movieInfo: IMovieInfo = { id: mediaId.split('to/').pop()!, title: '', url: mediaId }
    try {
      const { data } = await this.client.get(mediaId)
      const $ = load(data)

      const uid = $('.watch_block').attr('data-id')!
      movieInfo.cover = $('div.w_b-cover').attr('style')?.slice(22).replace(')', '').replace(';', '')
      movieInfo.title = $('.heading-name > a:nth-child(1)').text()
      movieInfo.image = $('.m_i-d-poster > div:nth-child(1) > img:nth-child(1)').attr('src')
      movieInfo.description = $('.description').text()
      movieInfo.type = movieInfo.id.split('/')[0] === 'tv' ? TvType.TVSERIES : TvType.MOVIE
      movieInfo.releaseDate = $('div.row-line:nth-child(3)').text().replace('Released: ', '').trim()
      movieInfo.genres = $('div.row-line:nth-child(2) > a').map((_, el) => $(el).text().split('&')).get().map(v => v.trim())
      movieInfo.casts = $('div.row-line:nth-child(5) > a').map((_, el) => $(el).text()).get()
      movieInfo.production = $('div.row-line:nth-child(4) > a:nth-child(2)').text()
      movieInfo.duration = $('span.item:nth-child(3)').text()
      movieInfo.rating = parseFloat($('span.item:nth-child(2)').text())

      const ajaxReqUrl = (id: string, type: string, isSeasons: boolean = false) =>
        `${this.baseUrl}/ajax/${type === 'movie' ? type : `v2/${type}`}/${isSeasons ? 'seasons' : 'episodes'}/${id}`

      if (movieInfo.type === TvType.TVSERIES) {
        const { data } = await this.client.get(ajaxReqUrl(uid, 'tv', true))
        const $$ = load(data)
        const seasonsIds = $$('.dropdown-menu > a').map((_, el) => $(el).attr('data-id')).get()
        movieInfo.episodes = []
        let season = 1
        for (const id of seasonsIds) {
          const { data } = await this.client.get(ajaxReqUrl(id, 'season'))
          const $$$ = load(data)
          $$$('.nav > li').map((_, el) => {
            const episode = {
              id: $$$(el).find('a').attr('id')!.split('-')[1],
              title: $$$(el).find('a').attr('title')!,
              number: parseInt($$$(el).find('a').attr('title')!.split(':')[0].slice(3).trim()),
              season: season,
              url: `${this.baseUrl}/ajax/v2/episode/servers/${$$$(el).find('a').attr('id')!.split('-')[1]}`,
            }
            movieInfo.episodes?.push(episode)
          }).get()
          season++
        }
      } else {
        movieInfo.episodes = [{ id: uid, title: movieInfo.title, url: `${this.baseUrl}/ajax/movie/episodes/${uid}` }]
      }
      return movieInfo
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchEpisodeServers = async (episodeId: string, mediaId: string): Promise<IEpisodeServer[]> => {
    const isMovie = mediaId.includes('movie')
    const serverUrl = isMovie
      ? `${this.baseUrl}/ajax/movie/episodes/${episodeId}`
      : episodeId.startsWith(this.baseUrl + '/ajax')
      ? episodeId
      : `${this.baseUrl}/ajax/v2/episode/servers/${episodeId}`
    try {
      const { data } = await this.client.get(serverUrl)
      const $ = load(data)
      const servers = $('.nav > li').map((_, el) => {
        const $el = $(el)
        const title = $el.find('a').attr('title')!
        const dataId = isMovie ? $el.find('a').attr('data-linkid') : $el.find('a').attr('data-id')
        const urlPattern = isMovie ? /\/movie\// : /\/tv\//
        const replacement = isMovie ? '/watch-movie/' : '/watch-tv/'
        return {
          name: isMovie ? title.toLowerCase() : title.slice(6).trim().toLowerCase(),
          url: `${this.baseUrl}/${mediaId}.${dataId}`.replace(urlPattern, replacement),
          id: dataId,
        }
      }).get()
      return servers
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchEpisodeSources = async (
    episodeId: string,
    mediaId: string,
    server: StreamingServers = StreamingServers.UpCloud
  ): Promise<ISource> => {
    if (episodeId.startsWith('http')) {
      const serverUrl = new URL(episodeId)
      switch (server) {
        case StreamingServers.MixDrop:
          return { headers: { Referer: serverUrl.href }, sources: await new MixDrop(this.proxyConfig, this.adapter).extract(serverUrl) }
        case StreamingServers.VidCloud:
        case StreamingServers.UpCloud:
          return { headers: { Referer: serverUrl.href }, ...(await new VidCloud(this.proxyConfig, this.adapter).extract(serverUrl)) }
        default:
          return { headers: { Referer: serverUrl.href }, sources: await new MixDrop(this.proxyConfig, this.adapter).extract(serverUrl) }
      }
    }
    try {
      const servers = await this.fetchEpisodeServers(episodeId, mediaId)
      const i = servers.findIndex(s => s.name === server)
      if (i === -1) throw new Error(`Server ${server} not found`)
      const { data } = await this.client.get(`${this.baseUrl}/ajax/episode/sources/${servers[i].url.split('.').slice(-1).shift()}`)
      const serverUrl: URL = new URL(data.link)
      return await this.fetchEpisodeSources(serverUrl.href, mediaId, server)
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  private parseMediaType(typeText: string): TvType {
    return typeText === 'Movie' ? TvType.MOVIE : TvType.TVSERIES
  }
}

export default FlixHQ
