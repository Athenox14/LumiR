<script setup lang="ts">
const { t } = useI18n()
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

const typeIcons: Record<string, string> = {
  info: 'i-heroicons-information-circle',
  warning: 'i-heroicons-exclamation-triangle',
  success: 'i-heroicons-check-circle',
  error: 'i-heroicons-x-circle',
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
      <span
        :class="[
          'shrink-0 size-5',
          typeIcons[announcement.type] || typeIcons.info,
        ]"
      />
      <span class="flex-1 text-sm">{{ announcement.message }}</span>
      <button
        v-if="announcement.dismissible"
        class="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
        :aria-label="t('common.close', 'Close')"
        @click="dismiss(announcement.id)"
      >
        <span class="i-heroicons-x-mark size-4" />
      </button>
    </div>
  </div>
</template>
