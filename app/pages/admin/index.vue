<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const trpc = useTrpc()
const { t } = useI18n()

// Fetch stats
const { data: stats } = useAsyncData('admin-stats', () => trpc.media.stats.query())
const { data: users } = useAsyncData('admin-users', () => trpc.users.list.query())
const { data: scanStatus } = useAsyncData('scan-status', () => trpc.library.scanStatus.query())

const adminSections = computed(() => [
  {
    title: t('admin.library'),
    description: t('admin.libraryDesc'),
    icon: 'folder',
    to: '/admin/library',
  },
  {
    title: t('admin.usersManagement'),
    description: t('admin.usersDesc'),
    icon: 'users',
    to: '/admin/users',
  },
  {
    title: t('admin.settings'),
    description: t('admin.settingsDesc'),
    icon: 'cog',
    to: '/admin/settings',
  },
])
</script>

<template>
  <div class="p-6">
    <h1 class="text-2xl font-bold text-text-primary mb-2">{{ t('admin.title') }}</h1>
    <p class="text-text-secondary mb-8">{{ t('admin.subtitle') }}</p>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-3xl font-bold text-text-primary">
          {{ stats?.totalMedia || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('admin.totalMedia') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-3xl font-bold text-text-primary">
          {{ stats?.totalMovies || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('admin.totalMovies') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-3xl font-bold text-text-primary">
          {{ stats?.totalTv || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('admin.totalTvShows') }}</p>
      </div>
      <div class="p-4 bg-surface border border-border rounded-xl">
        <p class="text-3xl font-bold text-text-primary">
          {{ users?.length || 0 }}
        </p>
        <p class="text-sm text-text-muted">{{ t('admin.users') }}</p>
      </div>
    </div>

    <!-- Scan status -->
    <div v-if="scanStatus" class="mb-8 p-4 bg-surface border border-border rounded-xl">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-medium text-text-primary">{{ t('admin.libraryScanStatus') }}</h3>
          <p class="text-sm text-text-muted">
            <template v-if="scanStatus.status === 'running'">
              {{ t('admin.scanning', { processed: scanStatus.processedFiles || 0, total: scanStatus.totalFiles || 0 }) }}
            </template>
            <template v-else-if="scanStatus.status === 'completed'">
              {{ t('admin.lastScanCompleted', { new: scanStatus.newFiles || 0 }) }}
            </template>
            <template v-else>
              {{ t('admin.lastScanFailed') }}
            </template>
          </p>
        </div>
        <div
          :class="[
            'w-3 h-3 rounded-full',
            scanStatus.status === 'running' ? 'bg-yellow-500 animate-pulse' :
            scanStatus.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
          ]"
        />
      </div>
      <div v-if="scanStatus.status === 'running'" class="mt-3">
        <div class="h-2 bg-surface-secondary rounded-full overflow-hidden">
          <div
            class="h-full bg-primary transition-all duration-300"
            :style="{
              width: scanStatus.totalFiles
                ? `${(scanStatus.processedFiles / scanStatus.totalFiles) * 100}%`
                : '0%'
            }"
          />
        </div>
      </div>
    </div>

    <!-- Admin sections -->
    <div class="grid md:grid-cols-3 gap-4">
      <NuxtLink
        v-for="section in adminSections"
        :key="section.to"
        :to="section.to"
        class="p-6 bg-surface border border-border rounded-xl hover:border-primary/50 transition-colors group"
      >
        <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
          <svg v-if="section.icon === 'folder'" class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <svg v-if="section.icon === 'users'" class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <svg v-if="section.icon === 'cog'" class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h3 class="font-semibold text-text-primary mb-1">{{ section.title }}</h3>
        <p class="text-sm text-text-secondary">{{ section.description }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
