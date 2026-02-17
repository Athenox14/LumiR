<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const trpc = useTrpc()
const { t } = useI18n()
const { user: currentUser } = useAuth()

useHead({ title: computed(() => t('admin.users')) })

const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingUser = ref<any>(null)
const loading = ref(false)
const error = ref('')

// Form data
const formData = ref({
  displayName: '',
  email: '',
  password: '',
  role: 'user' as 'admin' | 'user',
})

// Fetch users
const { data: users, refresh: refreshUsers } = useAsyncData(
  'admin-users',
  () => trpc.users.list.query()
)

function openCreateModal() {
  formData.value = {
    displayName: '',
    email: '',
    password: '',
    role: 'user',
  }
  error.value = ''
  showCreateModal.value = true
}

function openEditModal(user: any) {
  editingUser.value = user
  formData.value = {
    displayName: user.displayName,
    email: user.email,
    password: '',
    role: user.role === 'super_admin' ? 'admin' : user.role,
  }
  error.value = ''
  showEditModal.value = true
}

async function createUser() {
  if (!formData.value.displayName || !formData.value.email || !formData.value.password) {
    error.value = t('adminUsers.fillAllFields')
    return
  }

  loading.value = true
  error.value = ''

  try {
    await trpc.users.create.mutate({
      displayName: formData.value.displayName,
      email: formData.value.email,
      password: formData.value.password,
      role: formData.value.role,
    })
    showCreateModal.value = false
    await refreshUsers()
  } catch (e: any) {
    error.value = e.message || t('adminUsers.failedToCreate')
  } finally {
    loading.value = false
  }
}

async function updateUser() {
  if (!editingUser.value) return

  loading.value = true
  error.value = ''

  try {
    const updates: any = {
      id: editingUser.value.id,
    }

    if (formData.value.displayName !== editingUser.value.displayName) {
      updates.displayName = formData.value.displayName
    }
    if (formData.value.email !== editingUser.value.email) {
      updates.email = formData.value.email
    }
    if (formData.value.password) {
      updates.password = formData.value.password
    }
    if (formData.value.role !== editingUser.value.role && editingUser.value.role !== 'super_admin') {
      updates.role = formData.value.role
    }

    await trpc.users.update.mutate(updates)
    showEditModal.value = false
    await refreshUsers()
  } catch (e: any) {
    error.value = e.message || t('adminUsers.failedToUpdate')
  } finally {
    loading.value = false
  }
}

async function deleteUser(userId: string) {
  const { confirm } = useConfirmDialog()
  const ok = await confirm({ title: t('common.confirm'), message: t('adminUsers.confirmDelete') })
  if (!ok) return

  try {
    await trpc.users.delete.mutate(userId)
    await refreshUsers()
  } catch (e: any) {
    useToast().error(e.message || t('adminUsers.failedToDelete'))
  }
}

