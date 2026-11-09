<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const trpc = useTrpc()
const { t, locale } = useI18n()

useHead({ title: computed(() => t('algo.title')) })

type Movie = {
  id: string
  title: string
  posterPath: string | null
  year: number | null
  score: number
  share: number
  reasons: Array<string | { code: string, value?: string | null }>
  resume: boolean
}

const { data: overview, refresh: refreshOverview, pending } = useAsyncData(
  'admin-algorithm',
  () => trpc.algorithm.overview.query()
)
const { data: profiles, refresh: refreshProfiles } = useAsyncData(
  'admin-algorithm-profiles',
  () => trpc.analytics.getProfiles.query()
)

const profileByUser = computed(() => {
  const map = new Map<string, { scores: Record<string, number> | null, profileData: Record<string, any> | null }>()
  for (const p of profiles.value || []) map.set(p.userId, { scores: p.scores as any, profileData: p.profileData as any })
  return map
})

// ── Settings ────────────────────────────────────────────────────────────────
const savingSettings = ref(false)

async function updateSettings(patch: { predictiveLaunch?: boolean, preloadCount?: number }) {
  savingSettings.value = true
  try {
    const next = await trpc.algorithm.setSettings.mutate(patch)
    if (overview.value) overview.value.settings = next
    useToast().success(t('algo.settingsSaved'))
  } catch (e: any) {
    useToast().error(e.message || t('algo.settingsError'))
  } finally {
    savingSettings.value = false
  }
}

const preloadOptions = computed(() => [1, 2, 3].map(n => ({ value: n, label: t('algo.preloadFilms', n) })))

// ── Refresh ─────────────────────────────────────────────────────────────────
const refreshing = ref<string | null>(null)

