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
const analyticsTab = ref<'sessions' | 'profiles'>('sessions')
const analyticsLoading = ref(false)
const analyticsError = ref('')
const analyticsEditorOpen = ref(false)
const analyticsEditorLoading = ref(false)
const analyticsEditorUserId = ref('')
const analyticsEditorUserLabel = ref('')
const analyticsEditorScores = ref('{}')
const analyticsEditorProfileData = ref('{}')

// Form data
const appNameInput = ref('')
const mediaPath = ref('')
const tmdbApiKey = ref('')
const groqApiKey = ref('')
const githubRepo = ref('')
const githubToken = ref('')
const autoScanEnabled = ref(false)
const scanInterval = ref(24)
const catalogEnabled = ref(true)
const downloadsEnabled = ref(true)
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
const profiles = ref<Array<{
  userId: string
  email: string | null
  scores: Record<string, number> | null
  profileData: Record<string, any> | null
}>>([])

function sortEntries(record: Record<string, number> | null | undefined, limit = 6) {
  if (!record) return []
  return Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, limit)
}

function openProfileEditor(profile: {
  userId: string
  email: string | null
  scores: Record<string, number> | null
  profileData: Record<string, any> | null
}) {
  analyticsEditorUserId.value = profile.userId
  analyticsEditorUserLabel.value = profile.email || t('adminSettings.analyticsUnknownUser')
  analyticsEditorScores.value = JSON.stringify(profile.scores || {}, null, 2)
  analyticsEditorProfileData.value = JSON.stringify(profile.profileData || {}, null, 2)
  analyticsEditorOpen.value = true
}

async function saveProfileEditor() {
  analyticsEditorLoading.value = true
  try {
    const parsedScores = JSON.parse(analyticsEditorScores.value)
    const parsedProfileData = JSON.parse(analyticsEditorProfileData.value)

    if (!parsedScores || typeof parsedScores !== 'object' || Array.isArray(parsedScores)) {
      throw new Error(t('adminSettings.analyticsScoresObjectRequired'))
    }
    if (!parsedProfileData || typeof parsedProfileData !== 'object' || Array.isArray(parsedProfileData)) {
      throw new Error(t('adminSettings.analyticsProfileObjectRequired'))
    }

    for (const value of Object.values(parsedScores)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(t('adminSettings.analyticsScoresNumbersOnly'))
      }
    }

    await trpc.analytics.updateProfileData.mutate({
      userId: analyticsEditorUserId.value,
      scores: parsedScores as Record<string, number>,
      profileData: parsedProfileData as Record<string, unknown>,
    })

    analyticsEditorOpen.value = false
    useToast().success(t('adminSettings.analyticsProfileSaved'))
    await refreshAnalytics()
  } catch (e: any) {
    useToast().error(e.message || t('adminSettings.analyticsProfileSaveError'))
  } finally {
    analyticsEditorLoading.value = false
  }
}

async function resetProfile(userId: string) {
  if (!window.confirm(t('adminSettings.analyticsResetConfirm'))) return
  try {
    await trpc.analytics.resetProfile.mutate({ userId })
    useToast().success(t('adminSettings.analyticsResetSuccess'))
    await refreshAnalytics()
  } catch (e: any) {
    useToast().error(e.message || t('adminSettings.analyticsResetError'))
  }
}

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
    const [sessionsData, profilesData] = await Promise.all([
      trpc.analytics.getActiveSessions.query(),
      trpc.analytics.getProfiles.query(),
    ])
    sessions.value = sessionsData
    profiles.value = profilesData
  } catch (e: any) {
    analyticsError.value = e.message || t('adminSettings.analyticsLoadError')
  } finally {
    analyticsLoading.value = false
  }
}

