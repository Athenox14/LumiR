import { z } from 'zod'
import { router, protectedProcedure, adminProcedure } from '../trpc'
import { db } from '../../db'
import { userEvents, userProfiles, users } from '../../db/schema'
import { processEvent } from '../../utils/analyticsEngine'
import { eq } from 'drizzle-orm'

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
})
