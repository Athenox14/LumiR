import { eq } from 'drizzle-orm'
import { db, sqlite } from '../db'
import { media, userProfiles } from '../db/schema'
import {
  recordPlay, recordComplete, recordAbandon, recordDetailOpen,
  recordHoverNoOpen, recordImpression, recordEffectiveCompletion,
} from './mediaStatsEngine'

type AnalyticsEvent = {
  type: string
  mediaId?: string | null
  metadata?: Record<string, any>
}

type ProfileData = {
  navigation: {
    pageViews: number
    backtracks: number
    routeLoops: number
    shortHistory: string[]
    sessions: number
    avgSessionDurationMs: number
    lastPath: string | null
    lastSessionStartedAt: string | null
    lastSessionEndedAt: string | null
    lastSessionGapMs: number | null
  }
  search: {
    totalQueries: number
    refinements: number
    clicks: number
    submits: number
    abandonments: number
    totalClickDelayMs: number
    avgClickDelayMs: number
    lastQuery: string | null
    lastClickedResultPosition: number | null
    searchesBeforeSelection: number
    emptySearchThenBrowse: number
    repeatedQueries: Record<string, number>
  }
  browsing: {
    cardHovers: number
    longHovers: number
    totalHoverMs: number
    clicksAfterHover: number
    catalogSessions: number
    totalScrollDistance: number
    maxScrollDepth: number
    itemsSeenWithoutClick: number
    noClickBrowseMs: number
    hesitationSignals: number
    franticClicks: number
    lastMostVisibleMediaId: string | null
  }
  details: {
    opened: number
    repeatVisits: number
    immediateExits: number
    totalTimeOnPageMs: number
    totalScrollDepth: number
    synopsisViews: number
    castViews: number
    metadataViews: number
    playIntentCount: number
    totalTimeToPlayMs: number
  }
  playback: {
    starts: number
    completes: number
    abandons: number
    quickAbandons: number
    pauses: number
    resumes: number
    seeksForward: number
    seeksBackward: number
    totalWatchSeconds: number
    totalCompletionRate: number
    avgCompletionRate: number
    rewatches: number
    lastAbandonPosition: number | null
    lastAbandonReason: string | null
    audioPreferences: Record<string, number>
    subtitlePreferences: Record<string, number>
    languagePreferences: Record<string, number>
    fullscreenCount: number
  }
  preferences: {
    genreScores: Record<string, number>
    genreIntentScores: Record<string, number>  // watchlist_add + like + complete
    genreEngageScores: Record<string, number>  // watch_start + long detail + play_intent
    genreBrowseScores: Record<string, number>  // hover + view + card_click
    actorScores: Record<string, number>
    decadeScores: Record<string, number>
    runtimeScores: Record<string, number>
    recencyScores: Record<string, number>
    keywordScores: Record<string, number>
    directorScores: Record<string, number>
    composerScores: Record<string, number>
    certificationScores: Record<string, number>
    collectionScores: Record<string, number>
    tags: Record<string, number>
    lastGenres: string[]
    lastMediaIds: string[]
  }
  temporal: {
    hourBuckets: Record<string, number>
    weekdayBuckets: Record<string, number>
    monthBuckets: Record<string, number>
    // Genre affinity per "moment" (weekday × daypart) — e.g. action on Saturday
    // night, cartoons on Wednesday afternoon. Keyed "<weekday>-<daypart>".
    genreMoment: Record<string, Record<string, number>>
    // Genre affinity per month (0-11) — seasonality (horror in Oct, family in Dec)
    genreMonth: Record<string, Record<string, number>>
    weekendSessions: number
  }
  // Watch-quality engagement aggregates (active vs idle, effective completion…)
  engagement: {
    activeWatchSeconds: number
    idleWatchSeconds: number
    effectiveCompletions: number
    sessionsToFinishTotal: number
    finishedTitles: number
    watchlistAdds: number
    watchlistRemoves: number
  }
  // Binge / consecutive-session detection
  binge: {
    lastCompleteAt: string | null
    bingeSessions: number
    currentStreak: number
    maxStreak: number
    coViewingSignals: number
  }
  // Long-term cadence: churn and re-activation
  churn: {
    lastActiveAt: string | null
    longestGapMs: number
    reactivations: number
    activeDays: Record<string, number>
  }
  // Household / co-viewing sub-profiles (kids vs adult viewing modes)
  household: {
    kidsGenreScores: Record<string, number>
    adultGenreScores: Record<string, number>
    lastClass: string | null
    lastClassAt: string | null
    coViewing: number
  }
  // Timestamp of the last recency-decay pass applied to the taste maps
  decayAt: string | null
  device: {
    types: Record<string, number>
    fullscreenCount: number
    screenRatios: Record<string, number>
  }
  recentSignals: Array<{
    type: string
    mediaId: string | null
    createdAt: string
    summary: string
  }>
}