async function openAnalyticsModal(tab: 'sessions' | 'profiles' = 'sessions') {
  analyticsModalOpen.value = true
  analyticsTab.value = tab
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

async function adjustScore(userId: string, genre: string, currentScore: number) {
  const nextValue = window.prompt(`Nouveau score pour ${genre}:`, String(currentScore))
  if (nextValue === null) return

  const score = Number.parseInt(nextValue, 10)
  if (Number.isNaN(score)) {
    useToast().error(t('adminSettings.analyticsScoreInteger'))
    return
  }

  try {
    await trpc.analytics.updateProfileScore.mutate({ userId, genre, score })
    await refreshAnalytics()
  } catch (e: any) {
    useToast().error(e.message || t('adminSettings.analyticsScoreUpdateError'))
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
    githubRepo.value = (data.githubRepo as string) || ''
    githubToken.value = (data.githubToken as string) || ''
    autoScanEnabled.value = (data.autoScanEnabled as boolean) || false
    scanInterval.value = (data.scanInterval as number) || 24
    catalogEnabled.value = data.catalogEnabled !== false
    downloadsEnabled.value = data.downloadsEnabled !== false
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
      githubRepo: githubRepo.value || undefined,
      githubToken: githubToken.value || undefined,
      autoScanEnabled: autoScanEnabled.value,
      scanInterval: scanInterval.value,
      catalogEnabled: catalogEnabled.value,
      downloadsEnabled: downloadsEnabled.value,
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

      <!-- Features toggles + GitHub -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h3 class="font-semibold text-text-primary">{{ t('adminSettings.features') }}</h3>

          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-primary">{{ t('adminSettings.catalogEnabled') }}</p>
              <p class="text-xs text-text-muted">{{ t('adminSettings.catalogEnabledDesc') }}</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="catalogEnabled"
                type="checkbox"
                class="sr-only peer"
              >
              <div class="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
            </label>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-primary">{{ t('adminSettings.downloadsEnabled') }}</p>
              <p class="text-xs text-text-muted">{{ t('adminSettings.downloadsEnabledDesc') }}</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="downloadsEnabled"
                type="checkbox"
                class="sr-only peer"
              >
              <div class="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
            </label>
          </div>

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
        </div>

        <!-- GitHub -->
        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h3 class="font-semibold text-text-primary">{{ t('adminSettings.github') }}</h3>

          <UiInput
            v-model="githubRepo"
            :label="t('adminSettings.githubRepo')"
            :placeholder="t('adminSettings.githubRepoPlaceholder')"
          >
            <template #description>
              <p class="text-xs text-text-muted mt-1">
                {{ t('adminSettings.githubRepoDesc') }}
              </p>
            </template>
          </UiInput>

          <UiInput
            v-model="githubToken"
            type="password"
            :label="t('adminSettings.githubToken')"
            :placeholder="t('adminSettings.githubTokenPlaceholder')"
          >
            <template #description>
              <p class="text-xs text-text-muted mt-1">
                {{ t('adminSettings.githubTokenDesc') }}
              </p>
            </template>
          </UiInput>
        </div>
      </div>

      <!-- Bug Reports + Presence -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <!-- Bug Reports -->
        <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
          <h3 class="font-semibold text-text-primary">{{ t('adminSettings.bugReports') }}</h3>

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

        <!-- Presence & Analytics -->
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
              @click="openAnalyticsModal('sessions')"
            >
              {{ t('adminSettings.analyticsOpen') }}
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              class="p-3 text-left rounded-lg border border-border bg-background hover:border-primary/40 transition-colors"
              @click="openAnalyticsModal('sessions')"
            >
              <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsSessions') }}</p>
              <p class="text-2xl font-bold text-text-primary mt-1">{{ sessions.length }}</p>
              <p class="text-xs text-text-muted mt-1">{{ t('adminSettings.analyticsSessionsHint') }}</p>
            </button>

            <button
              type="button"
              class="p-3 text-left rounded-lg border border-border bg-background hover:border-primary/40 transition-colors"
              @click="openAnalyticsModal('profiles')"
            >
              <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsProfiles') }}</p>
              <p class="text-2xl font-bold text-text-primary mt-1">{{ profiles.length }}</p>
              <p class="text-xs text-text-muted mt-1">{{ t('adminSettings.analyticsProfilesHint') }}</p>
            </button>
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
          <h3 class="font-semibold text-text-primary">{{ t('adminSettings.groqAi') }}</h3>

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
          <div class="flex gap-1 bg-background rounded-lg p-1">
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              :class="analyticsTab === 'sessions' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-primary'"
              @click="analyticsTab = 'sessions'"
            >
              {{ t('adminSettings.analyticsActiveSessions') }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              :class="analyticsTab === 'profiles' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-primary'"
              @click="analyticsTab = 'profiles'"
            >
              {{ t('adminSettings.analyticsProfiles') }}
            </button>
          </div>

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

        <div v-else-if="analyticsTab === 'sessions'" class="space-y-3">
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

        <div v-else class="space-y-3 max-h-[60vh] overflow-y-auto">
          <div v-if="!profiles.length" class="p-6 text-center text-sm text-text-muted bg-background border border-border rounded-xl">
            {{ t('adminSettings.analyticsNoProfiles') }}
          </div>

          <div
            v-for="profile in profiles"
            :key="profile.userId"
            class="p-4 bg-background border border-border rounded-xl"
          >
            <div class="flex items-start justify-between gap-3">
              <p class="text-sm font-semibold text-text-primary">{{ profile.email || t('adminSettings.analyticsUnknownUser') }}</p>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
                  @click="openProfileEditor(profile)"
                >
                  {{ t('adminSettings.analyticsEditRawProfile') }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                  @click="resetProfile(profile.userId)"
                >
                  {{ t('adminSettings.analyticsResetProfile') }}
                </button>
              </div>
            </div>

            <div v-if="profile.profileData" class="mt-3 space-y-3">
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div class="p-2 rounded-lg bg-surface border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsStarts') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ profile.profileData.playback?.starts || 0 }}</p>
                </div>
                <div class="p-2 rounded-lg bg-surface border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsCompletions') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ profile.profileData.playback?.completes || 0 }}</p>
                </div>
                <div class="p-2 rounded-lg bg-surface border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsSearches') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ profile.profileData.search?.totalQueries || 0 }}</p>
                </div>
                <div class="p-2 rounded-lg bg-surface border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsHesitations') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ profile.profileData.browsing?.hesitationSignals || 0 }}</p>
                </div>
              </div>

              <div v-if="sortEntries(profile.profileData.preferences?.tags).length" class="space-y-2">
                <p class="text-xs font-medium text-text-muted uppercase tracking-wide">{{ t('adminSettings.analyticsDetectedTags') }}</p>
                <div class="flex flex-wrap gap-2">
                  <span
                    v-for="[tag, score] in sortEntries(profile.profileData.preferences?.tags)"
                    :key="tag"
                    class="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary"
                  >
                    {{ tag }} · {{ score }}
                  </span>
                </div>
              </div>
            </div>

            <div v-if="profile.scores && Object.keys(profile.scores).length" class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
              <button
                v-for="(score, genre) in profile.scores"
                :key="genre"
                type="button"
                class="flex items-center justify-between gap-3 p-3 bg-surface border border-border rounded-lg hover:border-primary/40 transition-colors text-left"
                @click="adjustScore(profile.userId, genre, score)"
              >
                <span class="text-sm text-text-primary truncate">{{ genre }}</span>
                <span class="text-xs font-semibold text-primary">{{ score }}</span>
              </button>
            </div>
            <div v-else class="mt-3 text-xs text-text-muted">
              {{ t('adminSettings.analyticsNoScores') }}
            </div>

            <div v-if="sortEntries(profile.profileData?.preferences?.actorScores, 5).length" class="mt-3">
              <p class="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">{{ t('adminSettings.analyticsAffinityActors') }}</p>
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="[actor, score] in sortEntries(profile.profileData?.preferences?.actorScores, 5)"
                  :key="actor"
                  class="px-2.5 py-1 rounded-full text-xs bg-surface border border-border text-text-primary"
                >
                  {{ actor }} · {{ score }}
                </span>
              </div>
            </div>

            <div v-if="profile.profileData?.recentSignals?.length" class="mt-3">
              <p class="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">{{ t('adminSettings.analyticsRecentSignals') }}</p>
              <div class="space-y-2">
                <div
                  v-for="signal in profile.profileData.recentSignals.slice(0, 4)"
                  :key="`${signal.createdAt}-${signal.type}`"
                  class="p-2 rounded-lg bg-surface border border-border"
                >
                  <p class="text-sm text-text-primary">{{ signal.summary }}</p>
                  <p class="text-xs text-text-muted mt-1">{{ formatRelativeDate(new Date(signal.createdAt).getTime()) }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </UiModal>

    <UiModal v-model="analyticsEditorOpen" :title="t('adminSettings.analyticsRawEditorTitle', { user: analyticsEditorUserLabel })" size="xl">
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-text-primary mb-2">
            {{ t('adminSettings.analyticsRawScores') }}
          </label>
          <textarea
            v-model="analyticsEditorScores"
            rows="10"
            class="w-full px-4 py-3 bg-background border border-border rounded-xl text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-y"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-text-primary mb-2">
            {{ t('adminSettings.analyticsRawProfileData') }}
          </label>
          <textarea
            v-model="analyticsEditorProfileData"
            rows="18"
            class="w-full px-4 py-3 bg-background border border-border rounded-xl text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-y"
          />
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
          @click="analyticsEditorOpen = false"
        >
          {{ t('common.cancel') }}
        </button>
        <UiButton :loading="analyticsEditorLoading" @click="saveProfileEditor">
          {{ t('common.save') }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
