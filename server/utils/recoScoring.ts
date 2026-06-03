/**
 * Recommendation scoring.
 *
 * Blends three layers into a calibrated 0-100 match score and a short list of
 * human-readable reasons ("why"):
 *   1. the genre/decade taste model (`preferences.ts`)
 *   2. the behavioral profile (`analyticsEngine.ts` → profileData)
 *   3. per-title audience stats (passed in via `statsModifier`)
 *
 * Every field tracked in profileData contributes here — either as a per-candidate
 * term or as a global "user style" bias derived from the whole profile.
 */
import { calculateMatchScore, type UserPreferences } from './preferences'

export type ScoreReason = { code: string; value?: string }

// Reason codes that are user-presentable ("why" badges). Internal nudges
// (behavioral tags, etc.) are excluded so the UI never shows raw signal names.
const PRESENTABLE_REASONS = new Set([
  'genre', 'actor', 'director', 'composer', 'keyword', 'collection', 'decade',
  'recency', 'moment', 'season', 'popular', 'novelty', 'acclaimed', 'fitsShort',
  'fitsEpic', 'bingeFriendly', 'continueSaga', 'household', 'watchlist',
  'recentGenres', 'searchMatch', 'audience', 'discover', 'lingered',
])
export type CandidateScore = { score: number; raw: number; reasons: ScoreReason[] }

export type ScoreContext = {
  now?: Date
  watchlistGenres?: Set<string>
  statsModifier?: number
  lastQuery?: string | null
}

// ── small helpers ─────────────────────────────────────────────────────────────

function maxPositive(record?: Record<string, number> | null): number {
  if (!record) return 0
  let max = 0
  for (const v of Object.values(record)) if (Number.isFinite(v) && v > max) max = v
  return max
}
function minNegative(record?: Record<string, number> | null): number {
  if (!record) return 0
  let min = 0
  for (const v of Object.values(record)) if (Number.isFinite(v) && v < min) min = v
  return min
}

/** Positive affinity 0..scale for a key, relative to the strongest key. */
function posScore(record: Record<string, number> | null | undefined, key: string | null | undefined, scale: number): number {
  if (!record || !key) return 0
  const max = maxPositive(record)
  if (max <= 0) return 0
  const v = record[key] || 0
  return v > 0 ? (v / max) * scale : 0
}

/** Negative penalty -scale..0 for a key the user has actively soured on. */
function negScore(record: Record<string, number> | null | undefined, key: string | null | undefined, scale: number): number {
  if (!record || !key) return 0
  const min = minNegative(record)
  if (min >= 0) return 0
  const v = record[key] || 0
  return v < 0 ? (v / Math.abs(min)) * scale : 0
}

