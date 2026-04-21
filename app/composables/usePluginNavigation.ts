import type { PluginNavItem } from '../types/plugins'

export function usePluginNavigation() {
  const { isAdmin } = useAuth()
  const { pluginItems: availablePluginItems } = usePlugins()

  const pluginItems = computed<PluginNavItem[]>(() => {
    return availablePluginItems.value.filter(item => !item.requiresAdmin || isAdmin.value)
  })

  return {
    pluginItems,
  }
}
