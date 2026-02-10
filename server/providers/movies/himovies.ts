import { load, CheerioAPI } from 'cheerio'

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
import { MegaCloud, VidCloud, VideoStr } from '../extractors'

class HiMovies extends MovieParser {
  override readonly name = 'HiMovies'
  protected override baseUrl = 'https://himovies.sx'
  protected override logo = 'https://himovies.sx/images/group_1/theme_1/favicon.png'
  protected override classPath = 'MOVIES.HiMovies'
  override supportedTypes = new Set([TvType.MOVIE, TvType.TVSERIES])

  private static readonly NAV_SELECTOR = 'div.pre-pagination > nav:nth-child(1) > ul:nth-child(1)'

  override search = async (query: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    try {
      const sanitizedQuery = query.replace(/[\W_]+/g, '-')
      const { data } = await this.client.get(`${this.baseUrl}/search/${sanitizedQuery}?page=${page}`)
      const $ = load(data)
      const searchResult: ISearch<IMovieResult> = { currentPage: page, hasNextPage: false, results: [] }
      searchResult.hasNextPage = $(HiMovies.NAV_SELECTOR).length > 0 && !$(HiMovies.NAV_SELECTOR).children().last().hasClass('active')

      $('.film_list-wrap > div.flw-item').each((_, el) => {
        const $el = $(el)
        const releaseDate = $el.find('div.film-detail > div.fd-infor > span:nth-child(1)').text()
        searchResult.results.push({
          id: $el.find('div.film-poster > a').attr('href')?.slice(1)!,
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
    const url = mediaId.startsWith(this.baseUrl) ? mediaId : `${this.baseUrl}/${mediaId}`
    try {
      const { data } = await this.client.get(url)
      const $ = load(data)
      const uid = $('.detail_page-watch').attr('data-id')!
      const extractedId = mediaId.split('sx/').pop()!
      const title = $('.heading-name > a:nth-child(1)').text()

      const movieInfo: IMovieInfo = {
        id: extractedId,
        title,
        url,
        cover: $('div.cover_follow').attr('style')?.slice(22).replace(')', '').replace(';', ''),
        image: $('.film-poster > img:nth-child(1)').attr('src'),
        description: $('.description').text().trim(),
        type: extractedId.includes('tv/') ? TvType.TVSERIES : TvType.MOVIE,
        releaseDate: $('div.row-line:contains(Released:)').text().replace('Released:', '').trim(),
        genres: $('div.row-line:contains(Genre:) a').map((_, el) => $(el).text().split('&')).get().map(v => v.trim()),
        casts: $('.row-line:contains(Casts:) a').map((_, el) => $(el).text()).get(),
        production: $('.row-line:contains(Production:) a').text().trim(),
        country: $('.row-line:contains(Country:) a').text().trim(),
        duration: $('.row-line:contains(Duration:)').text().replace('Duration:', '').replace(/\s+/g, ' ').trim(),
        rating: parseFloat($('.dp-i-stats > span.item:nth-child(3)').text().replace('IMDB:', '').trim()),
        recommendations: this.parseRecommendations($),
      }

      if (movieInfo.type === TvType.TVSERIES) {
        movieInfo.episodes = await this.fetchTvSeriesEpisodes(uid)
      } else {
        movieInfo.episodes = [{ id: uid, title, url: `${this.baseUrl}/ajax/episode/list/${uid}` }]
      }
      return movieInfo
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchEpisodeServers = async (episodeId: string, mediaId: string): Promise<IEpisodeServer[]> => {
    const isMovie = mediaId.includes('movie')
    const endpoint = !episodeId.startsWith(this.baseUrl + '/ajax') && !isMovie
      ? `${this.baseUrl}/ajax/episode/servers/${episodeId}`
      : `${this.baseUrl}/ajax/episode/list/${episodeId}`
    try {
      const { data } = await this.client.get(endpoint)
      const $ = load(data)
      const servers = $('ul.nav > li').map((_, el) => {
        const $el = $(el)
        const urlPattern = isMovie ? /\/movie\// : /\/tv\//
        const replacement = isMovie ? '/watch-movie/' : '/watch-tv/'
        const dataId = $el.find('a').attr('data-id')
        return {
          name: $el.find('a').attr('title')!.slice(6).toLowerCase().replace('server', '').trim(),
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
    server: StreamingServers = StreamingServers.MegaCloud
  ): Promise<ISource> => {
    if (episodeId.startsWith('http')) {
      return this.extractFromServer(episodeId, server)
    }
    try {
      const servers = await this.fetchEpisodeServers(episodeId, mediaId)
      const selectedServer = servers.find(s => s.name.toLowerCase() === server.toLowerCase())
      if (!selectedServer) throw new Error(`Server ${server} not found`)
      const { data } = await this.client.get(`${this.baseUrl}/ajax/episode/sources/${selectedServer.url.split('.').pop()}`)
      if (!data?.link) throw new Error('No link returned from episode source')
      const parsedUrl = new URL(data.link)
      if (parsedUrl.host === 'videostr.net' || parsedUrl.host === 'www.videostr.net') {
        server = StreamingServers.VideoStr
      }
      return await this.fetchEpisodeSources(data.link, mediaId, server)
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  private async fetchTvSeriesEpisodes(uid: string): Promise<any[]> {
    const ajaxUrl = (id: string, isSeason: boolean = false) =>
      `${this.baseUrl}/ajax/${isSeason ? 'season/episodes' : 'season/list'}/${id}`
    const { data } = await this.client.get(ajaxUrl(uid))
    const $ = load(data)
    const seasonIds = $('.dropdown-menu > a').map((_, el) => $(el).attr('data-id')).get()
    const episodes: any[] = []
    let seasonNumber = 1
    for (const seasonId of seasonIds) {
      const { data: seasonData } = await this.client.get(ajaxUrl(seasonId, true))
      const $$ = load(seasonData)
      $$('.nav > li').each((_, el) => {
        const $el = $$(el)
        const episodeId = $el.find('a').attr('id')!.split('-')[1]
        const titleAttr = $el.find('a').attr('title')!
        episodes.push({
          id: episodeId,
          title: titleAttr,
          number: parseInt(titleAttr.split(':')[0].slice(3).trim()),
          season: seasonNumber,
          url: `${this.baseUrl}/ajax/episode/servers/${episodeId}`,
        })
      })
      seasonNumber++
    }
    return episodes
  }

  private parseRecommendations($: CheerioAPI): IMovieResult[] {
    const recommendations: IMovieResult[] = []
    $('section.block_area > div.block_area-content > div.film_list-wrap > div.flw-item').each((_, el) => {
      const $el = $(el)
      recommendations.push({
        id: $el.find('div.film-poster > a').attr('href')?.slice(1)!,
        title: $el.find('div.film-detail > h3.film-name > a').text(),
        image: $el.find('div.film-poster > img').attr('data-src'),
        duration: $el.find('div.film-detail > div.fd-infor > span.fdi-duration').text().replace('m', '') || null,
        type: $el.find('div.film-detail > div.fd-infor > span.fdi-type').text() === 'TV' ? TvType.TVSERIES : TvType.MOVIE,
      })
    })
    return recommendations
  }

  private async extractFromServer(episodeUrl: string, server: StreamingServers): Promise<ISource> {
    const serverUrl = new URL(episodeUrl)
    switch (server) {
      case StreamingServers.UpCloud:
        return { headers: { Referer: serverUrl.href }, ...(await new VidCloud(this.proxyConfig, this.adapter).extract(serverUrl)) }
      case StreamingServers.MegaCloud:
        return { headers: { Referer: serverUrl.href }, ...(await new MegaCloud(this.proxyConfig, this.adapter).extract(serverUrl)) }
      case StreamingServers.VideoStr:
        return { headers: { Referer: serverUrl.href }, ...(await new VideoStr(this.proxyConfig, this.adapter).extract(serverUrl)) }
      default:
        return { headers: { Referer: serverUrl.href }, ...(await new MegaCloud(this.proxyConfig, this.adapter).extract(serverUrl)) }
    }
  }

  private parseMediaType(typeText: string): TvType {
    return typeText === 'Movie' ? TvType.MOVIE : TvType.TVSERIES
  }
}

export default HiMovies