function getRuntimeBucket(runtime: number | null | undefined) {
  if (!runtime) return null
  if (runtime < 60) return 'short'
  if (runtime < 100) return 'standard'
  if (runtime < 140) return 'long'
  return 'epic'
}
function getRecencyBucket(year: number | null | undefined) {
  if (!year) return null
  const delta = new Date().getFullYear() - year
  if (delta <= 2) return 'recent'
  if (delta <= 10) return 'modern'
  return 'classic'
}
function getDecadeKey(year: number | null | undefined) {
  return year ? `${Math.floor(year / 10) * 10}s` : null
}
function getDaypart(hour: number) {
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
function parseList(v: any): string[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}
const KIDS_GENRES = new Set(['Animation', 'Family', 'Familial'])

// ── user style (consumes the global, non-candidate-specific fields) ───────────

type UserStyle = {
  finisher: number          // -1..1  completes long content?
  shortBias: number         // prefers short content
  epicBias: number          // tolerates epics
  immersion: number         // fullscreen / big screen
  cinephile: number         // reads details, uses subtitles, deliberate
  popularitySeeker: number  // returning/reactivating → safe popular picks
  explorer: number          // deep scroller / browser → open to discovery
  binger: number            // streaks
  planner: number           // uses the watchlist a lot
  recentCaution: number     // recent abandons/dislikes → play it safe
  avgSessionsToFinish: number
  trustsProfile: number     // overall engagement volume → how much to trust learned taste
  ignoreAbandonTaste: boolean // last abandon was technical (buffering/error)
}

// Derives global, candidate-independent biases from the WHOLE profile. Every
// tracked profileData field is consulted here (or in scoreCandidate) so no
// signal is collected without being used.
function deriveUserStyle(p: any): UserStyle {
  const nav = p.navigation || {}
  const search = p.search || {}
  const browsing = p.browsing || {}
  const details = p.details || {}
  const playback = p.playback || {}
  const temporal = p.temporal || {}
  const engagement = p.engagement || {}
  const binge = p.binge || {}
  const churn = p.churn || {}
  const device = p.device || {}
  const recentSignals: any[] = Array.isArray(p.recentSignals) ? p.recentSignals : []

  const avgCompletion = playback.avgCompletionRate || (playback.totalCompletionRate && playback.starts ? playback.totalCompletionRate / playback.starts : 0)
  const completionVol = (playback.completes || 0) + (engagement.effectiveCompletions || 0)
  const finisher = clamp((completionVol - (playback.abandons || 0) - (playback.quickAbandons || 0)) / Math.max(1, (playback.starts || 0)), -1, 1)
  const attention = (engagement.activeWatchSeconds || 0) / Math.max(1, (engagement.activeWatchSeconds || 0) + (engagement.idleWatchSeconds || 0))

  const deviceTypes = device.types || {}
  const prefersMobile = (deviceTypes.mobile || 0) > (deviceTypes.desktop || 0)
  const wideScreen = Object.keys(device.screenRatios || {}).some(r => parseFloat(r) >= 1.7)

  // skippy / impatient viewers → short bias. Pauses, resumes, mid-watch abandons,
  // low total watch time and frequent re-buffer-style stops all feed this.
  const skippy = (playback.seeksForward || 0) > (playback.seeksBackward || 0) && (playback.seeksForward || 0) > 3
  const restless = (playback.pauses || 0) > (playback.resumes || 0) + 3
  const shortBias = clamp(
    (prefersMobile ? 0.35 : 0) + (skippy ? 0.25 : 0) + ((browsing.franticClicks || 0) > 2 ? 0.2 : 0)
    + (attention < 0.6 ? 0.2 : 0) + (avgCompletion > 0 && avgCompletion < 0.5 ? 0.2 : 0)
    + (restless ? 0.15 : 0) + ((playback.lastAbandonPosition || 0) > 0 && (playback.lastAbandonPosition || 0) < 600 ? 0.1 : 0),
    0, 1,
  )
  const epicBias = clamp(
    (finisher > 0.3 ? 0.35 : 0) + (avgCompletion >= 0.8 ? 0.3 : 0)
    + ((device.fullscreenCount || playback.fullscreenCount || 0) > 0 ? 0.2 : 0)
    + (wideScreen ? 0.15 : 0) + ((temporal.weekendSessions || 0) > 3 ? 0.15 : 0)
    + ((nav.avgSessionDurationMs || 0) > 45 * 60 * 1000 ? 0.2 : 0)
    + ((playback.totalWatchSeconds || 0) > 36000 ? 0.15 : 0) + ((playback.rewatches || 0) > 0 ? 0.1 : 0),
    0, 1,
  )

  // cinephile: reads detail sections, uses subtitles/audio tracks, deliberates,
  // revisits fiches, scrolls deep, clicks low-ranked results (digs past the top).
  const subUse = Object.keys(playback.subtitlePreferences || {}).length
    + Object.keys(playback.languagePreferences || {}).length
    + Object.keys(playback.audioPreferences || {}).length
  const reads = (details.synopsisViews || 0) + (details.castViews || 0) + (details.metadataViews || 0)
  const deliberate = (search.avgClickDelayMs || 0) > 4000 || (search.totalClickDelayMs || 0) > 30000
    || (search.searchesBeforeSelection || 0) > 2 || (details.totalTimeToPlayMs || 0) > 15000
    || (search.lastClickedResultPosition || 0) > 5
  const cinephile = clamp(
    (reads > 3 ? 0.35 : 0) + (subUse > 1 ? 0.25 : 0) + (deliberate ? 0.25 : 0)
    + ((details.totalTimeOnPageMs || 0) > 60000 ? 0.2 : 0) + ((details.totalScrollDepth || 0) > 3000 ? 0.1 : 0)
    + ((details.repeatVisits || 0) > 1 ? 0.15 : 0) + ((search.submits || 0) > (search.clicks || 0) ? 0.1 : 0),
    0, 1,
  )

  // explorer: deep scrolling, many catalog sessions, refines searches, loops routes,
  // long history breadth, browses with no immediate click.
  const explorer = clamp(
    ((browsing.maxScrollDepth || 0) > 2000 ? 0.25 : 0) + ((browsing.totalScrollDistance || 0) > 20000 ? 0.15 : 0)
    + ((browsing.catalogSessions || 0) > 5 ? 0.15 : 0) + ((search.emptySearchThenBrowse || 0) > 0 ? 0.15 : 0)
    + ((nav.routeLoops || 0) > 3 ? 0.1 : 0) + ((search.refinements || 0) > 2 ? 0.15 : 0)
    + (Array.isArray(nav.shortHistory) && nav.shortHistory.length >= 5 ? 0.1 : 0)
    + ((browsing.noClickBrowseMs || 0) > 30000 ? 0.15 : 0),
    0, 1,
  )

  // popularitySeeker: returning after a gap, browsing fatigue, hovering without
  // clicking, abandoning searches, long hovers that don't convert.
  const hoverConv = (browsing.clicksAfterHover || 0) / Math.max(1, browsing.cardHovers || 0)
  const popularitySeeker = clamp(
    ((churn.reactivations || 0) > 0 ? 0.4 : 0) + ((churn.longestGapMs || 0) > 14 * 864e5 ? 0.25 : 0)
    + ((browsing.itemsSeenWithoutClick || 0) > 30 ? 0.15 : 0) + (((browsing.cardHovers || 0) > 10 && hoverConv < 0.2) ? 0.25 : 0)
    + ((search.abandonments || 0) > 2 ? 0.15 : 0) + ((browsing.longHovers || 0) > 5 ? 0.1 : 0)
    + ((browsing.totalHoverMs || 0) > 60000 && hoverConv < 0.3 ? 0.1 : 0)
    + ((browsing.hesitationSignals || 0) > 5 ? 0.1 : 0),
    0, 1,
  )
  const binger = clamp(
    ((binge.maxStreak || 0) >= 3 ? 0.5 : 0) + ((binge.bingeSessions || 0) > 0 ? 0.3 : 0)
    + ((binge.currentStreak || 0) >= 2 ? 0.3 : 0)
    + (binge.lastCompleteAt && Date.now() - new Date(binge.lastCompleteAt).getTime() < 6 * 36e5 ? 0.3 : 0)
    + ((binge.coViewingSignals || 0) > 0 ? 0.1 : 0),
    0, 1,
  )

  const planner = clamp(((engagement.watchlistAdds || 0) - (engagement.watchlistRemoves || 0)) / 8, 0, 1)

  // recentCaution: a recent dislike/abandon in the signal log → lean safer.
  const recentNeg = recentSignals.slice(0, 5).filter(s => /DISLIKE|ABANDON|WATCH_STOP/.test(s?.type || '')).length
  const recentCaution = clamp(recentNeg / 4 + ((details.immediateExits || 0) > 2 ? 0.2 : 0), 0, 1)

  const finishers = engagement.finishedTitles || 0
  const avgSessionsToFinish = finishers > 0 ? (engagement.sessionsToFinishTotal || 0) / finishers : 1

  // overall engagement volume + cadence regularity → trust in learned taste.
  const activeDayCount = Object.keys(churn.activeDays || {}).length
  const recencyOfActivity = churn.lastActiveAt && Date.now() - new Date(churn.lastActiveAt).getTime() < 7 * 864e5 ? 0.1 : 0
  const trustsProfile = clamp(
    ((nav.pageViews || 0) + (details.opened || 0) + (playback.starts || 0) + (search.totalQueries || 0)
      + (search.clicks || 0) + (nav.sessions || 0) + (browsing.cardHovers || 0)) / 80
    + activeDayCount / 60 + recencyOfActivity,
    0, 1,
  )

  const reason = (playback.lastAbandonReason || '').toLowerCase()
  const ignoreAbandonTaste = reason.includes('buffer') || reason.includes('error')

  return {
    finisher, shortBias, epicBias, immersion: epicBias, cinephile, popularitySeeker,
    explorer, binger, planner, recentCaution, avgSessionsToFinish, trustsProfile, ignoreAbandonTaste,
  }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

// ── main scoring ──────────────────────────────────────────────────────────────

export function scoreCandidate(
  candidate: any,
  preferences: UserPreferences | null,
  profileData: Record<string, any> | null | undefined,
  ctx: ScoreContext = {},
): CandidateScore {
  const genres: string[] = parseList(candidate.genres)
  const profile = profileData || {}
  const pref = profile.preferences || {}
  const temporal = profile.temporal || {}
  const household = profile.household || {}
  const browsing = profile.browsing || {}
  const details = profile.details || {}
  const search = profile.search || {}
  const navigation = profile.navigation || {}
  const tags = pref.tags || {}
  const now = ctx.now || new Date()
  const style = deriveUserStyle(profile)
  // If the last abandon was technical (buffering/error), don't let it make the
  // user look cautious about content.
  const effCaution = style.ignoreAbandonTaste ? style.recentCaution * 0.3 : style.recentCaution

  const contributions: Array<{ code: string; value?: string; amount: number }> = []
  let score = 0
  const add = (amount: number, code: string, value?: string) => {
    if (!amount) return
    score += amount
    if (amount !== 0) contributions.push({ code, value, amount })
  }

  // 1) Base taste model (genre/decade/rating) — already 0..100, weighted down.
  add((preferences ? calculateMatchScore(genres, candidate.year, candidate.rating, preferences) : 0) * 0.4, 'taste')

  // 2) Genre affinity (+ anti-genre demotion)
  const trust = 0.5 + 0.5 * style.trustsProfile
  for (const genre of genres) {
    add(posScore(pref.genreScores, genre, 16) * trust, 'genre', genre)
    add(negScore(pref.genreScores, genre, 14), 'antiGenre', genre)
  }

  // 3) Actor affinity (+ anti-actor). Cast may arrive as JSON string.
  const cast = parseList(candidate.cast).map((a: any) => (typeof a === 'string' ? a : a?.name)).filter(Boolean)
  const castWeight = details.castViews > 3 ? 14 : 10 // cinephiles who read cast → weight actors more
  for (const actor of cast.slice(0, 5)) {
    add(posScore(pref.actorScores, actor, castWeight), 'actor', actor)
    add(negScore(pref.actorScores, actor, 8), 'antiActor', actor)
  }

  // 4) Director / composer affinity (+ demotion)
  add(posScore(pref.directorScores, candidate.director, 9), 'director', candidate.director || undefined)
  add(negScore(pref.directorScores, candidate.director, 9), 'antiDirector', candidate.director || undefined)
  add(posScore(pref.composerScores, candidate.composer, 5), 'composer', candidate.composer || undefined)

  // 5) Keywords / themes (+ anti-keyword)
  const keywords = parseList(candidate.keywords)
  for (const kw of keywords.slice(0, 12)) {
    add(posScore(pref.keywordScores, kw, 10), 'keyword', kw)
    add(negScore(pref.keywordScores, kw, 9), 'antiKeyword', kw)
  }

  // 6) Era / runtime / certification / collection
  add(posScore(pref.decadeScores, getDecadeKey(candidate.year), 8), 'decade', getDecadeKey(candidate.year) || undefined)
  add(posScore(pref.runtimeScores, getRuntimeBucket(candidate.runtime), 8), 'runtime')
  add(posScore(pref.recencyScores, getRecencyBucket(candidate.year), 7), 'recency')
  add(posScore(pref.certificationScores, candidate.certification, 5), 'certification', candidate.certification || undefined)
  add(negScore(pref.certificationScores, candidate.certification, 6), 'antiCertification', candidate.certification || undefined)
  add(posScore(pref.collectionScores, candidate.collectionName, 12), 'collection', candidate.collectionName || undefined)

  // 7) Popularity (crowd) + novelty. Novelty appetite shrinks when the user has
  // recently bailed on things (recentCaution).
  if (typeof candidate.popularity === 'number' && candidate.popularity > 0) {
    add(Math.min(4, Math.log10(1 + candidate.popularity)) * (0.6 + style.popularitySeeker), 'popular')
  }
  if (getRecencyBucket(candidate.year) === 'recent') add((2 + style.explorer * 2) * (1 - 0.5 * effCaution), 'novelty')

  // 8) Genre × moment (weekday × daypart) and × month (seasonality)
  const momentGenres = (temporal.genreMoment || {})[`${now.getDay()}-${getDaypart(now.getHours())}`] || {}
  const monthGenres = (temporal.genreMonth || {})[String(now.getMonth())] || {}
  for (const genre of genres) {
    add(posScore(momentGenres, genre, 8), 'moment', genre)
    add(posScore(monthGenres, genre, 6), 'season', genre)
  }

  // 8b) Temporal activity context — boost slightly if the user is typically
  // active at this hour / weekday / month (consumes the raw temporal buckets).
  const activeNow = ((temporal.hourBuckets || {})[String(now.getHours())] || 0)
    + ((temporal.weekdayBuckets || {})[String(now.getDay())] || 0)
    + ((temporal.monthBuckets || {})[String(now.getMonth())] || 0)
  if (activeNow > 0) add(1, 'activeNow')

  // 8c) Navigation context — last visited path mentioning a candidate genre, and
  // whether the user is in a fresh session right now.
  const lastPath = (navigation.lastPath || '').toString().toLowerCase()
  if (lastPath && genres.some((g: string) => lastPath.includes(g.toLowerCase()))) add(1.5, 'browsingGenre')
  const inSession = navigation.lastSessionStartedAt
    && (!navigation.lastSessionEndedAt || new Date(navigation.lastSessionStartedAt) > new Date(navigation.lastSessionEndedAt))
  const quickReturn = (navigation.lastSessionGapMs || 0) > 0 && (navigation.lastSessionGapMs || 0) < 6 * 36e5
  if (inSession || quickReturn) add(0.5, 'sessionContext')

  // 9) Recent context — last genres, last-on-screen, recently seen (demote repeats)
  if (Array.isArray(pref.lastGenres)) {
    const overlap = genres.filter((g: string) => pref.lastGenres.includes(g)).length
    add(Math.min(8, overlap * 2.5), 'recentGenres')
  }
  if (browsing.lastMostVisibleMediaId && browsing.lastMostVisibleMediaId === candidate.id) add(3, 'lingered')
  if (Array.isArray(pref.lastMediaIds) && pref.lastMediaIds.includes(candidate.id)) add(-6, 'justSeen')

  // 10) Search relevance: last query terms appearing in the title
  const lastQuery = (ctx.lastQuery || search.lastQuery || '').toString().toLowerCase().trim()
  if (lastQuery.length >= 3 && typeof candidate.title === 'string' && candidate.title.toLowerCase().includes(lastQuery)) {
    add(5, 'searchMatch')
  }

  // 11) User-style ↔ runtime fit
  const rb = getRuntimeBucket(candidate.runtime)
  if (style.shortBias > 0.4 && rb === 'short') add(style.shortBias * 3, 'fitsShort')
  if (style.shortBias > 0.4 && rb === 'epic') add(-style.shortBias * 3, 'tooLong')
  if (style.epicBias > 0.4 && (rb === 'long' || rb === 'epic')) add(style.immersion * 3, 'fitsEpic')
  // Acclaimed picks for cinephiles, and a safe-choice nudge when the user has
  // been bailing on things recently (recentCaution).
  if ((style.cinephile > 0.4 || effCaution > 0.5) && (candidate.rating || 0) >= 7.5) {
    add((style.cinephile + effCaution) * 2 + 1, 'acclaimed')
  }

  // 12) Sessions-to-finish as an effort signal (item #8)
  if (style.avgSessionsToFinish > 2 && !style.binger && (rb === 'long' || rb === 'epic')) add(-3, 'hardToFinish')
  if (style.binger && (rb === 'long' || rb === 'epic')) add(2, 'bingeFriendly')

  // 13) Binge / saga continuation
  if (style.binger && candidate.collectionName && (pref.collectionScores?.[candidate.collectionName] || 0) > 0) {
    add(3, 'continueSaga', candidate.collectionName)
  }

  // 14) Household / co-viewing: blend kids sub-profile during likely family moments
  if ((household.coViewing || 0) > 0) {
    const isFamilyMoment = getDaypart(now.getHours()) === 'afternoon' || now.getDay() === 0 || now.getDay() === 6
    const isKids = (candidate.certification && KIDS_CERTS_RUNTIME(candidate.certification)) || genres.some(g => KIDS_GENRES.has(g))
    if (isKids) {
      for (const genre of genres) add(posScore(household.kidsGenreScores, genre, isFamilyMoment ? 8 : 4), 'household', genre)
    } else {
      for (const genre of genres) add(posScore(household.adultGenreScores, genre, 4), 'household', genre)
    }
  }

  // 15) Watchlist affinity (planners weight this more)
  if (ctx.watchlistGenres && genres.some((g: string) => ctx.watchlistGenres!.has(g))) add(3 * (1 + style.planner), 'watchlist')

  // 16) Behavioral tag nudges (existing) + assorted low-weight signals so every
  // tracked field is consulted.
  if ((tags['navbar-search'] || 0) > 0 && genres.length > 0) add(1.5, 'tagNavbar')
  if ((tags['refined-search'] || 0) > 0 && (candidate.rating || 0) >= 7) add(1.5, 'tagRefined')
  if ((tags['catalog-fatigue'] || 0) > 0 && (candidate.rating || 0) >= 7.5) add(1, 'tagFatigue')
  if ((tags['recent-abandon'] || 0) > 0 && rb === 'standard') add(1, 'tagAbandon')
  if ((tags['quick-abandon'] || 0) > 0 && rb === 'short') add(1.5, 'tagQuickAbandon')
  if ((tags['completion-positive'] || 0) > 0 && genres.some((g: string) => (pref.genreScores?.[g] || 0) > 0)) add(2, 'tagCompletion')
  if ((search.repeatedQueries && Object.keys(search.repeatedQueries).length > 0)) add(Math.min(2, Object.keys(search.repeatedQueries).length * 0.3), 'persistentSearch')
  if ((details.playIntentCount || 0) > 0 && genres.some((g: string) => (pref.genreScores?.[g] || 0) > 0)) add(1, 'playIntent')
  if ((navigation.backtracks || 0) > 3 && (candidate.rating || 0) >= 7) add(0.5, 'indecisive')

  // 17) Title-level audience quality (abandonment curve, effective completion…)
  if (ctx.statsModifier) add(ctx.statsModifier, 'audience')

  // ── calibrate to 0-100 and pick reasons ──
  const raw = score
  // Saturating curve: smooth, monotonic, bounded.
  const norm = Math.round(100 * (1 - Math.exp(-Math.max(0, raw) / 80)))

  const reasons = contributions
    .filter(c => c.amount > 1.2 && PRESENTABLE_REASONS.has(c.code))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 2)
    .map(c => ({ code: c.code, value: c.value }))

  return { score: norm, raw: Math.round(raw), reasons }
}

// certification membership shared with analyticsEngine's KIDS set
function KIDS_CERTS_RUNTIME(cert: string): boolean {
  return new Set(['G', 'PG', 'U', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', '0', '6', 'Tous publics', 'AL']).has((cert || '').trim())
}

// ── diversity / MMR re-ranking ────────────────────────────────────────────────

/**
 * Maximal Marginal Relevance: greedily pick items that are relevant (high score)
 * but dissimilar to those already chosen, to avoid near-duplicate rails.
 * Similarity = genre overlap + same collection.
 */
export function applyMMR<T extends { matchScore: number; genres?: string[]; collectionName?: string | null }>(
  items: T[],
  limit: number,
  lambda = 0.72,
): T[] {
  if (items.length <= 1) return items.slice(0, limit)
  const maxScore = Math.max(1, ...items.map(i => i.matchScore))
  const pool = [...items]
  const selected: T[] = []

  const sim = (a: T, b: T) => {
    const ga = new Set(a.genres || [])
    const gb = b.genres || []
    const inter = gb.filter(g => ga.has(g)).length
    const union = new Set([...(a.genres || []), ...gb]).size || 1
    let s = inter / union
    if (a.collectionName && a.collectionName === b.collectionName) s = Math.min(1, s + 0.5)
    return s
  }

  while (selected.length < limit && pool.length) {
    let bestIdx = 0
    let bestVal = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const rel = pool[i]!.matchScore / maxScore
      const div = selected.length ? Math.max(...selected.map(s => sim(pool[i]!, s))) : 0
      const mmr = lambda * rel - (1 - lambda) * div
      if (mmr > bestVal) { bestVal = mmr; bestIdx = i }
    }
    selected.push(pool.splice(bestIdx, 1)[0]!)
  }
  return selected
}
