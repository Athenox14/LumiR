<script setup lang="ts">
defineOptions({
  name: 'ExamplePluginHome',
})

const title = 'Example Plugin'
</script>

<template>
  <div class="space-y-4 p-6">
    <div>
      <h1 class="text-3xl font-semibold text-text-primary">{{ title }}</h1>
      <p class="mt-2 max-w-2xl text-sm text-text-secondary">
        This page exists only as a reference implementation for external plugins.
      </p>
    </div>

    <div class="rounded-2xl border border-border bg-surface p-5">
      <p class="text-sm text-text-secondary">
        Copy this plugin into your external plugins directory, rename it, then add your own pages, settings, i18n,
        and server routes.
      </p>
    </div>
  </div>
</template>
