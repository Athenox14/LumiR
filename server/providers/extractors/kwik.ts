import VideoExtractor from '../base/video-extractor'
import type { IVideo } from '../types'
import { safeUnpack } from '../utils'

class Kwik extends VideoExtractor {
  protected override serverName = 'kwik'
  protected override sources: IVideo[] = []

  private readonly baseUrl = 'https://animepahe.si/'
  private readonly safelinkBaseUrl = 'https://pahe.win/'

  override extract = async (videoUrl: URL): Promise<IVideo[]> => {
    try {
      const response = await fetch(`${videoUrl.href}`, {
        headers: { Referer: this.baseUrl },
      })
      const data = await response.text()

      const source = safeUnpack(/;(eval)(\(f.*?)(\n<\/script>)/s.exec(data)![2]).match(/https.*?m3u8/)
      this.sources.push({
        url: source![0],
        isM3U8: source![0].includes('.m3u8'),
      })

      return this.sources
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  async bypassShortlink(shortinkUrl: URL): Promise<any> {
    try {
      const response = await fetch(`${shortinkUrl.href}`, {
        headers: { Referer: this.baseUrl },
      })
      const data = await response.text()
      const destination = data.match('a\\.redirect"\\)\\.attr\\("href","(https://[^"]+)')
      return destination![1]
    } catch (err) {
      throw new Error((err as Error).message)
    }
  }

  async getDirectDownloadLink(downloadUrl: URL) {
    try {
      if (downloadUrl.href.match(this.safelinkBaseUrl)) {
        const bypassedUrl = await this.bypassShortlink(downloadUrl)
        downloadUrl = new URL(bypassedUrl)
      }

      const response = await fetch(`${downloadUrl.href}`, {
        headers: { Referer: this.baseUrl },
      })
      const cookie = response.headers.get('set-cookie')?.split(';')[0]
      const data = await response.text()

      const obfuscatedParams = data.match(
        '\\}\\("([^"]+)".*?"([^"]+)"\\s*,\\s*([^,]+)\\s*,\\s*([^,]+)'
      )

      const formScript = this.deobfuscate(
        obfuscatedParams![1],
        obfuscatedParams![2],
        Number(obfuscatedParams![3]),
        Number(obfuscatedParams![4])
      )

      const formActionUrl = formScript.match(/form action="([^"]+)/)![1]
      const postToken = formScript.match(/name="_token" value="([^"]+)/)![1]

      const formData = new URLSearchParams()
      formData.append('_token', postToken)

      const formResponse = await fetch(`${formActionUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${downloadUrl.href}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
          Cookie: cookie!,
        },
        body: formData,
        redirect: 'manual',
      })

      if (formResponse.status === 302) {
        return formResponse.headers.get('location')
      }
      return downloadUrl.href
    } catch {
      return downloadUrl.href
    }
  }

  deobfuscate(payload: string, key: string, offset: number, radix: number): string {
    let result = ''
    const delimiter = key[radix]
    const chunks = payload.split(delimiter)

    const map: Record<string, number> = {}
    for (let i = 0; i < key.length; i++) {
      map[key[i]] = i
    }

    for (const chunk of chunks) {
      if (chunk.length === 0) continue
      let val = 0
      for (let i = 0; i < chunk.length; i++) {
        val = val * radix + map[chunk[i]]
      }
      result += String.fromCharCode(val - offset)
    }

    try {
      return decodeURIComponent(escape(result))
    } catch {
      return result
    }
  }
}

export default Kwik
