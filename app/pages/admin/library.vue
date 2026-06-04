<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const trpc = useTrpc()
const { t } = useI18n()

useHead({ title: computed(() => t('admin.library')) })

const scanning = ref(false)
const scanError = ref('')

// Fetch data
const { data: scanStatus, refresh: refreshScanStatus } = useAsyncData(
  'scan-status',
  () => trpc.library.scanStatus.query(),
  { watch: [scanning] }
)

const { data: scanHistory, refresh: refreshHistory } = useAsyncData(
  'scan-history',
  () => trpc.library.scanHistory.query({ limit: 10 })
)

const { data: settings } = useAsyncData(
  'library-settings',
  () => trpc.settings.getMany.query(['mediaPath', 'tmdbApiKey', 'autoScanEnabled', 'scanInterval'])
)

// Poll scan status while scanning
let pollInterval: NodeJS.Timeout | null = null

watch(() => scanStatus.value?.status, (status) => {
  if (status === 'running') {
    if (!pollInterval) {
      pollInterval = setInterval(() => {
        refreshScanStatus()
      }, 2000)
    }
  } else {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
    refreshHistory()
  }
})

onUnmounted(() => {
  if (pollInterval) {
    clearInterval(pollInterval)
  }
})

const stopping = ref(false)

async function startScan() {
  scanning.value = true
  scanError.value = ''

  try {
    await trpc.library.startScan.mutate()
    await refreshScanStatus()

    // Start polling immediately in case the watch didn't catch the transition
    if (!pollInterval) {
      pollInterval = setInterval(() => {
        refreshScanStatus()
      }, 2000)
    }
  } catch (e: any) {
    scanError.value = e.message || t('adminLibrary.failedToStartScan')
  } finally {
    scanning.value = false
  }
}

async function stopScan() {
  stopping.value = true
  try {
    await trpc.library.stopScan.mutate()
  } catch (e: any) {
    scanError.value = e.message || t('adminLibrary.failedToStopScan')
  } finally {
    stopping.value = false
  }
}

// Image pre-cache
const cachingImages = ref(false)
const cacheResult = ref<{ cached: number; failed: number; skipped: number } | null>(null)

async function cacheImages() {
  cachingImages.value = true
  cacheResult.value = null
  try {
    cacheResult.value = await trpc.library.cacheImages.mutate()
  } catch (e: any) {
    scanError.value = e.message || 'Failed to cache images'
  } finally {
    cachingImages.value = false
  }
}

// Synopsis embeddings
const embedError = ref('')
const stoppingEmbed = ref(false)

const { data: embedStatus, refresh: refreshEmbedStatus } = useAsyncData(
  'embed-status',
  () => trpc.library.embedStatus.query()
)

let embedPollInterval: NodeJS.Timeout | null = null

watch(() => embedStatus.value?.status, (status) => {
  const active = status === 'model_loading' || status === 'running'
  if (active) {
    if (!embedPollInterval) embedPollInterval = setInterval(() => refreshEmbedStatus(), 1500)
  } else {
    if (embedPollInterval) { clearInterval(embedPollInterval); embedPollInterval = null }
  }
})

onUnmounted(() => {
  if (embedPollInterval) clearInterval(embedPollInterval)
})

async function startEmbed(onlyNew = true) {
  embedError.value = ''
  try {
    await trpc.library.startEmbed.mutate({ onlyNew })
    await refreshEmbedStatus()
    if (!embedPollInterval) embedPollInterval = setInterval(() => refreshEmbedStatus(), 1500)
  } catch (e: any) {
    embedError.value = e.message || t('adminLibrary.embedFailed')
  }
}

async function stopEmbed() {
  stoppingEmbed.value = true
  try {
    await trpc.library.stopEmbed.mutate()
  } catch (e: any) {
    embedError.value = e.message
  } finally {
    stoppingEmbed.value = false
  }
}

