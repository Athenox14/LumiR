<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { getPluginPage } from '../../utils/clientPlugins'

definePageMeta({
  middleware: ['auth'],
})

const route = useRoute()
const { getPlugin, pluginsLoading } = usePlugins()

const pluginId = computed(() => route.params.pluginId as string)
const pluginPath = computed(() => {
  const raw = route.params.path
  if (!raw) return '/'
  const parts = Array.isArray(raw) ? raw : [raw]
  return `/${parts.join('/')}`
})

const pluginDefinition = computed(() => getPlugin(pluginId.value))
const pageDefinition = computed(() => {
  if (!pluginDefinition.value) return null
  return getPluginPage(pluginId.value, pluginPath.value)
})

const pageComponent = computed(() => {
  if (!pageDefinition.value) return null
  return defineAsyncComponent(pageDefinition.value.component)
})

watchEffect(() => {
  if (pluginPath.value.startsWith('/watch/')) {
    setPageLayout(false)
    return
  }

  setPageLayout('default')
})

useHead({
  title: computed(() => pageDefinition.value?.title || pluginId.value),
})
</script>

<template>
  <div v-if="pluginsLoading" class="p-6">
    <p class="text-text-secondary">Loading plugin...</p>
  </div>
  <div v-else-if="!pluginDefinition" class="p-6">
    <h1 class="text-2xl font-bold text-text-primary">Plugin disabled</h1>
    <p class="mt-2 text-text-secondary">This plugin is currently disabled in admin settings.</p>
  </div>
  <component :is="pageComponent" v-if="pageComponent" />
  <div v-else-if="pluginDefinition" class="p-6">
    <h1 class="text-2xl font-bold text-text-primary">Plugin page not found</h1>
    <p class="mt-2 text-text-secondary">The requested plugin route is not registered.</p>
  </div>
</template>
