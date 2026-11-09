/**
 * Next-visit / next-film predictor.
 *
 * For every user we keep ONE pending prediction ("when will they come back and
 * what will they watch?"). When the user really comes back (new session) and
 * starts a film, the prediction is resolved and compared with reality, which
 * feeds the accuracy percentages shown on the admin "Algorithme" page.
 *
 *  - Visit time: weekday × hour session-start histogram (recency-weighted,
 *    shrunk toward the user's all-week profile), turned into a "first visit"
 *    probability over the next 7 days. The estimate is the most likely hour;
 *    the confidence is the probability mass within ±2 h of it.
 *  - Films: unfinished films (resume) + watchlist + the regular recommender
 *    score (`scoreCandidate`) evaluated at the predicted moment.
 *
 * Optionally (admin setting, off by default) the same prediction is used when
 * the user arrives: the start of up to 3 films is preheated and the user is
 * redirected straight to the most likely one.
 */
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { sqlite } from '../db'
import { calculateUserPreferences } from './preferences'
import { getAllMediaStatsCached, mediaQualityModifier, getCatalogGenreFreqs } from './mediaStatsEngine'
import { scoreCandidate } from './recoScoring'
import { MediaEngine } from './mediaEngine'

const HOUR = 3_600_000
const DAY = 86_400_000
const HISTORY_DAYS = 120
const HALF_LIFE_DAYS = 60
const VISIT_HIT_WINDOW_MIN = 120      // "right" visit = within ±2 h
const WATCH_AFTER_VISIT_MS = 12 * HOUR // a visit with no film within 12 h = "no watch"
const REFRESH_AFTER_MS = 55 * 60_000
const MIN_SESSIONS = 3

// ── Settings ─────────────────────────────────────────────────────────────────

export type AlgoSettings = { predictiveLaunch: boolean, preloadCount: number }

