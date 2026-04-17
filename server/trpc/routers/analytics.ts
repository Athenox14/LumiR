import { z } from 'zod'
import { z } from 'zod'
import { router, protectedProcedure, adminProcedure } from '../trpc'
import { db } from '../../db'
import { userEvents, userProfiles, users } from '../../db/schema'
import { processEvent } from '../../utils/analyticsEngine'
import { eq } from 'drizzle-orm'
import { getActiveUsers } from '../../utils/activityTracker'

export const analyticsRouter = router({
  logEvent: protectedProcedure
    .input(z.object({
      type: z.string(),
      mediaId: z.string().optional().nullable(),
      metadata: z.record(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.insert(userEvents).values({
        userId: ctx.user.id,
        ...input,
        mediaId: input.mediaId || null,
      })
      processEvent(ctx.user.id, input).catch(console.error)
      return { success: true }
    }),

  getProfiles: adminProcedure.query(async () => {
    return await db.select({
      userId: userProfiles.userId,
      email: users.email,
      scores: userProfiles.scores,
    })
    .from(userProfiles)
    .leftJoin(users, eq(userProfiles.userId, users.id))
  }),

  updateProfileScore: adminProcedure
    .input(z.object({ userId: z.string(), genre: z.string(), score: z.number() }))
    .mutation(async ({ input }) => {
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, input.userId))
      if (!profile) throw new Error('Profile not found')
      const scores = profile.scores || {}
      scores[input.genre] = input.score
      await db.update(userProfiles).set({ scores }).where(eq(userProfiles.userId, input.userId))
      return { success: true }
    }),

  getActiveSessions: adminProcedure.query(async () => {
    const active = getActiveUsers()
    return await Promise.all(active.map(async (a) => {
      const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, a.userId))
      return {
        sessionId: a.userId,
        email: u?.email || 'Unknown',
        currentPage: 'N/A'
      }
    }))
  }),

  killSession: adminProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      return { success: true }
    }),
})

      return { success: true }
    }),
})