type MediaSnapshot = {
  genres: string[]
  cast: string[]
  year: number | null
  runtime: number | null
  title: string | null
  keywords: string[]
  director: string | null
  composer: string | null
  certification: string | null
  collectionName: string | null
}

const EVENT_WEIGHTS: Record<string, number> = {
  PAGE_VIEW: 0.1,
  SEARCH_QUERY: 0.2,
  SEARCH_CLICK: 5,
  SEARCH_SUBMIT: 1,
  SEARCH_ABANDON: -0.5,
  MEDIA_VIEW: 1.5,
  MEDIA_DETAIL_ENGAGEMENT: 3,
  MEDIA_PLAY_INTENT: 4,
  HOVER: 0.5,
  CARD_CLICK: 2,
  CATALOG_ITEM_CLICK: 2,
  WATCH_START: 6,
  WATCH_PROGRESS: 2,
  WATCH_COMPLETE: 10,
  WATCH_STOP: -2,
  ABANDON: -5,
  MEDIA_LIKE: 8,
  MEDIA_DISLIKE: -8,
  WATCHLIST_ADD: 7,
  WATCHLIST_REMOVE: -3,
  IMPRESSION: 0,
}

function createEmptyProfileData(): ProfileData {
  return {
    navigation: {
      pageViews: 0,
      backtracks: 0,
      routeLoops: 0,
      shortHistory: [],
      sessions: 0,
      avgSessionDurationMs: 0,
      lastPath: null,
      lastSessionStartedAt: null,
      lastSessionEndedAt: null,
      lastSessionGapMs: null,
    },
    search: {
      totalQueries: 0,
      refinements: 0,
      clicks: 0,
      submits: 0,
      abandonments: 0,
      totalClickDelayMs: 0,
      avgClickDelayMs: 0,
      lastQuery: null,
      lastClickedResultPosition: null,
      searchesBeforeSelection: 0,
      emptySearchThenBrowse: 0,
      repeatedQueries: {},
    },
    browsing: {
      cardHovers: 0,
      longHovers: 0,
      totalHoverMs: 0,
      clicksAfterHover: 0,
      catalogSessions: 0,
      totalScrollDistance: 0,
      maxScrollDepth: 0,
      itemsSeenWithoutClick: 0,
      noClickBrowseMs: 0,
      hesitationSignals: 0,
      franticClicks: 0,
      lastMostVisibleMediaId: null,
    },
    details: {
      opened: 0,
      repeatVisits: 0,
      immediateExits: 0,
      totalTimeOnPageMs: 0,
      totalScrollDepth: 0,
      synopsisViews: 0,
      castViews: 0,
      metadataViews: 0,
      playIntentCount: 0,
      totalTimeToPlayMs: 0,
    },
    playback: {
      starts: 0,
      completes: 0,
      abandons: 0,
      quickAbandons: 0,
      pauses: 0,
      resumes: 0,
      seeksForward: 0,
      seeksBackward: 0,
      totalWatchSeconds: 0,
      totalCompletionRate: 0,
      avgCompletionRate: 0,
      rewatches: 0,
      lastAbandonPosition: null,
      lastAbandonReason: null,
      audioPreferences: {},
      subtitlePreferences: {},
      languagePreferences: {},
      fullscreenCount: 0,
    },
    preferences: {
      genreScores: {},
      genreIntentScores: {},
      genreEngageScores: {},
      genreBrowseScores: {},
      actorScores: {},
      decadeScores: {},
      runtimeScores: {},
      recencyScores: {},
      keywordScores: {},
      directorScores: {},
      composerScores: {},
      certificationScores: {},
      collectionScores: {},
      tags: {},
      lastGenres: [],
      lastMediaIds: [],
    },
    temporal: {
      hourBuckets: {},
      weekdayBuckets: {},
      monthBuckets: {},
      genreMoment: {},
      genreMonth: {},
      weekendSessions: 0,
    },
    engagement: {
      activeWatchSeconds: 0,
      idleWatchSeconds: 0,
      effectiveCompletions: 0,
      sessionsToFinishTotal: 0,
      finishedTitles: 0,
      watchlistAdds: 0,
      watchlistRemoves: 0,
    },
    binge: {
      lastCompleteAt: null,
      bingeSessions: 0,
      currentStreak: 0,
      maxStreak: 0,
      coViewingSignals: 0,
    },
    churn: {
      lastActiveAt: null,
      longestGapMs: 0,
      reactivations: 0,
      activeDays: {},
    },
    household: {
      kidsGenreScores: {},
      adultGenreScores: {},
      lastClass: null,
      lastClassAt: null,
      coViewing: 0,
    },
    decayAt: null,
    device: {
      types: {},
      fullscreenCount: 0,
      screenRatios: {},
    },
    recentSignals: [],
  }
}

