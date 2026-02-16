<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const trpc = useTrpc()
const { t } = useI18n()

useHead({ title: computed(() => t('nav.continueWatching')) })

const { data: continueWatching, pending, refresh } = useAsyncData(
  'continue-watching-page',
  () => trpc.media.continueWatching.query({ limit: 20 })
)

async function removeFromList(mediaId: string) {
  try {
    await trpc.media.deleteProgress.mutate(mediaId)
    await refresh()
  } catch (e) {
    console.error('Failed to remove from continue watching:', e)
  }
}
</script>

<template>
  <div class="p-6">
    <h1 class="text-2xl font-bold text-text-primary mb-2">{{ t('continueWatching.title') }}</h1>
    <p class="text-text-secondary mb-6">{{ t('continueWatching.subtitle') }}</p>

    <!-- Loading -->
    <div
      v-if="pending"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
    >
      <div v-for="i in 12" :key="i" class="space-y-3">
        <UiSkeleton class="aspect-[2/3] rounded-xl" />
        <UiSkeleton height="1rem" width="80%" />
        <UiSkeleton height="0.75rem" width="40%" />
      </div>
    </div>

    <!-- Empty -->
    <div
      v-else-if="!continueWatching?.length"
      class="flex flex-col items-center justify-center py-16 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-surface flex items-center justify-center mb-4">
        <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p class="text-text-secondary">{{ t('continueWatching.emptyMessage') }}</p>
    </div>

    <!-- Grid with remove buttons -->
    <div
      v-else
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
    >
      <div
        v-for="item in continueWatching"
        :key="item.id"
        class="relative group/card"
      >
        <MediaCard :media="item" :show-progress="true" />
        <!-- Remove button -->
        <button
          type="button"
          class="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/70 hover:bg-red-600 text-white/70 hover:text-white flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-all duration-200"
          :title="t('common.delete')"
          @click.prevent.stop="removeFromList(item.id)"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
