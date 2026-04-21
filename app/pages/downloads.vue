<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const { t } = useI18n()
const trpc = useTrpc()
const route = useRoute()
useHead({ title: computed(() => t('nav.downloads')) })

if (route.path === '/downloads') {
  navigateTo('/p/remote-media/downloads', { redirectCode: 301 })
}

const { data: downloads, pending, refresh } = useAsyncData(
  'downloads',
  () => trpc.remoteMedia.listDownloads.query({ limit: 50 }),
)

// Auto-refresh every 5s if there are active downloads
let refreshInterval: NodeJS.Timeout | null = null

onMounted(() => {
  refreshInterval = setInterval(() => {
    const hasActive = downloads.value?.some(
      d => d.status === 'pending' || d.status === 'downloading'
    )
    if (hasActive) refresh()
  }, 5000)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})

async function cancelDownload(id: string) {
  try {
    await trpc.remoteMedia.cancelDownload.mutate(id)
    refresh()
  } catch (e: any) {
    useToast().error(t('downloads.cancelFailed') + ': ' + (e.message || 'Unknown error'))
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'pending': return t('downloads.pending')
    case 'downloading': return t('downloads.downloading')
    case 'completed': return t('downloads.completed')
    case 'failed': return t('downloads.failed')
    default: return status
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'pending': return 'text-yellow-500'
    case 'downloading': return 'text-blue-500'
    case 'completed': return 'text-green-500'
    case 'failed': return 'text-red-500'
    default: return 'text-text-muted'
  }
}

const placeholderImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="150" viewBox="0 0 100 150"%3E%3Crect fill="%231a1a1a" width="100" height="150"/%3E%3C/svg%3E'
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-text-primary">{{ t('downloads.title') }}</h1>
        <p class="text-text-secondary">{{ t('downloads.count', { count: downloads?.length || 0 }) }}</p>
      </div>
      <button
        type="button"
        class="px-4 py-2 bg-surface hover:bg-surface-secondary border border-border rounded-lg text-text-primary text-sm transition-colors"
        @click="refresh()"
      >
        {{ t('downloads.refresh') }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="space-y-4">
      <UiSkeleton v-for="i in 5" :key="i" height="5rem" />
    </div>

    <!-- Empty -->
    <div v-else-if="!downloads?.length" class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-16 h-16 rounded-full bg-surface flex items-center justify-center mb-4">
        <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </div>
      <p class="text-text-secondary">{{ t('downloads.noDownloads') }}</p>
      <NuxtLink to="/p/remote-media" class="text-primary hover:underline mt-2 text-sm">
        {{ t('downloads.browseCatalog') }}
      </NuxtLink>
    </div>

    <!-- Downloads list -->
    <div v-else class="space-y-3">
      <div
        v-for="dl in downloads"
        :key="dl.id"
        class="flex items-center gap-4 p-4 bg-surface border border-border rounded-xl"
      >
        <!-- Poster thumbnail -->
        <div class="flex-shrink-0 w-12 h-18 rounded-lg overflow-hidden bg-surface-secondary">
          <img
            :src="dl.posterPath || placeholderImage"
            :alt="dl.title"
            class="w-full h-full object-cover"
          >
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <h3 class="text-sm font-medium text-text-primary truncate">
              {{ dl.title }}
              <span v-if="dl.season != null && dl.episode != null" class="text-text-muted">
                S{{ String(dl.season).padStart(2, '0') }}E{{ String(dl.episode).padStart(2, '0') }}
              </span>
            </h3>
            <span
              :class="['text-xs font-medium', statusColor(dl.status)]"
            >
              {{ formatStatus(dl.status) }}
            </span>
          </div>

          <!-- Progress bar for downloading -->
          <div v-if="dl.status === 'downloading'" class="mt-1">
            <div class="h-1.5 bg-surface-secondary rounded-full overflow-hidden">
              <div
                class="h-full bg-blue-500 transition-all duration-300"
                :style="{ width: `${Math.round((dl.progress || 0) * 100)}%` }"
              />
            </div>
            <p class="text-xs text-text-muted mt-1">{{ Math.round((dl.progress || 0) * 100) }}%</p>
          </div>

          <!-- Error message -->
          <p v-if="dl.status === 'failed' && dl.error" class="text-xs text-red-500 mt-1 truncate">
            {{ dl.error }}
          </p>

          <!-- Completed: link to local media -->
          <NuxtLink
            v-if="dl.status === 'completed' && dl.mediaId"
            :to="`/media/${dl.mediaId}`"
            class="text-xs text-primary hover:underline mt-1 inline-block"
          >
            {{ t('downloads.viewInLibrary') }}
          </NuxtLink>
        </div>

        <!-- Actions -->
        <div class="flex-shrink-0">
          <button
            v-if="dl.status === 'pending' || dl.status === 'downloading'"
            type="button"
            class="p-2 text-text-muted hover:text-red-500 transition-colors"
            :title="t('downloads.cancel')"
            @click="cancelDownload(dl.id)"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