function toProfileData(raw: unknown): ProfileData {
  if (!raw || typeof raw !== 'object') return createEmptyProfileData()
  return {
    ...createEmptyProfileData(),
    ...raw as ProfileData,
    navigation: { ...createEmptyProfileData().navigation, ...(raw as any).navigation },
    search: { ...createEmptyProfileData().search, ...(raw as any).search },
    browsing: { ...createEmptyProfileData().browsing, ...(raw as any).browsing },
    details: { ...createEmptyProfileData().details, ...(raw as any).details },
    playback: { ...createEmptyProfileData().playback, ...(raw as any).playback },
    preferences: { ...createEmptyProfileData().preferences, ...(raw as any).preferences },
    temporal: { ...createEmptyProfileData().temporal, ...(raw as any).temporal },
    engagement: { ...createEmptyProfileData().engagement, ...(raw as any).engagement },
    binge: { ...createEmptyProfileData().binge, ...(raw as any).binge },
    churn: { ...createEmptyProfileData().churn, ...(raw as any).churn },
    household: { ...createEmptyProfileData().household, ...(raw as any).household },
    decayAt: typeof (raw as any).decayAt === 'string' ? (raw as any).decayAt : null,
    device: { ...createEmptyProfileData().device, ...(raw as any).device },
    recentSignals: Array.isArray((raw as any).recentSignals) ? (raw as any).recentSignals : [],
  }
}

function inc(map: Record<string, number>, key: string | null | undefined, amount = 1) {
  if (!key) return
  map[key] = (map[key] || 0) + amount
}

function round(value: number, precision = 2) {
  return Number(value.toFixed(precision))
}

function pushRecent<T>(items: T[], value: T, limit = 8) {
  items.unshift(value)
  if (items.length > limit) items.splice(limit)
}

function pushUnique(items: string[], values: string[], limit = 6) {
  for (const value of values) {
    if (!value) continue
    items.unshift(value)
  }
  const unique = [...new Set(items)]
  items.splice(0, items.length, ...unique.slice(0, limit))
}

function getDecade(year: number | null) {
  if (!year) return null
  return `${Math.floor(year / 10) * 10}s`
}

function getRuntimeBucket(runtime: number | null) {
  if (!runtime) return null
  if (runtime < 60) return 'short'
  if (runtime < 100) return 'standard'
  if (runtime < 140) return 'long'
  return 'epic'
}

function getRecencyBucket(year: number | null) {
  if (!year) return null
  const delta = new Date().getFullYear() - year
  if (delta <= 2) return 'recent'
  if (delta <= 10) return 'modern'
  return 'classic'
}

async function getMediaSnapshot(mediaId?: string | null): Promise<MediaSnapshot> {
  if (!mediaId) {
    return { genres: [], cast: [], year: null, runtime: null, title: null, keywords: [], director: null, composer: null, certification: null, collectionName: null }
  }

  const [entry] = await db.select({
    genres: media.genres,
    cast: media.cast,
    year: media.year,
    runtime: media.runtime,
    title: media.title,
    keywords: media.keywords,
    director: media.director,
    composer: media.composer,
    certification: media.certification,
    collectionName: media.collectionName,
  }).from(media).where(eq(media.id, mediaId))

  const cast = Array.isArray(entry?.cast)
    ? entry.cast.map((actor: any) => typeof actor === 'string' ? actor : actor?.name).filter(Boolean)
    : []

  return {
    genres: entry?.genres || [],
    cast,
    year: entry?.year || null,
    runtime: entry?.runtime || null,
    title: entry?.title || null,
    keywords: Array.isArray(entry?.keywords) ? entry.keywords : [],
    director: entry?.director || null,
    composer: entry?.composer || null,
    certification: entry?.certification || null,
    collectionName: entry?.collectionName || null,
  }
}

