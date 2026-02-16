<script setup lang="ts">
const { appName } = useAppName()

useHead(computed(() => ({
  titleTemplate: (title?: string) => title ? `${title} - ${appName.value}` : appName.value,
})))
</script>

<template>
  <div class="dark">
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <UpdateNotification />
  </div>
</template>

<style>
html {
  color-scheme: dark;
}
</style>
