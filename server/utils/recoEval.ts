/**
 * Offline evaluation harness for the recommender.
 *
 * Instead of hand-tuning the scoring weights by feel, this replays each user's
 * known positives (titles they liked or completed) and measures how well the
 * scorer ranks them against a pool of distractor titles. Reports the standard
 * ranking metrics: precision@k, recall@k, NDCG@k and MRR.
 *
 * Caveat: profiles are not rebuilt to exclude the held-out items, so absolute
 * numbers are optimistic. The value is *relative* — run before/after a weight
 * change to see whether ranking improved. Exposed via the admin analytics router
 * (`analytics.evaluateReco`).
 */
import { sqlite, db } from '../db'
import { userProfiles } from '../db/schema'
import { eq } from 'drizzle-orm'
import { calculateUserPreferences } from './preferences'
import { getAllMediaStatsCached, mediaQualityModifier } from './mediaStatsEngine'
import { scoreCandidate } from './recoScoring'

export type EvalResult = {
  k: number
  usersEvaluated: number
  totalPositives: number
  precisionAtK: number
  recallAtK: number
  ndcgAtK: number
  mrr: number
  perUser: Array<{ userId: string; positives: number; precisionAtK: number; ndcgAtK: number; mrr: number }>
}

const CANDIDATE_COLS = `m.id, m.title, m.year, m.rating, m.runtime, m.cast, m.genres,
  m.keywords, m.director, m.composer, m.certification, m.popularity,
  m.collection_name as collectionName`

function dcg(relevances: number[]): number {
  return relevances.reduce((acc, rel, i) => acc + rel / Math.log2(i + 2), 0)
}

export async function evaluateRecommendations(opts?: { k?: number; maxUsers?: number; distractors?: number }): Promise<EvalResult> {
  const k = opts?.k ?? 10
  const maxUsers = opts?.maxUsers ?? 50
  const distractorCount = opts?.distractors ?? 400
  const now = new Date()
  const statsMap = getAllMediaStatsCached()

  // Distractor universe: a stable sample of reasonably-rated titles.
  const distractors = sqlite.prepare(`
    SELECT ${CANDIDATE_COLS} FROM media m
    GROUP BY COALESCE(m.tmdb_id, m.title)
    ORDER BY COALESCE(m.popularity, 0) DESC, m.rating DESC NULLS LAST
    LIMIT ?
  `).all(distractorCount) as any[]

  // Users with enough positive signal to evaluate.
  const users = sqlite.prepare(`
    SELECT user_id as userId, COUNT(*) as n FROM (
      SELECT user_id, media_id FROM watch_progress WHERE completed = 1
      UNION
      SELECT user_id, media_id FROM media_ratings WHERE rating = 1
    ) GROUP BY user_id HAVING n >= 3
    ORDER BY n DESC LIMIT ?
  `).all(maxUsers) as Array<{ userId: string; n: number }>

  const perUser: EvalResult['perUser'] = []
  let sumPrecision = 0, sumRecall = 0, sumNdcg = 0, sumMrr = 0, totalPositives = 0

  for (const u of users) {
    const positiveRows = sqlite.prepare(`
      SELECT ${CANDIDATE_COLS} FROM media m WHERE m.id IN (
        SELECT media_id FROM watch_progress WHERE user_id = ? AND completed = 1
        UNION
        SELECT media_id FROM media_ratings WHERE user_id = ? AND rating = 1
      )
    `).all(u.userId, u.userId) as any[]
    if (positiveRows.length < 3) continue
    const positiveIds = new Set(positiveRows.map(r => r.id))

    const [profile] = await db.select({ profileData: userProfiles.profileData }).from(userProfiles).where(eq(userProfiles.userId, u.userId))
    const profileData = profile?.profileData as Record<string, any> | null | undefined
    const preferences = calculateUserPreferences(u.userId)

    // Rank positives among distractors (distractors that are themselves positive
    // are de-duplicated, not treated as negatives).
    const pool = [...positiveRows, ...distractors.filter(d => !positiveIds.has(d.id))]
    const ranked = pool
      .map(c => ({ id: c.id, score: scoreCandidate(c, preferences, profileData, { now, statsModifier: mediaQualityModifier(statsMap.get(c.id)) }).score }))
      .sort((a, b) => b.score - a.score)

    const topK = ranked.slice(0, k)
    const hits = topK.filter(r => positiveIds.has(r.id)).length
    const precision = hits / k
    const recall = hits / Math.min(k, positiveIds.size)
    const relevances = topK.map(r => (positiveIds.has(r.id) ? 1 : 0))
    const idealRel = Array(Math.min(k, positiveIds.size)).fill(1)
    const ndcg = dcg(idealRel) > 0 ? dcg(relevances) / dcg(idealRel) : 0
    const firstHit = ranked.findIndex(r => positiveIds.has(r.id))
    const mrr = firstHit >= 0 ? 1 / (firstHit + 1) : 0

    perUser.push({ userId: u.userId, positives: positiveIds.size, precisionAtK: round(precision), ndcgAtK: round(ndcg), mrr: round(mrr) })
    sumPrecision += precision; sumRecall += recall; sumNdcg += ndcg; sumMrr += mrr; totalPositives += positiveIds.size
  }

  const n = perUser.length || 1
  return {
    k,
    usersEvaluated: perUser.length,
    totalPositives,
    precisionAtK: round(sumPrecision / n),
    recallAtK: round(sumRecall / n),
    ndcgAtK: round(sumNdcg / n),
    mrr: round(sumMrr / n),
    perUser,
  }
}

function round(v: number) { return Number(v.toFixed(4)) }
