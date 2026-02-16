<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const { t } = useI18n()
const { user, updateProfile, fetchUser } = useAuth()
const trpc = useTrpc()

// Form state
const displayName = ref(user.value?.displayName || '')
const bio = ref('')
const isProfilePublic = ref(false)
const showWatchedFilms = ref(false)
const showLikedFilms = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')
const success = ref('')

// Avatar search
const selectedActor = ref<{ id: number; name: string; image: string | null } | null>(null)
const actorSearch = ref('')
const actorResults = ref<Array<{ id: number; name: string; profilePath: string | null; knownFor: string[] }>>([])
const actorSearchLoading = ref(false)
let actorSearchTimeout: ReturnType<typeof setTimeout> | null = null

// Stats
const { data: stats } = useAsyncData(
  'my-stats',
  () => trpc.users.getUserStats.query({ userId: user.value?.id || '' }),
  { lazy: true }
)

// Load profile data from server and sync form
async function loadProfile() {
  if (!user.value?.id) return
  try {
    const data = await trpc.users.getPublicProfile.query({ userId: user.value.id })
    displayName.value = data.displayName
    bio.value = data.bio || ''
    isProfilePublic.value = data.isProfilePublic || false
    showWatchedFilms.value = data.showWatchedFilms || false
    showLikedFilms.value = data.showLikedFilms || false
    if (data.favoriteActorId) {
      selectedActor.value = {
        id: data.favoriteActorId,
        name: data.favoriteActorName || '',
        image: data.favoriteActorImage || null,
      }
    } else {
      selectedActor.value = null
    }
  } catch (e) {
    console.error('Failed to load profile:', e)
  }
}

// Fetch profile when user is available
watch(user, () => loadProfile(), { immediate: true })

// Debounced actor search
watch(actorSearch, (value) => {
  if (actorSearchTimeout) clearTimeout(actorSearchTimeout)
  if (!value.trim() || value.trim().length < 2) {
    actorResults.value = []
    return
  }
  actorSearchTimeout = setTimeout(async () => {
    actorSearchLoading.value = true
    try {
      actorResults.value = await trpc.catalog.searchPerson.query({ query: value })
    } catch {
      actorResults.value = []
    } finally {
      actorSearchLoading.value = false
    }
  }, 400)
})

function selectActor(actor: { id: number; name: string; profilePath: string | null }) {
  selectedActor.value = { id: actor.id, name: actor.name, image: actor.profilePath }
  actorSearch.value = ''
  actorResults.value = []
}

function removeAvatar() {
  selectedActor.value = null
}

