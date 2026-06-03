/**
 * Per-title aggregated playback statistics (cross-user, anonymous).
 *
 * These power *title-level* recommendation signals that are independent of any
 * single user's taste — they describe how the whole audience behaves with a
 * title:
 *   - abandonment curve (at which normalized position people drop off)
 *   - effective completion (share of plays watched past 75%)
 *   - sessions needed to finish (binge-ability)
 *   - impression / hover click-through (does showing it lead to opens?)
 *
 * Uses the synchronous better-sqlite3 handle directly (fast, fire-and-forget
 * from the analytics pipeline).
 */
import { sqlite } from '../db'

type Stmt = ReturnType<typeof sqlite.prepare>

// Statements are prepared lazily (and memoized) so this module can be imported
// before initializeDatabase() has created the media_stats table.
const stmtCache = new Map<string, Stmt>()
function stmt(sql: string): Stmt {
  let s = stmtCache.get(sql)
  if (!s) { s = sqlite.prepare(sql); stmtCache.set(sql, s) }
  return s
}

function ensureRow(mediaId: string) {
  stmt(`INSERT INTO media_stats (media_id, updated_at) VALUES (?, ?) ON CONFLICT(media_id) DO NOTHING`)
    .run(mediaId, Date.now())
}

function bump(mediaId: string, column: string, amount = 1) {
  if (!mediaId) return
  ensureRow(mediaId)
  // Column name is from a fixed internal allow-list (never user input).
  stmt(`UPDATE media_stats SET ${column} = ${column} + ?, updated_at = ? WHERE media_id = ?`)
    .run(amount, Date.now(), mediaId)
}

export function recordImpression(mediaId: string | null | undefined) {
  if (mediaId) bump(mediaId, 'impressions')
}

export function recordHoverNoOpen(mediaId: string | null | undefined) {
  if (mediaId) bump(mediaId, 'hover_no_open')
}

export function recordDetailOpen(mediaId: string | null | undefined) {
  if (mediaId) bump(mediaId, 'detail_opens')
}

export function recordPlay(mediaId: string | null | undefined) {
  if (mediaId) bump(mediaId, 'plays')
}

export function recordAbandon(mediaId: string | null | undefined, positionRatio: number) {
  if (!mediaId) return
  ensureRow(mediaId)
  const ratio = Math.max(0, Math.min(0.999, Number(positionRatio) || 0))
  const decile = Math.floor(ratio * 10) // 0..9
  let buckets: number[]
  try {
    const row = stmt('SELECT abandon_buckets as b FROM media_stats WHERE media_id = ?').get(mediaId) as any
    buckets = JSON.parse(row?.b || '[0,0,0,0,0,0,0,0,0,0]')
    if (!Array.isArray(buckets) || buckets.length !== 10) buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  } catch {
    buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  }
  buckets[decile] = (buckets[decile] || 0) + 1
  stmt('UPDATE media_stats SET abandon_buckets = ?, abandons = abandons + 1, updated_at = ? WHERE media_id = ?')
    .run(JSON.stringify(buckets), Date.now(), mediaId)
}

export function recordComplete(
  mediaId: string | null | undefined,
  opts: { positionRatio?: number; sessionsToFinish?: number },
) {
  if (!mediaId) return
  ensureRow(mediaId)
  const ratio = Number(opts.positionRatio) || 1
  const effective = ratio >= 0.75 ? 1 : 0
  const sessions = Math.max(1, Math.round(Number(opts.sessionsToFinish) || 1))
  sqlite.prepare(`
    UPDATE media_stats
       SET completes = completes + 1,
           effective_completes = effective_completes + ?,
           sessions_to_finish_total = sessions_to_finish_total + ?,
           finishers = finishers + 1,
           updated_at = ?
     WHERE media_id = ?
  `).run(effective, sessions, Date.now(), mediaId)
}

/** Mark an effective (>75%) watch that did not reach the formal "complete" event. */
export function recordEffectiveCompletion(mediaId: string | null | undefined) {
  if (mediaId) bump(mediaId, 'effective_completes')
}

export type MediaStatsRow = {
  mediaId: string
  impressions: number
  hoverNoOpen: number
  detailOpens: number
  plays: number
  completes: number
  effectiveCompletes: number
  abandons: number
  abandonBuckets: number[]
  sessionsToFinishTotal: number
  finishers: number
}

