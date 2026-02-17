<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const trpc = useTrpc()
const { t } = useI18n()
const { appName } = useAppName()

useHead({ title: computed(() => t('nav.admin')) })

// Version info
const versionInfo = ref<{ commitSha: string; version: string } | null>(null)
const updateInfo = ref<{
  currentVersion: string
  latestVersion: string
  latestName: string
  publishedAt: string
  releaseUrl: string
  releaseNotes: string
  hasUpdate: boolean
  downloadUrl: string | null
  downloadSize: number
} | null>(null)
const checkingUpdate = ref(false)
const updating = ref(false)
const updateError = ref('')

onMounted(async () => {
  try {
    versionInfo.value = await $fetch('/api/admin/version')
  } catch {
    // ignore
  }
  // Auto-check for updates
  checkForUpdate()
})

async function checkForUpdate() {
  checkingUpdate.value = true
  updateError.value = ''
  try {
    updateInfo.value = await $fetch('/api/admin/check-update')
  } catch (e: any) {
    updateError.value = e.data?.statusMessage || e.message || t('adminUpdate.checkFailed')
  } finally {
    checkingUpdate.value = false
  }
}

async function performUpdate() {
  if (!updateInfo.value?.downloadUrl) return
  if (!confirm(t('adminUpdate.confirmUpdate'))) return

  updating.value = true
  updateError.value = ''
  try {
    await $fetch('/api/admin/update', {
      method: 'POST',
      body: { downloadUrl: updateInfo.value.downloadUrl, version: updateInfo.value.latestVersion },
    })
    alert(t('adminUpdate.updateSuccess'))
    setTimeout(() => window.location.reload(), 5000)
  } catch (e: any) {
    updateError.value = e.data?.statusMessage || e.message || t('adminUpdate.updateFailed')
  } finally {
    updating.value = false
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'
  return (bytes / 1073741824).toFixed(2) + ' GB'
}

// Fetch stats
const { data: stats } = useAsyncData('admin-stats', () => trpc.media.stats.query())
const { data: users } = useAsyncData('admin-users', () => trpc.users.list.query())
const { data: scanStatus } = useAsyncData('scan-status', () => trpc.library.scanStatus.query())

// System stats (CPU / RAM) with auto-refresh
const systemStats = ref<{
  cpu: { percent: number, cores: number }
  memory: { rss: number, heapUsed: number, heapTotal: number, totalSystem: number, freeSystem: number }
  uptime: number
} | null>(null)

async function fetchSystemStats() {
  try {
    systemStats.value = await trpc.media.systemStats.query()
  } catch { /* ignore */ }
}

let systemStatsInterval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  fetchSystemStats()
  systemStatsInterval = setInterval(fetchSystemStats, 5000)
})
onUnmounted(() => {
  if (systemStatsInterval) clearInterval(systemStatsInterval)
})

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (d > 0) return `${d}j ${h}h ${m}m ${s}s`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

// Modal states
const showNoTmdbModal = ref(false)
const showDuplicatesModal = ref(false)

// Media without TMDB ID
const noTmdbTab = ref<'movie' | 'tv'>('movie')
const { data: noTmdbMedia, refresh: refreshNoTmdb } = useAsyncData(
  'no-tmdb-media',
  () => trpc.media.noTmdbMedia.query({ limit: 50, mediaType: noTmdbTab.value }),
  { watch: [noTmdbTab] }
)

// Duplicate media
const { data: duplicates, refresh: refreshDuplicates } = useAsyncData(
  'duplicate-media',
  () => trpc.media.duplicateMedia.query()
)

// Library search (for deindexing)
const searchQuery = ref('')
const searchResults = ref<any[]>([])
const searching = ref(false)
let searchTimeout: NodeJS.Timeout | null = null

watch(searchQuery, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!val || val.length < 2) {
    searchResults.value = []
    return
  }
  searchTimeout = setTimeout(async () => {
    searching.value = true
    try {
      const res = await trpc.media.list.query({ search: val, limit: 20 })
      searchResults.value = res.items
    } catch { searchResults.value = [] }
    searching.value = false
  }, 400)
})

