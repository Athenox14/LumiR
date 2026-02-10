<script setup lang="ts">
interface Media {
  id: string
  title: string
  year?: number | null
  posterPath?: string | null
  rating?: number | null
  mediaType?: string | null
  season?: number | null
  episode?: number | null
  watchProgress?: {
    position: number
    duration?: number | null
    completed: boolean
  } | null
}

interface Props {
  media: Media
  showProgress?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showProgress: true,
})

const progressPercent = computed(() => {
  if (!props.media.watchProgress?.duration) return 0
  return Math.round((props.media.watchProgress.position / props.media.watchProgress.duration) * 100)
})

const placeholderImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"%3E%3Crect fill="%231a1a1a" width="300" height="450"/%3E%3Ctext fill="%23404040" font-family="sans-serif" font-size="24" text-anchor="middle" x="150" y="225"%3ENo Poster%3C/text%3E%3C/svg%3E'
</script>

<template>
  <NuxtLink
    :to="`/media/${media.id}`"
    class="group block"
  >
    <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface card-hover">
      <!-- Poster -->
      <img
        :src="media.posterPath || placeholderImage"
        :alt="media.title"
        class="w-full h-full object-cover"
        loading="lazy"
      />

      <!-- Overlay on hover -->
      <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div class="absolute bottom-0 left-0 right-0 p-4">
          <!-- Play button -->
          <div class="flex justify-center mb-3">
            <div class="w-12 h-12 rounded-full bg-primary flex items-center justify-center transform scale-0 group-hover:scale-100 transition-transform duration-300">
              <svg class="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>

          <!-- Rating -->
          <div v-if="media.rating" class="flex items-center justify-center gap-1 text-sm text-text-secondary">
            <svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            {{ media.rating.toFixed(1) }}
          </div>
        </div>
      </div>

      <!-- Progress bar -->
      <div
        v-if="showProgress && media.watchProgress && !media.watchProgress.completed && progressPercent > 0"
        class="absolute bottom-0 left-0 right-0 h-1 bg-black/50"
      >
        <div
          class="h-full bg-primary transition-all duration-300"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>

      <!-- Season/Episode badge -->
      <div
        v-if="media.mediaType === 'tv' && media.season != null && media.episode != null"
        class="absolute top-2 left-2 bg-primary text-white text-xs font-medium px-2 py-1 rounded-full"
      >
        S{{ String(media.season).padStart(2, '0') }}E{{ String(media.episode).padStart(2, '0') }}
      </div>

      <!-- Watched badge -->
      <div
        v-if="media.watchProgress?.completed"
        class="absolute top-2 right-2 bg-green-500 text-white text-xs font-medium px-2 py-1 rounded-full"
      >
        Watched
      </div>

    </div>

    <!-- Info -->
    <div class="mt-3 px-1">
      <h3 class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">
        {{ media.title }}
      </h3>
      <p v-if="media.year" class="text-xs text-text-muted mt-0.5">
        {{ media.year }}
      </p>
    </div>
  </NuxtLink>
</template>
