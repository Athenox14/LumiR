<script setup lang="ts">
interface Media {
  id: string
  title: string
  year?: number | null
  posterPath?: string | null
  backdropPath?: string | null
  watchProgress: {
    position: number
    duration?: number | null
    completed: boolean
  }
}

interface Props {
  items: Media[]
  loading?: boolean
}

withDefaults(defineProps<Props>(), {
  loading: false,
})

const { t } = useI18n()

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  const time = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  return t('continueWatching.timeLeft', { time })
}

function getRemainingTime(progress: Media['watchProgress']): string {
  if (!progress.duration) return ''
  const remaining = progress.duration - progress.position
  return formatTime(remaining)
}

function getProgressPercent(progress: Media['watchProgress']): number {
  if (!progress.duration) return 0
  return Math.round((progress.position / progress.duration) * 100)
}

const placeholderBackdrop = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"%3E%3Crect fill="%231a1a1a" width="400" height="225"/%3E%3C/svg%3E'
</script>

<template>
  <div v-if="loading || items.length > 0">
    <h2 class="text-xl font-semibold text-text-primary mb-4">{{ t('continueWatching.title') }}</h2>

    <!-- Loading state -->
    <div
      v-if="loading"
      class="flex gap-4 overflow-x-auto pb-4 no-scrollbar"
    >
      <div
        v-for="i in 4"
        :key="i"
        class="flex-shrink-0 w-72"
      >
        <UiSkeleton class="aspect-video rounded-xl" />
        <div class="mt-3 space-y-2">
          <UiSkeleton height="1rem" width="70%" />
          <UiSkeleton height="0.5rem" width="100%" />
        </div>
      </div>
    </div>

    <!-- Content -->
    <div
      v-else
      class="flex gap-4 overflow-x-auto pb-4 no-scrollbar"
    >
      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="`/watch/${item.id}`"
        class="group flex-shrink-0 w-72"
      >
        <div class="relative aspect-video rounded-xl overflow-hidden bg-surface">
          <img
            :src="item.backdropPath || item.posterPath || placeholderBackdrop"
            :alt="item.title"
            class="w-full h-full object-cover"
            loading="lazy"
          >

          <!-- Overlay -->
          <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent">
            <!-- Play button -->
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center transform scale-0 group-hover:scale-100 transition-transform duration-300">
                <svg class="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>

            <!-- Info -->
            <div class="absolute bottom-0 left-0 right-0 p-4">
              <h3 class="text-sm font-medium text-white truncate">
                {{ item.title }}
              </h3>
              <p class="text-xs text-white/70 mt-1">
                {{ getRemainingTime(item.watchProgress) }}
              </p>
            </div>
          </div>

          <!-- Progress bar -->
          <div class="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
            <div
              class="h-full bg-primary transition-all duration-300"
              :style="{ width: `${getProgressPercent(item.watchProgress)}%` }"
            />
          </div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
