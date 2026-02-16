<script setup lang="ts">
const { t } = useI18n()
const { appName } = useAppName()
</script>

<template>
  <div class="min-h-screen bg-background flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
          <svg class="w-8 h-8 text-primary" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v12h16V6H4zm7 2l5 4-5 4V8z" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold text-text-primary">{{ appName }}</h1>
        <p class="text-text-secondary mt-1">{{ t('authLayout.tagline') }}</p>
      </div>

      <!-- Content -->
      <div class="bg-surface border border-border rounded-2xl p-6 shadow-xl">
        <slot />
      </div>

      <!-- Footer -->
      <p class="text-center text-text-muted text-sm mt-6">
        {{ t('authLayout.footerText') }}
      </p>
    </div>
  </div>
</template>
