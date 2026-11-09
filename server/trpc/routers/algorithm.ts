import { z } from 'zod'
import { router, adminProcedure, protectedProcedure } from '../trpc'
import { sqlite } from '../../db'
import {
  computeAccuracy, getAlgoSettings, getLaunchTarget, getVisitProfile,
  predictMovies, predictNextVisit, upsertPendingPrediction, type PredictionRow,
} from '../../utils/visitPredictor'

function setSetting(key: string, value: unknown) {
  sqlite.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), Math.floor(Date.now() / 1000))
}

function parseMovies(raw: string | null) {
  try { return JSON.parse(raw || '[]') } catch { return [] }
}

function count(sql: string, userId: string): number {
  return (sqlite.prepare(sql).get(userId) as { n: number } | undefined)?.n ?? 0
}

export const algorithmRouter = router({
  // Whole admin page in one call: settings, global accuracy and one entry per user.
  overview: adminProcedure.query(() => {
    const now = Date.now()
    const users = sqlite.prepare(`SELECT id, email, display_name as displayName, role FROM users ORDER BY created_at ASC`).all() as Array<{ id: string, email: string, displayName: string, role: string }>

    const entries = users.map((u) => {
      const stored = sqlite.prepare(`SELECT * FROM visit_predictions WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(u.id) as PredictionRow | undefined
      // Not stored yet (first run): compute a live preview without persisting it.
      const live = !stored
      const visit = live ? predictNextVisit(u.id, now) : null
      const prediction = stored
        ? {
            live: false,
            visitAt: stored.predicted_visit_at,
            visitConfidence: stored.visit_confidence,
            movies: parseMovies(stored.predicted_media),
            assisted: !!stored.assisted,
            visitedAt: stored.actual_visit_at,
            updatedAt: stored.updated_at,
          }
        : {
            live: true,
            visitAt: visit?.at ?? null,
            visitConfidence: visit?.confidence ?? null,
            movies: predictMovies(u.id, visit?.at ?? now, 3),
            assisted: false,
            visitedAt: null,
            updatedAt: now,
          }

      const recent = (sqlite.prepare(`
        SELECT predicted_visit_at as predictedVisitAt, actual_visit_at as actualVisitAt, visit_error_min as visitErrorMin,
               visit_hit as visitHit, predicted_media as predictedMedia, actual_media_title as actualMediaTitle,
               movie_outcome as movieOutcome, assisted, resolved_at as resolvedAt
        FROM visit_predictions WHERE user_id = ? AND status = 'resolved' ORDER BY resolved_at DESC LIMIT 8
      `).all(u.id) as any[]).map(r => ({ ...r, predictedMedia: parseMovies(r.predictedMedia) }))

      return {
        ...u,
        visitProfile: getVisitProfile(u.id, now),
        stats: {
          completed: count(`SELECT COUNT(*) as n FROM watch_progress WHERE user_id = ? AND completed = 1`, u.id),
          inProgress: count(`SELECT COUNT(*) as n FROM watch_progress WHERE user_id = ? AND completed = 0 AND position > 30`, u.id),
          likes: count(`SELECT COUNT(*) as n FROM media_ratings WHERE user_id = ? AND rating = 1`, u.id),
          dislikes: count(`SELECT COUNT(*) as n FROM media_ratings WHERE user_id = ? AND rating = -1`, u.id),
          watchlist: count(`SELECT COUNT(*) as n FROM watchlist WHERE user_id = ?`, u.id),
          events: count(`SELECT COUNT(*) as n FROM user_events WHERE user_id = ?`, u.id),
        },
        prediction,
        accuracy: computeAccuracy(u.id),
        recent,
      }
    })

    return {
      settings: getAlgoSettings(),
      accuracy: computeAccuracy(),
      users: entries,
    }
  }),

  setSettings: adminProcedure
    .input(z.object({
      predictiveLaunch: z.boolean().optional(),
      preloadCount: z.number().int().min(1).max(3).optional(),
    }))
    .mutation(({ input }) => {
      if (input.predictiveLaunch !== undefined) setSetting('algoPredictiveLaunch', input.predictiveLaunch)
      if (input.preloadCount !== undefined) setSetting('algoPreloadCount', input.preloadCount)
      return getAlgoSettings()
    }),

  // Recompute the pending prediction of one user (or everyone).
  refresh: adminProcedure
    .input(z.object({ userId: z.string().optional() }).optional())
    .mutation(({ input }) => {
      const ids = input?.userId
        ? [input.userId]
        : (sqlite.prepare(`SELECT id FROM users`).all() as Array<{ id: string }>).map(u => u.id)
      for (const id of ids) upsertPendingPrediction(id)
      return { success: true }
    }),

  // Called by the client when the user lands on the platform (no-op unless enabled).
  launchTarget: protectedProcedure.mutation(async ({ ctx }) => {
    return await getLaunchTarget(ctx.user.id)
  }),
})
