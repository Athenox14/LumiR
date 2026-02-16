import { z } from 'zod'
import { router, publicProcedure, adminProcedure, protectedProcedure } from '../trpc'
import { db } from '../../db'
import { settings } from '../../db/schema'
import { eq, inArray } from 'drizzle-orm'

export const settingsRouter = router({
  // Get a single setting
  get: protectedProcedure
    .input(z.string())
    .query(async ({ input }) => {
      const [setting] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, input))
        .limit(1)

      return setting?.value ?? null
    }),

  // Get multiple settings
  getMany: protectedProcedure
    .input(z.array(z.string()))
    .query(async ({ input }) => {
      const results = await db
        .select()
        .from(settings)

      const filtered = results.filter(s => input.includes(s.key))
      const settingsMap: Record<string, unknown> = {}

      filtered.forEach(s => {
        settingsMap[s.key] = s.value
      })

      return settingsMap
    }),

  // Get all settings (admin only)
  getAll: adminProcedure.query(async () => {
    const allSettings = await db.select().from(settings)

    const settingsMap: Record<string, unknown> = {}
    allSettings.forEach(s => {
      settingsMap[s.key] = s.value
    })

    return settingsMap
  }),

  // Set a single setting (admin only)
  set: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.unknown(),
    }))
    .mutation(async ({ input }) => {
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, input.key))
        .limit(1)

      if (existing.length > 0) {
        await db
          .update(settings)
          .set({
            value: input.value as string,
            updatedAt: new Date(),
          })
          .where(eq(settings.key, input.key))
      } else {
        await db.insert(settings).values({
          key: input.key,
          value: input.value as string,
          updatedAt: new Date(),
        })
      }

      return { success: true }
    }),

  // Set multiple settings (admin only)
  setMany: adminProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ input }) => {
      for (const [key, value] of Object.entries(input)) {
        const existing = await db
          .select()
          .from(settings)
          .where(eq(settings.key, key))
          .limit(1)

        if (existing.length > 0) {
          await db
            .update(settings)
            .set({
              value: value as string,
              updatedAt: new Date(),
            })
            .where(eq(settings.key, key))
        } else {
          await db.insert(settings).values({
            key,
            value: value as string,
            updatedAt: new Date(),
          })
        }
      }

      return { success: true }
    }),

  // Delete a setting (admin only)
  delete: adminProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      await db.delete(settings).where(eq(settings.key, input))
      return { success: true }
    }),

  // Get public settings (accessible without login)
  getPublic: publicProcedure.query(async () => {
    const publicKeys = ['appName', 'logoUrl', 'catalogEnabled', 'downloadsEnabled', 'registrationEnabled']
    const results = await db.select().from(settings).where(inArray(settings.key, publicKeys))

    const settingsMap: Record<string, unknown> = {}
    results.forEach(s => {
      settingsMap[s.key] = s.value
    })

    return {
      appName: settingsMap.appName ?? null,
      logoUrl: settingsMap.logoUrl ?? null,
      catalogEnabled: settingsMap.catalogEnabled !== false,
      downloadsEnabled: settingsMap.downloadsEnabled !== false,
      registrationEnabled: settingsMap.registrationEnabled !== false,
    }
  }),
})