/** Coarse daypart bucket from an hour-of-day (0-23). */
function getDaypart(hour: number): string {
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function recordTemporalSignals(profile: ProfileData, metadata: Record<string, any>, createdAt: Date) {
  const hour = typeof metadata.hour === 'number' ? metadata.hour : createdAt.getHours()
  const weekday = typeof metadata.weekday === 'number' ? metadata.weekday : createdAt.getDay()
  const month = createdAt.getMonth() // 0-11
  inc(profile.temporal.hourBuckets, String(hour))
  inc(profile.temporal.weekdayBuckets, String(weekday))
  inc(profile.temporal.monthBuckets, String(month))
  if (weekday === 0 || weekday === 6) {
    profile.temporal.weekendSessions += 1
  }
}

/** Record genre × moment affinity (weekday × daypart) for positive engagement. */
function recordGenreMoment(profile: ProfileData, snapshot: MediaSnapshot, createdAt: Date, weight: number) {
  if (weight <= 0 || !snapshot.genres.length) return
  const key = `${createdAt.getDay()}-${getDaypart(createdAt.getHours())}`
  if (!profile.temporal.genreMoment[key]) profile.temporal.genreMoment[key] = {}
  for (const genre of snapshot.genres) {
    inc(profile.temporal.genreMoment[key], genre, weight)
  }
}

/** Record genre × month affinity (seasonality) for positive engagement. */
function recordGenreMonth(profile: ProfileData, snapshot: MediaSnapshot, createdAt: Date, weight: number) {
  if (weight <= 0 || !snapshot.genres.length) return
  const key = String(createdAt.getMonth())
  if (!profile.temporal.genreMonth[key]) profile.temporal.genreMonth[key] = {}
  for (const genre of snapshot.genres) {
    inc(profile.temporal.genreMonth[key], genre, weight)
  }
}

// Age ratings that indicate kids / family content.
const KIDS_CERTS = new Set(['G', 'PG', 'U', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', '0', '6', 'Tous publics', 'AL'])

function contentClass(snapshot: MediaSnapshot): 'kids' | 'adult' {
  const cert = (snapshot.certification || '').trim()
  if (cert && KIDS_CERTS.has(cert)) return 'kids'
  if (snapshot.genres.includes('Animation') || snapshot.genres.includes('Family') || snapshot.genres.includes('Familial')) return 'kids'
  return 'adult'
}

/**
 * Maintain household sub-profiles. Positive engagement with kids-rated content
 * feeds the kids genre map; adult content the adult map. Rapid flips between the
 * two classes within a session are a co-viewing signal (e.g. parents + children).
 */
function recordHousehold(profile: ProfileData, snapshot: MediaSnapshot, createdAt: Date, weight: number) {
  if (weight <= 0 || !snapshot.genres.length) return
  const cls = contentClass(snapshot)
  const target = cls === 'kids' ? profile.household.kidsGenreScores : profile.household.adultGenreScores
  for (const genre of snapshot.genres) inc(target, genre, weight)

  const last = profile.household.lastClassAt ? new Date(profile.household.lastClassAt).getTime() : null
  if (profile.household.lastClass && profile.household.lastClass !== cls
      && last !== null && createdAt.getTime() - last <= 2 * 60 * 60 * 1000) {
    profile.household.coViewing += 1
  }
  profile.household.lastClass = cls
  profile.household.lastClassAt = createdAt.toISOString()
}

const DECAY_HALF_LIFE_DAYS = 75
const DECAY_MIN_DAYS = 1 // only run a pass at most ~daily

/**
 * Exponentially decay the long-lived taste maps so recent behavior dominates.
 * Mirrors the recency factor used in preferences.ts (half-life ~75 days).
 */
function applyRecencyDecay(profile: ProfileData, scores: Record<string, number>, now: Date) {
  const lastAt = profile.decayAt ? new Date(profile.decayAt).getTime() : null
  const elapsedDays = lastAt === null ? 0 : (now.getTime() - lastAt) / (1000 * 60 * 60 * 24)
  profile.decayAt = now.toISOString()
  if (lastAt === null || elapsedDays < DECAY_MIN_DAYS) return

  const factor = Math.pow(0.5, elapsedDays / DECAY_HALF_LIFE_DAYS)
  if (factor >= 0.9999) return

  const decayMap = (m: Record<string, number> | undefined) => {
    if (!m) return
    for (const k of Object.keys(m)) {
      m[k] *= factor
      if (Math.abs(m[k]) < 0.01) delete m[k] // prune negligible entries
    }
  }
  const p = profile.preferences
  decayMap(p.genreScores); decayMap(p.genreIntentScores); decayMap(p.genreEngageScores)
  decayMap(p.genreBrowseScores); decayMap(p.actorScores); decayMap(p.decadeScores)
  decayMap(p.runtimeScores); decayMap(p.recencyScores); decayMap(p.keywordScores)
  decayMap(p.directorScores); decayMap(p.composerScores); decayMap(p.certificationScores)
  decayMap(p.collectionScores)
  decayMap(scores)
  for (const k of Object.keys(profile.temporal.genreMoment)) decayMap(profile.temporal.genreMoment[k])
  for (const k of Object.keys(profile.temporal.genreMonth)) decayMap(profile.temporal.genreMonth[k])
  decayMap(profile.household.kidsGenreScores)
  decayMap(profile.household.adultGenreScores)
}

/** Update binge / churn cadence from a session timestamp. */
function recordCadence(profile: ProfileData, createdAt: Date) {
  const dayKey = createdAt.toISOString().slice(0, 10)
  inc(profile.churn.activeDays, dayKey)
  // Keep only the 90 most recent days so the profile document stays bounded.
  const dayKeys = Object.keys(profile.churn.activeDays)
  if (dayKeys.length > 90) {
    for (const key of dayKeys.sort().slice(0, dayKeys.length - 90)) {
      delete profile.churn.activeDays[key]
    }
  }
  const last = profile.churn.lastActiveAt ? new Date(profile.churn.lastActiveAt).getTime() : null
  if (last !== null) {
    const gap = createdAt.getTime() - last
    if (gap > profile.churn.longestGapMs) profile.churn.longestGapMs = gap
    // A gap longer than 14 days followed by activity counts as a re-activation.
    if (gap > 14 * 24 * 60 * 60 * 1000) profile.churn.reactivations += 1
  }
  profile.churn.lastActiveAt = createdAt.toISOString()
}

/** Number of distinct viewing sessions (WATCH_START events) before finishing a title. */
function countSessionsToFinish(userId: string, mediaId: string | null | undefined): number {
  if (!mediaId) return 1
  try {
    const row = sqlite
      .prepare(`SELECT COUNT(*) as n FROM user_events WHERE user_id = ? AND media_id = ? AND type = 'WATCH_START'`)
      .get(userId, mediaId) as any
    return Math.max(1, Number(row?.n || 1))
  } catch {
    return 1
  }
}

/** Detect binge streaks: completions within 6h of each other extend the streak. */
function recordBinge(profile: ProfileData, createdAt: Date) {
  const last = profile.binge.lastCompleteAt ? new Date(profile.binge.lastCompleteAt).getTime() : null
  const SIX_HOURS = 6 * 60 * 60 * 1000
  if (last !== null && createdAt.getTime() - last <= SIX_HOURS) {
    profile.binge.currentStreak += 1
  } else {
    profile.binge.currentStreak = 1
  }
  if (profile.binge.currentStreak > profile.binge.maxStreak) {
    profile.binge.maxStreak = profile.binge.currentStreak
  }
  if (profile.binge.currentStreak >= 3) profile.binge.bingeSessions += 1
  profile.binge.lastCompleteAt = createdAt.toISOString()
}

function recordDeviceSignals(profile: ProfileData, metadata: Record<string, any>) {
  inc(profile.device.types, metadata.deviceType)
  inc(profile.device.screenRatios, metadata.screenRatio)
  if (metadata.fullscreen) {
    profile.device.fullscreenCount += 1
  }
}

function addPreferenceScore(profile: ProfileData, mediaSnapshot: MediaSnapshot, amount: number) {
  for (const genre of mediaSnapshot.genres) inc(profile.preferences.genreScores, genre, amount)
  for (const actor of mediaSnapshot.cast.slice(0, 5)) inc(profile.preferences.actorScores, actor, amount)
  inc(profile.preferences.decadeScores, getDecade(mediaSnapshot.year), amount)
  inc(profile.preferences.runtimeScores, getRuntimeBucket(mediaSnapshot.runtime), amount)
  inc(profile.preferences.recencyScores, getRecencyBucket(mediaSnapshot.year), amount)
  for (const keyword of mediaSnapshot.keywords.slice(0, 8)) inc(profile.preferences.keywordScores, keyword, amount)
  inc(profile.preferences.directorScores, mediaSnapshot.director, amount)
  inc(profile.preferences.composerScores, mediaSnapshot.composer, amount)
  inc(profile.preferences.certificationScores, mediaSnapshot.certification, amount)
  inc(profile.preferences.collectionScores, mediaSnapshot.collectionName, amount)
  pushUnique(profile.preferences.lastGenres, mediaSnapshot.genres)
}

const INTENT_EVENTS = new Set(['WATCHLIST_ADD', 'MEDIA_LIKE', 'WATCH_COMPLETE'])
const ENGAGE_EVENTS = new Set(['WATCH_START', 'MEDIA_PLAY_INTENT', 'MEDIA_DETAIL_ENGAGEMENT'])

function addTieredPreferenceScore(
  profile: ProfileData,
  mediaSnapshot: MediaSnapshot,
  eventType: string,
  amount: number,
  metadata: Record<string, any>,
) {
  if (!mediaSnapshot.genres.length || amount <= 0) return
  const p = profile.preferences
  for (const genre of mediaSnapshot.genres) {
    if (INTENT_EVENTS.has(eventType)) {
      inc(p.genreIntentScores, genre, amount)
    } else if (ENGAGE_EVENTS.has(eventType) &&
      (eventType !== 'MEDIA_DETAIL_ENGAGEMENT' || (metadata.timeOnPageMs || 0) > 5000)) {
      inc(p.genreEngageScores, genre, amount)
    } else {
      inc(p.genreBrowseScores, genre, amount)
    }
  }
}

function updateTopLevelGenreScores(scores: Record<string, number>, mediaGenres: string[], amount: number) {
  for (const genre of mediaGenres) {
    scores[genre] = (scores[genre] || 0) + amount
  }
}

function updateTags(profile: ProfileData, event: AnalyticsEvent, metadata: Record<string, any>, weight: number) {
  const tags = profile.preferences.tags
  if (event.type === 'SEARCH_CLICK' && metadata.source === 'navbar') inc(tags, 'navbar-search', 3)
  if (event.type === 'SEARCH_QUERY' && metadata.refinedFrom) inc(tags, 'refined-search', 2)
  if (event.type === 'MEDIA_DETAIL_ENGAGEMENT' && metadata.timeOnPageMs > 15000) inc(tags, 'deep-detail-reader', 2)
  if (event.type === 'WATCH_COMPLETE') inc(tags, 'completion-positive', 3)
  if (event.type === 'ABANDON' || event.type === 'WATCH_STOP') inc(tags, 'recent-abandon', 2)
  if (event.type === 'HOVER' && (metadata.hoverMs || 0) > 1200) inc(tags, 'hover-deliberate', 1)
  if (metadata.noClickBrowseMs > 20000) inc(tags, 'catalog-fatigue', 2)
  if ((metadata.positionRatio || 0) < 0.15 && weight < 0) inc(tags, 'quick-abandon', 2)
}

function summarizeEvent(event: AnalyticsEvent, metadata: Record<string, any>, mediaTitle: string | null) {
  switch (event.type) {
    case 'SEARCH_CLICK':
      return `Recherche "${metadata.query || ''}" -> résultat #${metadata.position ?? '?'}`
    case 'MEDIA_VIEW':
      return `Ouverture de fiche ${mediaTitle || event.mediaId || ''}`.trim()
    case 'MEDIA_DETAIL_ENGAGEMENT':
      return `Fiche consultée ${Math.round((metadata.timeOnPageMs || 0) / 1000)}s`
    case 'WATCH_COMPLETE':
      return `Lecture terminée ${mediaTitle || event.mediaId || ''}`.trim()
    case 'WATCH_STOP':
    case 'ABANDON':
      return `Lecture abandonnée à ${Math.round(metadata.position || 0)}s`
    default:
      return event.type
  }
}

export async function processEvent(userId: string, event: AnalyticsEvent) {
  const metadata = (event.metadata && typeof event.metadata === 'object') ? event.metadata : {}
  let [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId))
  if (!profile) {
    [profile] = await db.insert(userProfiles).values({
      userId,
      scores: {},
      recentGenres: [],
      profileData: createEmptyProfileData(),
    }).returning()
  }

  const profileData = toProfileData(profile.profileData)
  const scores = profile.scores || {}
  const mediaSnapshot = await getMediaSnapshot(event.mediaId)
  const createdAt = metadata.clientAt ? new Date(metadata.clientAt) : new Date()
  const weight = EVENT_WEIGHTS[event.type] || 0

  // Decay the long-lived taste maps before folding in the new signal.
  applyRecencyDecay(profileData, scores, createdAt)

  recordTemporalSignals(profileData, metadata, createdAt)
  recordDeviceSignals(profileData, metadata)
  recordCadence(profileData, createdAt)
  recordGenreMoment(profileData, mediaSnapshot, createdAt, weight)
  recordGenreMonth(profileData, mediaSnapshot, createdAt, weight)
  recordHousehold(profileData, mediaSnapshot, createdAt, weight)

  if (event.mediaId) {
    pushUnique(profileData.preferences.lastMediaIds, [event.mediaId], 5)
  }

  switch (event.type) {
    case 'PAGE_VIEW': {
      profileData.navigation.pageViews += 1
      const path = typeof metadata.path === 'string' ? metadata.path : null
      const from = typeof metadata.from === 'string' ? metadata.from : null
      if (path && from === path) {
        profileData.navigation.routeLoops += 1
      } else if (path && from && profileData.navigation.shortHistory[0] === path) {
        profileData.navigation.backtracks += 1
      }
      if (path) {
        pushRecent(profileData.navigation.shortHistory, path, 6)
        profileData.navigation.lastPath = path
      }
      if (metadata.sessionStart) {
        profileData.navigation.sessions += 1
        profileData.navigation.lastSessionStartedAt = createdAt.toISOString()
        if (typeof metadata.lastSessionGapMs === 'number') {
          profileData.navigation.lastSessionGapMs = metadata.lastSessionGapMs
        }
      }
      if (metadata.sessionEnd && typeof metadata.sessionDurationMs === 'number') {
        const sessions = Math.max(profileData.navigation.sessions, 1)
        profileData.navigation.avgSessionDurationMs = round(
          ((profileData.navigation.avgSessionDurationMs * (sessions - 1)) + metadata.sessionDurationMs) / sessions,
          0,
        )
        profileData.navigation.lastSessionEndedAt = createdAt.toISOString()
      }
      break
    }
    case 'SEARCH_QUERY': {
      profileData.search.totalQueries += 1
      const query = typeof metadata.query === 'string' ? metadata.query.trim().toLowerCase() : ''
      if (query) {
        profileData.search.lastQuery = query
        inc(profileData.search.repeatedQueries, query)
      }
      if (metadata.refinedFrom) profileData.search.refinements += 1
      if (metadata.emptyToBrowse) profileData.search.emptySearchThenBrowse += 1
      break
    }
    case 'SEARCH_SUBMIT': {
      profileData.search.submits += 1
      break
    }
    case 'SEARCH_CLICK': {
      profileData.search.clicks += 1
      profileData.search.lastClickedResultPosition = typeof metadata.position === 'number' ? metadata.position : null
      if (typeof metadata.latencyMs === 'number') {
        profileData.search.totalClickDelayMs += metadata.latencyMs
        profileData.search.avgClickDelayMs = round(profileData.search.totalClickDelayMs / profileData.search.clicks, 0)
      }
      if (typeof metadata.searchesBeforeSelection === 'number') {
        profileData.search.searchesBeforeSelection = Math.max(
          profileData.search.searchesBeforeSelection,
          metadata.searchesBeforeSelection,
        )
      }
      break
    }
    case 'SEARCH_ABANDON': {
      profileData.search.abandonments += 1
      break
    }
    case 'HOVER': {
      profileData.browsing.cardHovers += 1
      const hoverMs = typeof metadata.hoverMs === 'number' ? metadata.hoverMs : 0
      profileData.browsing.totalHoverMs += hoverMs
      if (hoverMs >= 1200) profileData.browsing.longHovers += 1
      if (metadata.clickedAfterHover) profileData.browsing.clicksAfterHover += 1
      else if (hoverMs >= 600) recordHoverNoOpen(event.mediaId) // deliberate hover, no open
      if (metadata.hesitation) profileData.browsing.hesitationSignals += 1
      break
    }
    case 'IMPRESSION': {
      // One or more cards became visible in a rail without (yet) a click.
      const ids: string[] = Array.isArray(metadata.mediaIds) ? metadata.mediaIds : (event.mediaId ? [event.mediaId] : [])
      for (const id of ids.slice(0, 40)) recordImpression(id)
      break
    }
    case 'WATCHLIST_ADD': {
      profileData.engagement.watchlistAdds += 1
      break
    }
    case 'WATCHLIST_REMOVE': {
      profileData.engagement.watchlistRemoves += 1
      break
    }
    case 'CARD_CLICK':
    case 'CATALOG_ITEM_CLICK': {
      if (metadata.clickBurst) profileData.browsing.franticClicks += 1
      break
    }
    case 'CATALOG_BROWSE': {
      profileData.browsing.catalogSessions += 1
      profileData.browsing.totalScrollDistance += Number(metadata.scrollDistance || 0)
      profileData.browsing.maxScrollDepth = Math.max(profileData.browsing.maxScrollDepth, Number(metadata.scrollDepth || 0))
      profileData.browsing.itemsSeenWithoutClick += Number(metadata.seenWithoutClick || 0)
      profileData.browsing.noClickBrowseMs += Number(metadata.noClickBrowseMs || 0)
      if (metadata.mostVisibleMediaId) {
        profileData.browsing.lastMostVisibleMediaId = metadata.mostVisibleMediaId
        recordImpression(metadata.mostVisibleMediaId)
      }
      if (Array.isArray(metadata.visibleMediaIds)) {
        for (const id of metadata.visibleMediaIds.slice(0, 40)) recordImpression(id)
      }
      if (metadata.hesitationScore > 1) profileData.browsing.hesitationSignals += 1
      break
    }
    case 'MEDIA_VIEW': {
      profileData.details.opened += 1
      if (metadata.repeatVisit) profileData.details.repeatVisits += 1
      recordDetailOpen(event.mediaId)
      break
    }
    case 'MEDIA_SECTION_VIEW': {
      if (metadata.section === 'synopsis') profileData.details.synopsisViews += 1
      if (metadata.section === 'cast') profileData.details.castViews += 1
      if (metadata.section === 'metadata') profileData.details.metadataViews += 1
      break
    }
    case 'MEDIA_DETAIL_ENGAGEMENT': {
      profileData.details.totalTimeOnPageMs += Number(metadata.timeOnPageMs || 0)
      profileData.details.totalScrollDepth += Number(metadata.scrollDepth || 0)
      if (metadata.immediateExit) profileData.details.immediateExits += 1
      break
    }
    case 'MEDIA_PLAY_INTENT': {
      profileData.details.playIntentCount += 1
      profileData.details.totalTimeToPlayMs += Number(metadata.delayFromOpenMs || 0)
      break
    }
    case 'WATCH_START': {
      profileData.playback.starts += 1
      if (metadata.resume) profileData.playback.rewatches += 1
      recordPlay(event.mediaId)
      break
    }
    case 'WATCH_PROGRESS': {
      const delta = Number(metadata.deltaSeconds || 0)
      profileData.playback.totalWatchSeconds += delta
      // Active vs idle: a heartbeat with no position advance (paused/standby)
      // counts as idle time; otherwise active viewing time.
      if (metadata.paused || metadata.idle) {
        profileData.engagement.idleWatchSeconds += delta
      } else {
        profileData.engagement.activeWatchSeconds += delta
      }
      if (typeof metadata.completionRate === 'number') {
        profileData.playback.totalCompletionRate += metadata.completionRate
        const divisor = Math.max(profileData.playback.starts, 1)
        profileData.playback.avgCompletionRate = round(profileData.playback.totalCompletionRate / divisor, 3)
      }
      break
    }
    case 'WATCH_PAUSE': {
      profileData.playback.pauses += 1
      break
    }
    case 'WATCH_RESUME': {
      profileData.playback.resumes += 1
      break
    }
    case 'WATCH_SEEK': {
      if (metadata.direction === 'backward') profileData.playback.seeksBackward += 1
      if (metadata.direction === 'forward') profileData.playback.seeksForward += 1
      break
    }
    case 'WATCH_STOP':
    case 'ABANDON': {
      profileData.playback.abandons += 1
      profileData.playback.lastAbandonPosition = Number(metadata.position || 0)
      profileData.playback.lastAbandonReason = metadata.reason || event.type
      if (metadata.quickAbandon) profileData.playback.quickAbandons += 1
      const ratio = Number(metadata.positionRatio || 0)
      recordAbandon(event.mediaId, ratio)
      // Stopped past 75% still counts as an effective watch for the title.
      if (ratio >= 0.75) {
        profileData.engagement.effectiveCompletions += 1
        recordEffectiveCompletion(event.mediaId)
      }
      break
    }
    case 'WATCH_COMPLETE': {
      profileData.playback.completes += 1
      profileData.engagement.effectiveCompletions += 1
      profileData.engagement.finishedTitles += 1
      const sessionsToFinish = countSessionsToFinish(userId, event.mediaId)
      profileData.engagement.sessionsToFinishTotal += sessionsToFinish
      recordComplete(event.mediaId, {
        positionRatio: Number(metadata.positionRatio || 1),
        sessionsToFinish,
      })
      recordBinge(profileData, createdAt)
      if (metadata.coViewing) profileData.binge.coViewingSignals += 1
      break
    }
    case 'WATCH_AUDIO_CHANGE': {
      inc(profileData.playback.audioPreferences, metadata.label || metadata.language || String(metadata.trackIndex))
      inc(profileData.playback.languagePreferences, metadata.language)
      break
    }
    case 'WATCH_SUBTITLE_CHANGE': {
      inc(profileData.playback.subtitlePreferences, metadata.label || metadata.language || metadata.mode || 'off')
      inc(profileData.playback.languagePreferences, metadata.language)
      break
    }
    case 'WATCH_FULLSCREEN_CHANGE': {
      if (metadata.fullscreen) {
        profileData.playback.fullscreenCount += 1
      }
      break
    }
    case 'MEDIA_LIKE':
    case 'MEDIA_DISLIKE':
      break
    default:
      break
  }

  if (weight !== 0 && mediaSnapshot.genres.length) {
    updateTopLevelGenreScores(scores, mediaSnapshot.genres, weight)
    addPreferenceScore(profileData, mediaSnapshot, weight)
    addTieredPreferenceScore(profileData, mediaSnapshot, event.type, weight, metadata)
  }

  if (event.type === 'MEDIA_LIKE') {
    updateTopLevelGenreScores(scores, mediaSnapshot.genres, 8)
    addPreferenceScore(profileData, mediaSnapshot, 8)
    addTieredPreferenceScore(profileData, mediaSnapshot, 'MEDIA_LIKE', 8, metadata)
  }

  if (event.type === 'MEDIA_DISLIKE') {
    updateTopLevelGenreScores(scores, mediaSnapshot.genres, -8)
    addPreferenceScore(profileData, mediaSnapshot, -8)
  }

  // Adding to the watchlist is an explicit intent signal — propagate taste.
  if (event.type === 'WATCHLIST_ADD') {
    updateTopLevelGenreScores(scores, mediaSnapshot.genres, 7)
    addPreferenceScore(profileData, mediaSnapshot, 7)
    addTieredPreferenceScore(profileData, mediaSnapshot, 'WATCHLIST_ADD', 7, metadata)
  }
  if (event.type === 'WATCHLIST_REMOVE') {
    updateTopLevelGenreScores(scores, mediaSnapshot.genres, -3)
    addPreferenceScore(profileData, mediaSnapshot, -3)
  }

  if (event.type === 'WATCH_STOP' && Number(metadata.positionRatio || 0) < 0.2) {
    addPreferenceScore(profileData, mediaSnapshot, -3)
  }

  if (event.type === 'WATCH_COMPLETE' && Number(metadata.positionRatio || 0) >= 0.9) {
    addPreferenceScore(profileData, mediaSnapshot, 3)
    addTieredPreferenceScore(profileData, mediaSnapshot, 'WATCH_COMPLETE', 3, metadata)
  }

  updateTags(profileData, event, metadata, weight)
  pushRecent(profileData.recentSignals, {
    type: event.type,
    mediaId: event.mediaId || null,
    createdAt: createdAt.toISOString(),
    summary: summarizeEvent(event, metadata, mediaSnapshot.title),
  }, 12)

  await db.update(userProfiles)
    .set({
      scores,
      recentGenres: profileData.preferences.lastGenres,
      profileData,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.userId, userId))
}
