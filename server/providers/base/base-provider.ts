import type { IProviderStats } from '../types'
import Proxy from './proxy'

abstract class BaseProvider extends Proxy {
  abstract readonly name: string
  protected abstract readonly baseUrl: string
  protected readonly languages: string[] | string = 'en'
  readonly isNSFW: boolean = false
  protected readonly logo: string = ''
  protected abstract readonly classPath: string
  readonly isWorking: boolean = true

  get toString(): IProviderStats {
    return {
      name: this.name,
      baseUrl: this.baseUrl,
      lang: this.languages,
      isNSFW: this.isNSFW,
      logo: this.logo,
      classPath: this.classPath,
      isWorking: this.isWorking,
    }
  }
}

export default BaseProvider
