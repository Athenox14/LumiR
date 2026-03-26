import { z } from 'zod'
import { router, protectedProcedure, adminProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db } from '../../db'
import { announcements } from '../../db/schema'
import { eq, desc } from 'drizzle-orm'

export const announcementsRouter = router({
  // Get active announcements (any authenticated user)
  getActive: protectedProcedure
    .query(async () => {
      return db
        .select()
        .from(announcements)
        .where(eq(announcements.active, true))
        .orderBy(desc(announcements.createdAt))
    }),

  // Get all announcements (admin only)
  getAll: adminProcedure
    .query(async () => {
      return db
        .select()
        .from(announcements)
        .orderBy(desc(announcements.createdAt))
    }),

  // Create announcement (admin only)
  create: adminProcedure
    .input(z.object({
      message: z.string().min(1),
      type: z.enum(['info', 'warning', 'success', 'error']).default('info'),
      dismissible: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const [created] = await db
        .insert(announcements)
        .values({
          message: input.message,
          type: input.type,
          dismissible: input.dismissible,
        })
        .returning()

      return created
    }),

  // Update announcement (admin only)
  update: adminProcedure
    .input(z.object({
      id: z.string(),
      message: z.string().min(1).optional(),
      type: z.enum(['info', 'warning', 'success', 'error']).optional(),
      active: z.boolean().optional(),
      dismissible: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input

      const [existing] = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, id))
        .limit(1)

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Announcement not found',
        })
      }

      const updates: Record<string, unknown> = {}
      if (fields.message !== undefined) updates.message = fields.message
      if (fields.type !== undefined) updates.type = fields.type
      if (fields.active !== undefined) updates.active = fields.active
      if (fields.dismissible !== undefined) updates.dismissible = fields.dismissible

      if (Object.keys(updates).length === 0) {
        return { success: true }
      }

      updates.updatedAt = new Date()

      await db
        .update(announcements)
        .set(updates)
        .where(eq(announcements.id, id))

      return { success: true }
    }),

  // Delete announcement (admin only)
  delete: adminProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, input.id))
        .limit(1)

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Announcement not found',
        })
      }

      await db.delete(announcements).where(eq(announcements.id, input.id))

      return { success: true }
    }),
})
