<script setup lang="ts">
/* eslint-disable vue/no-v-html */
const { t } = useI18n()
const { isAdmin } = useAuth()
const {
  updateData,
  showPopup,
  installing,
  installError,
  dismiss,
  remindLater,
  performUpdate,
  startBackgroundCheck,
} = useUpdateChecker()

const showRemindMenu = ref(false)
const confirmingInstall = ref(false)

const remindOptions = [
  { hours: 1, label: () => t('updatePopup.remind1h') },
  { hours: 24, label: () => t('updatePopup.remind1d') },
  { hours: 24 * 3, label: () => t('updatePopup.remind3d') },
  { hours: 24 * 7, label: () => t('updatePopup.remind7d') },
]

function handleRemind(hours: number) {
  remindLater(hours)
  showRemindMenu.value = false
}

async function handleInstall() {
  if (!confirmingInstall.value) {
    confirmingInstall.value = true
    return
  }
  confirmingInstall.value = false
  await performUpdate()
}

function handleClose() {
  dismiss()
  showRemindMenu.value = false
  confirmingInstall.value = false
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderReleaseNotes(text: string): string {
  return escapeHtml(text)
    .replace(/^### (.+)$/gm, '<h4 class="font-semibold text-text-primary mt-2 mb-1">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-semibold text-text-primary mt-2 mb-1">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-text-primary">$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" class="text-primary hover:underline">$1</a>')
    .replace(/(?<!\()(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" class="text-primary hover:underline">$1</a>')
    .replace(/^[*-] (.+)$/gm, '<li class="ml-3">$1</li>')
    .replace(/\n/g, '<br>')
}

// Start background checking on mount (only for admins)
onMounted(() => {
  if (isAdmin.value) {
    startBackgroundCheck()
  }
})

// Watch for admin status change (e.g. login)
watch(isAdmin, (val) => {
  if (val) startBackgroundCheck()
})
</script>

<template>
  <!-- Floating popup bottom-right -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="translate-y-4 opacity-0 scale-95"
      enter-to-class="translate-y-0 opacity-100 scale-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="translate-y-0 opacity-100 scale-100"
      leave-to-class="translate-y-4 opacity-0 scale-95"
    >
      <div
        v-if="isAdmin && showPopup && updateData?.hasUpdate"
        class="fixed bottom-6 right-6 z-[9999] w-[380px] max-w-[calc(100vw-3rem)] bg-surface border border-primary/30 rounded-2xl shadow-2xl shadow-primary/10 overflow-hidden"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 bg-primary/10 border-b border-primary/20">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span class="text-sm font-semibold text-text-primary">{{ t('updatePopup.title') }}</span>
          </div>
          <button
            type="button"
            class="p-1 rounded-lg hover:bg-surface-secondary transition-colors text-text-muted hover:text-text-primary"
            @click="handleClose"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Content -->
        <div class="px-4 py-3 space-y-3">
          <!-- Version info -->
          <div>
            <p class="text-sm font-medium text-text-primary">
              {{ updateData.latestName || updateData.latestVersion }}
            </p>
            <p class="text-xs text-text-muted mt-0.5">
              {{ t('updatePopup.publishedAt') }} {{ new Date(updateData.publishedAt).toLocaleDateString() }}
              <span v-if="updateData.downloadSize" class="ml-1">({{ formatBytes(updateData.downloadSize) }})</span>
            </p>
          </div>

          <!-- Release notes (collapsible, max height) -->
          <div
            v-if="updateData.releaseNotes"
            class="p-2.5 bg-background rounded-lg text-xs text-text-muted leading-relaxed max-h-32 overflow-y-auto"
            v-html="renderReleaseNotes(updateData.releaseNotes)"
          />

          <!-- Error -->
          <div v-if="installError" class="p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p class="text-xs text-red-500">{{ installError }}</p>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <!-- Install button -->
            <button
              type="button"
              class="flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors"
              :class="confirmingInstall
                ? 'bg-orange-500 hover:bg-orange-600 text-white'
                : 'bg-primary hover:bg-primary/90 text-white'"
              :disabled="installing || !updateData.downloadUrl"
              @click="handleInstall"
            >
              <span v-if="installing" class="flex items-center justify-center gap-2">
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {{ t('updatePopup.installing') }}
              </span>
              <span v-else-if="confirmingInstall">{{ t('updatePopup.confirmInstall') }}</span>
              <span v-else>{{ t('updatePopup.install') }}</span>
            </button>

            <!-- Remind later dropdown -->
            <div class="relative">
              <button
                type="button"
                class="px-3 py-2 text-sm text-text-muted hover:text-text-primary hover:bg-surface-secondary rounded-lg transition-colors"
                :disabled="installing"
                @click="showRemindMenu = !showRemindMenu"
              >
                {{ t('updatePopup.later') }}
              </button>

              <!-- Dropdown menu -->
              <Transition
                enter-active-class="transition-all duration-150 ease-out"
                enter-from-class="opacity-0 scale-95"
                enter-to-class="opacity-100 scale-100"
                leave-active-class="transition-all duration-100 ease-in"
                leave-from-class="opacity-100 scale-100"
                leave-to-class="opacity-0 scale-95"
              >
                <div
                  v-if="showRemindMenu"
                  class="absolute bottom-full right-0 mb-1 w-48 bg-surface border border-border rounded-lg shadow-xl overflow-hidden"
                >
                  <button
                    v-for="option in remindOptions"
                    :key="option.hours"
                    type="button"
                    class="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-colors"
                    @click="handleRemind(option.hours)"
                  >
                    {{ option.label() }}
                  </button>
                  <div class="border-t border-border">
                    <button
                      type="button"
                      class="w-full px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-secondary hover:text-text-primary transition-colors"
                      @click="handleClose"
                    >
                      {{ t('updatePopup.dismissVersion') }}
                    </button>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- GitHub link -->
          <a
            :href="updateData.releaseUrl"
            target="_blank"
            class="text-xs text-primary hover:underline inline-block"
          >
            {{ t('adminUpdate.viewOnGithub') }}
          </a>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
