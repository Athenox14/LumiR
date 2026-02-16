<script setup lang="ts">
const { user, logout } = useAuth()
const { t, locale, setLocale } = useI18n()
const trpc = useTrpc()
const route = useRoute()

const searchQuery = ref('')
const showUserMenu = ref(false)
const showLangMenu = ref(false)
const showSearchResults = ref(false)
const searchResults = ref<any[]>([])
const searchLoading = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)

// Sync search query from URL when on search page
watch(() => route.query.q, (q) => {
  if (route.path === '/search' && q) {
    searchQuery.value = q as string
  }
}, { immediate: true })

// Debounced live search
let searchTimeout: ReturnType<typeof setTimeout> | null = null

watch(searchQuery, (value) => {
  if (searchTimeout) clearTimeout(searchTimeout)

  if (!value.trim()) {
    searchResults.value = []
    showSearchResults.value = false
    return
  }

  searchTimeout = setTimeout(async () => {
    searchLoading.value = true
    try {
      const result = await trpc.media.list.query({
        search: value,
        limit: 8,
      })
      searchResults.value = result.items || []
      showSearchResults.value = true
    } catch {
      searchResults.value = []
    } finally {
      searchLoading.value = false
    }
  }, 300)
})

function handleSearch() {
  if (searchQuery.value.trim()) {
    showSearchResults.value = false
    navigateTo(`/search?q=${encodeURIComponent(searchQuery.value)}`)
  }
}

function goToMedia(item: any) {
  showSearchResults.value = false
  searchQuery.value = ''
  navigateTo(`/media/${item.id}`)
}

function selectLocale(code: 'fr' | 'en' | 'de') {
  setLocale(code)
  showLangMenu.value = false
}

// Close dropdown when clicking outside
const searchContainerRef = ref<HTMLElement | null>(null)

onMounted(() => {
  const handleClickOutside = (e: MouseEvent) => {
    if (searchContainerRef.value && !searchContainerRef.value.contains(e.target as Node)) {
      showSearchResults.value = false
    }
  }
  document.addEventListener('click', handleClickOutside)
  onUnmounted(() => document.removeEventListener('click', handleClickOutside))
})

// Close menus when clicking outside
const userMenuRef = ref<HTMLElement | null>(null)
const langMenuRef = ref<HTMLElement | null>(null)

onMounted(() => {
  const handleClickOutside = (e: MouseEvent) => {
    if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) {
      showUserMenu.value = false
    }
    if (langMenuRef.value && !langMenuRef.value.contains(e.target as Node)) {
      showLangMenu.value = false
    }
  }
  document.addEventListener('click', handleClickOutside)
  onUnmounted(() => document.removeEventListener('click', handleClickOutside))
})
</script>