function formatEta(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '…'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s}s`
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return t('adminLibrary.never')
  return new Date(date).toLocaleString()
}
</script>

<template>
  <div class="p-6 max-w-4xl">
    <div class="flex items-center gap-4 mb-6">
      <NuxtLink to="/admin" class="text-text-muted hover:text-text-primary transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </NuxtLink>
      <h1 class="text-2xl font-bold text-text-primary">{{ t('adminLibrary.title') }}</h1>
    </div>

    <!-- Current Path -->
    <div class="mb-6 p-4 bg-surface border border-border rounded-xl">
      <h3 class="text-sm font-medium text-text-muted uppercase tracking-wider mb-2">
        {{ t('adminLibrary.mediaPath') }}
      </h3>
      <p class="text-text-primary font-mono">
        {{ settings?.mediaPath || t('adminLibrary.notConfigured') }}
      </p>
      <NuxtLink
        to="/admin/settings"
        class="text-sm text-primary hover:underline mt-2 inline-block"
      >
        {{ t('adminLibrary.changeInSettings') }}
      </NuxtLink>
    </div>

    <!-- Scan Controls -->
    <div class="mb-6 p-6 bg-surface border border-border rounded-xl">
      <div class="flex items-start justify-between">
        <div>
          <h3 class="font-semibold text-text-primary mb-1">{{ t('adminLibrary.libraryScan') }}</h3>
          <p class="text-sm text-text-secondary">
            {{ t('adminLibrary.scanDescription') }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UiButton
            v-if="scanStatus?.status === 'running'"
            variant="secondary"
            :loading="stopping"
            @click="stopScan"
          >
            {{ t('adminLibrary.stop') }}
          </UiButton>
          <UiButton
            :loading="scanStatus?.status === 'running' && !stopping"
            :disabled="scanStatus?.status === 'running' || !settings?.mediaPath"
            @click="startScan"
          >
            <template v-if="scanStatus?.status === 'running'">{{ t('adminLibrary.scanning') }}</template>
            <template v-else-if="scanStatus?.status === 'stopped'">{{ t('adminLibrary.resumeScan') }}</template>
            <template v-else>{{ t('adminLibrary.startScan') }}</template>
          </UiButton>
        </div>
      </div>

      <!-- Stopped info -->
      <div v-if="scanStatus?.status === 'stopped'" class="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
        <p class="text-sm text-yellow-500">
          {{ t('adminLibrary.stoppedInfo', { processed: scanStatus.processedFiles || 0, total: scanStatus.totalFiles || 0 }) }}
        </p>
      </div>

      <!-- Scan Progress -->
      <div v-if="scanStatus?.status === 'running'" class="mt-4">
        <div class="flex justify-between text-sm text-text-muted mb-2">
          <span>{{ t('adminLibrary.progress') }}</span>
          <span>
            {{ scanStatus.processedFiles || 0 }} / {{ scanStatus.totalFiles || 0 }} {{ t('adminLibrary.files') }}
          </span>
        </div>
        <div class="h-2 bg-surface-secondary rounded-full overflow-hidden">
          <div
            class="h-full bg-primary transition-all duration-300"
            :style="{
              width: scanStatus.totalFiles
                ? `${(scanStatus.processedFiles / scanStatus.totalFiles) * 100}%`
                : '0%'
            }"
          />
        </div>
        <div class="flex justify-between text-sm text-text-muted mt-2">
          <span>{{ t('adminLibrary.newFiles', { count: scanStatus.newFiles || 0 }) }}</span>
          <span>{{ t('adminLibrary.updatedFiles', { count: scanStatus.updatedFiles || 0 }) }}</span>
        </div>
      </div>

      <!-- Error -->
      <div v-if="scanError" class="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
        <p class="text-sm text-red-500">{{ scanError }}</p>
      </div>
    </div>

    <!-- Image Cache -->
    <div class="mb-6 p-6 bg-surface border border-border rounded-xl">
      <div class="flex items-start justify-between">
        <div>
          <h3 class="font-semibold text-text-primary mb-1">{{ t('adminLibrary.imageCache') }}</h3>
          <p class="text-sm text-text-secondary">
            {{ t('adminLibrary.imageCacheDesc') }}
          </p>
        </div>
        <UiButton
          :loading="cachingImages"
          :disabled="cachingImages"
          variant="secondary"
          @click="cacheImages"
        >
          {{ cachingImages ? t('adminLibrary.caching') : t('adminLibrary.cacheImages') }}
        </UiButton>
      </div>
      <div v-if="cacheResult" class="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
        <p class="text-sm text-green-500">
          {{ t('adminLibrary.cacheResult', { cached: cacheResult.cached, skipped: cacheResult.skipped, failed: cacheResult.failed }) }}
        </p>
      </div>
    </div>

    <!-- Synopsis Embeddings -->
    <div class="mb-6 p-6 bg-surface border border-border rounded-xl">
      <div class="flex items-start justify-between">
        <div class="flex-1 mr-4">
          <h3 class="font-semibold text-text-primary mb-1">{{ t('adminLibrary.embeddings') }}</h3>
          <p class="text-sm text-text-secondary">{{ t('adminLibrary.embeddingsDesc') }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <UiButton
            v-if="embedStatus?.status === 'model_loading' || embedStatus?.status === 'running'"
            variant="secondary"
            :loading="stoppingEmbed"
            @click="stopEmbed"
          >
            {{ t('adminLibrary.stop') }}
          </UiButton>
          <UiButton
            variant="secondary"
            :disabled="embedStatus?.status === 'model_loading' || embedStatus?.status === 'running'"
            :loading="embedStatus?.status === 'model_loading' || embedStatus?.status === 'running'"
            @click="startEmbed(true)"
          >
            {{ (embedStatus?.status === 'model_loading' || embedStatus?.status === 'running')
              ? t('adminLibrary.embedding')
              : t('adminLibrary.embedNew') }}
          </UiButton>
          <UiButton
            variant="secondary"
            size="sm"
            :disabled="embedStatus?.status === 'model_loading' || embedStatus?.status === 'running'"
            @click="startEmbed(false)"
          >
            {{ t('adminLibrary.embedAll') }}
          </UiButton>
        </div>
      </div>

      <!-- Model loading phase -->
      <div v-if="embedStatus?.status === 'model_loading'" class="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <div class="flex items-center gap-2">
          <svg class="animate-spin w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          <p class="text-sm text-blue-400">
            {{ embedStatus.downloadMsg || t('adminLibrary.embedLoadingModel') }}
          </p>
        </div>
      </div>

      <!-- Running phase -->
      <div v-if="embedStatus?.status === 'running'" class="mt-4">
        <div class="flex justify-between text-sm text-text-muted mb-2">
          <span>{{ embedStatus.processed }} / {{ embedStatus.total }} {{ t('adminLibrary.films') }}</span>
          <span>
            {{ embedStatus.speedPerSec }} {{ t('adminLibrary.filmsPerSec') }}
            · ETA {{ formatEta(embedStatus.etaSec) }}
          </span>
        </div>
        <div class="h-2 bg-surface-secondary rounded-full overflow-hidden">
          <div
            class="h-full bg-primary transition-all duration-300"
            :style="{ width: `${embedStatus.percent}%` }"
          />
        </div>
        <div class="text-right text-xs text-text-muted mt-1">{{ embedStatus.percent }}%</div>
      </div>

      <!-- Completed -->
      <div v-if="embedStatus?.status === 'completed'" class="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
        <p class="text-sm text-green-500">
          {{ t('adminLibrary.embedCompleted', { count: embedStatus.processed }) }}
        </p>
      </div>

      <!-- Cancelled -->
      <div v-if="embedStatus?.status === 'cancelled'" class="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
        <p class="text-sm text-yellow-500">
          {{ t('adminLibrary.embedCancelled', { processed: embedStatus.processed, total: embedStatus.total }) }}
        </p>
      </div>

      <!-- Failed -->
      <div v-if="embedStatus?.status === 'failed'" class="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
        <p class="text-sm text-red-500">{{ embedStatus.error || t('adminLibrary.embedFailed') }}</p>
      </div>

      <!-- Error -->
      <div v-if="embedError" class="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
        <p class="text-sm text-red-500">{{ embedError }}</p>
      </div>
    </div>

    <!-- Scan History -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden">
      <div class="px-6 py-4 border-b border-border">
        <h3 class="font-semibold text-text-primary">{{ t('adminLibrary.scanHistory') }}</h3>
      </div>
      <div v-if="!scanHistory?.length" class="p-6 text-center text-text-muted">
        {{ t('adminLibrary.noHistory') }}
      </div>
      <div v-else class="divide-y divide-border">
        <div
          v-for="scan in scanHistory"
          :key="scan.id"
          class="px-6 py-4 flex items-center justify-between"
        >
          <div>
            <p class="text-sm text-text-primary">
              {{ formatDate(scan.startedAt) }}
            </p>
            <p class="text-xs text-text-muted">
              {{ t('adminLibrary.newFiles', { count: scan.newFiles || 0 }) }}, {{ t('adminLibrary.updatedFiles', { count: scan.updatedFiles || 0 }) }}
            </p>
          </div>
          <div
            :class="[
              'px-2 py-1 rounded text-xs font-medium',
              scan.status === 'completed' ? 'bg-green-500/10 text-green-500' :
              scan.status === 'running' ? 'bg-blue-500/10 text-blue-500' :
              scan.status === 'stopped' ? 'bg-yellow-500/10 text-yellow-500' :
              'bg-red-500/10 text-red-500'
            ]"
          >
            {{ t(`adminLibrary.${scan.status}`) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
