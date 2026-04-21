import type { ClientPluginDefinition, PluginLocaleMessages, PluginNavItem, PluginPageDefinition } from '../types/plugins'

const pluginModules = import.meta.glob('../../plugins/*/client/plugin.ts', { eager: true }) as Record<string, { default: ClientPluginDefinition }>

const plugins = Object.values(pluginModules).map((mod) => mod.default)

export function getPluginEnabledSettingKey(pluginId: string): string {
  return `plugin.${pluginId}.enabled`
}

export function getClientPlugins(): ClientPluginDefinition[] {
  return plugins
}

export function getClientPlugin(pluginId: string): ClientPluginDefinition | null {
  return plugins.find(plugin => plugin.id === pluginId) || null
}

export function getPluginNavigation(): PluginNavItem[] {
  return plugins.flatMap(plugin => plugin.navigation || [])
}

export function getPluginI18nMessages(): PluginLocaleMessages[] {
  return plugins
    .map(plugin => plugin.i18n)
    .filter((messages): messages is PluginLocaleMessages => Boolean(messages))
}

export function getPluginPage(pluginId: string, pagePath: string): PluginPageDefinition | null {
  const plugin = getClientPlugin(pluginId)
  if (!plugin?.pages) return null

  const normalizedPath = pagePath.startsWith('/') ? pagePath : `/${pagePath}`
  if (plugin.pages[normalizedPath]) {
    return plugin.pages[normalizedPath]
  }

  const prefixMatch = Object.entries(plugin.pages)
    .filter(([path]) => path !== '/' && normalizedPath.startsWith(path))
    .sort((a, b) => b[0].length - a[0].length)[0]

  return prefixMatch?.[1] || plugin.pages['/'] || null
}