async function handleSubmit() {
  error.value = ''
  success.value = ''

  if (newPassword.value) {
    if (!currentPassword.value) {
      error.value = t('auth.currentPasswordRequired')
      return
    }
    if (newPassword.value !== confirmPassword.value) {
      error.value = t('auth.passwordsDontMatch')
      return
    }
    if (newPassword.value.length < 8) {
      error.value = t('auth.passwordMin8')
      return
    }
  }

  loading.value = true

  try {
    await updateProfile({
      displayName: displayName.value !== user.value?.displayName ? displayName.value : undefined,
      currentPassword: newPassword.value ? currentPassword.value : undefined,
      newPassword: newPassword.value || undefined,
      bio: bio.value,
      isProfilePublic: isProfilePublic.value,
      showWatchedFilms: showWatchedFilms.value,
      showLikedFilms: showLikedFilms.value,
      favoriteActorId: selectedActor.value?.id || null,
      favoriteActorName: selectedActor.value?.name || null,
      favoriteActorImage: selectedActor.value?.image || null,
    })

    success.value = t('profile.profileUpdated')
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''

    await fetchUser()
    await loadProfile()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (e: any) {
    error.value = e.message || t('profile.updateError')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="p-6">
    <h1 class="text-2xl font-bold text-text-primary mb-6">{{ t('profile.title') }}</h1>

    <form @submit.prevent="handleSubmit">
      <!-- Top row: Avatar + Info | Privacy + Stats -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <!-- Left column -->
        <div class="space-y-6">
          <!-- Avatar -->
          <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
            <h3 class="font-semibold text-text-primary">{{ t('profile.profilePicture') }}</h3>

            <div class="flex items-center gap-4">
              <div class="w-20 h-20 rounded-full overflow-hidden bg-surface-secondary flex-shrink-0">
                <img
                  v-if="selectedActor?.image"
                  :src="selectedActor.image"
                  :alt="selectedActor.name"
                  class="w-full h-full object-cover"
                />
                <div v-else class="w-full h-full flex items-center justify-center">
                  <span class="text-2xl font-bold text-primary">
                    {{ user?.displayName?.charAt(0).toUpperCase() || 'U' }}
                  </span>
                </div>
              </div>
              <div v-if="selectedActor" class="flex-1">
                <p class="text-sm font-medium text-text-primary">{{ selectedActor.name }}</p>
                <button
                  type="button"
                  class="text-xs text-red-400 hover:text-red-300 mt-1"
                  @click="removeAvatar"
                >
                  {{ t('profile.removePhoto') }}
                </button>
              </div>
            </div>

            <!-- Actor search -->
            <div class="relative">
              <input
                v-model="actorSearch"
                type="text"
                :placeholder="t('profile.searchActor')"
                class="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
              <div
                v-if="actorResults.length > 0"
                class="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-xl overflow-hidden z-50 max-h-64 overflow-y-auto"
              >
                <button
                  v-for="actor in actorResults"
                  :key="actor.id"
                  type="button"
                  class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary transition-colors text-left"
                  @click="selectActor(actor)"
                >
                  <div class="w-10 h-10 rounded-full bg-surface-secondary overflow-hidden flex-shrink-0">
                    <img
                      v-if="actor.profilePath"
                      :src="actor.profilePath"
                      :alt="actor.name"
                      class="w-full h-full object-cover"
                    />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-text-primary">{{ actor.name }}</p>
                    <p v-if="actor.knownFor.length" class="text-xs text-text-muted truncate">
                      {{ actor.knownFor.join(', ') }}
                    </p>
                  </div>
                </button>
              </div>
              <div v-else-if="actorSearchLoading" class="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl p-3 text-sm text-text-muted">
                {{ t('common.search') }}...
              </div>
            </div>
          </div>

          <!-- Profile info -->
          <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
            <h3 class="font-semibold text-text-primary">{{ t('profile.information') }}</h3>

            <UiInput
              v-model="displayName"
              :label="t('auth.displayName')"
              required
            />

            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1.5">{{ t('profile.bio') }}</label>
              <textarea
                v-model="bio"
                maxlength="500"
                rows="3"
                :placeholder="t('profile.bioPlaceholder')"
                class="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary text-sm resize-none"
              />
              <p class="text-xs text-text-muted mt-1 text-right">{{ t('profile.bioMaxLength', { current: bio.length, max: 500 }) }}</p>
            </div>

            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1.5">{{ t('auth.email') }}</label>
              <p class="px-4 py-2.5 rounded-lg bg-surface-secondary text-text-muted text-sm">
                {{ user?.email }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1.5">{{ t('profile.role') }}</label>
              <p class="px-4 py-2.5 rounded-lg bg-surface-secondary text-text-muted capitalize text-sm">
                {{ user?.role?.replace('_', ' ') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="space-y-6">
          <!-- Privacy -->
          <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
            <h3 class="font-semibold text-text-primary">{{ t('profile.privacy') }}</h3>

            <button
              type="button"
              class="flex items-center justify-between gap-3 w-full text-left"
              @click="isProfilePublic = !isProfilePublic"
            >
              <div>
                <p class="text-sm text-text-primary">{{ t('profile.publicProfile') }}</p>
                <p class="text-xs text-text-muted">{{ t('profile.publicProfileDesc') }}</p>
              </div>
              <div
                class="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200"
                :class="isProfilePublic ? 'bg-primary' : 'bg-border'"
              >
                <div
                  class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                  :class="isProfilePublic ? 'translate-x-5' : 'translate-x-0'"
                />
              </div>
            </button>

            <button
              type="button"
              class="flex items-center justify-between gap-3 w-full text-left"
              @click="showWatchedFilms = !showWatchedFilms"
            >
              <div>
                <p class="text-sm text-text-primary">{{ t('profile.showWatchedFilms') }}</p>
                <p class="text-xs text-text-muted">{{ t('profile.showWatchedFilmsDesc') }}</p>
              </div>
              <div
                class="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200"
                :class="showWatchedFilms ? 'bg-primary' : 'bg-border'"
              >
                <div
                  class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                  :class="showWatchedFilms ? 'translate-x-5' : 'translate-x-0'"
                />
              </div>
            </button>

            <button
              type="button"
              class="flex items-center justify-between gap-3 w-full text-left"
              @click="showLikedFilms = !showLikedFilms"
            >
              <div>
                <p class="text-sm text-text-primary">{{ t('profile.showLikedFilms') }}</p>
                <p class="text-xs text-text-muted">{{ t('profile.showLikedFilmsDesc') }}</p>
              </div>
              <div
                class="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200"
                :class="showLikedFilms ? 'bg-primary' : 'bg-border'"
              >
                <div
                  class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                  :class="showLikedFilms ? 'translate-x-5' : 'translate-x-0'"
                />
              </div>
            </button>

            <!-- Link to public profile -->
            <div v-if="isProfilePublic && user">
              <NuxtLink
                :to="`/user/${user.id}`"
                class="text-sm text-primary hover:underline"
              >
                {{ t('profile.viewPublicProfile') }}
              </NuxtLink>
            </div>
          </div>

          <!-- Stats -->
          <div v-if="stats" class="p-6 bg-surface border border-border rounded-xl">
            <h3 class="font-semibold text-text-primary mb-4">{{ t('profile.statistics') }}</h3>
            <div class="grid grid-cols-2 gap-4">
              <div class="text-center p-3 bg-surface-secondary rounded-lg">
                <p class="text-xl font-bold text-text-primary">{{ stats.totalWatched }}</p>
                <p class="text-xs text-text-muted">{{ t('profile.totalWatched') }}</p>
              </div>
              <div class="text-center p-3 bg-surface-secondary rounded-lg">
                <p class="text-xl font-bold text-text-primary">{{ stats.totalHours }}h</p>
                <p class="text-xs text-text-muted">{{ t('profile.totalHours') }}</p>
              </div>
              <div class="text-center p-3 bg-surface-secondary rounded-lg">
                <p class="text-xl font-bold text-text-primary">{{ stats.completionRate }}%</p>
                <p class="text-xs text-text-muted">{{ t('profile.completionRate') }}</p>
              </div>
              <div class="text-center p-3 bg-surface-secondary rounded-lg">
                <p class="text-sm font-medium text-text-primary">{{ stats.topGenres?.slice(0, 3).join(', ') || '-' }}</p>
                <p class="text-xs text-text-muted">{{ t('profile.topGenres') }}</p>
              </div>
            </div>
          </div>

          <!-- Change password -->
          <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
            <h3 class="font-semibold text-text-primary">{{ t('profile.changePassword') }}</h3>

            <UiInput
              v-model="currentPassword"
              type="password"
              :label="t('auth.currentPassword')"
              :placeholder="t('auth.currentPasswordPlaceholder')"
            />

            <UiInput
              v-model="newPassword"
              type="password"
              :label="t('auth.newPassword')"
              :placeholder="t('auth.newPasswordPlaceholder')"
            />

            <UiInput
              v-model="confirmPassword"
              type="password"
              :label="t('auth.confirmPassword')"
              :placeholder="t('auth.repeatPassword')"
            />
          </div>
        </div>
      </div>

      <!-- Messages -->
      <div v-if="error" class="p-4 bg-red-500/10 border border-red-500/20 rounded-xl mb-6">
        <p class="text-sm text-red-500">{{ error }}</p>
      </div>

      <div v-if="success" class="p-4 bg-green-500/10 border border-green-500/20 rounded-xl mb-6">
        <p class="text-sm text-green-500">{{ success }}</p>
      </div>

      <!-- Submit -->
      <div class="flex justify-end">
        <UiButton type="submit" :loading="loading">
          {{ t('common.save') }}
        </UiButton>
      </div>
    </form>
  </div>
</template>