export function getAlgoSettings(): AlgoSettings {
  const rows = sqlite.prepare(`SELECT key, value FROM settings WHERE key IN ('algoPredictiveLaunch', 'algoPreloadCount')`).all() as Array<{ key: string, value: string | null }>
  const map: Record<string, unknown> = {}
  for (const r of rows) {
    try { map[r.key] = r.value == null ? null : JSON.parse(r.value) } catch { map[r.key] = r.value }
  }
  const count = Number(map.algoPreloadCount)
  return {
    predictiveLaunch: map.algoPredictiveLaunch === true || map.algoPredictiveLaunch === 'true',
    preloadCount: Number.isFinite(count) ? Math.min(3, Math.max(1, Math.round(count))) : 1,
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type PredictedMovie = {
  id: string
  tmdbId: number | null
  title: string
  posterPath: string | null
  year: number | null
  score: number
  /** Confidence 0-1: how likely this film is the pick among the candidates (softmax of scores). */
  share: number
  reasons: Array<{ code: string, value?: string | null }>
  resume: boolean
}

export type VisitProfile = {
  sessions: number
  firstSessionAt: number | null
  lastSessionAt: number | null
  tzOffsetHours: number
  /** Average number of sessions per day for each weekday (0 = Sunday). */
  weekdayRate: number[]
  /** Recency-weighted session starts per local hour (0-23). */
  hourHistogram: number[]
  avgGapHours: number | null
}

export type VisitEstimate = {
  at: number
  confidence: number
  /** Probability that the user comes back at all within the next 7 days. */
  withinWeek: number
}

// ── Visit time ───────────────────────────────────────────────────────────────

function loadTzOffsetHours(userId: string): number {
  const row = sqlite.prepare(`
    SELECT json_extract(metadata, '$.clientAt') as clientAt, json_extract(metadata, '$.hour') as hour
    FROM user_events
    WHERE user_id = ? AND type = 'PAGE_VIEW' AND json_extract(metadata, '$.clientAt') IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(userId) as { clientAt: string | null, hour: number | null } | undefined
  if (row?.clientAt && typeof row.hour === 'number') {
    const utcHour = new Date(row.clientAt).getUTCHours()
    if (Number.isFinite(utcHour)) {
      let diff = ((row.hour - utcHour) % 24 + 24) % 24
      if (diff > 14) diff -= 24
      return diff
    }
  }
  return -new Date().getTimezoneOffset() / 60 // server timezone as fallback
}

function loadSessionStarts(userId: string, sinceMs: number): number[] {
  const rows = sqlite.prepare(`
    SELECT created_at as at FROM user_events
    WHERE user_id = ? AND type = 'PAGE_VIEW' AND json_extract(metadata, '$.sessionStart') = 1 AND created_at >= ?
    ORDER BY created_at ASC
  `).all(userId, Math.floor(sinceMs / 1000)) as Array<{ at: number }>
  return rows.map(r => r.at * 1000)
}

export function getVisitProfile(userId: string, nowMs = Date.now()): VisitProfile {
  const offsetH = loadTzOffsetHours(userId)
  const offsetMs = offsetH * HOUR
  const starts = loadSessionStarts(userId, nowMs - HISTORY_DAYS * DAY)
  const todayKey = Math.floor((nowMs + offsetMs) / DAY)

  const hourHistogram = Array(24).fill(0)
  const perWeekdaySessions = Array(7).fill(0)
  const perWeekdayDays = Array(7).fill(0)
  for (const at of starts) {
    const d = new Date(at + offsetMs)
    hourHistogram[d.getUTCHours()] += 1
    perWeekdaySessions[d.getUTCDay()] += 1
  }
  if (starts.length) {
    const firstKey = Math.floor((starts[0]! + offsetMs) / DAY)
    for (let k = firstKey; k <= todayKey; k++) perWeekdayDays[new Date(k * DAY).getUTCDay()] += 1
  }
  let gapSum = 0
  for (let i = 1; i < starts.length; i++) gapSum += starts[i]! - starts[i - 1]!

  return {
    sessions: starts.length,
    firstSessionAt: starts[0] ?? null,
    lastSessionAt: starts[starts.length - 1] ?? null,
    tzOffsetHours: offsetH,
    weekdayRate: perWeekdaySessions.map((n, i) => perWeekdayDays[i] ? round(n / perWeekdayDays[i], 2) : 0),
    hourHistogram: hourHistogram.map(v => round(v, 1)),
    avgGapHours: starts.length > 1 ? round(gapSum / (starts.length - 1) / HOUR, 1) : null,
  }
}

/** Estimate the user's next visit. Returns null when there is not enough history. */
export function predictNextVisit(userId: string, nowMs = Date.now()): VisitEstimate | null {
  const offsetMs = loadTzOffsetHours(userId) * HOUR
  const starts = loadSessionStarts(userId, nowMs - HISTORY_DAYS * DAY)
  const todayKey = Math.floor((nowMs + offsetMs) / DAY)
  const past = starts.filter(at => Math.floor((at + offsetMs) / DAY) < todayKey)
  if (past.length < MIN_SESSIONS) return null

  const weight = (dayKey: number) => Math.pow(0.5, (todayKey - dayKey) / HALF_LIFE_DAYS)
  const cnt: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  const cntAll: number[] = Array(24).fill(0)
  const den: number[] = Array(7).fill(0)

  const firstKey = Math.floor((past[0]! + offsetMs) / DAY)
  if (todayKey - firstKey < 2) return null
  for (let k = firstKey; k < todayKey; k++) den[new Date(k * DAY).getUTCDay()]! += weight(k)
  const denTotal = den.reduce((a, b) => a + b, 0)
  for (const at of past) {
    const d = new Date(at + offsetMs)
    const w = weight(Math.floor((at + offsetMs) / DAY))
    cnt[d.getUTCDay()]![d.getUTCHours()]! += w
    cntAll[d.getUTCHours()]! += w
  }

  // Shrink each weekday toward the all-week hourly profile, then smooth hours.
  const K = 1.5
  const rate: number[][] = []
  for (let wd = 0; wd < 7; wd++) {
    const raw = Array.from({ length: 24 }, (_, h) => (cnt[wd]![h]! + K * (cntAll[h]! / denTotal)) / (den[wd]! + K))
    rate.push(raw.map((v, h) => 0.25 * raw[(h + 23) % 24]! + 0.5 * v + 0.25 * raw[(h + 1) % 24]!))
  }

  const nowLocal = new Date(nowMs + offsetMs)
  const nowHour = nowLocal.getUTCHours()
  const nowFracLeft = 1 - nowLocal.getUTCMinutes() / 60

  const slots: Array<{ dayKey: number, hour: number, p: number }> = []
  let survival = 1
  for (let d = 0; d <= 7; d++) {
    const dayKey = todayKey + d
    const wd = new Date(dayKey * DAY).getUTCDay()
    for (let h = 0; h < 24; h++) {
      if (d === 0 && h < nowHour) continue
      const lambda = rate[wd]![h]! * (d === 0 && h === nowHour ? nowFracLeft : 1)
      const p = survival * (1 - Math.exp(-lambda))
      survival *= Math.exp(-lambda)
      slots.push({ dayKey, hour: h, p })
    }
  }
  let best = 0
  for (let i = 1; i < slots.length; i++) if (slots[i]!.p > slots[best]!.p) best = i
  const lo = Math.max(0, best - 2), hi = Math.min(slots.length - 1, best + 2)
  let confidence = 0
  for (let i = lo; i <= hi; i++) confidence += slots[i]!.p

  const slot = slots[best]!
  const at = slot.dayKey * DAY + slot.hour * HOUR + HOUR / 2 - offsetMs
  return { at, confidence: round(confidence, 3), withinWeek: round(1 - survival, 3) }
}

// ── Films ────────────────────────────────────────────────────────────────────

const COLS = `m.id, m.tmdb_id as tmdbId, m.title, m.poster_path as posterPath, m.year, m.rating, m.runtime,
  m.cast, m.genres, m.keywords, m.director, m.composer, m.certification, m.popularity,
  m.collection_name as collectionName, m.file_path as filePath`

export function predictMovies(userId: string, atMs = Date.now(), n = 3): PredictedMovie[] {
  const at = new Date(atMs)
  const preferences = calculateUserPreferences(userId)
  const profileRow = sqlite.prepare(`SELECT profile_data FROM user_profiles WHERE user_id = ?`).get(userId) as { profile_data: string | null } | undefined
  let profileData: Record<string, any> | null = null
  try { profileData = profileRow?.profile_data ? JSON.parse(profileRow.profile_data) : null } catch { profileData = null }

  const excluded = new Set<string>()
  for (const r of sqlite.prepare(`SELECT media_id FROM watch_progress WHERE user_id = ? AND completed = 1`).all(userId) as Array<{ media_id: string }>) excluded.add(r.media_id)
  for (const r of sqlite.prepare(`SELECT media_id FROM media_ratings WHERE user_id = ? AND rating = -1`).all(userId) as Array<{ media_id: string }>) excluded.add(r.media_id)

  const candidates = new Map<string, any>()
  const bonus = new Map<string, { amount: number, reasons: string[], resume: boolean }>()
  const addBonus = (id: string, amount: number, reason: string, resume = false) => {
    const b = bonus.get(id) || { amount: 0, reasons: [], resume: false }
    b.amount += amount
    b.reasons.push(reason)
    b.resume = b.resume || resume
    bonus.set(id, b)
  }

  // 1. Unfinished films: the strongest "what will they watch next" signal.
  const inProgress = sqlite.prepare(`
    SELECT ${COLS}, wp.position as position, wp.duration as duration, wp.updated_at as wpUpdated
    FROM watch_progress wp JOIN media m ON m.id = wp.media_id
    WHERE wp.user_id = ? AND wp.completed = 0 AND wp.position > 30 AND m.media_type = 'movie'
  `).all(userId) as any[]
  for (const row of inProgress) {
    const total = row.duration || (row.runtime ? row.runtime * 60 : 0)
    const frac = total ? row.position / total : 0.3
    if (frac >= 0.93 || excluded.has(row.id)) continue
    const ageDays = Math.max(0, (atMs - row.wpUpdated * 1000) / DAY)
    let amount = 20 + 30 * Math.pow(0.5, ageDays / 10)
    if (frac < 0.03) amount *= 0.5
    candidates.set(row.id, row)
    addBonus(row.id, amount, 'resume', true)
  }

  // 2. Watchlist.
  const watchlistGenres = new Set<string>()
  const watchlist = sqlite.prepare(`
    SELECT ${COLS} FROM watchlist w JOIN media m ON m.id = w.media_id
    WHERE w.user_id = ? AND m.media_type = 'movie'
  `).all(userId) as any[]
  for (const row of watchlist) {
    try { for (const g of JSON.parse(row.genres || '[]')) watchlistGenres.add(g) } catch { /* ignore */ }
    if (excluded.has(row.id)) continue
    candidates.set(row.id, candidates.get(row.id) || row)
    addBonus(row.id, 10, 'watchlist')
  }

  // 3. Taste-matched + popular catalog titles.
  const topGenres = [...new Set([
    ...(preferences?.topGenres || []).slice(0, 4).map(e => e.genre),
    ...Object.entries((profileData?.preferences?.genreScores || {}) as Record<string, number>)
      .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g),
  ])].slice(0, 6)
  const pools: any[][] = []
  if (topGenres.length) {
    pools.push(sqlite.prepare(`
      SELECT ${COLS} FROM media m
      WHERE m.media_type = 'movie' AND (${topGenres.map(() => 'm.genres LIKE ?').join(' OR ')})
      GROUP BY COALESCE(m.tmdb_id, m.title)
      ORDER BY m.rating DESC NULLS LAST, m.added_at DESC LIMIT 150
    `).all(...topGenres.map(g => `%${g}%`)) as any[])
  }
  pools.push(sqlite.prepare(`
    SELECT ${COLS} FROM media m WHERE m.media_type = 'movie'
    GROUP BY COALESCE(m.tmdb_id, m.title)
    ORDER BY COALESCE(m.popularity, 0) DESC, m.rating DESC NULLS LAST LIMIT 80
  `).all() as any[])
  for (const pool of pools) {
    for (const row of pool) if (!excluded.has(row.id) && !candidates.has(row.id)) candidates.set(row.id, row)
  }

  const statsMap = getAllMediaStatsCached()
  const catalogGenreFreqs = getCatalogGenreFreqs('movie')
  const scored = [...candidates.values()].map((c) => {
    const base = scoreCandidate(c, preferences, profileData, {
      now: at, statsModifier: mediaQualityModifier(statsMap.get(c.id)), watchlistGenres, catalogGenreFreqs,
    })
    const b = bonus.get(c.id)
    const reasons: Array<{ code: string, value?: string | null }> = [...(b?.reasons || []).map(code => ({ code })), ...base.reasons]
    const seen = new Set<string>()
    return {
      c, score: base.score + (b?.amount || 0), resume: !!b?.resume,
      reasons: reasons.filter(r => !seen.has(r.code) && !!seen.add(r.code)),
    }
  }).sort((a, b) => b.score - a.score)

  const top = scored.slice(0, 15)
  const expSum = top.reduce((s, x) => s + Math.exp(x.score / 10), 0) || 1
  return top.slice(0, n).map(x => ({
    id: x.c.id,
    tmdbId: x.c.tmdbId ?? null,
    title: x.c.title,
    posterPath: x.c.posterPath ?? null,
    year: x.c.year ?? null,
    score: round(x.score, 1),
    share: round(Math.exp(x.score / 10) / expSum, 3),
    reasons: x.reasons.slice(0, 3),
    resume: x.resume,
  }))
}

// ── Persistence & resolution ─────────────────────────────────────────────────

export type PredictionRow = {
  id: string
  user_id: string
  created_at: number
  updated_at: number
  predicted_visit_at: number | null
  visit_confidence: number | null
  predicted_media: string | null
  status: 'pending' | 'resolved'
  actual_visit_at: number | null
  visit_error_min: number | null
  visit_hit: number | null
  actual_media_id: string | null
  actual_media_title: string | null
  movie_outcome: string | null
  assisted: number
  resolved_at: number | null
}

function getPending(userId: string): PredictionRow | undefined {
  return sqlite.prepare(`SELECT * FROM visit_predictions WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(userId) as PredictionRow | undefined
}

/** Create or refresh the user's pending prediction. A prediction whose visit already happened is frozen. */
export function upsertPendingPrediction(userId: string, nowMs = Date.now()): PredictionRow | null {
  const existing = getPending(userId)
  if (existing?.actual_visit_at) return existing

  const visit = predictNextVisit(userId, nowMs)
  const movies = predictMovies(userId, visit?.at ?? nowMs, 3)
  if (!visit && !movies.length) return existing ?? null

  if (existing) {
    sqlite.prepare(`UPDATE visit_predictions SET updated_at = ?, predicted_visit_at = ?, visit_confidence = ?, predicted_media = ? WHERE id = ?`)
      .run(nowMs, visit?.at ?? null, visit?.confidence ?? null, JSON.stringify(movies), existing.id)
    return getPending(userId) ?? null
  }
  sqlite.prepare(`INSERT INTO visit_predictions (id, user_id, created_at, updated_at, predicted_visit_at, visit_confidence, predicted_media, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
    .run(randomUUID(), userId, nowMs, nowMs, visit?.at ?? null, visit?.confidence ?? null, JSON.stringify(movies))
  return getPending(userId) ?? null
}

/** A new session started: record the real visit time against the pending prediction. */
export function recordVisit(userId: string, atMs = Date.now()) {
  const row = getPending(userId)
  if (!row || row.actual_visit_at) return
  const errorMin = row.predicted_visit_at != null ? (atMs - row.predicted_visit_at) / 60_000 : null
  sqlite.prepare(`UPDATE visit_predictions SET actual_visit_at = ?, visit_error_min = ?, visit_hit = ?, updated_at = ? WHERE id = ?`)
    .run(atMs, errorMin != null ? round(errorMin, 1) : null, errorMin != null ? (Math.abs(errorMin) <= VISIT_HIT_WINDOW_MIN ? 1 : 0) : null, atMs, row.id)
}

/** A film was started: compare it with what was predicted and open the next prediction. */
export function recordWatchStart(userId: string, mediaId: string, atMs = Date.now()) {
  const row = getPending(userId)
  // Only a watch inside a *new visit* counts (a visit was recorded after the prediction).
  if (!row || !row.actual_visit_at) return

  if (atMs - row.actual_visit_at > WATCH_AFTER_VISIT_MS) {
    resolve(row, { outcome: 'no_watch', mediaId: null, title: null, atMs })
    upsertPendingPrediction(userId, atMs)
    return
  }
  const m = sqlite.prepare(`SELECT id, title, media_type as mediaType, tmdb_id as tmdbId FROM media WHERE id = ?`).get(mediaId) as { id: string, title: string, mediaType: string, tmdbId: number | null } | undefined
  if (!m) return

  let outcome = 'other_type'
  if (m.mediaType === 'movie') {
    let predicted: PredictedMovie[] = []
    try { predicted = JSON.parse(row.predicted_media || '[]') } catch { predicted = [] }
    const same = (p: PredictedMovie) => p.id === m.id || (m.tmdbId != null && p.tmdbId === m.tmdbId)
    outcome = predicted[0] && same(predicted[0]) ? 'hit1' : predicted.some(same) ? 'hit3' : 'miss'
  }
  resolve(row, { outcome, mediaId: m.id, title: m.title, atMs })
  upsertPendingPrediction(userId, atMs)
}

function resolve(row: PredictionRow, r: { outcome: string, mediaId: string | null, title: string | null, atMs: number }) {
  sqlite.prepare(`UPDATE visit_predictions SET status = 'resolved', movie_outcome = ?, actual_media_id = ?, actual_media_title = ?, resolved_at = ?, updated_at = ? WHERE id = ?`)
    .run(r.outcome, r.mediaId, r.title, r.atMs, r.atMs, row.id)
}

/** Hourly job: close visits with no film, create / refresh predictions for everyone with some history. */
export function runPredictionJob(nowMs = Date.now()) {
  for (const row of sqlite.prepare(`SELECT * FROM visit_predictions WHERE status = 'pending' AND actual_visit_at IS NOT NULL AND actual_visit_at < ?`).all(nowMs - WATCH_AFTER_VISIT_MS) as PredictionRow[]) {
    resolve(row, { outcome: 'no_watch', mediaId: null, title: null, atMs: nowMs })
  }
  const users = sqlite.prepare(`SELECT id FROM users`).all() as Array<{ id: string }>
  for (const u of users) {
    try {
      const pending = getPending(u.id)
      if (pending && (pending.actual_visit_at || nowMs - pending.updated_at < REFRESH_AFTER_MS)) continue
      upsertPendingPrediction(u.id, nowMs)
    } catch (err) {
      console.error(`[Algorithm] prediction failed for ${u.id}:`, err)
    }
  }
}

// ── Predictive launch (optional) ─────────────────────────────────────────────

async function preheatStart(m: { id: string, filePath: string, runtime: number | null }) {
  try {
    await fs.access(m.filePath)
    const decision = MediaEngine.decide(await MediaEngine.probe(m.filePath))
    if (decision.mode === 'direct') return
    const pos = sqlite.prepare(`SELECT position FROM watch_progress WHERE media_id = ? ORDER BY updated_at DESC LIMIT 1`).get(m.id) as { position: number } | undefined
    const duration = m.runtime ? m.runtime * 60 : undefined
    if (pos && pos.position > 0) await MediaEngine.preheatSeek(m.filePath, m.id, pos.position, duration, true)
    else await MediaEngine.preheat(m.filePath, m.id, duration)
  } catch (err: any) {
    console.error(`[Algorithm] preheat failed for ${m.id}:`, err?.message)
  }
}

/**
 * Called when a user lands on the platform. When the feature is enabled, preheats
 * the start of the top films and returns the film to redirect to (or null).
 */
export async function getLaunchTarget(userId: string): Promise<{ mediaId: string, title: string } | null> {
  const settings = getAlgoSettings()
  if (!settings.predictiveLaunch) return null

  const nowMs = Date.now()
  const movies = predictMovies(userId, nowMs, 3)
  const playable: Array<PredictedMovie & { filePath: string, runtime: number | null }> = []
  for (const mv of movies) {
    const row = sqlite.prepare(`SELECT file_path as filePath, runtime FROM media WHERE id = ?`).get(mv.id) as { filePath: string, runtime: number | null } | undefined
    if (!row) continue
    try { await fs.access(row.filePath); playable.push({ ...mv, ...row }) } catch { /* file offline */ }
  }
  const top = playable[0]
  if (!top || !(top.resume || top.score >= 40)) return null

  // Mark the prediction as assisted: the redirect influences what the user watches,
  // so it is excluded from the "pure" accuracy and counted as acceptance instead.
  const publicList = playable.slice(0, 3).map(({ filePath: _f, runtime: _r, ...rest }) => rest)
  const pending = getPending(userId)
  if (pending) {
    sqlite.prepare(`UPDATE visit_predictions SET predicted_media = ?, assisted = 1, updated_at = ? WHERE id = ?`).run(JSON.stringify(publicList), nowMs, pending.id)
  } else {
    sqlite.prepare(`INSERT INTO visit_predictions (id, user_id, created_at, updated_at, predicted_media, status, assisted) VALUES (?, ?, ?, ?, ?, 'pending', 1)`)
      .run(randomUUID(), userId, nowMs, nowMs, JSON.stringify(publicList))
  }

  for (const mv of playable.slice(0, settings.preloadCount)) void preheatStart(mv)
  return { mediaId: top.id, title: top.title }
}

// ── Accuracy ─────────────────────────────────────────────────────────────────

export type Accuracy = {
  predictions: number
  visit: { n: number, hitPct: number | null, within24hPct: number | null, avgErrorMin: number | null }
  film: { n: number, top1Pct: number | null, top3Pct: number | null }
  assisted: { n: number, acceptedPct: number | null }
  /** Mean of the visit hit rate and the film top-3 rate (null until both exist). */
  overallPct: number | null
}

export function computeAccuracy(userId?: string): Accuracy {
  const rows = sqlite.prepare(`
    SELECT visit_hit, visit_error_min, movie_outcome, assisted FROM visit_predictions
    WHERE status = 'resolved' ${userId ? 'AND user_id = ?' : ''}
  `).all(...(userId ? [userId] : [])) as Array<{ visit_hit: number | null, visit_error_min: number | null, movie_outcome: string | null, assisted: number }>

  const visitRows = rows.filter(r => r.visit_hit != null)
  const filmRows = rows.filter(r => !r.assisted && (r.movie_outcome === 'hit1' || r.movie_outcome === 'hit3' || r.movie_outcome === 'miss'))
  const assistedRows = rows.filter(r => r.assisted && (r.movie_outcome === 'hit1' || r.movie_outcome === 'hit3' || r.movie_outcome === 'miss'))
  const pct = (a: number, b: number) => b ? round(a / b * 100, 1) : null

  const visitHit = pct(visitRows.filter(r => r.visit_hit === 1).length, visitRows.length)
  const top3 = pct(filmRows.filter(r => r.movie_outcome !== 'miss').length, filmRows.length)
  return {
    predictions: rows.length,
    visit: {
      n: visitRows.length,
      hitPct: visitHit,
      within24hPct: pct(visitRows.filter(r => Math.abs(r.visit_error_min ?? Infinity) <= 24 * 60).length, visitRows.length),
      avgErrorMin: visitRows.length ? round(visitRows.reduce((s, r) => s + Math.abs(r.visit_error_min ?? 0), 0) / visitRows.length, 0) : null,
    },
    film: {
      n: filmRows.length,
      top1Pct: pct(filmRows.filter(r => r.movie_outcome === 'hit1').length, filmRows.length),
      top3Pct: top3,
    },
    assisted: { n: assistedRows.length, acceptedPct: pct(assistedRows.filter(r => r.movie_outcome === 'hit1').length, assistedRows.length) },
    overallPct: visitHit != null && top3 != null ? round((visitHit + top3) / 2, 1) : (visitHit ?? top3),
  }
}

function round(v: number, p = 2) {
  const f = 10 ** p
  return Math.round(v * f) / f
}
