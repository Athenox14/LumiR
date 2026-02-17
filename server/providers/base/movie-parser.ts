import Proxy from './proxy'
import type { ISource, IEpisodeServer, IMovieInfo, ISearch, IMovieResult } from '../types'

abstract class MovieParser extends Proxy {
  protected abstract baseUrl: string
  abstract search(query: string, ...args: any[]): Promise<ISearch<IMovieResult>>
  abstract fetchMediaInfo(mediaId: string, type?: string): Promise<IMovieInfo>
  abstract fetchEpisodeSources(episodeId: string, ...args: any): Promise<ISource>
  abstract fetchEpisodeServers(episodeId: string, ...args: any): Promise<IEpisodeServer[]>
}

export default MovieParser
