export function usePluginLabels() {
  function getPluginLabel(plugin: { id: string, name?: string, description?: string }) {
    return {
      name: plugin.name || plugin.id,
      description: plugin.description || '',
    }
  }

  return {
    getPluginLabel,
  }
}