<template>
  <header class="sticky top-0 z-30 flex items-center justify-between h-16 px-6 bg-background/80 backdrop-blur-lg border-b border-border">
    <!-- Search -->
    <div ref="searchContainerRef" class="relative flex-1 max-w-xl">
      <form @submit.prevent="handleSearch">
        <div class="relative">
          <svg
            class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="search"
            :placeholder="t('search.placeholder')"
            class="w-full pl-10 pr-4 py-2 rounded-lg bg-surface border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            @focus="searchQuery.trim() && searchResults.length > 0 && (showSearchResults = true)"
          >
        </div>
      </form>

      <!-- Live search results dropdown -->
      <Transition
        enter-active-class="transition-all duration-200"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition-all duration-150"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="showSearchResults && searchQuery.trim()"
          class="absolute top-full left-0 right-0 mt-2 bg-surface border border-border rounded-xl shadow-xl overflow-hidden z-50"
        >
          <!-- Loading -->
          <div v-if="searchLoading" class="px-4 py-3 text-sm text-text-muted">
            {{ t('search.searching') }}
          </div>

          <!-- Results -->
          <template v-else-if="searchResults.length > 0">
            <button
              v-for="item in searchResults"
              :key="item.id"
              type="button"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary transition-colors text-left"
              @click="goToMedia(item)"
            >
              <div class="w-10 h-14 rounded bg-surface-secondary flex-shrink-0 overflow-hidden">
                <img
                  v-if="item.posterPath"
                  :src="item.posterPath"
                  :alt="item.title"
                  class="w-full h-full object-cover"
                >
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-text-primary truncate">{{ item.title }}</p>
                <div class="flex items-center gap-2 text-xs text-text-muted">
                  <span v-if="item.year">{{ item.year }}</span>
                  <span v-if="item.mediaType" class="px-1.5 py-0.5 rounded bg-surface text-text-muted">
                    {{ item.mediaType === 'movie' ? t('search.film') : item.mediaType === 'tv' ? t('search.series') : '' }}
                  </span>
                  <span v-if="item.rating" class="flex items-center gap-0.5">
                    <svg class="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    {{ item.rating.toFixed(1) }}
                  </span>
                </div>
              </div>
            </button>

            <!-- See all results -->
            <button
              type="button"
              class="w-full px-4 py-2.5 text-sm text-primary hover:bg-surface-secondary transition-colors text-center border-t border-border"
              @click="handleSearch"
            >
              {{ t('search.seeAllResults') }}
            </button>
          </template>

          <!-- No results -->
          <div v-else class="px-4 py-3 text-sm text-text-muted">
            {{ t('search.noResultsFor', { query: searchQuery }) }}
          </div>
        </div>
      </Transition>
    </div>

    <!-- Right side: language switcher + user menu -->
    <div class="flex items-center gap-2 ml-4">
      <!-- Language selector -->
      <div ref="langMenuRef" class="relative">
        <button
          type="button"
          class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
          @click="showLangMenu = !showLangMenu"
        >
          <!-- French flag -->
          <svg v-if="locale === 'fr'" class="w-5 h-3.5 rounded-sm overflow-hidden" viewBox="0 0 640 480">
            <rect width="213.3" fill="#002654" height="480" />
            <rect width="213.3" x="213.3" fill="#fff" height="480" />
            <rect width="213.3" x="426.7" fill="#ce1126" height="480" />
          </svg>
          <!-- German flag -->
          <svg v-else-if="locale === 'de'" class="w-5 h-3.5 rounded-sm overflow-hidden" viewBox="0 0 640 480">
            <rect width="640" fill="#000" height="160" />
            <rect width="640" y="160" fill="#D00" height="160" />
            <rect width="640" y="320" fill="#FFCE00" height="160" />
          </svg>
          <!-- UK flag -->
          <svg v-else class="w-5 h-3.5 rounded-sm overflow-hidden" viewBox="0 0 640 480">
            <path fill="#012169" d="M0 0h640v480H0z" />
            <path fill="#FFF" d="M75 0l244 181L562 0h78v62L400 241l240 178v61h-80L320 301 81 480H0v-60l239-178L0 64V0h75z" />
            <path fill="#C8102E" d="M424 281l216 159v40L369 281h55zm-184 20l6 35L54 480H0l240-179zM640 0v3L391 191l2-44L590 0h50zM0 0l239 176h-60L0 42V0z" />
            <path fill="#FFF" d="M241 0v480h160V0H241zM0 160v160h640V160H0z" />
            <path fill="#C8102E" d="M0 193v96h640v-96H0zM273 0v480h96V0h-96z" />
          </svg>
          <svg
            :class="['w-3.5 h-3.5 transition-transform duration-200', showLangMenu ? 'rotate-180' : '']"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- Language dropdown -->
        <Transition
          enter-active-class="transition-all duration-200"
          enter-from-class="opacity-0 scale-95 -translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition-all duration-150"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 -translate-y-2"
        >
          <div
            v-if="showLangMenu"
            class="absolute right-0 mt-2 w-48 py-1 bg-surface border border-border rounded-xl shadow-xl z-50"
          >
            <p class="px-3 py-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
              {{ t('language.selectLanguage') }}
            </p>
            <!-- Français -->
            <button
              type="button"
              class="w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left"
              :class="locale === 'fr' ? 'text-primary bg-primary/5' : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'"
              @click="selectLocale('fr')"
            >
              <svg class="w-5 h-3.5 rounded-sm flex-shrink-0" viewBox="0 0 640 480">
                <rect width="213.3" fill="#002654" height="480" />
                <rect width="213.3" x="213.3" fill="#fff" height="480" />
                <rect width="213.3" x="426.7" fill="#ce1126" height="480" />
              </svg>
              <span class="flex-1">{{ t('language.french') }}</span>
              <svg
                v-if="locale === 'fr'"
                class="w-4 h-4 text-primary flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <!-- English -->
            <button
              type="button"
              class="w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left"
              :class="locale === 'en' ? 'text-primary bg-primary/5' : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'"
              @click="selectLocale('en')"
            >
              <svg class="w-5 h-3.5 rounded-sm flex-shrink-0" viewBox="0 0 640 480">
                <path fill="#012169" d="M0 0h640v480H0z" />
                <path fill="#FFF" d="M75 0l244 181L562 0h78v62L400 241l240 178v61h-80L320 301 81 480H0v-60l239-178L0 64V0h75z" />
                <path fill="#C8102E" d="M424 281l216 159v40L369 281h55zm-184 20l6 35L54 480H0l240-179zM640 0v3L391 191l2-44L590 0h50zM0 0l239 176h-60L0 42V0z" />
                <path fill="#FFF" d="M241 0v480h160V0H241zM0 160v160h640V160H0z" />
                <path fill="#C8102E" d="M0 193v96h640v-96H0zM273 0v480h96V0h-96z" />
              </svg>
              <span class="flex-1">{{ t('language.english') }}</span>
              <svg
                v-if="locale === 'en'"
                class="w-4 h-4 text-primary flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <!-- Deutsch -->
            <button
              type="button"
              class="w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left"
              :class="locale === 'de' ? 'text-primary bg-primary/5' : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'"
              @click="selectLocale('de')"
            >
              <svg class="w-5 h-3.5 rounded-sm flex-shrink-0" viewBox="0 0 640 480">
                <rect width="640" fill="#000" height="160" />
                <rect width="640" y="160" fill="#D00" height="160" />
                <rect width="640" y="320" fill="#FFCE00" height="160" />
              </svg>
              <span class="flex-1">{{ t('language.german') }}</span>
              <svg
                v-if="locale === 'de'"
                class="w-4 h-4 text-primary flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </Transition>
      </div>

      <!-- User menu -->
      <div ref="userMenuRef" class="relative">
        <button
          type="button"
          class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-surface transition-colors"
          @click="showUserMenu = !showUserMenu"
        >
          <div class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
            <img
              v-if="user?.favoriteActorImage"
              :src="user.favoriteActorImage"
              :alt="user.displayName"
              class="w-full h-full object-cover"
            >
            <span v-else class="text-sm font-medium text-primary">
              {{ user?.displayName?.charAt(0).toUpperCase() || 'U' }}
            </span>
          </div>
          <svg
            :class="['w-4 h-4 text-text-muted transition-transform', showUserMenu ? 'rotate-180' : '']"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- Dropdown -->
        <Transition
          enter-active-class="transition-all duration-200"
          enter-from-class="opacity-0 scale-95 -translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition-all duration-200"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 -translate-y-2"
        >
          <div
            v-if="showUserMenu"
            class="absolute right-0 mt-2 w-56 py-2 bg-surface border border-border rounded-xl shadow-xl"
          >
            <div class="px-4 py-2 border-b border-border">
              <p class="text-sm font-medium text-text-primary">
                {{ user?.displayName }}
              </p>
              <p class="text-xs text-text-muted truncate">
                {{ user?.email }}
              </p>
            </div>
            <div class="py-1">
              <NuxtLink
                to="/profile"
                class="flex items-center gap-2 px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
                @click="showUserMenu = false"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {{ t('common.profile') }}
              </NuxtLink>
              <button
                type="button"
                class="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
                @click="logout"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                {{ t('common.logout') }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>
