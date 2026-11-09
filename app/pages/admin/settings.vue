<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const trpc = useTrpc()
const { t } = useI18n()

useHead({ title: computed(() => t('admin.settings')) })

const loading = ref(false)
const success = ref(false)
const error = ref('')
const analyticsModalOpen = ref(false)
const analyticsLoading = ref(false)
const analyticsError = ref('')

// Form data
const appNameInput = ref('')
const mediaPath = ref('')
const tmdbApiKey = ref('')
const groqApiKey = ref('')
const groqModel = ref('llama-3.1-8b-instant')
const autoUpdateEnabled = ref(false)
const autoScanEnabled = ref(false)
const scanInterval = ref(24)
const registrationEnabled = ref(true)
const bugReportEnabled = ref(false)
const bugReportWebhookUrl = ref('')

// Announcements
const announcementsLoading = ref(false)
const announcementsError = ref('')
const showAnnouncementForm = ref(false)
const editingAnnouncementId = ref<string | null>(null)
const announcementForm = ref({
  message: '',
  type: 'info' as 'info' | 'warning' | 'success' | 'error',
  dismissible: true,
})

const { data: announcements, refresh: refreshAnnouncements } = useAsyncData(
  'settings-announcements',
  () => trpc.announcements.getAll.query()
)
const sessions = ref<Array<{ userId: string, email: string, currentPage: string, lastActive: number }>>([])
function openCreateAnnouncement() {
  editingAnnouncementId.value = null
  announcementForm.value = { message: '', type: 'info', dismissible: true }
  announcementsError.value = ''
  showAnnouncementForm.value = true
}

function openEditAnnouncement(a: any) {
  editingAnnouncementId.value = a.id
  announcementForm.value = { message: a.message, type: a.type, dismissible: a.dismissible }
  announcementsError.value = ''
  showAnnouncementForm.value = true
}

function cancelAnnouncementForm() {
  showAnnouncementForm.value = false
  editingAnnouncementId.value = null
  announcementsError.value = ''
}

async function saveAnnouncement() {
  if (!announcementForm.value.message.trim()) return
  announcementsLoading.value = true
  announcementsError.value = ''
  try {
    if (editingAnnouncementId.value) {
      await trpc.announcements.update.mutate({
        id: editingAnnouncementId.value,
        message: announcementForm.value.message,
        type: announcementForm.value.type,
        dismissible: announcementForm.value.dismissible,
      })
    } else {
      await trpc.announcements.create.mutate({
        message: announcementForm.value.message,
        type: announcementForm.value.type,
        dismissible: announcementForm.value.dismissible,
      })
    }
    showAnnouncementForm.value = false
    editingAnnouncementId.value = null
    await refreshAnnouncements()
  } catch (e: any) {
    announcementsError.value = e.message || 'Failed to save'
  } finally {
    announcementsLoading.value = false
  }
}

async function deleteAnnouncement(id: string) {
  if (!window.confirm(t('announcements.deleteConfirm'))) return
  try {
    await trpc.announcements.delete.mutate({ id })
    await refreshAnnouncements()
  } catch (e: any) {
    useToast().error(e.message)
  }
}

async function toggleAnnouncementActive(a: any) {
  try {
    await trpc.announcements.update.mutate({ id: a.id, active: !a.active })
    await refreshAnnouncements()
  } catch (e: any) {
    useToast().error(e.message)
  }
}

function getAnnouncementBadgeClass(type: string) {
  switch (type) {
    case 'info': return 'bg-blue-500/10 text-blue-500'
    case 'warning': return 'bg-yellow-500/10 text-yellow-500'
    case 'success': return 'bg-green-500/10 text-green-500'
    case 'error': return 'bg-red-500/10 text-red-500'
    default: return 'bg-gray-500/10 text-gray-400'
  }
}