async function recompute(userId?: string) {
  refreshing.value = userId || 'all'
  try {
    await trpc.algorithm.refresh.mutate(userId ? { userId } : undefined)
    await refreshOverview()
  } catch (e: any) {
    useToast().error(e.message || t('algo.refreshError'))
  } finally {
    refreshing.value = null
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────
function fmtDateTime(ms: number | null | undefined) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(locale.value, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtShort(ms: number | null | undefined) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(locale.value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtPct(v: number | null | undefined) {
  return v == null ? '—' : `${v}%`
}

function fmtErr(min: number | null | undefined) {
  if (min == null) return '—'
  const abs = Math.abs(min)
  const sign = min > 0 ? '+' : '−'
  return abs >= 120 ? `${sign}${(abs / 60).toFixed(1)} h` : `${sign}${Math.round(abs)} min`
}

function formatRelativeDate(value: number) {
  const diffSec = Math.max(0, Math.floor((Date.now() - value) / 1000))
  if (diffSec < 60) return t('adminSettings.analyticsJustNow')
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return t('adminSettings.analyticsMinutesAgo', { count: diffMin })
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return t('adminSettings.analyticsHoursAgo', { count: diffHours })
  return t('adminSettings.analyticsDaysAgo', { count: Math.floor(diffHours / 24) })
}

const weekdays = computed(() => [0, 1, 2, 3, 4, 5, 6].map(d =>
  new Date(Date.UTC(2024, 0, 7 + d)).toLocaleDateString(locale.value, { weekday: 'short', timeZone: 'UTC' })
))

function barHeight(value: number, values: number[]) {
  const max = Math.max(...values, 0)
  return max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4
}

function outcomeLabel(o: string | null) {
  return o ? t(`algo.outcome.${o}`) : '—'
}

function outcomeClass(o: string | null) {
  if (o === 'hit1') return 'bg-green-500/10 text-green-400'
  if (o === 'hit3') return 'bg-emerald-500/10 text-emerald-300'
  if (o === 'miss') return 'bg-red-500/10 text-red-400'
  return 'bg-surface-secondary text-text-muted'
}

function reasonLabel(reason: string | { code: string, value?: string | null }) {
  const code = typeof reason === 'string' ? reason : reason.code
  const value = typeof reason === 'string' ? '' : (reason.value ?? '')
  const key = code === 'resume' ? 'algo.reasonResume' : code === 'watchlist' ? 'algo.reasonWatchlist' : `reco.reason.${code}`
  const label = t(key, { value })
  return label === key ? code : label.replace(/\s+$/, '')
}

function confidenceClass(share: number) {
  const pct = share * 100
  if (pct >= 40) return 'bg-green-500/10 text-green-400'
  if (pct >= 20) return 'bg-amber-500/10 text-amber-400'
  return 'bg-surface-secondary text-text-muted'
}

function sortEntries(record: Record<string, number> | null | undefined, limit = 6) {
  if (!record) return []
  return Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, limit)
}

const expanded = ref<Set<string>>(new Set())
function toggle(userId: string) {
  const next = new Set(expanded.value)
  if (next.has(userId)) next.delete(userId)
  else next.add(userId)
  expanded.value = next
}

// ── Behavioral profiles (moved from Settings → Analytics) ───────────────────
const editorOpen = ref(false)
const editorLoading = ref(false)
const editorUserId = ref('')
const editorUserLabel = ref('')
const editorScores = ref('{}')
const editorProfileData = ref('{}')

function openProfileEditor(userId: string, label: string) {
  const p = profileByUser.value.get(userId)
  editorUserId.value = userId
  editorUserLabel.value = label
  editorScores.value = JSON.stringify(p?.scores || {}, null, 2)
  editorProfileData.value = JSON.stringify(p?.profileData || {}, null, 2)
  editorOpen.value = true
}

async function saveProfileEditor() {
  editorLoading.value = true
  try {
    const parsedScores = JSON.parse(editorScores.value)
    const parsedProfileData = JSON.parse(editorProfileData.value)
    if (!parsedScores || typeof parsedScores !== 'object' || Array.isArray(parsedScores)) {
      throw new Error(t('adminSettings.analyticsScoresObjectRequired'))
    }
    if (!parsedProfileData || typeof parsedProfileData !== 'object' || Array.isArray(parsedProfileData)) {
      throw new Error(t('adminSettings.analyticsProfileObjectRequired'))
    }
    for (const value of Object.values(parsedScores)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(t('adminSettings.analyticsScoresNumbersOnly'))
      }
    }
    await trpc.analytics.updateProfileData.mutate({
      userId: editorUserId.value,
      scores: parsedScores as Record<string, number>,
      profileData: parsedProfileData as Record<string, unknown>,
    })
    editorOpen.value = false
    useToast().success(t('adminSettings.analyticsProfileSaved'))
    await Promise.all([refreshProfiles(), refreshOverview()])
  } catch (e: any) {
    useToast().error(e.message || t('adminSettings.analyticsProfileSaveError'))
  } finally {
    editorLoading.value = false
  }
}

async function resetProfile(userId: string) {
  if (!window.confirm(t('adminSettings.analyticsResetConfirm'))) return
  try {
    await trpc.analytics.resetProfile.mutate({ userId })
    useToast().success(t('adminSettings.analyticsResetSuccess'))
    await Promise.all([refreshProfiles(), refreshOverview()])
  } catch (e: any) {
    useToast().error(e.message || t('adminSettings.analyticsResetError'))
  }
}

async function adjustScore(userId: string, genre: string, currentScore: number) {
  const nextValue = window.prompt(`Nouveau score pour ${genre}:`, String(currentScore))
  if (nextValue === null) return
  const score = Number.parseInt(nextValue, 10)
  if (Number.isNaN(score)) {
    useToast().error(t('adminSettings.analyticsScoreInteger'))
    return
  }
  try {
    await trpc.analytics.updateProfileScore.mutate({ userId, genre, score })
    await refreshProfiles()
  } catch (e: any) {
    useToast().error(e.message || t('adminSettings.analyticsScoreUpdateError'))
  }
}
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <NuxtLink to="/admin" class="text-sm text-text-muted hover:text-text-primary">← {{ t('nav.admin') }}</NuxtLink>
        <h1 class="text-2xl font-bold text-text-primary mt-1">{{ t('algo.title') }}</h1>
        <p class="text-sm text-text-secondary mt-1">{{ t('algo.subtitle') }}</p>
      </div>
      <UiButton :loading="refreshing === 'all'" @click="recompute()">
        {{ t('algo.recomputeAll') }}
      </UiButton>
    </div>

    <div v-if="pending && !overview" class="space-y-3">
      <UiSkeleton height="8rem" />
      <UiSkeleton height="12rem" />
    </div>

    <template v-else-if="overview">
      <!-- Predictive launch option -->
      <div class="p-6 bg-surface border border-border rounded-xl space-y-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="font-semibold text-text-primary">{{ t('algo.launchTitle') }}</h2>
            <p class="text-sm text-text-secondary mt-1">{{ t('algo.launchDesc') }}</p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="overview.settings.predictiveLaunch"
            :disabled="savingSettings"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60"
            :class="overview.settings.predictiveLaunch ? 'bg-primary' : 'bg-surface-secondary border border-border'"
            @click="updateSettings({ predictiveLaunch: !overview.settings.predictiveLaunch })"
          >
            <span
              class="inline-block h-4 w-4 rounded-full bg-white transition-transform"
              :class="overview.settings.predictiveLaunch ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <div v-if="overview.settings.predictiveLaunch" class="max-w-xs">
          <UiSelect
            :model-value="overview.settings.preloadCount"
            :options="preloadOptions"
            :label="t('algo.preloadLabel')"
            :disabled="savingSettings"
            @update:model-value="updateSettings({ preloadCount: Number($event) })"
          />
          <p class="text-xs text-text-muted mt-2">{{ t('algo.preloadHint') }}</p>
        </div>
        <p class="text-xs text-text-muted">{{ t('algo.launchNote') }}</p>
      </div>

      <!-- Global accuracy -->
      <div class="p-6 bg-surface border border-border rounded-xl">
        <h2 class="font-semibold text-text-primary">{{ t('algo.accuracyTitle') }}</h2>
        <p class="text-xs text-text-muted mt-1">{{ t('algo.accuracyDesc') }}</p>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <div class="p-4 rounded-xl bg-primary/10 border border-primary/20">
            <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('algo.overall') }}</p>
            <p class="text-3xl font-bold text-primary mt-1">{{ fmtPct(overview.accuracy.overallPct) }}</p>
            <p class="text-xs text-text-muted mt-1">{{ t('algo.overallHint') }}</p>
          </div>
          <div class="p-4 rounded-xl bg-background border border-border">
            <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('algo.visitAccuracy') }}</p>
            <p class="text-2xl font-bold text-text-primary mt-1">{{ fmtPct(overview.accuracy.visit.hitPct) }}</p>
            <p class="text-xs text-text-muted mt-1">{{ t('algo.visitHint', { n: overview.accuracy.visit.n, err: fmtErr(overview.accuracy.visit.avgErrorMin) }) }}</p>
          </div>
          <div class="p-4 rounded-xl bg-background border border-border">
            <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('algo.filmTop1') }}</p>
            <p class="text-2xl font-bold text-text-primary mt-1">{{ fmtPct(overview.accuracy.film.top1Pct) }}</p>
            <p class="text-xs text-text-muted mt-1">{{ t('algo.filmHint', { n: overview.accuracy.film.n }) }}</p>
          </div>
          <div class="p-4 rounded-xl bg-background border border-border">
            <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('algo.filmTop3') }}</p>
            <p class="text-2xl font-bold text-text-primary mt-1">{{ fmtPct(overview.accuracy.film.top3Pct) }}</p>
            <p class="text-xs text-text-muted mt-1">{{ t('algo.filmHint', { n: overview.accuracy.film.n }) }}</p>
          </div>
        </div>
        <p v-if="overview.accuracy.assisted.n" class="text-xs text-text-muted mt-3">
          {{ t('algo.assistedStat', { n: overview.accuracy.assisted.n, pct: fmtPct(overview.accuracy.assisted.acceptedPct) }) }}
        </p>
        <p v-if="!overview.accuracy.predictions" class="text-sm text-text-muted mt-3">{{ t('algo.noResolvedYet') }}</p>
      </div>

      <!-- Users -->
      <div class="space-y-4">
        <div
          v-for="u in overview.users"
          :key="u.id"
          class="p-5 bg-surface border border-border rounded-xl space-y-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-semibold text-text-primary truncate">{{ u.displayName }}</p>
              <p class="text-xs text-text-muted truncate">{{ u.email }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary">
                {{ t('algo.userAccuracy') }} {{ fmtPct(u.accuracy.overallPct) }}
              </span>
              <button
                type="button"
                class="px-3 py-1.5 text-xs font-medium text-text-primary bg-surface-secondary hover:bg-surface-secondary/80 rounded-lg transition-colors disabled:opacity-60"
                :disabled="refreshing === u.id"
                @click="recompute(u.id)"
              >
                {{ t('algo.recompute') }}
              </button>
            </div>
          </div>

          <!-- Prediction: next visit + top 3 films on one row -->
          <div class="grid lg:grid-cols-3 gap-4">
            <div class="p-4 bg-background border border-border rounded-xl">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('algo.nextVisit') }}</p>
                <span
                  v-if="u.prediction.visitAt"
                  class="text-[11px] px-2 py-0.5 rounded-full"
                  :class="confidenceClass(u.prediction.visitConfidence || 0)"
                >
                  {{ t('algo.confidence') }} {{ Math.round((u.prediction.visitConfidence || 0) * 100) }}%
                </span>
              </div>
              <template v-if="u.prediction.visitAt">
                <p class="text-lg font-semibold text-text-primary mt-2 capitalize">{{ fmtDateTime(u.prediction.visitAt) }}</p>
                <p class="text-xs text-text-muted mt-1">{{ t('algo.visitWindow') }}</p>
              </template>
              <p v-else class="text-sm text-text-muted mt-2">{{ t('algo.notEnoughData') }}</p>
              <p v-if="u.prediction.visitedAt" class="text-xs text-green-400 mt-2">
                {{ t('algo.visitedAlready', { when: fmtShort(u.prediction.visitedAt) }) }}
              </p>
              <p v-else-if="u.prediction.live" class="text-xs text-text-muted mt-2">{{ t('algo.livePreview') }}</p>
              <p v-else class="text-xs text-text-muted mt-2">{{ t('algo.updatedAt', { when: fmtShort(u.prediction.updatedAt) }) }}</p>
            </div>

            <div class="lg:col-span-2 p-4 bg-background border border-border rounded-xl">
              <div class="flex items-center justify-between">
                <p class="text-xs uppercase tracking-wide text-text-muted">{{ t('algo.nextFilms') }}</p>
                <span v-if="u.prediction.assisted" class="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{{ t('algo.assistedBadge') }}</span>
              </div>
              <div v-if="u.prediction.movies.length" class="grid sm:grid-cols-3 gap-3 mt-3">
                <div v-for="(m, i) in (u.prediction.movies as Movie[])" :key="m.id" class="flex gap-3">
                  <img
                    v-if="m.posterPath"
                    :src="m.posterPath"
                    :alt="m.title"
                    class="w-12 h-[4.5rem] object-cover rounded-md bg-surface-secondary shrink-0"
                    loading="lazy"
                  >
                  <div v-else class="w-12 h-[4.5rem] rounded-md bg-surface-secondary shrink-0" />
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-text-primary leading-tight">
                      <span class="text-text-muted">#{{ i + 1 }}</span> {{ m.title }}
                    </p>
                    <p class="text-xs text-text-muted mt-0.5">{{ m.year || '' }} · {{ t('algo.score') }} {{ m.score }}</p>
                    <span class="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full" :class="confidenceClass(m.share)">
                      {{ t('algo.confidence') }} {{ Math.round(m.share * 100) }}%
                    </span>
                    <p class="text-[11px] text-primary mt-1">{{ m.reasons.map(reasonLabel).join(' · ') }}</p>
                  </div>
                </div>
              </div>
              <p v-else class="text-sm text-text-muted mt-2">{{ t('algo.notEnoughData') }}</p>
            </div>
          </div>

          <!-- Accuracy + history -->
          <div v-if="u.recent.length" class="space-y-2">
            <p class="text-xs font-medium text-text-muted uppercase tracking-wide">{{ t('algo.history') }}</p>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="text-left text-text-muted">
                    <th class="py-1.5 pr-3 font-medium">{{ t('algo.colPredictedVisit') }}</th>
                    <th class="py-1.5 pr-3 font-medium">{{ t('algo.colActualVisit') }}</th>
                    <th class="py-1.5 pr-3 font-medium">{{ t('algo.colPredictedFilms') }}</th>
                    <th class="py-1.5 pr-3 font-medium">{{ t('algo.colActualFilm') }}</th>
                    <th class="py-1.5 font-medium">{{ t('algo.colResult') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r, idx) in u.recent" :key="idx" class="border-t border-border align-top">
                    <td class="py-1.5 pr-3 text-text-secondary">{{ fmtShort(r.predictedVisitAt) }}</td>
                    <td class="py-1.5 pr-3 text-text-secondary">
                      {{ fmtShort(r.actualVisitAt) }}
                      <span v-if="r.visitHit != null" :class="r.visitHit ? 'text-green-400' : 'text-red-400'">
                        {{ r.visitHit ? '✓' : '✗' }} {{ fmtErr(r.visitErrorMin) }}
                      </span>
                    </td>
                    <td class="py-1.5 pr-3 text-text-secondary">{{ (r.predictedMedia as Movie[]).map(m => m.title).join(', ') || '—' }}</td>
                    <td class="py-1.5 pr-3 text-text-primary">{{ r.actualMediaTitle || '—' }}</td>
                    <td class="py-1.5">
                      <span class="px-2 py-0.5 rounded-full" :class="outcomeClass(r.movieOutcome)">{{ outcomeLabel(r.movieOutcome) }}</span>
                      <span v-if="r.assisted" class="ml-1 text-amber-400">{{ t('algo.assistedShort') }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <button
            type="button"
            class="text-xs font-medium text-primary hover:underline"
            @click="toggle(u.id)"
          >
            {{ expanded.has(u.id) ? t('algo.hideDetails') : t('algo.showDetails') }}
          </button>

          <div v-if="expanded.has(u.id)" class="space-y-5 pt-1">
            <!-- Data we already have -->
            <div>
              <p class="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">{{ t('algo.knownData') }}</p>
              <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                <div class="p-2 rounded-lg bg-background border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('algo.statSessions') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ u.visitProfile.sessions }}</p>
                </div>
                <div class="p-2 rounded-lg bg-background border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('algo.statEvents') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ u.stats.events }}</p>
                </div>
                <div class="p-2 rounded-lg bg-background border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('algo.statCompleted') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ u.stats.completed }}</p>
                </div>
                <div class="p-2 rounded-lg bg-background border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('algo.statInProgress') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ u.stats.inProgress }}</p>
                </div>
                <div class="p-2 rounded-lg bg-background border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('algo.statLikes') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ u.stats.likes }} / {{ u.stats.dislikes }}</p>
                </div>
                <div class="p-2 rounded-lg bg-background border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('algo.statWatchlist') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ u.stats.watchlist }}</p>
                </div>
                <div class="p-2 rounded-lg bg-background border border-border">
                  <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('algo.statGap') }}</p>
                  <p class="text-sm font-semibold text-text-primary mt-1">{{ u.visitProfile.avgGapHours != null ? `${u.visitProfile.avgGapHours} h` : '—' }}</p>
                </div>
              </div>
              <p class="text-xs text-text-muted mt-2">
                {{ t('algo.lastVisit', { when: u.visitProfile.lastSessionAt ? formatRelativeDate(u.visitProfile.lastSessionAt) : '—' }) }}
                · {{ t('algo.timezone', { tz: (u.visitProfile.tzOffsetHours >= 0 ? '+' : '') + u.visitProfile.tzOffsetHours }) }}
              </p>

              <div class="grid sm:grid-cols-2 gap-4 mt-3">
                <div>
                  <p class="text-[11px] uppercase tracking-wide text-text-muted mb-1">{{ t('algo.byWeekday') }}</p>
                  <div class="flex items-end gap-1 h-16">
                    <div v-for="(v, d) in u.visitProfile.weekdayRate" :key="d" class="flex-1 flex flex-col items-center justify-end h-full">
                      <div class="w-full rounded-t bg-primary/60" :style="{ height: barHeight(v, u.visitProfile.weekdayRate) + '%' }" :title="String(v)" />
                    </div>
                  </div>
                  <div class="flex gap-1 mt-1">
                    <span v-for="(d, i) in weekdays" :key="i" class="flex-1 text-center text-[10px] text-text-muted">{{ d }}</span>
                  </div>
                </div>
                <div>
                  <p class="text-[11px] uppercase tracking-wide text-text-muted mb-1">{{ t('algo.byHour') }}</p>
                  <div class="flex items-end gap-px h-16">
                    <div v-for="(v, h) in u.visitProfile.hourHistogram" :key="h" class="flex-1 flex flex-col justify-end h-full">
                      <div class="w-full rounded-t bg-primary/60" :style="{ height: barHeight(v, u.visitProfile.hourHistogram) + '%' }" :title="`${h}h : ${v}`" />
                    </div>
                  </div>
                  <div class="flex justify-between mt-1 text-[10px] text-text-muted"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
                </div>
              </div>
            </div>

            <!-- Behavioral profile (moved from Settings) -->
            <div class="p-4 bg-background border border-border rounded-xl">
              <div class="flex items-start justify-between gap-3">
                <p class="text-sm font-semibold text-text-primary">{{ t('algo.behavioralProfile') }}</p>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
                    @click="openProfileEditor(u.id, u.email)"
                  >
                    {{ t('adminSettings.analyticsEditRawProfile') }}
                  </button>
                  <button
                    type="button"
                    class="px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                    @click="resetProfile(u.id)"
                  >
                    {{ t('adminSettings.analyticsResetProfile') }}
                  </button>
                </div>
              </div>

              <template v-if="profileByUser.get(u.id)">
                <div v-if="profileByUser.get(u.id)!.profileData" class="mt-3 space-y-3">
                  <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div class="p-2 rounded-lg bg-surface border border-border">
                      <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsStarts') }}</p>
                      <p class="text-sm font-semibold text-text-primary mt-1">{{ profileByUser.get(u.id)!.profileData!.playback?.starts || 0 }}</p>
                    </div>
                    <div class="p-2 rounded-lg bg-surface border border-border">
                      <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsCompletions') }}</p>
                      <p class="text-sm font-semibold text-text-primary mt-1">{{ profileByUser.get(u.id)!.profileData!.playback?.completes || 0 }}</p>
                    </div>
                    <div class="p-2 rounded-lg bg-surface border border-border">
                      <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsSearches') }}</p>
                      <p class="text-sm font-semibold text-text-primary mt-1">{{ profileByUser.get(u.id)!.profileData!.search?.totalQueries || 0 }}</p>
                    </div>
                    <div class="p-2 rounded-lg bg-surface border border-border">
                      <p class="text-[11px] uppercase tracking-wide text-text-muted">{{ t('adminSettings.analyticsHesitations') }}</p>
                      <p class="text-sm font-semibold text-text-primary mt-1">{{ profileByUser.get(u.id)!.profileData!.browsing?.hesitationSignals || 0 }}</p>
                    </div>
                  </div>

                  <div v-if="sortEntries(profileByUser.get(u.id)!.profileData!.preferences?.tags).length" class="space-y-2">
                    <p class="text-xs font-medium text-text-muted uppercase tracking-wide">{{ t('adminSettings.analyticsDetectedTags') }}</p>
                    <div class="flex flex-wrap gap-2">
                      <span
                        v-for="[tag, score] in sortEntries(profileByUser.get(u.id)!.profileData!.preferences?.tags)"
                        :key="tag"
                        class="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary"
                      >
                        {{ tag }} · {{ score }}
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  v-if="profileByUser.get(u.id)!.scores && Object.keys(profileByUser.get(u.id)!.scores!).length"
                  class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3"
                >
                  <button
                    v-for="(score, genre) in profileByUser.get(u.id)!.scores!"
                    :key="genre"
                    type="button"
                    class="flex items-center justify-between gap-3 p-3 bg-surface border border-border rounded-lg hover:border-primary/40 transition-colors text-left"
                    @click="adjustScore(u.id, String(genre), score)"
                  >
                    <span class="text-sm text-text-primary truncate">{{ genre }}</span>
                    <span class="text-xs font-semibold text-primary">{{ score }}</span>
                  </button>
                </div>
                <div v-else class="mt-3 text-xs text-text-muted">
                  {{ t('adminSettings.analyticsNoScores') }}
                </div>

                <div v-if="sortEntries(profileByUser.get(u.id)!.profileData?.preferences?.actorScores, 5).length" class="mt-3">
                  <p class="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">{{ t('adminSettings.analyticsAffinityActors') }}</p>
                  <div class="flex flex-wrap gap-2">
                    <span
                      v-for="[actor, score] in sortEntries(profileByUser.get(u.id)!.profileData?.preferences?.actorScores, 5)"
                      :key="actor"
                      class="px-2.5 py-1 rounded-full text-xs bg-surface border border-border text-text-primary"
                    >
                      {{ actor }} · {{ score }}
                    </span>
                  </div>
                </div>

                <div v-if="profileByUser.get(u.id)!.profileData?.recentSignals?.length" class="mt-3">
                  <p class="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">{{ t('adminSettings.analyticsRecentSignals') }}</p>
                  <div class="space-y-2">
                    <div
                      v-for="signal in profileByUser.get(u.id)!.profileData!.recentSignals.slice(0, 4)"
                      :key="`${signal.createdAt}-${signal.type}`"
                      class="p-2 rounded-lg bg-surface border border-border"
                    >
                      <p class="text-sm text-text-primary">{{ signal.summary }}</p>
                      <p class="text-xs text-text-muted mt-1">{{ formatRelativeDate(new Date(signal.createdAt).getTime()) }}</p>
                    </div>
                  </div>
                </div>
              </template>
              <p v-else class="mt-3 text-xs text-text-muted">{{ t('adminSettings.analyticsNoProfiles') }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <UiModal v-model="editorOpen" :title="t('adminSettings.analyticsRawEditorTitle', { user: editorUserLabel })" size="xl">
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-text-primary mb-2">
            {{ t('adminSettings.analyticsRawScores') }}
          </label>
          <textarea
            v-model="editorScores"
            rows="10"
            class="w-full px-4 py-3 bg-background border border-border rounded-xl text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-y"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-text-primary mb-2">
            {{ t('adminSettings.analyticsRawProfileData') }}
          </label>
          <textarea
            v-model="editorProfileData"
            rows="18"
            class="w-full px-4 py-3 bg-background border border-border rounded-xl text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-y"
          />
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
          @click="editorOpen = false"
        >
          {{ t('common.cancel') }}
        </button>
        <UiButton :loading="editorLoading" @click="saveProfileEditor">
          {{ t('common.save') }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
