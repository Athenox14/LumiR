<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const trpc = useTrpc()
const { user } = useAuth()
const { t } = useI18n()

// Fetch data
const { data: continueWatching, pending: continueLoading } = useAsyncData(
  'continue-watching',
  () => trpc.media.continueWatching.query({ limit: 10 })
)

const { data: recentlyAdded, pending: recentLoading } = useAsyncData(
  'recently-added',
  () => trpc.media.recentlyAdded.query({ limit: 12 })
)

const { data: stats } = useAsyncData(
  'stats',
  () => trpc.media.stats.query()
)
</script>

<template>
  <div class="p-6 space-y-8">
    <!-- Welcome -->
    <div>
      <h1 class="text-2xl font-bold text-text-primary">
        {{ t('home.welcomeBack', { name: user?.displayName?.split(' ')[0] || 'User' }) }}
      </h1>
      <p class="text-text-secondary mt-1">
        {{ t('home.libraryStatus') }}
      </p>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-2xl font-bold text-text-primary">
          {{ stats?.totalMedia || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('home.totalMedia') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-2xl font-bold text-text-primary">
          {{ stats?.totalMovies || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('home.movies') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-2xl font-bold text-text-primary">
          {{ stats?.totalTv || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('home.tvShows') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-2xl font-bold text-text-primary">
          {{ stats?.totalWatched || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('home.watched') }}</p>
      </div>
    </div>

    <!-- Continue Watching -->
    <MediaContinueWatchingRow
      :items="continueWatching || []"
      :loading="continueLoading"
    />

    <!-- Recently Added -->
    <div>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-text-primary">{{ t('home.recentlyAdded') }}</h2>
        <NuxtLink
          to="/movies"
          class="text-sm text-primary hover:underline"
        >
          {{ t('common.viewAll') }}
        </NuxtLink>
      </div>
      <MediaGrid
        :items="recentlyAdded || []"
        :loading="recentLoading"
        :empty-message="t('home.emptyLibrary')"
      />
    </div>
  </div>
</template>
