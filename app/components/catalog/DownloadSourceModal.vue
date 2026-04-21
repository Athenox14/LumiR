<script setup lang="ts">
interface Props {
  modelValue: boolean
  tmdbId: number
  title: string
  type: 'movie' | 'tv'
  posterPath?: string
  episodeId?: string
  season?: number
  episode?: number
}

interface StreamSource {
  provider: string
  server: string
  sources: { url: string; quality: string; isM3U8: boolean }[]
  subtitles: { url: string; lang: string }[]
  headers?: Record<string, string>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  download: [source: { url: string; isM3U8: boolean; headers?: Record<string, string> }]
}>()

const { t } = useI18n()
const trpc = useTrpc()
const streams = ref<StreamSource[]>([])
const loading = ref(false)
const error = ref('')
const downloading = ref(false)

watch(() => props.modelValue, async (visible) => {
  if (visible) {
    await fetchSources()
  } else {
    streams.value = []
    error.value = ''
    downloading.value = false
  }
})

async function fetchSources() {
  loading.value = true
  error.value = ''
  streams.value = []
  try {
    const result = await trpc.remoteMedia.streamingSources.query({
      tmdbId: props.tmdbId,
      title: props.title,
      type: props.type,
      episodeId: props.episodeId,
      season: props.season,
      episode: props.episode,
    })
    streams.value = result.streams
  } catch (e: any) {
    error.value = e.message || t('downloadModal.noSourcesFound')
  } finally {
    loading.value = false
  }
}

function selectSource(stream: StreamSource) {
  if (downloading.value) return
  downloading.value = true
  const src = stream.sources[0]
  emit('download', {
    url: src.url,
    isM3U8: src.isM3U8,
    headers: stream.headers,
  })
}

function selectBest() {
  if (downloading.value || streams.value.length === 0) return
  // Prefer direct MP4 source over HLS
  const directStream = streams.value.find(s => s.sources.some(src => !src.isM3U8))
  const stream = directStream || streams.value[0]
  selectSource(stream)
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <UiModal :model-value="modelValue" :title="t('downloadModal.title')" size="lg" @update:model-value="emit('update:modelValue', $event)">
    <!-- Loading -->
    <div v-if="loading" class="flex flex-col items-center justify-center py-12 gap-4">
      <div class="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <p class="text-text-muted text-sm">{{ t('downloadModal.searchingSources') }}</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-12 gap-4">
      <svg class="w-12 h-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
      <p class="text-text-muted text-sm text-center">{{ error }}</p>
      <button
        type="button"
        class="px-4 py-2 text-sm bg-surface-secondary hover:bg-border text-text-primary rounded-lg transition-colors"
        @click="fetchSources"
      >
        {{ t('downloadModal.retry') }}
      </button>
    </div>

    <!-- Sources list -->
    <div v-else-if="streams.length > 0" class="space-y-2 max-h-[60vh] overflow-y-auto -mx-2 px-2">
      <button
        v-for="(stream, i) in streams"
        :key="i"
        type="button"
        class="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-surface-secondary transition-all group"
        :disabled="downloading"
        @click="selectSource(stream)"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-text-primary text-sm">{{ stream.provider }}</span>
              <span class="text-text-muted text-xs">{{ stream.server }}</span>
            </div>
            <div class="flex items-center gap-2 mt-1">
              <span
                :class="[
                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                  stream.sources[0]?.isM3U8
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-green-500/10 text-green-400'
                ]"
              >
                {{ stream.sources[0]?.isM3U8 ? t('downloadModal.hls') : t('downloadModal.mp4') }}
              </span>
              <span v-if="stream.sources[0]?.quality && stream.sources[0]?.quality !== 'auto'" class="text-text-muted text-xs">
                {{ stream.sources[0].quality }}
              </span>
              <span v-if="stream.subtitles.length" class="text-text-muted text-xs">
                {{ t('downloadModal.subtitles', { count: stream.subtitles.length }) }}
              </span>
            </div>
          </div>
          <svg class="w-5 h-5 text-text-muted group-hover:text-primary transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </div>
      </button>
    </div>

    <!-- No sources -->
    <div v-else class="flex flex-col items-center justify-center py-12 gap-3">
      <p class="text-text-muted text-sm">{{ t('downloadModal.noSourcesAvailable') }}</p>
    </div>

    <template v-if="streams.length > 0 && !loading" #footer>
      <button
        type="button"
        class="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
        @click="close"
      >
        {{ t('downloadModal.cancel') }}
      </button>
      <button
        type="button"
        class="px-4 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-lg font-medium transition-colors"
        :disabled="downloading"
        @click="selectBest"
      >
        {{ downloading ? t('downloadModal.starting') : t('downloadModal.bestSource') }}
      </button>
    </template>
  </UiModal>
</template>
