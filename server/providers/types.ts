// Types ported from FilmsAPI/consumet.ts - movie-relevant only

export interface IProviderStats {
  name: string
  baseUrl: string
  lang: string[] | string
  isNSFW: boolean
  logo: string
  classPath: string
  isWorking: boolean
}

export interface ITitle {
  romaji?: string
  english?: string
  native?: string
  userPreferred?: string
}

export interface ISearch<T> {
  currentPage?: number
  hasNextPage?: boolean
  totalPages?: number
  totalResults?: number
  results: T[]
}

export interface Trailer {
  id: string
  url?: string
  site?: string
  thumbnail?: string
  thumbnailHash?: string | null
}

export enum MediaFormat {
  TV = 'TV',
  TV_SHORT = 'TV_SHORT',
  MOVIE = 'MOVIE',
  SPECIAL = 'SPECIAL',
  OVA = 'OVA',
  ONA = 'ONA',
  MUSIC = 'MUSIC',
}

export enum MediaStatus {
  ONGOING = 'Ongoing',
  COMPLETED = 'Completed',
  HIATUS = 'Hiatus',
  CANCELLED = 'Cancelled',
  NOT_YET_AIRED = 'Not yet aired',
  UNKNOWN = 'Unknown',
}

export enum TvType {
  TVSERIES = 'TV Series',
  MOVIE = 'Movie',
  ANIME = 'Anime',
  PEOPLE = 'People',
}

export enum StreamingServers {
  VideoStr = 'videostr',
  AsianLoad = 'asianload',
  GogoCDN = 'gogocdn',
  StreamSB = 'streamsb',
  MixDrop = 'mixdrop',
  Mp4Upload = 'mp4upload',
  UpCloud = 'upcloud',
  VidCloud = 'vidcloud',
  StreamTape = 'streamtape',
  VizCloud = 'vizcloud',
  MyCloud = 'mycloud',
  Filemoon = 'filemoon',
  VidStreaming = 'vidstreaming',
  DuckStream = 'duckstream',
  BirdStream = 'birdstream',
  BuiltIn = 'builtin',
  SmashyStream = 'smashystream',
  StreamHub = 'streamhub',
  StreamWish = 'streamwish',
  VidHide = 'vidhide',
  VidMoly = 'vidmoly',
  Voe = 'voe',
  MegaUp = 'megaup',
  MegaCloud = 'megacloud',
  Luffy = 'luffy',
}

export interface IVideo {
  url: string
  quality?: string
  isM3U8?: boolean
  isDASH?: boolean
  size?: number
  [x: string]: unknown
}

export interface ISubtitle {
  id?: string
  url: string
  lang: string
}

export interface Intro {
  start: number
  end: number
}

export interface ISource {
  headers?: { [k: string]: string }
  intro?: Intro
  outro?: Intro
  subtitles?: ISubtitle[]
  sources: IVideo[]
  download?: string | { url?: string; quality?: string }[]
  embedURL?: string
}

export interface IEpisodeServer {
  name: string
  url: string
  [x: string]: unknown
}

export interface IMovieEpisode {
  id: string
  title: string
  url?: string
  number?: number
  season?: number
  description?: string
  image?: string
  releaseDate?: string
  [x: string]: unknown
}

export interface IMovieResult {
  id: string
  title: string | ITitle
  url?: string
  image?: string
  releaseDate?: string
  type?: TvType
  [x: string]: unknown
}

export interface IMovieInfo extends IMovieResult {
  cover?: string
  recommendations?: IMovieResult[]
  genres?: string[]
  description?: string
  rating?: number
  status?: MediaStatus
  duration?: string
  production?: string
  casts?: string[]
  tags?: string[]
  totalEpisodes?: number
  trailer?: Trailer
  seasons?: { season: number; image?: string; episodes: IMovieEpisode[] }[]
  episodes?: IMovieEpisode[]
}

export interface IPeopleResult {
  id: string
  name: string
  rating?: string
  image?: string
  movies: IMovieResult[]
  [x: string]: unknown
}

// Anime types needed for MovieParser compatibility
export interface IAnimeResult {
  id: string
  title: string | ITitle
  url?: string
  image?: string
  cover?: string
  status?: MediaStatus
  rating?: number
  type?: MediaFormat
  releaseDate?: string
  [x: string]: any
}

export interface IAnimeEpisode {
  id: string
  number: number
  title?: string
  description?: string
  url?: string
  image?: string
  releaseDate?: string
  [x: string]: unknown
}

export interface IAnimeInfo extends IAnimeResult {
  malId?: number | string
  genres?: string[]
  description?: string
  totalEpisodes?: number
  trailer?: Trailer
  episodes?: IAnimeEpisode[]
  recommendations?: IAnimeResult[]
}

export interface ProxyConfig {
  url: string | string[]
  key?: string
  rotateInterval?: number
}

// Pipeline-specific types

export interface StreamingSource {
  provider: string
  server: string
  sources: IVideo[]
  subtitles: ISubtitle[]
  headers?: { [k: string]: string }
}

export interface ProviderMatch {
  provider: string
  id: string
  title: string
  similarity: number
  info: IMovieInfo | null
  servers: IEpisodeServer[]
  streams: StreamingSource[]
}

export interface MoviePipelineResult {
  query: string
  type: 'movie' | 'tv'
  tmdb: any | null
  providers: ProviderMatch[]
  allStreams: StreamingSource[]
  allSubtitles: (ISubtitle & { source?: string })[]
  errors: { provider: string; step: string; message: string }[]
  timing: {
    total: number
    perProvider: Record<string, number>
  }
}
