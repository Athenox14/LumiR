<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const trpc = useTrpc()
const { t } = useI18n()

useHead({ title: computed(() => t('announcements.title')) })

const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingAnnouncement = ref<any>(null)
const loading = ref(false)
const error = ref('')

// Form data
const formData = ref({
  message: '',
  type: 'info' as 'info' | 'warning' | 'success' | 'error',
  dismissible: true,
  active: true,
})

// Fetch announcements
const { data: announcements, refresh: refreshAnnouncements } = useAsyncData(
  'admin-announcements',
  () => trpc.announcements.getAll.query()
)

function openCreateModal() {
  formData.value = {
    message: '',
    type: 'info',
    dismissible: true,
    active: true,
  }
  error.value = ''
  showCreateModal.value = true
}

function openEditModal(announcement: any) {
  editingAnnouncement.value = announcement
  formData.value = {
    message: announcement.message,
    type: announcement.type,
    dismissible: announcement.dismissible,
    active: announcement.active,
  }
  error.value = ''
  showEditModal.value = true
}

async function createAnnouncement() {
  if (!formData.value.message) {
    error.value = t('announcements.messageRequired')
    return
  }

  loading.value = true
  error.value = ''

  try {
    await trpc.announcements.create.mutate({
      message: formData.value.message,
      type: formData.value.type,
      dismissible: formData.value.dismissible,
    })
    showCreateModal.value = false
    await refreshAnnouncements()
  } catch (e: any) {
    error.value = e.message || t('announcements.failedToCreate')
  } finally {
    loading.value = false
  }
}

async function updateAnnouncement() {
  if (!editingAnnouncement.value) return

  loading.value = true
  error.value = ''

  try {
    await trpc.announcements.update.mutate({
      id: editingAnnouncement.value.id,
      message: formData.value.message,
      type: formData.value.type,
      active: formData.value.active,
      dismissible: formData.value.dismissible,
    })
    showEditModal.value = false
    await refreshAnnouncements()
  } catch (e: any) {
    error.value = e.message || t('announcements.failedToUpdate')
  } finally {
    loading.value = false
  }
}

async function deleteAnnouncement(id: string) {
  const { confirm } = useConfirmDialog()
  const ok = await confirm({ title: t('common.confirm'), message: t('announcements.deleteConfirm') })
  if (!ok) return

  try {
    await trpc.announcements.delete.mutate({ id })
    await refreshAnnouncements()
  } catch (e: any) {
    useToast().error(e.message || t('announcements.failedToDelete'))
  }
}

async function toggleActive(announcement: any) {
  try {
    await trpc.announcements.update.mutate({
      id: announcement.id,
      active: !announcement.active,
    })
    await refreshAnnouncements()
  } catch (e: any) {
    useToast().error(e.message)
  }
}

async function toggleDismissible(announcement: any) {
  try {
    await trpc.announcements.update.mutate({
      id: announcement.id,
      dismissible: !announcement.dismissible,
    })
    await refreshAnnouncements()
  } catch (e: any) {
    useToast().error(e.message)
  }
}

