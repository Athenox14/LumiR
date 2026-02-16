import type { AxiosAdapter, AxiosInstance } from 'axios';
import axios from 'axios'
import type { ProxyConfig } from '../types'

export class Proxy {
  protected client: AxiosInstance

  constructor(protected proxyConfig?: ProxyConfig, protected adapter?: AxiosAdapter) {
    this.client = axios.create()

    if (proxyConfig) this.setProxy(proxyConfig)
    if (adapter) this.setAxiosAdapter(adapter)
  }

  private validUrl = /^https?:\/\/.+/

  setProxy(proxyConfig: ProxyConfig) {
    if (!proxyConfig?.url) return

    if (typeof proxyConfig?.url === 'string')
      if (!this.validUrl.test(proxyConfig.url)) throw new Error('Proxy URL is invalid!')

    if (Array.isArray(proxyConfig?.url)) {
      for (const [i, url] of this.toMap<string>(proxyConfig.url))
        if (!this.validUrl.test(url)) throw new Error(`Proxy URL at index ${i} is invalid!`)

      this.rotateProxy({ ...proxyConfig, urls: proxyConfig.url })
      return
    }

    this.client.interceptors.request.use(config => {
      if (proxyConfig?.url) {
        config.headers.set('x-api-key', proxyConfig?.key ?? '')
        config.url = `${proxyConfig.url}${config?.url ? config?.url : ''}`
      }
      return config
    })
  }

  setAxiosAdapter(adapter: AxiosAdapter) {
    this.client.defaults.adapter = adapter
  }

  private rotateProxy = (proxy: Omit<ProxyConfig, 'url'> & { urls: string[] }) => {
    setInterval(() => {
      const url = proxy.urls.shift()
      if (url) proxy.urls.push(url)
      this.setProxy({ url: proxy.urls[0], key: proxy.key })
    }, proxy?.rotateInterval ?? 5000)
  }

  private toMap = <T>(arr: T[]): [number, T][] => arr.map((v, i) => [i, v])
}

export default Proxy
