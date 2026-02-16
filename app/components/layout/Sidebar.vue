<script setup lang="ts">
const { user, isAdmin, logout } = useAuth()
const { t } = useI18n()
const { appName } = useAppName()
const { catalogEnabled, downloadsEnabled } = useFeatureFlags()
const route = useRoute()

const collapsed = useState('sidebar-collapsed', () => false)

const navItems = computed(() => {
  const items: { icon: string, labelKey: string, to: string, beta?: boolean }[] = [
    { icon: 'home', labelKey: 'nav.home', to: '/' },
    { icon: 'film', labelKey: 'nav.movies', to: '/movies' },
    { icon: 'tv', labelKey: 'nav.tvShows', to: '/tv' },
    { icon: 'clock', labelKey: 'nav.continueWatching', to: '/continue' },
  ]

  if (catalogEnabled.value) {
    items.push({ icon: 'globe', labelKey: 'nav.catalog', to: '/catalog', beta: true })
  }
  if (downloadsEnabled.value) {
    items.push({ icon: 'download', labelKey: 'nav.downloads', to: '/downloads', beta: true })
  }

  if (isAdmin.value) {
    items.push({ icon: 'cog', labelKey: 'nav.admin', to: '/admin' })
  }

  return items
})

function isActive(path: string) {
  if (path === '/') {
    return route.path === '/'
  }
  return route.path.startsWith(path)
}

function toggleCollapse() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <aside
    :class="[
      'fixed left-0 top-0 z-40 h-screen flex flex-col',
      'bg-background-secondary border-r border-border transition-all duration-300',
      collapsed ? 'w-20' : 'w-64',
    ]"
  >
    <!-- Logo -->
    <div :class="['flex items-center h-16 border-b border-border', collapsed ? 'justify-center px-0' : 'px-4']">
      <NuxtLink
        to="/"
        class="flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
          <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v12h16V6H4zm7 2l5 4-5 4V8z" />
          </svg>
        </div>
        <span
          v-if="!collapsed"
          class="text-xl font-bold text-text-primary"
        >
          {{ appName }}
        </span>
      </NuxtLink>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :class="[
          'flex items-center gap-3 py-2.5 rounded-lg transition-all duration-200',
          collapsed ? 'justify-center px-0' : 'px-3',
          isActive(item.to)
            ? 'bg-primary/10 text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface',
        ]"
      >
        <!-- Icons -->
        <svg
          v-if="item.icon === 'home'"
          class="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
        <svg
          v-if="item.icon === 'film'"
          class="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
          />
        </svg>
        <svg
          v-if="item.icon === 'tv'"
          class="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
        <svg
          v-if="item.icon === 'clock'"
          class="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <svg
          v-if="item.icon === 'globe'"
          class="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
          />
        </svg>
        <svg
          v-if="item.icon === 'download'"
          class="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <svg
          v-if="item.icon === 'cog'"
          class="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <span
          v-if="!collapsed"
          class="font-medium flex-1"
        >
          {{ t(item.labelKey) }}
        </span>
        <span
          v-if="!collapsed && item.beta"
          class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-primary/15 text-primary"
        >
          {{ t('common.beta') }}
        </span>
      </NuxtLink>
    </nav>

    <!-- User section -->
    <div class="p-3 border-t border-border">
      <div
        :class="[
          'flex items-center gap-3 p-2 rounded-lg',
          collapsed ? 'justify-center' : '',
        ]"
      >
        <div class="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
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
        <div v-if="!collapsed" class="flex-1 min-w-0">
          <p class="text-sm font-medium text-text-primary truncate">
            {{ user?.displayName || t('common.user') }}
          </p>
          <p class="text-xs text-text-muted truncate">
            {{ user?.email }}
          </p>
        </div>
        <button
          v-if="!collapsed"
          type="button"
          class="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface transition-colors"
          :title="t('common.logout')"
          @click="logout"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
        </button>
      </div>

      <!-- Collapse toggle -->
      <button
        type="button"
        :class="[
          'w-full mt-2 p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface transition-colors',
          'flex items-center justify-center',
        ]"
        @click="toggleCollapse"
      >
        <svg
          :class="['w-5 h-5 transition-transform duration-300', collapsed ? 'rotate-180' : '']"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
          />
        </svg>
      </button>
    </div>
  </aside>
</template>
