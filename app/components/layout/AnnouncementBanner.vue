<script setup lang="ts">
const trpc = useTrpc()
const { data: announcements } = useAsyncData('announcements', () => trpc.announcements.getActive.query())

const dismissed = ref<string[]>([])
onMounted(() => {
  const stored = localStorage.getItem('dismissed-announcements')
  if (stored) dismissed.value = JSON.parse(stored)
})

const visibleAnnouncements = computed(() =>
  (announcements.value || []).filter(a => !dismissed.value.includes(a.id))
)

function dismiss(id: string) {
  dismissed.value.push(id)
  localStorage.setItem('dismissed-announcements', JSON.stringify(dismissed.value))
}

const typeColors: Record<string, string> = {
  info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
  warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
  success: 'bg-green-500/10 border-green-500/30 text-green-400',
  error: 'bg-red-500/10 border-red-500/30 text-red-400',
}
</script>

<template>
  <div v-if="visibleAnnouncements.length > 0">
    <div
      v-for="announcement in visibleAnnouncements"
      :key="announcement.id"
      :class="[
        'w-full border-b px-4 py-2 flex items-center gap-2',
        typeColors[announcement.type] || typeColors.info,
      ]"
    >
      <!-- Type icon -->
      <svg v-if="announcement.type === 'info'" class="shrink-0 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <svg v-else-if="announcement.type === 'warning'" class="shrink-0 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <svg v-else-if="announcement.type === 'success'" class="shrink-0 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <svg v-else class="shrink-0 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>

      <span class="flex-1 text-sm">{{ announcement.message }}</span>

      <!-- Dismiss button -->
      <button
        v-if="announcement.dismissible"
        class="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
        @click="dismiss(announcement.id)"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
