export function usePluginLabels() {
  const { t } = useI18n()

  function getPluginLabel(plugin: { id: string, name?: string, description?: string }) {
    if (plugin.id === 'remote-media') {
      return {
        name: t('plugins.remoteMedia.name'),
        description: t('plugins.remoteMedia.description'),
      }
    }

    return {
      name: plugin.name || plugin.id,
      description: plugin.description || '',
    }
  }

  return {
    getPluginLabel,
  }
}
