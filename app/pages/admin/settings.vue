<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const trpc = useTrpc()
const { t } = useI18n()

const loading = ref(false)
const success = ref(false)
const error = ref('')

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

      <!-- Features toggles -->
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

      <!-- Third row: GitHub -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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
  </div>
</template>
