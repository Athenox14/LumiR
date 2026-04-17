import { eq } from 'drizzle-orm'
import { db } from '../db'
import { media, userProfiles } from '../db/schema'

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
    actorScores: Record<string, number>
    decadeScores: Record<string, number>
    runtimeScores: Record<string, number>
    recencyScores: Record<string, number>
    tags: Record<string, number>
    lastGenres: string[]
    lastMediaIds: string[]
  }
  temporal: {
    hourBuckets: Record<string, number>
    weekdayBuckets: Record<string, number>
    weekendSessions: number
  }
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
      actorScores: {},
      decadeScores: {},
      runtimeScores: {},
      recencyScores: {},
      tags: {},
      lastGenres: [],
      lastMediaIds: [],
    },
    temporal: {
      hourBuckets: {},
      weekdayBuckets: {},
      weekendSessions: 0,
    },
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
    return { genres: [], cast: [], year: null, runtime: null, title: null }
  }

  const [entry] = await db.select({
    genres: media.genres,
    cast: media.cast,
    year: media.year,
    runtime: media.runtime,
    title: media.title,
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
  }
}

function recordTemporalSignals(profile: ProfileData, metadata: Record<string, any>, createdAt: Date) {
  const hour = typeof metadata.hour === 'number' ? metadata.hour : createdAt.getHours()
  const weekday = typeof metadata.weekday === 'number' ? metadata.weekday : createdAt.getDay()
  inc(profile.temporal.hourBuckets, String(hour))
  inc(profile.temporal.weekdayBuckets, String(weekday))
  if (weekday === 0 || weekday === 6) {
    profile.temporal.weekendSessions += 1
  }
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
  pushUnique(profile.preferences.lastGenres, mediaSnapshot.genres)
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

  recordTemporalSignals(profileData, metadata, createdAt)
  recordDeviceSignals(profileData, metadata)

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
      if (metadata.hesitation) profileData.browsing.hesitationSignals += 1
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
      }
      if (metadata.hesitationScore > 1) profileData.browsing.hesitationSignals += 1
      break
    }
    case 'MEDIA_VIEW': {
      profileData.details.opened += 1
      if (metadata.repeatVisit) profileData.details.repeatVisits += 1
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
      break
    }
    case 'WATCH_PROGRESS': {
      profileData.playback.totalWatchSeconds += Number(metadata.deltaSeconds || 0)
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
      break
    }
    case 'WATCH_COMPLETE': {
      profileData.playback.completes += 1
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
  }

  if (event.type === 'MEDIA_LIKE') {
    updateTopLevelGenreScores(scores, mediaSnapshot.genres, 8)
    addPreferenceScore(profileData, mediaSnapshot, 8)
  }

  if (event.type === 'MEDIA_DISLIKE') {
    updateTopLevelGenreScores(scores, mediaSnapshot.genres, -8)
    addPreferenceScore(profileData, mediaSnapshot, -8)
  }

  if (event.type === 'WATCH_STOP' && Number(metadata.positionRatio || 0) < 0.2) {
    addPreferenceScore(profileData, mediaSnapshot, -3)
  }

  if (event.type === 'WATCH_COMPLETE' && Number(metadata.positionRatio || 0) >= 0.9) {
    addPreferenceScore(profileData, mediaSnapshot, 3)
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