function getRoleBadgeClass(role: string) {
  switch (role) {
    case 'super_admin':
      return 'bg-purple-500/10 text-purple-500'
    case 'admin':
      return 'bg-blue-500/10 text-blue-500'
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
      <h1 class="text-2xl font-bold text-text-primary">{{ t('adminUsers.title') }}</h1>
    </div>

    <!-- Actions -->
    <div class="flex justify-between items-center mb-6">
      <p class="text-text-secondary">
        {{ t('adminUsers.totalUsers', { count: users?.length || 0 }) }}
      </p>
      <UiButton @click="openCreateModal">
        {{ t('adminUsers.addUser') }}
      </UiButton>
    </div>

    <!-- Users list -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden">
      <div v-if="!users?.length" class="p-6 text-center text-text-muted">
        {{ t('adminUsers.noUsers') }}
      </div>
      <div v-else class="divide-y divide-border">
        <div
          v-for="user in users"
          :key="user.id"
          class="px-6 py-4 flex items-center justify-between"
        >
          <div class="flex items-center gap-4">
            <!-- Avatar: actor image or initials -->
            <NuxtLink
              v-if="user.isProfilePublic"
              :to="`/user/${user.id}`"
              class="flex-shrink-0"
            >
              <img
                v-if="user.favoriteActorImage"
                :src="user.favoriteActorImage"
                :alt="user.displayName"
                class="w-10 h-10 rounded-full object-cover ring-2 ring-primary/30 hover:ring-primary transition-all"
              >
              <div v-else class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center ring-2 ring-primary/30 hover:ring-primary transition-all">
                <span class="text-sm font-medium text-primary">
                  {{ user.displayName?.charAt(0).toUpperCase() || 'U' }}
                </span>
              </div>
            </NuxtLink>
            <div v-else class="flex-shrink-0">
              <img
                v-if="user.favoriteActorImage"
                :src="user.favoriteActorImage"
                :alt="user.displayName"
                class="w-10 h-10 rounded-full object-cover"
              >
              <div v-else class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <span class="text-sm font-medium text-primary">
                  {{ user.displayName?.charAt(0).toUpperCase() || 'U' }}
                </span>
              </div>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <NuxtLink
                  v-if="user.isProfilePublic"
                  :to="`/user/${user.id}`"
                  class="font-medium text-text-primary hover:text-primary transition-colors"
                >
                  {{ user.displayName }}
                </NuxtLink>
                <p v-else class="font-medium text-text-primary">
                  {{ user.displayName }}
                </p>
                <span
                  :class="[
                    'px-2 py-0.5 rounded text-xs font-medium',
                    getRoleBadgeClass(user.role)
                  ]"
                >
                  {{ user.role }}
                </span>
                <span v-if="user.isProfilePublic" class="text-xs text-green-500" :title="t('adminUsers.publicProfile')">
                  <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </span>
              </div>
              <p class="text-sm text-text-muted">
                {{ user.email }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <NuxtLink
              v-if="user.isProfilePublic"
              :to="`/user/${user.id}`"
              class="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
              :title="t('adminUsers.viewProfile')"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </NuxtLink>
            <button
              type="button"
              class="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
              @click="openEditModal(user)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              v-if="user.role !== 'super_admin' && user.id !== currentUser?.id"
              type="button"
              class="p-2 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              @click="deleteUser(user.id)"
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
    <UiModal v-model="showCreateModal" :title="t('adminUsers.createUser')">
      <form class="space-y-4" @submit.prevent="createUser">
        <UiInput
          v-model="formData.displayName"
          :label="t('adminUsers.displayName')"
          :placeholder="t('adminUsers.displayNamePlaceholder')"
          required
        />
        <UiInput
          v-model="formData.email"
          type="email"
          :label="t('adminUsers.email')"
          :placeholder="t('adminUsers.emailPlaceholder')"
          required
        />
        <UiInput
          v-model="formData.password"
          type="password"
          :label="t('adminUsers.password')"
          :placeholder="t('adminUsers.passwordPlaceholder')"
          required
        />
        <UiSelect
          v-model="formData.role"
          :label="t('adminUsers.role')"
          :options="[
            { value: 'user', label: t('adminUsers.user') },
            { value: 'admin', label: t('adminUsers.admin') },
          ]"
        />

        <div v-if="error" class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p class="text-sm text-red-500">{{ error }}</p>
        </div>
      </form>

      <template #footer>
        <UiButton variant="secondary" @click="showCreateModal = false">
          {{ t('adminUsers.cancel') }}
        </UiButton>
        <UiButton :loading="loading" @click="createUser">
          {{ t('adminUsers.createUserBtn') }}
        </UiButton>
      </template>
    </UiModal>

    <!-- Edit Modal -->
    <UiModal v-model="showEditModal" :title="t('adminUsers.editUser')">
      <form class="space-y-4" @submit.prevent="updateUser">
        <UiInput
          v-model="formData.displayName"
          :label="t('adminUsers.displayName')"
          required
        />
        <UiInput
          v-model="formData.email"
          type="email"
          :label="t('adminUsers.email')"
          required
        />
        <UiInput
          v-model="formData.password"
          type="password"
          :label="t('adminUsers.newPassword')"
          :placeholder="t('adminUsers.newPasswordPlaceholder')"
        />
        <UiSelect
          v-if="editingUser?.role !== 'super_admin'"
          v-model="formData.role"
          :label="t('adminUsers.role')"
          :options="[
            { value: 'user', label: t('adminUsers.user') },
            { value: 'admin', label: t('adminUsers.admin') },
          ]"
        />

        <div v-if="error" class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p class="text-sm text-red-500">{{ error }}</p>
        </div>
      </form>

      <template #footer>
        <UiButton variant="secondary" @click="showEditModal = false">
          {{ t('adminUsers.cancel') }}
        </UiButton>
        <UiButton :loading="loading" @click="updateUser">
          {{ t('adminUsers.saveChanges') }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
