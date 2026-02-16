<script setup lang="ts">
const { appName } = useAppName()

useHead({
  titleTemplate: computed(() => `%s - ${appName.value}`),
  title: computed(() => appName.value),
})
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
