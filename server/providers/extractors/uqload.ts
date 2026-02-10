import VideoExtractor from '../base/video-extractor'
import { IVideo } from '../types'

class Uqload extends VideoExtractor {
  protected override serverName = 'Uqload'
  protected override sources: IVideo[] = []

  override extract = async (videoUrl: URL): Promise<IVideo[]> => {
    try {
      const { data } = await this.client.get(videoUrl.href, {
        headers: { Referer: videoUrl.origin },
      })

      const match = /sources:\s*\["([^"]+)"\]/.exec(data)
      if (!match) throw new Error('No sources found in Uqload page')

      this.sources.push({
        url: match[1],
        isM3U8: match[1].includes('.m3u8'),
        quality: 'auto',
      })

      return this.sources
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }
}

export default Uqload
