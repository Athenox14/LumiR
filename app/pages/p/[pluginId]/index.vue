<script setup lang="ts">
import PluginPageShell from '../../../components/plugins/PluginPageShell.vue'

definePageMeta({
  middleware: ['auth'],
  layout: 'default',
})
</script>

<template>
  <PluginPageShell />
</template>