function formatRelativeDate(value: number) {
  const diffMs = Date.now() - value
  const diffSec = Math.max(0, Math.floor(diffMs / 1000))

  if (diffSec < 10) return t('adminSettings.analyticsJustNow')
  if (diffSec < 60) return t('adminSettings.analyticsSecondsAgo', { count: diffSec })

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return t('adminSettings.analyticsMinutesAgo', { count: diffMin })

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return t('adminSettings.analyticsHoursAgo', { count: diffHours })

  const diffDays = Math.floor(diffHours / 24)
  return t('adminSettings.analyticsDaysAgo', { count: diffDays })
}

async function loadAnalyticsData() {
  analyticsLoading.value = true
  analyticsError.value = ''

  try {
    sessions.value = await trpc.analytics.getActiveSessions.query()
  } catch (e: any) {
    analyticsError.value = e.message || t('adminSettings.analyticsLoadError')
  } finally {
    analyticsLoading.value = false
  }
}

async function openAnalyticsModal() {
  analyticsModalOpen.value = true
  await loadAnalyticsData()
}

async function refreshAnalytics() {
  await loadAnalyticsData()
}

async function suppressSession(userId: string) {
  try {
    await trpc.analytics.suppressSession.mutate({ userId })
    sessions.value = sessions.value.filter(session => session.userId !== userId)
    useToast().success(t('adminSettings.analyticsIgnoreSuccess'))
  } catch (e: any) {
    useToast().error(e.message || t('adminSettings.analyticsIgnoreError'))
  }
}

onMounted(() => {
  loadAnalyticsData().catch(() => {})
})

// Load settings
const { data: settings, pending } = useAsyncData('settings', async () => {
  const data = await trpc.settings.getAll.query()
  return data
})

// Initialize form when settings load
watch(settings, (data) => {
  if (data) {
    appNameInput.value = (data.appName as string) || ''
    mediaPath.value = (data.mediaPath as string) || ''
    tmdbApiKey.value = (data.tmdbApiKey as string) || ''
    groqApiKey.value = (data.groqApiKey as string) || ''
    groqModel.value = (data.groqModel as string) || 'llama-3.1-8b-instant'
    autoUpdateEnabled.value = data.autoUpdateEnabled === true || data.autoUpdateEnabled === 'true'
    autoScanEnabled.value = (data.autoScanEnabled as boolean) || false
    scanInterval.value = (data.scanInterval as number) || 24
    registrationEnabled.value = data.registrationEnabled !== false
    bugReportEnabled.value = (data.bugReportEnabled as boolean) || false
    bugReportWebhookUrl.value = (data.bugReportWebhookUrl as string) || ''
  }
}, { immediate: true })