async function deindexMedia(id: string) {
  if (!confirm(t('adminDash.confirmDeindex'))) return
  try {
    await trpc.media.delete.mutate(id)
    searchResults.value = searchResults.value.filter(m => m.id !== id)
    refreshNoTmdb()
    refreshDuplicates()
  } catch (e: any) {
    alert(e.message)
  }
}

const adminSections = computed(() => [
  {
    title: t('admin.library'),
    description: t('admin.libraryDesc'),
    icon: 'folder',
    to: '/admin/library',
  },
  {
    title: t('admin.usersManagement'),
    description: t('admin.usersDesc'),
    icon: 'users',
    to: '/admin/users',
  },
  {
    title: t('admin.settings'),
    description: t('admin.settingsDesc'),
    icon: 'cog',
    to: '/admin/settings',
  },
])
</script>

<template>
  <div class="p-6">
    <!-- Header with version badge aligned right -->
    <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
      <h1 class="text-2xl font-bold text-text-primary">{{ t('admin.title') }}</h1>
      <div class="flex items-center gap-2">
        <!-- Update error (small inline) -->
        <span v-if="updateError" class="text-xs text-red-500">{{ updateError }}</span>
        <!-- Version badge -->
        <template v-if="versionInfo">
          <button
            v-if="updateInfo && !updateInfo.hasUpdate"
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500/10 text-green-500 border border-green-500/20 hover:bg-green-500/20 transition-colors cursor-default"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-green-500" />
            {{ versionInfo.version }}
          </button>
          <template v-else-if="updateInfo?.hasUpdate">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
              :disabled="updating || !updateInfo.downloadUrl"
              @click="performUpdate"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {{ versionInfo.version }} &rarr; {{ updateInfo.latestVersion }}
              <span class="ml-1 px-1.5 py-0.5 bg-primary text-white rounded text-[10px] leading-none">
                {{ updating ? '...' : t('adminUpdate.installUpdate') }}
              </span>
            </button>
          </template>
          <button
            v-else-if="checkingUpdate"
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary text-text-muted border border-border cursor-default"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-text-muted animate-pulse" />
            {{ versionInfo.version }}
          </button>
          <button
            v-else
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary text-text-muted border border-border hover:bg-surface-secondary/80 hover:border-primary/30 transition-colors"
            @click="checkForUpdate"
          >
            {{ versionInfo.version }}
          </button>
        </template>
      </div>
    </div>
    <p class="text-text-secondary mb-8">{{ t('admin.subtitle', { appName: appName }) }}</p>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-3xl font-bold text-text-primary">
          {{ stats?.totalMedia || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('admin.totalMedia') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-3xl font-bold text-text-primary">
          {{ stats?.totalMovies || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('admin.totalMovies') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-3xl font-bold text-text-primary">
          {{ stats?.totalTv || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('admin.totalTvShows') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-3xl font-bold text-text-primary">
          {{ users?.length || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('admin.users') }}</p>
      </div>
    </div>

    <!-- System monitoring -->
    <div v-if="systemStats" class="mb-8 p-4 bg-surface border border-border rounded-xl">
      <h3 class="font-semibold text-text-primary mb-4">{{ t('admin.system') }}</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <!-- CPU -->
        <div class="flex flex-col items-center">
          <div class="relative w-20 h-20">
            <svg class="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
              <path
                class="text-surface-secondary"
                stroke="currentColor"
                stroke-width="3"
                fill="none"
                d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                class="text-primary"
                stroke="currentColor"
                stroke-width="3"
                fill="none"
                stroke-linecap="round"
                :stroke-dasharray="`${systemStats.cpu.percent}, 100`"
                d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div class="absolute inset-0 flex items-center justify-center">
              <span class="text-sm font-bold text-text-primary">{{ systemStats.cpu.percent }}%</span>
            </div>
          </div>
          <p class="text-xs text-text-muted mt-2">{{ t('admin.cpuUsage') }}</p>
          <p class="text-xs text-text-muted">{{ systemStats.cpu.cores }} cores</p>
        </div>

        <!-- Process memory -->
        <div class="flex flex-col justify-center">
          <p class="text-xs text-text-muted mb-1">{{ t('admin.processMemory') }}</p>
          <div class="h-2 bg-surface-secondary rounded-full overflow-hidden mb-1">
            <div
              class="h-full bg-primary transition-all duration-300"
              :style="{ width: `${Math.min(100, (systemStats.memory.heapUsed / systemStats.memory.heapTotal) * 100)}%` }"
            />
          </div>
          <p class="text-xs text-text-muted">
            {{ formatBytes(systemStats.memory.heapUsed) }} / {{ formatBytes(systemStats.memory.heapTotal) }}
          </p>
          <p class="text-xs text-text-muted mt-1">
            RSS: {{ formatBytes(systemStats.memory.rss) }}
          </p>
        </div>

        <!-- System memory -->
        <div class="flex flex-col justify-center">
          <p class="text-xs text-text-muted mb-1">{{ t('admin.systemMemory') }}</p>
          <div class="h-2 bg-surface-secondary rounded-full overflow-hidden mb-1">
            <div
              class="h-full bg-blue-500 transition-all duration-300"
              :style="{ width: `${Math.min(100, ((systemStats.memory.totalSystem - systemStats.memory.freeSystem) / systemStats.memory.totalSystem) * 100)}%` }"
            />
          </div>
          <p class="text-xs text-text-muted">
            {{ formatBytes(systemStats.memory.totalSystem - systemStats.memory.freeSystem) }} / {{ formatBytes(systemStats.memory.totalSystem) }}
          </p>
        </div>

        <!-- Uptime -->
        <div class="flex flex-col items-center justify-center">
          <p class="text-2xl font-bold text-text-primary">{{ formatUptime(systemStats.uptime) }}</p>
          <p class="text-xs text-text-muted">{{ t('admin.uptime') }}</p>
        </div>
      </div>
    </div>

    <!-- Admin sections (Library / Users / Settings) -->
    <div class="grid md:grid-cols-3 gap-4 mb-8">
      <NuxtLink
        v-for="section in adminSections"
        :key="section.to"
        :to="section.to"
        class="p-6 bg-surface border border-border rounded-xl hover:border-primary/50 transition-colors group"
      >
        <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
          <svg v-if="section.icon === 'folder'" class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <svg v-if="section.icon === 'users'" class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <svg v-if="section.icon === 'cog'" class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h3 class="font-semibold text-text-primary mb-1">{{ section.title }}</h3>
        <p class="text-sm text-text-secondary">{{ section.description }}</p>
      </NuxtLink>
    </div>

    <!-- Scan status -->
    <div v-if="scanStatus" class="mb-8 p-4 bg-surface border border-border rounded-xl">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-medium text-text-primary">{{ t('admin.libraryScanStatus') }}</h3>
          <p class="text-sm text-text-muted">
            <template v-if="scanStatus.status === 'running'">
              {{ t('admin.scanning', { processed: scanStatus.processedFiles || 0, total: scanStatus.totalFiles || 0 }) }}
            </template>
            <template v-else-if="scanStatus.status === 'completed'">
              {{ t('admin.lastScanCompleted', { new: scanStatus.newFiles || 0 }) }}
            </template>
            <template v-else>
              {{ t('admin.lastScanFailed') }}
            </template>
          </p>
        </div>
        <div
          :class="[
            'w-3 h-3 rounded-full',
            scanStatus.status === 'running' ? 'bg-yellow-500 animate-pulse' :
            scanStatus.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
          ]"
        />
      </div>
      <div v-if="scanStatus.status === 'running'" class="mt-3">
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
      </div>
    </div>

    <!-- Tools: 3 cards side by side -->
    <div class="grid md:grid-cols-3 gap-4 mb-8">
      <!-- Search & Deindex (inline — always visible) -->
      <div class="p-4 bg-surface border border-border rounded-xl">
        <div class="flex items-center gap-2 mb-3">
          <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h3 class="font-semibold text-text-primary text-sm">{{ t('adminDash.searchDeindex') }}</h3>
        </div>
        <div class="relative">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('adminDash.searchPlaceholder')"
            class="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-primary"
          >
        </div>
        <div v-if="searching" class="mt-2 text-xs text-text-muted">{{ t('common.loading') }}</div>
        <div v-else-if="searchResults.length > 0" class="mt-2 divide-y divide-border max-h-48 overflow-y-auto rounded-lg border border-border">
          <div
            v-for="item in searchResults"
            :key="item.id"
            class="flex items-center justify-between px-2 py-1.5 hover:bg-surface-secondary"
          >
            <div class="min-w-0">
              <p class="text-xs font-medium text-text-primary truncate">{{ item.title }}</p>
              <p class="text-xs text-text-muted">
                {{ item.mediaType === 'tv' && item.season != null ? `S${String(item.season).padStart(2,'0')}E${String(item.episode).padStart(2,'0')}` : '' }}
              </p>
            </div>
            <button
              type="button"
              class="flex-shrink-0 px-2 py-0.5 text-xs text-red-500 hover:bg-red-500/10 rounded transition-colors"
              @click="deindexMedia(item.id)"
            >
              {{ t('adminDash.deindex') }}
            </button>
          </div>
        </div>
        <div v-else-if="searchQuery.length >= 2 && !searching" class="mt-2 text-xs text-text-muted">
          {{ t('adminDash.noResults') }}
        </div>
      </div>

      <!-- No TMDB ID (card → modal) -->
      <button
        type="button"
        class="p-4 bg-surface border border-border rounded-xl hover:border-primary/50 transition-colors text-left"
        @click="showNoTmdbModal = true"
      >
        <div class="flex items-center gap-2 mb-2">
          <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <h3 class="font-semibold text-text-primary text-sm">{{ t('adminDash.noTmdbId') }}</h3>
        </div>
        <p class="text-xs text-text-muted mb-2">{{ t('adminDash.noTmdbIdDesc') }}</p>
        <p v-if="noTmdbMedia?.length" class="text-2xl font-bold text-primary">{{ noTmdbMedia.length }}</p>
        <p v-else class="text-xs text-green-500">{{ t('adminDash.allHaveTmdb') }}</p>
      </button>

      <!-- Duplicates (card → modal) -->
      <button
        type="button"
        class="p-4 bg-surface border border-border rounded-xl hover:border-primary/50 transition-colors text-left"
        @click="showDuplicatesModal = true"
      >
        <div class="flex items-center gap-2 mb-2">
          <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <h3 class="font-semibold text-text-primary text-sm">{{ t('adminDash.duplicates') }}</h3>
        </div>
        <p class="text-xs text-text-muted mb-2">{{ t('adminDash.duplicatesDesc') }}</p>
        <p v-if="duplicates?.length" class="text-2xl font-bold text-primary">{{ duplicates.length }}</p>
        <p v-else class="text-xs text-green-500">{{ t('adminDash.noDuplicates') }}</p>
      </button>
    </div>

    <!-- No TMDB Modal -->
    <Teleport to="body">
      <div
        v-if="showNoTmdbModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showNoTmdbModal = false"
      >
        <div class="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
          <div class="flex items-center justify-between p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">{{ t('adminDash.noTmdbId') }}</h3>
            <div class="flex items-center gap-3">
              <div class="flex gap-1 bg-background rounded-lg p-0.5">
                <button
                  type="button"
                  class="px-3 py-1 text-xs font-medium rounded-md transition-colors"
                  :class="noTmdbTab === 'movie' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-primary'"
                  @click="noTmdbTab = 'movie'"
                >
                  {{ t('admin.totalMovies') }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1 text-xs font-medium rounded-md transition-colors"
                  :class="noTmdbTab === 'tv' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-primary'"
                  @click="noTmdbTab = 'tv'"
                >
                  {{ t('admin.totalTvShows') }}
                </button>
              </div>
              <button type="button" class="p-1 hover:bg-surface-secondary rounded-lg" @click="showNoTmdbModal = false">
                <svg class="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div class="p-4 overflow-y-auto">
            <div v-if="!noTmdbMedia?.length" class="text-sm text-green-500 py-4 text-center">
              {{ t('adminDash.allHaveTmdb') }}
            </div>
            <div v-else class="divide-y divide-border rounded-lg border border-border">
              <div
                v-for="item in noTmdbMedia"
                :key="item.id"
                class="flex items-center justify-between px-3 py-2 hover:bg-surface-secondary"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium text-text-primary truncate">
                    {{ item.title }}
                    <span v-if="item.season != null" class="text-text-muted">
                      S{{ String(item.season).padStart(2,'0') }}E{{ String(item.episode).padStart(2,'0') }}
                    </span>
                  </p>
                  <p class="text-xs text-text-muted truncate">
                    {{ item.fileName }}
                    <span v-if="item.fileSize" class="ml-1 text-text-muted/60">({{ formatBytes(item.fileSize) }})</span>
                  </p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <NuxtLink
                    :to="`/media/${item.id}`"
                    class="px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    @click="showNoTmdbModal = false"
                  >
                    {{ t('adminDash.identify') }}
                  </NuxtLink>
                  <button
                    type="button"
                    class="px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                    @click="deindexMedia(item.id)"
                  >
                    {{ t('adminDash.deindex') }}
                  </button>
                </div>
              </div>
            </div>
            <p v-if="noTmdbMedia?.length" class="text-xs text-text-muted mt-3">
              {{ t('adminDash.noTmdbCount', { count: noTmdbMedia.length }) }}
            </p>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Duplicates Modal -->
    <Teleport to="body">
      <div
        v-if="showDuplicatesModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showDuplicatesModal = false"
      >
        <div class="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
          <div class="flex items-center justify-between p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">{{ t('adminDash.duplicates') }}</h3>
            <button type="button" class="p-1 hover:bg-surface-secondary rounded-lg" @click="showDuplicatesModal = false">
              <svg class="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="p-4 overflow-y-auto">
            <div v-if="!duplicates?.length" class="text-sm text-green-500 py-4 text-center">
              {{ t('adminDash.noDuplicates') }}
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="dup in duplicates"
                :key="dup.title"
                class="border border-border rounded-lg overflow-hidden"
              >
                <div class="px-3 py-2 bg-surface-secondary flex items-center justify-between">
                  <p class="text-sm font-medium text-text-primary">
                    {{ dup.title }}
                    <span class="text-text-muted ml-1">(x{{ dup.count }})</span>
                    <span v-if="dup.tmdbId" class="text-xs text-text-muted ml-2">TMDB #{{ dup.tmdbId }}</span>
                  </p>
                </div>
                <div class="divide-y divide-border">
                  <div
                    v-for="item in dup.items"
                    :key="item.id"
                    class="flex items-center justify-between px-3 py-2"
                  >
                    <p class="text-xs text-text-muted truncate min-w-0 flex-1">
                      {{ item.fileName }}
                      <span v-if="item.fileSize" class="ml-1 text-text-muted/60">({{ formatBytes(item.fileSize) }})</span>
                    </p>
                    <div class="flex items-center gap-2 flex-shrink-0 ml-2">
                      <NuxtLink
                        :to="`/media/${item.id}`"
                        class="text-xs text-primary hover:underline"
                        @click="showDuplicatesModal = false"
                      >
                        {{ t('common.edit') }}
                      </NuxtLink>
                      <button
                        type="button"
                        class="text-xs text-red-500 hover:underline"
                        @click="deindexMedia(item.id)"
                      >
                        {{ t('adminDash.deindex') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>
