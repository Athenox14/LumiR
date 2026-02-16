<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: ['guest'],
})

const { login } = useAuth()
const { t } = useI18n()
const trpc = useTrpc()
const { registrationEnabled } = useFeatureFlags()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

// Check if setup is needed
const needsSetup = ref(false)

onMounted(async () => {
  try {
    needsSetup.value = await trpc.auth.needsSetup.query()
    if (needsSetup.value) {
      navigateTo('/setup')
    }
  } catch {
    // Ignore
  }
})

async function handleSubmit() {
  if (!email.value || !password.value) {
    error.value = t('auth.fillAllFields')
    return
  }

  loading.value = true
  error.value = ''

  try {
    await login(email.value, password.value)
    navigateTo('/')
  } catch (e: any) {
    error.value = e.message || t('auth.invalidEmailPassword')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <h2 class="text-xl font-semibold text-text-primary mb-6">{{ t('auth.signInToAccount') }}</h2>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <UiInput
        v-model="email"
        type="email"
        :label="t('auth.email')"
        :placeholder="t('auth.emailPlaceholder')"
        required
      />

      <UiInput
        v-model="password"
        type="password"
        :label="t('auth.password')"
        :placeholder="t('auth.passwordPlaceholder')"
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
        {{ t('auth.signIn') }}
      </UiButton>
    </form>

    <p v-if="registrationEnabled" class="mt-6 text-center text-sm text-text-muted">
      {{ t('auth.dontHaveAccount') }}
      <NuxtLink to="/register" class="text-primary hover:underline">
        {{ t('auth.signUp') }}
      </NuxtLink>
    </p>
  </div>
</template>