// Materialized cache of ALL media_stats, refreshed on a timer. Reads in the
// recommendation hot path hit this map instead of SQLite on every request.
let statsCache: { at: number; map: Map<string, MediaStatsRow> } | null = null
const STATS_CACHE_TTL = 60_000

function loadAllStats(): Map<string, MediaStatsRow> {
  const map = new Map<string, MediaStatsRow>()
  const rows = stmt(`
    SELECT media_id as mediaId, impressions, hover_no_open as hoverNoOpen, detail_opens as detailOpens,
           plays, completes, effective_completes as effectiveCompletes, abandons,
           abandon_buckets as abandonBuckets, sessions_to_finish_total as sessionsToFinishTotal, finishers
    FROM media_stats
  `).all() as any[]
  for (const r of rows) {
    let buckets: number[] = []
    try { buckets = JSON.parse(r.abandonBuckets || '[]') } catch { buckets = [] }
    map.set(r.mediaId, { ...r, abandonBuckets: Array.isArray(buckets) ? buckets : [] })
  }
  return map
}

/** Cached snapshot of every title's stats (≤ STATS_CACHE_TTL stale). */
export function getAllMediaStatsCached(): Map<string, MediaStatsRow> {
  if (statsCache && Date.now() - statsCache.at < STATS_CACHE_TTL) return statsCache.map
  let map: Map<string, MediaStatsRow>
  try { map = loadAllStats() } catch { map = statsCache?.map ?? new Map() }
  statsCache = { at: Date.now(), map }
  return map
}

export function getMediaStats(mediaIds: string[]): Map<string, MediaStatsRow> {
  const out = new Map<string, MediaStatsRow>()
  if (!mediaIds.length) return out
  const placeholders = mediaIds.map(() => '?').join(',')
  const rows = sqlite.prepare(`
    SELECT media_id as mediaId, impressions, hover_no_open as hoverNoOpen, detail_opens as detailOpens,
           plays, completes, effective_completes as effectiveCompletes, abandons,
           abandon_buckets as abandonBuckets, sessions_to_finish_total as sessionsToFinishTotal,
           finishers
    FROM media_stats WHERE media_id IN (${placeholders})
  `).all(...mediaIds) as any[]
  for (const r of rows) {
    let buckets: number[] = []
    try { buckets = JSON.parse(r.abandonBuckets || '[]') } catch { buckets = [] }
    out.set(r.mediaId, { ...r, abandonBuckets: Array.isArray(buckets) ? buckets : [] })
  }
  return out
}

/**
 * Derive a title-quality modifier (roughly -8..+10) from aggregated stats.
 * Returns 0 when there isn't enough data to be meaningful (cold-start safe).
 */
export function mediaQualityModifier(stats: MediaStatsRow | undefined): number {
  if (!stats) return 0
  let mod = 0

  // Effective completion rate (watched > 75%) — the single strongest title signal.
  if (stats.plays >= 3) {
    const effRate = stats.effectiveCompletes / stats.plays
    mod += (effRate - 0.5) * 12 // -6..+6 around a 50% baseline
  }

  // Early-abandon penalty: share of abandons that happen in the first 20%.
  const totalAbandon = stats.abandonBuckets.reduce((a, b) => a + b, 0)
  if (totalAbandon >= 3) {
    const early = (stats.abandonBuckets[0] || 0) + (stats.abandonBuckets[1] || 0)
    const earlyRate = early / totalAbandon
    mod -= earlyRate * 5 // up to -5 for titles people bail on immediately
  }

  // Impression → open click-through: shown a lot but rarely opened = fatigue.
  if (stats.impressions >= 20) {
    const ctr = stats.detailOpens / stats.impressions
    if (ctr < 0.02) mod -= 3
    else if (ctr > 0.15) mod += 2
  }

  // Hover-without-open: strong hesitation/negative interest signal.
  if (stats.hoverNoOpen >= 10 && stats.detailOpens === 0) mod -= 2

  // Binge-ability: titles finished in few sessions get a small nudge.
  if (stats.finishers >= 3) {
    const avgSessions = stats.sessionsToFinishTotal / stats.finishers
    if (avgSessions <= 1.3) mod += 1.5
  }

  return mod
}
