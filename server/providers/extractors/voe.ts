import VideoExtractor from '../base/video-extractor'
import { IVideo, ISubtitle } from '../types'

class Voe extends VideoExtractor {
  protected override serverName = 'Voe'
  protected override sources: IVideo[] = []

  override extract = async (videoUrl: URL): Promise<{ sources: IVideo[]; subtitles: ISubtitle[] }> => {
    try {
      const apiUrl = 'https://crawlr.cc/3F7A1C9D8?url=' + encodeURIComponent(videoUrl.href)

      const { data } = await this.client.get(apiUrl)

      if (!data.sources || data.sources.length === 0) {
        throw new Error('No sources returned')
      }

      for (const src of data.sources) {
        this.sources.push({
          url: src.url,
          quality: src.quality ?? 'auto',
          isM3U8: src.url.includes('.m3u8'),
        })
      }

      const subtitles: ISubtitle[] =
        data.tracks?.map((t: any) => ({
          lang: t.label ?? 'Unknown',
          url: t.file,
        })) ?? []

      return { sources: this.sources, subtitles }
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }
}

export default Voe
