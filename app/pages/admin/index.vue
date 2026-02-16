<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const trpc = useTrpc()
const { t } = useI18n()
const { appName } = useAppName()

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

function simpleMarkdown(text: string): string {
  return text
    // Headers
    .replace(/^### (.+)$/gm, '<h4 class="font-semibold text-text-primary mt-2 mb-1">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-semibold text-text-primary mt-2 mb-1">$1</h3>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-text-primary">$1</strong>')
    // Links
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" class="text-primary hover:underline">$1</a>')
    // Bare URLs
    .replace(/(?<!\()(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" class="text-primary hover:underline">$1</a>')
    // List items
    .replace(/^[*-] (.+)$/gm, '<li class="ml-3">$1</li>')
    // Newlines
    .replace(/\n/g, '<br>')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

// Fetch stats
const { data: stats } = useAsyncData('admin-stats', () => trpc.media.stats.query())
const { data: users } = useAsyncData('admin-users', () => trpc.users.list.query())
const { data: scanStatus } = useAsyncData('scan-status', () => trpc.library.scanStatus.query())

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
    <h1 class="text-2xl font-bold text-text-primary mb-2">{{ t('admin.title') }}</h1>
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

    <!-- Version & Update -->
    <div class="mb-8 p-4 bg-surface border border-border rounded-xl">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="font-semibold text-text-primary">{{ t('adminUpdate.title') }}</h3>
          <p v-if="versionInfo" class="text-sm text-text-muted mt-1">
            {{ t('adminUpdate.currentVersion') }}:
            <span class="font-mono text-text-primary">{{ versionInfo.version }}</span>
            <span v-if="versionInfo.commitSha !== 'dev'" class="text-xs text-text-muted ml-2">
              ({{ versionInfo.commitSha.slice(0, 7) }})
            </span>
          </p>
        </div>
        <UiButton
          size="sm"
          variant="secondary"
          :loading="checkingUpdate"
          @click="checkForUpdate"
        >
          {{ t('adminUpdate.checkUpdate') }}
        </UiButton>
      </div>

      <!-- Update error -->
      <div v-if="updateError" class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg mb-3">
        <p class="text-sm text-red-500">{{ updateError }}</p>
      </div>

      <!-- Update info -->
      <div v-if="updateInfo" class="mt-3">
        <div v-if="updateInfo.hasUpdate" class="p-4 bg-primary/10 border border-primary/20 rounded-lg">
          <div class="flex items-center justify-between mb-2">
            <div>
              <p class="font-medium text-text-primary">
                {{ t('adminUpdate.newVersionAvailable') }}: {{ updateInfo.latestName || updateInfo.latestVersion }}
              </p>
              <p class="text-xs text-text-muted mt-1">
                {{ t('adminUpdate.publishedAt') }}: {{ new Date(updateInfo.publishedAt).toLocaleDateString() }}
                <span v-if="updateInfo.downloadSize" class="ml-2">
                  ({{ formatBytes(updateInfo.downloadSize) }})
                </span>
              </p>
            </div>
            <UiButton
              size="sm"
              :loading="updating"
              :disabled="!updateInfo.downloadUrl"
              @click="performUpdate"
            >
              {{ t('adminUpdate.installUpdate') }}
            </UiButton>
          </div>
          <div v-if="updateInfo.releaseNotes" class="mt-3 p-3 bg-surface-secondary rounded-lg text-xs text-text-muted leading-relaxed" v-html="simpleMarkdown(updateInfo.releaseNotes)" />
          <a
            :href="updateInfo.releaseUrl"
            target="_blank"
            class="text-xs text-primary hover:underline mt-2 inline-block"
          >
            {{ t('adminUpdate.viewOnGithub') }}
          </a>
        </div>
        <div v-else class="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <p class="text-sm text-green-500">{{ t('adminUpdate.upToDate') }}</p>
        </div>
      </div>
    </div>

    <!-- Search & Deindex -->
    <div class="mb-8 p-4 bg-surface border border-border rounded-xl">
      <h3 class="font-semibold text-text-primary mb-3">{{ t('adminDash.searchDeindex') }}</h3>
      <p class="text-sm text-text-muted mb-3">{{ t('adminDash.searchDeindexDesc') }}</p>
      <div class="relative">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('adminDash.searchPlaceholder')"
          class="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary"
        >
      </div>
      <!-- Results -->
      <div v-if="searching" class="mt-3 text-sm text-text-muted">{{ t('common.loading') }}</div>
      <div v-else-if="searchResults.length > 0" class="mt-3 divide-y divide-border max-h-80 overflow-y-auto rounded-lg border border-border">
        <div
          v-for="item in searchResults"
          :key="item.id"
          class="flex items-center justify-between px-3 py-2 hover:bg-surface-secondary"
        >
          <div class="flex items-center gap-3 min-w-0">
            <img
              v-if="item.posterPath"
              :src="item.posterPath"
              class="w-8 h-12 rounded object-cover flex-shrink-0"
            >
            <div v-else class="w-8 h-12 rounded bg-surface-secondary flex-shrink-0 flex items-center justify-center">
              <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" />
              </svg>
            </div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-text-primary truncate">{{ item.title }}</p>
              <p class="text-xs text-text-muted">
                {{ item.mediaType === 'tv' && item.season != null ? `S${String(item.season).padStart(2,'0')}E${String(item.episode).padStart(2,'0')} - ` : '' }}{{ item.year || '' }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="flex-shrink-0 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
            @click="deindexMedia(item.id)"
          >
            {{ t('adminDash.deindex') }}
          </button>
        </div>
      </div>
      <div v-else-if="searchQuery.length >= 2 && !searching" class="mt-3 text-sm text-text-muted">
        {{ t('adminDash.noResults') }}
      </div>
    </div>

    <!-- No TMDB ID -->
    <div class="mb-8 p-4 bg-surface border border-border rounded-xl">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-text-primary">{{ t('adminDash.noTmdbId') }}</h3>
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
      </div>
      <p class="text-sm text-text-muted mb-3">{{ t('adminDash.noTmdbIdDesc') }}</p>

      <div v-if="!noTmdbMedia?.length" class="text-sm text-green-500 py-2">
        {{ t('adminDash.allHaveTmdb') }}
      </div>
      <div v-else class="divide-y divide-border max-h-60 overflow-y-auto rounded-lg border border-border">
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
            <p class="text-xs text-text-muted truncate">{{ item.fileName }}</p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <NuxtLink
              :to="`/media/${item.id}`"
              class="px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
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
      <p v-if="noTmdbMedia?.length" class="text-xs text-text-muted mt-2">
        {{ t('adminDash.noTmdbCount', { count: noTmdbMedia.length }) }}
      </p>
    </div>

    <!-- Duplicates -->
    <div class="mb-8 p-4 bg-surface border border-border rounded-xl">
      <h3 class="font-semibold text-text-primary mb-3">{{ t('adminDash.duplicates') }}</h3>
      <p class="text-sm text-text-muted mb-3">{{ t('adminDash.duplicatesDesc') }}</p>

      <div v-if="!duplicates?.length" class="text-sm text-green-500 py-2">
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
              <p class="text-xs text-text-muted truncate min-w-0 flex-1">{{ item.fileName }}</p>
              <div class="flex items-center gap-2 flex-shrink-0 ml-2">
                <NuxtLink
                  :to="`/media/${item.id}`"
                  class="text-xs text-primary hover:underline"
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
</template>
