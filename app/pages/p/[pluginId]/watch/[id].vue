<script setup lang="ts">
import PluginPageShell from '../../../../components/plugins/PluginPageShell.vue'

definePageMeta({
  middleware: ['auth'],
  layout: false,
})
</script>

<template>
  <PluginPageShell />
</template>