function getTypeBadgeClass(type: string) {
  switch (type) {
    case 'info':
      return 'bg-blue-500/10 text-blue-500'
    case 'warning':
      return 'bg-yellow-500/10 text-yellow-500'
    case 'success':
      return 'bg-green-500/10 text-green-500'
    case 'error':
      return 'bg-red-500/10 text-red-500'
    default:
      return 'bg-gray-500/10 text-gray-400'
  }
}
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">
    <div class="flex items-center gap-4 mb-6">
      <NuxtLink to="/admin" class="text-text-muted hover:text-text-primary transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </NuxtLink>
      <h1 class="text-2xl font-bold text-text-primary">{{ t('announcements.title') }}</h1>
    </div>

    <!-- Actions -->
    <div class="flex justify-between items-center mb-6">
      <p class="text-text-secondary">
        {{ announcements?.length || 0 }} {{ t('announcements.title').toLowerCase() }}
      </p>
      <UiButton @click="openCreateModal">
        {{ t('announcements.create') }}
      </UiButton>
    </div>

    <!-- Announcements list -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden">
      <div v-if="!announcements?.length" class="p-6 text-center text-text-muted">
        {{ t('announcements.noAnnouncements') }}
      </div>
      <div v-else class="divide-y divide-border">
        <div
          v-for="announcement in announcements"
          :key="announcement.id"
          class="px-6 py-4 flex items-center justify-between"
        >
          <div class="flex-1 min-w-0 mr-4">
            <div class="flex items-center gap-2 mb-1">
              <span
                :class="[
                  'px-2 py-0.5 rounded text-xs font-medium',
                  getTypeBadgeClass(announcement.type)
                ]"
              >
                {{ t(`announcements.${announcement.type}`) }}
              </span>
              <span
                v-if="!announcement.active"
                class="px-2 py-0.5 rounded text-xs font-medium bg-gray-500/10 text-gray-400"
              >
                {{ t('announcements.inactive') }}
              </span>
            </div>
            <p class="text-sm text-text-primary truncate">
              {{ announcement.message }}
            </p>
          </div>
          <div class="flex items-center gap-4 flex-shrink-0">
            <!-- Active toggle -->
            <div class="flex flex-col items-center gap-1">
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  :checked="announcement.active"
                  class="sr-only peer"
                  @change="toggleActive(announcement)"
                >
                <div class="w-9 h-5 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
              <span class="text-[10px] text-text-muted">{{ t('announcements.active') }}</span>
            </div>
            <!-- Dismissible toggle -->
            <div class="flex flex-col items-center gap-1">
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  :checked="announcement.dismissible"
                  class="sr-only peer"
                  @change="toggleDismissible(announcement)"
                >
                <div class="w-9 h-5 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
              <span class="text-[10px] text-text-muted">{{ t('announcements.dismissible') }}</span>
            </div>
            <!-- Edit -->
            <button
              type="button"
              class="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
              @click="openEditModal(announcement)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <!-- Delete -->
            <button
              type="button"
              class="p-2 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              @click="deleteAnnouncement(announcement.id)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <UiModal v-model="showCreateModal" :title="t('announcements.create')">
      <form class="space-y-4" @submit.prevent="createAnnouncement">
        <div>
          <label class="block text-sm font-medium text-text-primary mb-1">{{ t('announcements.message') }}</label>
          <textarea
            v-model="formData.message"
            :placeholder="t('announcements.messagePlaceholder')"
            required
            rows="3"
            class="w-full px-3 py-2 bg-background border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary resize-none"
          />
        </div>

        <UiSelect
          v-model="formData.type"
          :label="t('announcements.type')"
          :options="[
            { value: 'info', label: t('announcements.info') },
            { value: 'warning', label: t('announcements.warning') },
            { value: 'success', label: t('announcements.success') },
            { value: 'error', label: t('announcements.error') },
          ]"
        />

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-primary">{{ t('announcements.dismissible') }}</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="formData.dismissible"
              type="checkbox"
              class="sr-only peer"
            >
            <div class="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
          </label>
        </div>

        <div v-if="error" class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p class="text-sm text-red-500">{{ error }}</p>
        </div>
      </form>

      <template #footer>
        <UiButton variant="secondary" @click="showCreateModal = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton :loading="loading" @click="createAnnouncement">
          {{ t('common.save') }}
        </UiButton>
      </template>
    </UiModal>

    <!-- Edit Modal -->
    <UiModal v-model="showEditModal" :title="t('announcements.edit')">
      <form class="space-y-4" @submit.prevent="updateAnnouncement">
        <div>
          <label class="block text-sm font-medium text-text-primary mb-1">{{ t('announcements.message') }}</label>
          <textarea
            v-model="formData.message"
            :placeholder="t('announcements.messagePlaceholder')"
            required
            rows="3"
            class="w-full px-3 py-2 bg-background border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary resize-none"
          />
        </div>

        <UiSelect
          v-model="formData.type"
          :label="t('announcements.type')"
          :options="[
            { value: 'info', label: t('announcements.info') },
            { value: 'warning', label: t('announcements.warning') },
            { value: 'success', label: t('announcements.success') },
            { value: 'error', label: t('announcements.error') },
          ]"
        />

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-primary">{{ t('announcements.active') }}</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="formData.active"
              type="checkbox"
              class="sr-only peer"
            >
            <div class="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
          </label>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-primary">{{ t('announcements.dismissible') }}</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="formData.dismissible"
              type="checkbox"
              class="sr-only peer"
            >
            <div class="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
          </label>
        </div>

        <div v-if="error" class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p class="text-sm text-red-500">{{ error }}</p>
        </div>
      </form>

      <template #footer>
        <UiButton variant="secondary" @click="showEditModal = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton :loading="loading" @click="updateAnnouncement">
          {{ t('common.save') }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
