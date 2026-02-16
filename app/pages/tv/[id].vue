<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const route = useRoute()
const trpc = useTrpc()
const { t } = useI18n()

const tmdbId = computed(() => parseInt(route.params.id as string))

const { data, pending, error } = useAsyncData(
  `show-${tmdbId.value}`,
  () => trpc.media.getShowEpisodes.query({ tmdbId: tmdbId.value })
)

useHead({ title: computed(() => data.value?.title || t('nav.tvShows')) })

const seasonScrollRefs = ref<Record<number, HTMLElement | null>>({})

function episodeProgress(ep: any): number {
  if (!ep.watchProgress?.duration) return 0
  return Math.round((ep.watchProgress.position / ep.watchProgress.duration) * 100)
}

function episodeDisplayName(ep: any): string {
  // If TMDB provides a real name (not just "Episode X"), show it
  if (ep.episodeName && !ep.episodeName.match(/^[EÉ]pisode\s+\d+$/i)) {
    return ep.episodeName
  }
  return ''
}

// Auto-scroll to last watched episode per season
watch(data, async (val) => {
  if (!val?.seasons) return
  await nextTick()
  for (const season of val.seasons) {
    const container = seasonScrollRefs.value[season.number]
    if (!container) continue

    // Find last episode with progress (not completed)
    let targetIdx = -1
    for (let i = season.episodes.length - 1; i >= 0; i--) {
      const ep = season.episodes[i]
      if (ep.watchProgress && !ep.watchProgress.completed && episodeProgress(ep) > 0) {
        targetIdx = i
        break
      }
    }
    // If no in-progress, find first unwatched
    if (targetIdx === -1) {
      for (let i = 0; i < season.episodes.length; i++) {
        if (!season.episodes[i].watchProgress?.completed) {
          targetIdx = i
          break
        }
      }
    }

    if (targetIdx > 0) {
      const cards = container.querySelectorAll('[data-episode-card]')
      if (cards[targetIdx]) {
        cards[targetIdx].scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' })
      }
    }
  }
}, { immediate: true })

// Normalize cast to handle old format (string[]) and new format (object[])
const normalizedCast = computed(() => {
  if (!data.value?.show?.cast) return []
  return (data.value.show.cast as any[]).map((actor: any) => {
    if (typeof actor === 'string') {
      return { id: null, name: actor, character: '', profilePath: null }
    }
    return {
      id: actor.id || null,
      name: actor.name || '',
      character: actor.character || '',
      profilePath: actor.profilePath || null,
    }
  })
})

const placeholderBackdrop = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"%3E%3Crect fill="%230a0a0a" width="1920" height="1080"/%3E%3C/svg%3E'
</script>

