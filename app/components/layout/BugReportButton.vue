<script setup lang="ts">
const { t } = useI18n()
const trpc = useTrpc()
const toast = useToast()
const route = useRoute()

const showModal = ref(false)
const title = ref('')
const description = ref('')
const page = ref('')
const submitting = ref(false)
// Check if bug reporting is enabled
const { data: isEnabled } = useAsyncData('bug-report-enabled', () =>
  trpc.bugReport.isEnabled.query()
)

const enabled = computed(() => isEnabled.value?.enabled === true)

function openModal() {
  title.value = ''
  description.value = ''
  page.value = window.location.href
  showModal.value = true
}

async function submitReport() {
  if (submitting.value || !title.value.trim()) return
  submitting.value = true
  try {
    await trpc.bugReport.submit.mutate({
      title: title.value.trim(),
      description: description.value.trim(),
      page: page.value,
    })
    toast.success(t('bugReport.submitted'))
    showModal.value = false
  } catch (e: any) {
    toast.error(e.message || t('bugReport.submitError'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- Floating bug report button -->
  <button
    v-if="enabled"
    type="button"
    class="fixed bottom-24 right-4 lg:bottom-6 lg:right-6 z-40 w-10 h-10 rounded-full bg-surface border border-border shadow-lg flex items-center justify-center text-text-muted hover:text-primary hover:border-primary transition-colors"
    :title="t('bugReport.title')"
    @click="openModal"
  >
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
  </button>

  <!-- Bug report modal -->
  <UiModal v-model="showModal" :title="t('bugReport.title')" size="md">
    <form class="space-y-4" @submit.prevent="submitReport">
      <UiInput
        v-model="title"
        :label="t('bugReport.titleLabel')"
        :placeholder="t('bugReport.titlePlaceholder')"
        required
      />

      <div>
        <label class="block text-sm font-medium text-text-primary mb-1">
          {{ t('bugReport.descriptionLabel') }}
        </label>
        <textarea
          v-model="description"
          class="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y min-h-[100px]"
          :placeholder="t('bugReport.descriptionPlaceholder')"
          rows="4"
        />
      </div>

      <UiInput
        v-model="page"
        :label="t('bugReport.pageLabel')"
        disabled
      />
    </form>

    <template #footer>
      <button
        type="button"
        class="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
        @click="showModal = false"
      >
        {{ t('common.cancel') }}
      </button>
      <UiButton
        :loading="submitting"
        :disabled="!title.trim()"
        @click="submitReport"
      >
        {{ t('bugReport.submit') }}
      </UiButton>
    </template>
  </UiModal>
</template>
