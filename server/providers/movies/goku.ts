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
import { MixDrop, VidCloud } from '../extractors'

class Goku extends MovieParser {
  override readonly name = 'Goku'
  protected override baseUrl = 'https://goku.sx'
  protected override logo = ''
  protected override classPath = 'MOVIES.Goku'
  override supportedTypes = new Set([TvType.MOVIE, TvType.TVSERIES])

  override search = async (query: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    try {
      const sanitizedQuery = query.replace(/[\W_]+/g, '-')
      const { data } = await this.client.get(`${this.baseUrl}/search?keyword=${sanitizedQuery}&page=${page}`)
      const $ = load(data)
      const searchResult: ISearch<IMovieResult> = {
        currentPage: page,
        hasNextPage: $('.page-link').length > 0 && $('.page-link').last().attr('title') === 'Last',
        results: [],
      }
      $('div.section-items > div.item').each((_, el) => {
        const $el = $(el)
        const releaseDate = $el.find('div.movie-info div.info-split > div:nth-child(1)').text()
        const rating = $el.find('div.movie-info div.info-split div.is-rated').text()
        const href = $el.find('.is-watch > a').attr('href')
        searchResult.results.push({
          id: href?.replace('/', '') ?? '',
          title: $el.find('div.movie-info h3.movie-name').text(),
          url: `${this.baseUrl}${href}`,
          image: $el.find('div.movie-thumbnail > a > img').attr('src'),
          releaseDate: isNaN(parseInt(releaseDate)) ? undefined : releaseDate,
          rating: isNaN(parseFloat(rating)) ? undefined : parseFloat(rating),
          type: href?.includes('watch-series') ? TvType.TVSERIES : TvType.MOVIE,
        })
      })
      return searchResult
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchMediaInfo = async (mediaId: string): Promise<IMovieInfo> => {
    const cleanId = mediaId.startsWith(this.baseUrl) ? mediaId.replace(this.baseUrl + '/', '') : mediaId
    try {
      const { data } = await this.client.get(`${this.baseUrl}/${cleanId}`)
      const $ = load(data)
      const mediaType: TvType = cleanId.includes('watch-series') ? TvType.TVSERIES : TvType.MOVIE
      const movieInfo: IMovieInfo = {
        id: cleanId,
        title: $('div.movie-detail > div.is-name > h3').text(),
        url: `${this.baseUrl}/${cleanId}`,
        image: $('.movie-thumbnail > img').attr('src'),
        description: $('.is-description > .text-cut').text(),
        type: mediaType,
        genres: $("div.name:contains('Genres:')").siblings().find('a').map((_, el) => $(el).text()).get(),
        casts: $("div.name:contains('Cast:')").siblings().find('a').map((_, el) => $(el).text()).get(),
        production: $("div.name:contains('Production:')").siblings().find('a').map((_, el) => $(el).text()).get().join(),
        duration: $("div.name:contains('Duration:')").siblings().text().split('\n').join('').trim(),
      }
      if (mediaType === TvType.TVSERIES) {
        movieInfo.episodes = await this.fetchTvSeriesEpisodes(cleanId)
      } else {
        movieInfo.episodes = []
        $('meta').each((_, el) => {
          const $el = $(el)
          if ($el.attr('property') === 'og:url') {
            movieInfo.episodes?.push({
              id: $el.attr('content')?.split('/').pop() ?? '',
              title: movieInfo.title.toString(),
              url: $el.attr('content'),
            })
          }
        })
      }
      return movieInfo
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  override fetchEpisodeServers = async (episodeId: string, mediaId: string): Promise<IEpisodeServer[]> => {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/ajax/movie/episode/servers/${episodeId}`)
      const $ = load(data)
      const servers = $('.dropdown-menu > a').map((_, el) => {
        const $el = $(el)
        return { name: $el.text(), id: $el.attr('data-id') ?? '' }
      }).get()
      const episodeServers: IEpisodeServer[] = []
      for (const server of servers) {
        const { data } = await this.client.get(`${this.baseUrl}/ajax/movie/episode/server/sources/${server.id}`)
        episodeServers.push({ name: server.name, url: data.data.link })
      }
      return episodeServers
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
      const selectedServer = servers.find(s => s.name.toLowerCase() === server.toLowerCase())
      if (!selectedServer) throw new Error(`Server ${server} not found`)
      return await this.fetchEpisodeSources(selectedServer.url, mediaId, server)
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  private async fetchTvSeriesEpisodes(mediaId: string): Promise<IMovieEpisode[]> {
    const { data } = await this.client.get(`${this.baseUrl}/ajax/movie/seasons/${mediaId.split('-').pop()}`)
    const $ = load(data)
    const seasonIds = $('.dropdown-menu > a').map((_, el) => {
      const $el = $(el)
      const seasonText = $el.text().replace('Season', '').trim()
      return { id: $el.attr('data-id'), season: isNaN(parseInt(seasonText)) ? undefined : parseInt(seasonText) }
    }).get()
    const episodes: IMovieEpisode[] = []
    for (const season of seasonIds) {
      const { data: seasonData } = await this.client.get(`${this.baseUrl}/ajax/movie/season/episodes/${season.id}`)
      const $$ = load(seasonData)
      $$('.item').each((_, el) => {
        const $$el = $$(el)
        const episodeText = $$el.find('a').text()?.split(':')[0].trim().substring(3) ?? ''
        episodes.push({
          id: $$el.find('a').attr('data-id') ?? '',
          title: $$el.find('a').attr('title') ?? '',
          number: parseInt(episodeText),
          season: season.season,
          url: $$el.find('a').attr('href'),
        })
      })
    }
    return episodes
  }
}

export default Goku