<template>
  <div class="min-h-screen">
    <!-- Loading -->
    <div v-if="pending" class="p-6">
      <UiSkeleton class="w-full h-[50vh] rounded-none" />
      <div class="max-w-5xl mx-auto mt-6 space-y-4">
        <UiSkeleton height="2rem" width="40%" />
        <UiSkeleton height="1rem" width="20%" />
        <UiSkeleton height="6rem" />
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="p-6 text-center">
      <p class="text-red-500">{{ t('tv.failedToLoad') }}</p>
      <NuxtLink to="/tv" class="text-primary hover:underline mt-2 inline-block">
        {{ t('tv.backToTvShows') }}
      </NuxtLink>
    </div>

    <!-- Content -->
    <div v-else-if="data">
      <!-- Backdrop -->
      <div class="relative">
        <div class="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent z-10" />
        <img
          :src="data.show.backdropPath || placeholderBackdrop"
          :alt="data.show.title"
          class="w-full h-[50vh] object-cover"
        >

        <!-- Content overlay -->
        <div class="absolute bottom-0 left-0 right-0 z-20 p-6 md:p-12">
          <div class="max-w-5xl flex items-end gap-6">
            <!-- Poster -->
            <img
              v-if="data.show.posterPath"
              :src="data.show.posterPath"
              :alt="data.show.title"
              class="hidden md:block w-40 rounded-xl shadow-2xl"
            >

            <div>
              <!-- Title -->
              <h1 class="text-3xl md:text-5xl font-bold text-white mb-2">
                {{ data.show.title }}
              </h1>

              <!-- Meta -->
              <div class="flex flex-wrap items-center gap-3 text-white/80 mb-4">
                <span v-if="data.show.year">{{ data.show.year }}</span>
                <span>{{ data.seasons.length }} {{ t('tv.seasons', data.seasons.length) }}</span>
                <span>{{ data.totalEpisodes }} {{ t('tv.episodes', data.totalEpisodes) }}</span>
                <span v-if="data.show.rating" class="flex items-center gap-1">
                  <svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {{ data.show.rating.toFixed(1) }}
                </span>
              </div>

              <!-- Genres -->
              <div v-if="data.show.genres?.length" class="flex flex-wrap gap-2">
                <span
                  v-for="genre in data.show.genres"
                  :key="genre"
                  class="px-3 py-1 rounded-full bg-white/10 text-white text-sm"
                >
                  {{ genre }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Details -->
      <div class="max-w-5xl mx-auto px-6 py-8">
        <!-- Tagline -->
        <p v-if="data.show.tagline" class="text-lg text-text-secondary italic mb-4">
          "{{ data.show.tagline }}"
        </p>

        <!-- Overview -->
        <div v-if="data.show.overview" class="mb-8">
          <p class="text-text-secondary leading-relaxed">
            {{ data.show.overview }}
          </p>
        </div>

        <!-- Cast -->
        <div v-if="normalizedCast.length" class="mb-8">
          <h2 class="text-lg font-semibold text-text-primary mb-4">{{ t('tv.casting') }}</h2>
          <div class="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
            <NuxtLink
              v-for="actor in normalizedCast"
              :key="actor.name"
              :to="actor.id ? `/catalog/person/${actor.id}` : '#'"
              class="flex-shrink-0 w-28 text-center group"
            >
              <div class="w-28 h-28 rounded-full overflow-hidden bg-surface mx-auto mb-2 ring-2 ring-transparent group-hover:ring-primary transition-all">
                <img
                  v-if="actor.profilePath"
                  :src="actor.profilePath"
                  :alt="actor.name"
                  class="w-full h-full object-cover"
                  loading="lazy"
                >
                <div v-else class="w-full h-full flex items-center justify-center">
                  <svg class="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
              <p class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">{{ actor.name }}</p>
              <p v-if="actor.character" class="text-xs text-text-muted truncate">{{ actor.character }}</p>
            </NuxtLink>
          </div>
        </div>

        <!-- Seasons -->
        <div class="space-y-8">
          <div
            v-for="season in data.seasons"
            :key="season.number"
          >
            <!-- Season header -->
            <div class="flex items-center gap-3 mb-3">
              <h3 class="text-lg font-semibold text-text-primary">
                {{ t('tv.season', { number: season.number }) }}
              </h3>
              <span class="text-sm text-text-muted">
                {{ season.episodes.length }} {{ t('tv.episodes', season.episodes.length) }}
              </span>
            </div>

            <!-- Episodes horizontal scroll -->
            <div
              :ref="(el) => { if (el) seasonScrollRefs[season.number] = el as HTMLElement }"
              class="flex gap-3 overflow-x-auto pb-4 -mx-6 px-6 scroll-smooth snap-x"
              style="scrollbar-width: thin;"
            >
              <NuxtLink
                v-for="ep in season.episodes"
                :key="ep.id"
                :to="`/watch/${ep.id}`"
                data-episode-card
                class="flex-shrink-0 w-48 group snap-center"
              >
                <!-- Thumbnail -->
                <div class="relative w-48 aspect-video rounded-lg overflow-hidden bg-background mb-2">
                  <img
                    v-if="ep.stillPath"
                    :src="ep.stillPath"
                    :alt="`${t('tv.episode', { number: ep.episode })}`"
                    class="w-full h-full object-cover"
                    loading="lazy"
                  >
                  <div v-else class="w-full h-full flex items-center justify-center">
                    <span class="text-2xl font-bold text-text-muted">{{ ep.episode }}</span>
                  </div>

                  <!-- Play overlay -->
                  <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                    <div class="w-10 h-10 rounded-full bg-primary/0 group-hover:bg-primary flex items-center justify-center transition-all scale-0 group-hover:scale-100">
                      <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>

                  <!-- Watched checkmark -->
                  <div
                    v-if="ep.watchProgress?.completed"
                    class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center"
                  >
                    <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>

                  <!-- Progress bar -->
                  <div
                    v-if="ep.watchProgress && !ep.watchProgress.completed && episodeProgress(ep) > 0"
                    class="absolute bottom-0 left-0 right-0 h-1 bg-black/50"
                  >
                    <div
                      class="h-full bg-primary"
                      :style="{ width: `${episodeProgress(ep)}%` }"
                    />
                  </div>
                </div>

                <!-- Episode info -->
                <p class="text-sm font-medium text-text-primary truncate">
                  {{ t('tv.episode', { number: ep.episode }) }}
                </p>
                <p
                  v-if="episodeDisplayName(ep)"
                  class="text-xs text-text-muted truncate"
                >
                  {{ episodeDisplayName(ep) }}
                </p>
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
