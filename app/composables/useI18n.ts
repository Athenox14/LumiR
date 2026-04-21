import fr from '~/locales/fr'
import en from '~/locales/en'
import de from '~/locales/de'
import { getPluginI18nMessages } from '../utils/clientPlugins'

type Locale = 'fr' | 'en' | 'de'

function mergeMessages(base: Record<string, any>, extension: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ...base }

  for (const [key, value] of Object.entries(extension)) {
    const current = result[key]
    if (current && typeof current === 'object' && !Array.isArray(current) && typeof value === 'object' && value && !Array.isArray(value)) {
      result[key] = mergeMessages(current, value)
      continue
    }

    result[key] = value
  }

  return result
}

const baseMessages: Record<Locale, any> = { fr, en, de }
const pluginMessages = getPluginI18nMessages()
const messages = pluginMessages.reduce<Record<Locale, any>>((acc, pluginMessage) => {
  return {
    fr: pluginMessage.fr ? mergeMessages(acc.fr, pluginMessage.fr) : acc.fr,
    en: pluginMessage.en ? mergeMessages(acc.en, pluginMessage.en) : acc.en,
    de: pluginMessage.de ? mergeMessages(acc.de, pluginMessage.de) : acc.de,
  }
}, baseMessages)

export function useI18n() {
  const locale = useState<Locale>('app-locale', () => {
    if (import.meta.client) {
      return (localStorage.getItem('pipouflix-locale') as Locale) || 'fr'
    }
    return 'fr'
  })

  function t(key: string, params?: Record<string, string | number> | number): string {
    const keys = key.split('.')
    let value: any = messages[locale.value]
    for (const k of keys) {
      if (value == null) break
      value = value[k]
    }
    if (typeof value !== 'string') {
      let fb: any = messages.fr
      for (const k of keys) {
        if (fb == null) break
        fb = fb[k]
      }
      value = typeof fb === 'string' ? fb : key
    }

    // Pluralization: "singular | plural" with t(key, count)
    if (typeof params === 'number') {
      const count = params
      if (value.includes(' | ')) {
        const forms = value.split(' | ')
        value = count <= 1 ? forms[0] : forms[1] || forms[0]
      }
      return value.replace(/\{count\}/g, String(count))
    }

    if (params) {
      return value.replace(/\{(\w+)\}/g, (_: any, k: string) => String(params[k] ?? `{${k}}`))
    }
    return value
  }

  function setLocale(newLocale: Locale) {
    locale.value = newLocale
    if (import.meta.client) {
      localStorage.setItem('pipouflix-locale', newLocale)
    }
  }

  return { locale, t, setLocale }
}
