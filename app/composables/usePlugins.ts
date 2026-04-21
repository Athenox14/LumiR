import { getClientPlugin, getClientPlugins, getPluginEnabledSettingKey, getPluginNavigation } from '../utils/clientPlugins'

export function usePlugins() {
  const trpc = useTrpc()

  const plugins = computed(() => getClientPlugins())
  const pluginEnableKeys = computed(() => plugins.value.map(plugin => getPluginEnabledSettingKey(plugin.id)))

  const { data: pluginSettings, pending, refresh } = useAsyncData(
    'plugin-settings',
    async () => {
      if (!pluginEnableKeys.value.length) {
        return {} as Record<string, unknown>
      }

      return await trpc.settings.getMany.query(pluginEnableKeys.value)
    },
    {
      default: () => ({}),
    },
  )

  function isPluginEnabled(pluginId: string): boolean {
    const value = pluginSettings.value?.[getPluginEnabledSettingKey(pluginId)]

    if (value === false || value === 'false' || value === 0 || value === '0') {
      return false
    }

    return true
  }

  const enabledPlugins = computed(() => plugins.value.filter(plugin => isPluginEnabled(plugin.id)))

  const pluginItems = computed(() => {
    const enabledIds = new Set(enabledPlugins.value.map(plugin => plugin.id))
    return getPluginNavigation().filter(item => enabledIds.has(item.id.split('.')[0] || ''))
  })

  function getPlugin(pluginId: string) {
    const plugin = getClientPlugin(pluginId)
    if (!plugin) return null
    return isPluginEnabled(pluginId) ? plugin : null
  }

  return {
    plugins,
    enabledPlugins,
    pluginItems,
    pluginSettings,
    pluginsLoading: pending,
    refreshPluginStates: refresh,
    isPluginEnabled,
    getPlugin,
  }
}