async function saveSettings() {
  loading.value = true
  error.value = ''
  success.value = false

  try {
    await trpc.settings.setMany.mutate({
      appName: appNameInput.value || undefined,
      mediaPath: mediaPath.value,
      tmdbApiKey: tmdbApiKey.value,
      groqApiKey: groqApiKey.value,
      groqModel: groqModel.value,
      autoUpdateEnabled: autoUpdateEnabled.value,
      autoScanEnabled: autoScanEnabled.value,
      scanInterval: scanInterval.value,
      registrationEnabled: registrationEnabled.value,
      bugReportEnabled: bugReportEnabled.value,
      bugReportWebhookUrl: bugReportWebhookUrl.value || undefined,
    })
    success.value = true
    setTimeout(() => {
      success.value = false
    }, 3000)
  } catch (e: any) {
    error.value = e.message || t('adminSettings.failedToSave')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center gap-4 mb-6">
      <NuxtLink to="/admin" class="text-text-muted hover:text-text-primary transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </NuxtLink>
      <h1 class="text-2xl font-bold text-text-primary">{{ t('adminSettings.title') }}</h1>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="space-y-4">
      <UiSkeleton height="4rem" />
      <UiSkeleton height="4rem" />
      <UiSkeleton height="4rem" />
    </div>

    <!-- Settings form -->
    <form v-else @submit.prevent="saveSettings">
      <!-- Top row: 2 columns -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <!-- App Name -->
        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h3 class="font-semibold text-text-primary">{{ t('adminSettings.appName') }}</h3>

          <UiInput
            v-model="appNameInput"
            :label="t('adminSettings.appNameLabel')"
            :placeholder="t('adminSettings.appNamePlaceholder')"
          >
            <template #description>
              <p class="text-xs text-text-muted mt-1">
                {{ t('adminSettings.appNameDesc') }}
              </p>
            </template>
          </UiInput>
        </div>

        <!-- Media Library -->
        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h3 class="font-semibold text-text-primary">{{ t('adminSettings.mediaLibrary') }}</h3>

          <UiInput
            v-model="mediaPath"
            :label="t('adminSettings.mediaPath')"
            :placeholder="t('adminSettings.mediaPathPlaceholder')"
          >
            <template #description>
              <p class="text-xs text-text-muted mt-1">
                {{ t('adminSettings.mediaPathDesc') }}
              </p>
            </template>
          </UiInput>

          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-primary">{{ t('adminSettings.autoScan') }}</p>
              <p class="text-xs text-text-muted">{{ t('adminSettings.autoScanDesc') }}</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="autoScanEnabled"
                type="checkbox"
                class="sr-only peer"
              >
              <div class="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
            </label>
          </div>

          <UiInput
            v-if="autoScanEnabled"
            v-model.number="scanInterval"
            type="number"
            :label="t('adminSettings.scanInterval')"
            :min="1"
            :max="168"
          />
        </div>
      </div>

      <!-- Features + Analytics -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h3 class="font-semibold text-text-primary">{{ t('adminSettings.features') }}</h3>

          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-primary">{{ t('adminSettings.registrationEnabled') }}</p>
              <p class="text-xs text-text-muted">{{ t('adminSettings.registrationEnabledDesc') }}</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="registrationEnabled"
                type="checkbox"
                class="sr-only peer"
              >
              <div class="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
            </label>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-primary">{{ t('adminSettings.autoUpdateEnabled') }}</p>
              <p class="text-xs text-text-muted">{{ t('adminSettings.autoUpdateEnabledDesc') }}</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="autoUpdateEnabled"
                type="checkbox"
                class="sr-only peer"
              >
              <div class="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
            </label>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-primary">{{ t('adminSettings.bugReportEnabled') }}</p>
              <p class="text-xs text-text-muted">{{ t('adminSettings.bugReportEnabledDesc') }}</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="bugReportEnabled"
                type="checkbox"
                class="sr-only peer"
              >
              <div class="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
            </label>
          </div>

          <UiInput
            v-if="bugReportEnabled"
            v-model="bugReportWebhookUrl"
            :label="t('adminSettings.bugReportWebhook')"
            placeholder="https://discord.com/api/webhooks/..."
          >
            <template #description>
              <p class="text-xs text-text-muted mt-1">
                {{ t('adminSettings.bugReportWebhookDesc') }}
              </p>
            </template>
          </UiInput>
        </div>

        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="font-semibold text-text-primary">{{ t('adminSettings.analyticsTitle') }}</h3>
              <p class="text-xs text-text-muted mt-1">
                {{ t('adminSettings.analyticsDescription') }}
              </p>
            </div>
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
              @click="openAnalyticsModal()"
            >
              {{ t('adminSettings.analyticsOpen') }}
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              class="p-3 text-left rounded-lg border border-border bg-background hover:border-primary/40 transition-colors"
              @click="openAnalyticsModal()"
            >
              <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsSessions') }}</p>
              <p class="text-2xl font-bold text-text-primary mt-1">{{ sessions.length }}</p>
              <p class="text-xs text-text-muted mt-1">{{ t('adminSettings.analyticsSessionsHint') }}</p>
            </button>

            <NuxtLink
              to="/admin/algorithm"
              class="p-3 text-left rounded-lg border border-border bg-background hover:border-primary/40 transition-colors"
            >
              <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsProfiles') }}</p>
              <p class="text-sm font-semibold text-primary mt-2">{{ t('algo.movedToPage') }}</p>
              <p class="text-xs text-text-muted mt-1">{{ t('adminSettings.analyticsProfilesHint') }}</p>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Announcements -->
      <div class="grid grid-cols-1 gap-6 mb-6">
        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-text-primary">{{ t('announcements.title') }}</h3>
          <button
            type="button"
            class="px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
            @click="openCreateAnnouncement"
          >
            {{ t('announcements.create') }}
          </button>
        </div>

        <!-- Inline create/edit form -->
        <div v-if="showAnnouncementForm" class="p-4 bg-background border border-border rounded-lg space-y-3">
          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">{{ t('announcements.message') }}</label>
            <textarea
              v-model="announcementForm.message"
              rows="2"
              class="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-primary resize-none"
            />
          </div>
          <div class="flex items-center gap-4">
            <div class="flex-1">
              <label class="block text-xs font-medium text-text-primary mb-1">{{ t('announcements.type') }}</label>
              <select
                v-model="announcementForm.type"
                class="w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-primary"
              >
                <option value="info">{{ t('announcements.info') }}</option>
                <option value="warning">{{ t('announcements.warning') }}</option>
                <option value="success">{{ t('announcements.success') }}</option>
                <option value="error">{{ t('announcements.error') }}</option>
              </select>
            </div>
            <div class="flex items-center gap-2 pt-4">
              <label class="text-xs text-text-primary">{{ t('announcements.dismissible') }}</label>
              <label class="relative inline-flex items-center cursor-pointer">
                <input v-model="announcementForm.dismissible" type="checkbox" class="sr-only peer">
                <div class="w-9 h-5 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
            </div>
          </div>
          <div v-if="announcementsError" class="text-xs text-red-500">{{ announcementsError }}</div>
          <div class="flex items-center gap-2 justify-end">
            <button
              type="button"
              class="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
              @click="cancelAnnouncementForm"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
              :disabled="announcementsLoading || !announcementForm.message.trim()"
              @click="saveAnnouncement"
            >
              {{ t('common.save') }}
            </button>
          </div>
        </div>

        <!-- Announcements list -->
        <div v-if="!announcements?.length && !showAnnouncementForm" class="text-sm text-text-muted text-center py-3">
          {{ t('announcements.noAnnouncements') }}
        </div>
        <div v-else-if="announcements?.length" class="divide-y divide-border border border-border rounded-lg">
          <div
            v-for="a in announcements"
            :key="a.id"
            class="flex items-center justify-between px-4 py-3"
          >
            <div class="flex-1 min-w-0 mr-3">
              <div class="flex items-center gap-2 mb-0.5">
                <span :class="['px-2 py-0.5 rounded text-xs font-medium', getAnnouncementBadgeClass(a.type)]">
                  {{ t(`announcements.${a.type}`) }}
                </span>
                <span v-if="!a.active" class="px-2 py-0.5 rounded text-xs font-medium bg-gray-500/10 text-gray-400">
                  {{ t('announcements.active') }}: off
                </span>
              </div>
              <p class="text-sm text-text-primary truncate">{{ a.message }}</p>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <!-- Active toggle -->
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" :checked="a.active" class="sr-only peer" @change="toggleAnnouncementActive(a)">
                <div class="w-9 h-5 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
              <!-- Edit -->
              <button type="button" class="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors" @click="openEditAnnouncement(a)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <!-- Delete -->
              <button type="button" class="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors" @click="deleteAnnouncement(a.id)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>

      <!-- Bottom row: API keys side by side -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <!-- TMDB API -->
        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h3 class="font-semibold text-text-primary">{{ t('adminSettings.tmdb') }}</h3>

          <UiInput
            v-model="tmdbApiKey"
            type="password"
            :label="t('adminSettings.tmdbApiKey')"
            :placeholder="t('adminSettings.tmdbApiKeyPlaceholder')"
          >
            <template #description>
              <p class="text-xs text-text-muted mt-1">
                {{ t('adminSettings.tmdbApiKeyDesc') }}
                <a href="https://www.themoviedb.org/settings/api" target="_blank" class="text-primary hover:underline">themoviedb.org</a>
              </p>
            </template>
          </UiInput>
        </div>

        <!-- Groq AI -->
        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
          <div class="flex items-center gap-2">
            <h3 class="font-semibold text-text-primary">{{ t('adminSettings.groqAi') }}</h3>
            <div class="relative group">
              <button
                type="button"
                class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs font-semibold text-text-muted hover:text-text-primary hover:border-border-secondary transition-colors"
                :aria-label="t('adminSettings.groqHelpTitle')"
              >
                ?
              </button>
              <div class="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-72 -translate-x-1/2 rounded-xl border border-border bg-background p-3 text-xs text-text-secondary shadow-xl group-hover:block">
                <p class="font-medium text-text-primary">{{ t('adminSettings.groqHelpTitle') }}</p>
                <p class="mt-1">{{ t('adminSettings.groqHelpBody') }}</p>
              </div>
            </div>
          </div>

          <UiInput
            v-model="groqApiKey"
            type="password"
            :label="t('adminSettings.groqApiKey')"
            :placeholder="t('adminSettings.groqApiKeyPlaceholder')"
          >
            <template #description>
              <p class="text-xs text-text-muted mt-1">
                {{ t('adminSettings.groqApiKeyDesc') }}
                <a href="https://console.groq.com" target="_blank" class="text-primary hover:underline">console.groq.com</a>
              </p>
            </template>
          </UiInput>

          <UiInput
            v-model="groqModel"
            :label="t('adminSettings.groqModel')"
            placeholder="llama-3.1-8b-instant"
          />
          <p class="text-xs text-text-muted">
            {{ t('adminSettings.groqModelDesc') }}
          </p>
        </div>
      </div>

      <!-- Messages -->
      <div v-if="error" class="p-4 bg-red-500/10 border border-red-500/20 rounded-xl mb-6">
        <p class="text-sm text-red-500">{{ error }}</p>
      </div>

      <div v-if="success" class="p-4 bg-green-500/10 border border-green-500/20 rounded-xl mb-6">
        <p class="text-sm text-green-500">{{ t('adminSettings.settingsSaved') }}</p>
      </div>

      <!-- Save button -->
      <div class="flex justify-end">
        <UiButton type="submit" :loading="loading">
          {{ t('adminSettings.saveSettings') }}
        </UiButton>
      </div>
    </form>

    <UiModal v-model="analyticsModalOpen" :title="t('adminSettings.analyticsTitle')" size="xl">
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-text-primary">{{ t('adminSettings.analyticsActiveSessions') }}</p>

          <button
            type="button"
            class="px-3 py-1.5 text-xs font-medium text-text-primary bg-surface-secondary hover:bg-surface-secondary/80 rounded-lg transition-colors"
            @click="refreshAnalytics"
          >
            {{ t('adminSettings.analyticsRefresh') }}
          </button>
        </div>

        <div v-if="analyticsError" class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-500">
          {{ analyticsError }}
        </div>

        <div v-else-if="analyticsLoading" class="space-y-3">
          <UiSkeleton height="4rem" />
          <UiSkeleton height="4rem" />
          <UiSkeleton height="4rem" />
        </div>

        <div v-else class="space-y-3">
          <div v-if="!sessions.length" class="p-6 text-center text-sm text-text-muted bg-background border border-border rounded-xl">
            {{ t('adminSettings.analyticsNoVisibleUsers') }}
          </div>

          <div v-else class="space-y-3 max-h-[60vh] overflow-y-auto">
            <div
              v-for="session in sessions"
              :key="session.userId"
              class="p-4 bg-background border border-border rounded-xl flex items-start justify-between gap-4"
            >
              <div class="min-w-0">
                <p class="text-sm font-semibold text-text-primary truncate">{{ session.email }}</p>
                <p class="text-xs text-text-muted mt-1">{{ t('adminSettings.analyticsCurrentPage', { page: session.currentPage }) }}</p>
                <p class="text-xs text-text-muted mt-1">{{ t('adminSettings.analyticsLastActivity', { value: formatRelativeDate(session.lastActive) }) }}</p>
              </div>

              <button
                type="button"
                class="px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg transition-colors whitespace-nowrap"
                @click="suppressSession(session.userId)"
              >
                {{ t('adminSettings.analyticsIgnoreNextCheck') }}
              </button>
            </div>
          </div>
        </div>

      </div>
    </UiModal>
  </div>
</template>
