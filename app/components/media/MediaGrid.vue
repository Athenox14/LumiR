<script setup lang="ts">
interface Media {
  id: string
  title: string
  year?: number | null
  posterPath?: string | null
  rating?: number | null
  watchProgress?: {
    position: number
    duration?: number | null
    completed: boolean
  } | null
}

interface Props {
  items: Media[]
  loading?: boolean
  emptyMessage?: string
  showProgress?: boolean
}

withDefaults(defineProps<Props>(), {
  loading: false,
  emptyMessage: '',
  showProgress: true,
})

const { t } = useI18n()
</script>

<template>
  <div>
    <!-- Loading state -->
    <div
      v-if="loading"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
    >
      <div
        v-for="i in 12"
        :key="i"
        class="space-y-3"
      >
        <UiSkeleton class="aspect-[2/3] rounded-xl" />
        <UiSkeleton height="1rem" width="80%" />
        <UiSkeleton height="0.75rem" width="40%" />
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="items.length === 0"
      class="flex flex-col items-center justify-center py-16 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-surface flex items-center justify-center mb-4">
        <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        </svg>
      </div>
      <p class="text-text-secondary">{{ emptyMessage || t('common.noMediaFound') }}</p>
    </div>

    <!-- Media grid -->
    <div
      v-else
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
    >
      <MediaCard
        v-for="item in items"
        :key="item.id"
        :media="item"
        :show-progress="showProgress"
      />
    </div>
  </div>
</template>
