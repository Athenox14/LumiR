import { z } from 'zod'
import { router, protectedProcedure, adminProcedure } from '../trpc'
import { db } from '../../db'
import { userEvents, userProfiles, users } from '../../db/schema'
import { processEvent } from '../../utils/analyticsEngine'
import { eq } from 'drizzle-orm'
import { getActiveUsers, recordUserActivity, suppressUserForNextCheck } from '../../utils/activityTracker'

const jsonValueSchema: z.ZodTypeAny = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]))

export const analyticsRouter = router({
  logEvent: protectedProcedure
    .input(z.object({
      type: z.string(),
      mediaId: z.string().optional().nullable(),
      metadata: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.insert(userEvents).values({
        userId: ctx.user.id,
        ...input,
        mediaId: input.mediaId || null,
      })
      if (input.type === 'PAGE_VIEW') {
        recordUserActivity(ctx.user.id, typeof input.metadata?.path === 'string' ? input.metadata.path : null)
      }
      processEvent(ctx.user.id, input).catch(console.error)
      return { success: true }
    }),

  getProfiles: adminProcedure.query(async () => {
    return await db.select({
      userId: userProfiles.userId,
      email: users.email,
      scores: userProfiles.scores,
      profileData: userProfiles.profileData,
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
      const profileData = (profile.profileData && typeof profile.profileData === 'object') ? profile.profileData as Record<string, any> : {}
      const preferenceGenres = (profileData.preferences?.genreScores && typeof profileData.preferences.genreScores === 'object')
        ? profileData.preferences.genreScores
        : {}
      preferenceGenres[input.genre] = input.score
      await db.update(userProfiles).set({
        scores,
        profileData: {
          ...profileData,
          preferences: {
            ...(profileData.preferences || {}),
            genreScores: preferenceGenres,
          },
        },
      }).where(eq(userProfiles.userId, input.userId))
      return { success: true }
    }),

  updateProfileData: adminProcedure
    .input(z.object({
      userId: z.string(),
      scores: z.record(z.string(), z.number().finite()).optional(),
      profileData: z.record(z.string(), jsonValueSchema).optional(),
    }).refine(input => input.scores !== undefined || input.profileData !== undefined, {
      message: 'No profile payload provided',
    }))
    .mutation(async ({ input }) => {
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, input.userId))
      if (!profile) throw new Error('Profile not found')

      const nextScores = input.scores ?? (profile.scores || {})
      const nextProfileData = input.profileData ?? ((profile.profileData as Record<string, any> | null) || {})

      const payloadSize = JSON.stringify({ scores: nextScores, profileData: nextProfileData }).length
      if (payloadSize > 200_000) {
        throw new Error('Profile payload too large')
      }

      await db.update(userProfiles).set({
        scores: nextScores,
        profileData: nextProfileData,
        updatedAt: new Date(),
      }).where(eq(userProfiles.userId, input.userId))

      return { success: true }
    }),

  resetProfile: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      await db.update(userProfiles).set({
        scores: {},
        recentGenres: [],
        profileData: {},
        updatedAt: new Date(),
      }).where(eq(userProfiles.userId, input.userId))

      await db.delete(userEvents).where(eq(userEvents.userId, input.userId))
      return { success: true }
    }),

  getActiveSessions: adminProcedure.query(async () => {
    const active = getActiveUsers()
    return await Promise.all(active.map(async (a) => {
      const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, a.userId))
      return {
        userId: a.userId,
        email: u?.email || 'Unknown',
        currentPage: a.currentPage || 'Page inconnue',
        lastActive: a.lastActive,
      }
    }))
  }),

  suppressSession: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      suppressUserForNextCheck(input.userId)
      return { success: true }
    }),
})

