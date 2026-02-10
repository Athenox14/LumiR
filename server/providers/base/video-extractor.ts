import { IVideo, ISource } from '../types'
import Proxy from './proxy'

abstract class VideoExtractor extends Proxy {
  protected abstract serverName: string
  protected abstract sources: IVideo[]
  protected abstract extract(videoUrl: URL, ...args: any): Promise<IVideo[] | ISource>
}

export default VideoExtractor
