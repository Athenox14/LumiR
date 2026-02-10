<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: ['guest'],
})

const { register } = useAuth()
const { t } = useI18n()

const displayName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

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
    navigateTo('/')
  } catch (e: any) {
    error.value = e.message || t('auth.registrationFailed')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <h2 class="text-xl font-semibold text-text-primary mb-6">{{ t('auth.createAccount') }}</h2>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <UiInput
        v-model="displayName"
        type="text"
        :label="t('auth.displayName')"
        :placeholder="t('auth.displayNamePlaceholder')"
        required
      />

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
        :placeholder="t('auth.newPasswordPlaceholder')"
        required
      />

      <UiInput
        v-model="confirmPassword"
        type="password"
        :label="t('auth.confirmPassword')"
        :placeholder="t('auth.confirmPasswordPlaceholder')"
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
        {{ t('auth.createAccount') }}
      </UiButton>
    </form>

    <p class="mt-6 text-center text-sm text-text-muted">
      {{ t('auth.alreadyHaveAccount') }}
      <NuxtLink to="/login" class="text-primary hover:underline">
        {{ t('auth.signIn') }}
      </NuxtLink>
    </p>
  </div>
</template>
