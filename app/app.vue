<script setup lang="ts">
const { appName } = useAppName()

useHead({
  titleTemplate: computed(() => {
    return (title?: string) => title ? `${title} - ${appName.value}` : appName.value
  }),
})
</script>

<template>
  <div class="dark">
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <UpdateNotification />
    <ConfirmDialog />
  </div>
</template>

<style>
html {
  color-scheme: dark;
}
</style>
