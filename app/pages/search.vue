<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const route = useRoute()
const trpc = useTrpc()
const { t } = useI18n()

const searchQuery = computed(() => (route.query.q as string) || '')

const { data: results, pending } = useAsyncData(
  'search-results',
  () => {
    if (!searchQuery.value.trim()) {
      return Promise.resolve({ items: [], total: 0, hasMore: false })
    }
    return trpc.media.list.query({
      search: searchQuery.value,
      limit: 50,
    })
  },
  {
    watch: [searchQuery],
  }
)
</script>

<template>
  <div class="p-6">
    <!-- Results -->
    <div v-if="searchQuery.trim()">
      <p class="text-text-secondary mb-4">
        <template v-if="pending">
          {{ t('search.searching') }}
        </template>
        <template v-else>
          {{ t('search.resultsFor', { count: results?.total || 0, query: searchQuery }) }}
        </template>
      </p>

      <MediaGrid
        :items="results?.items || []"
        :loading="pending"
        :empty-message="t('search.noResults')"
      />
    </div>

    <!-- Empty state -->
    <div v-else class="text-center py-16">
      <div class="w-16 h-16 rounded-full bg-surface flex items-center justify-center mx-auto mb-4">
        <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <p class="text-text-secondary">{{ t('search.useSearchBar') }}</p>
    </div>
  </div>
</template>
