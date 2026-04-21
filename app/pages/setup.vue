<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

const { register } = useAuth()
const { t } = useI18n()
const { appName } = useAppName()

useHead({ title: 'Setup' })

const displayName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

onMounted(async () => {
  try {
    const response = await $fetch<{ needsSetup: boolean }>('/api/setup-status')
    useState<boolean | null>('needs-setup').value = response.needsSetup

    if (!response.needsSetup) {
      navigateTo('/login')
    }
  } catch {
    // Ignore and keep the page accessible.
  }
})

async function handleSubmit() {
  if (!displayName.value || !email.value || !password.value || !confirmPassword.value) {
    error.value = t('auth.fillAllFields')
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = t('auth.passwordsDontMatch')
    return
  }

  if (password.value.length < 8) {
    error.value = t('auth.passwordMin8')
    return
  }

  loading.value = true
  error.value = ''

  try {
    await register(email.value, password.value, displayName.value)
    useState<boolean | null>('needs-setup').value = false
    navigateTo('/')
  } catch (e: any) {
    error.value = e.message || t('setup.setupFailed')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <div class="text-center mb-6">
      <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-3">
        <svg class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      </div>
      <h2 class="text-xl font-semibold text-text-primary">{{ t('setup.welcomeTitle', { appName: appName }) }}</h2>
      <p class="text-sm text-text-secondary mt-1">{{ t('setup.setupAdminAccount') }}</p>
    </div>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <UiInput
        v-model="displayName"
        type="text"
        :label="t('setup.yourName')"
        :placeholder="t('setup.adminPlaceholder')"
        required
      />

      <UiInput
        v-model="email"
        type="email"
        :label="t('auth.email')"
        :placeholder="t('setup.adminEmailPlaceholder')"
        required
      />

      <UiInput
        v-model="password"
        type="password"
        :label="t('auth.password')"
        :placeholder="t('auth.newPasswordPlaceholder')"
        required
      />

      <UiInput
        v-model="confirmPassword"
        type="password"
        :label="t('auth.confirmPassword')"
        :placeholder="t('auth.repeatPassword')"
        required
      />

      <div v-if="error" class="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
        <p class="text-sm text-red-500">{{ error }}</p>
      </div>

      <UiButton
        type="submit"
        class="w-full"
        :loading="loading"
      >
        {{ t('setup.createAdminAccount') }}
      </UiButton>
    </form>

    <p class="mt-4 text-xs text-text-muted text-center">
      {{ t('setup.fullAdminPrivileges') }}
    </p>
  </div>
</template>
