import { z } from 'zod'
import { router, adminProcedure, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db, sqlite } from '../../db'
import { users } from '../../db/schema'
import { eq, ne, and, desc } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

export const usersRouter = router({
  // List all users (admin only)
  list: adminProcedure.query(async () => {
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        permissions: users.permissions,
        avatarUrl: users.avatarUrl,
        favoriteActorImage: users.favoriteActorImage,
        favoriteActorName: users.favoriteActorName,
        isProfilePublic: users.isProfilePublic,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))

    return allUsers
  }),

  // Get single user
  getById: adminProcedure
    .input(z.string())
    .query(async ({ input }) => {
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          permissions: users.permissions,
          avatarUrl: users.avatarUrl,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, input))
        .limit(1)

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        })
      }

      return user
    }),

  // Create new user (admin only)
  create: adminProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(8),
      displayName: z.string().min(2).max(50),
      role: z.enum(['admin', 'user']).default('user'),
      permissions: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Only super_admin can create admins
      if (input.role === 'admin' && ctx.user.role !== 'super_admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only super admins can create admin users',
        })
      }

      // Check if email already exists
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1)

      if (existing.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Email already registered',
        })
      }

      const passwordHash = await bcrypt.hash(input.password, 12)
      const userId = uuidv4()

      await db.insert(users).values({
        id: userId,
        email: input.email.toLowerCase(),
        passwordHash,
        displayName: input.displayName,
        role: input.role,
        permissions: input.permissions || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      return {
        id: userId,
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        role: input.role,
      }
    }),

  // Update user
  update: adminProcedure
    .input(z.object({
      id: z.string(),
      email: z.string().email().optional(),
      password: z.string().min(8).optional(),
      displayName: z.string().min(2).max(50).optional(),
      role: z.enum(['admin', 'user']).optional(),
      permissions: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input

      // Get target user
      const [targetUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1)

      if (!targetUser) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        })
      }

      // Can't modify super_admin
      if (targetUser.role === 'super_admin' && ctx.user.id !== targetUser.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot modify super admin user',
        })
      }

      // Only super_admin can change roles to admin
      if (updates.role === 'admin' && ctx.user.role !== 'super_admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only super admins can promote to admin',
        })
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (updates.email) {
        // Check if email is already taken by another user
        const existing = await db
          .select()
          .from(users)
          .where(and(eq(users.email, updates.email.toLowerCase()), ne(users.id, id)))
          .limit(1)

        if (existing.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Email already in use',
          })
        }
        updateData.email = updates.email.toLowerCase()
      }

      if (updates.password) {
        updateData.passwordHash = await bcrypt.hash(updates.password, 12)
      }

      if (updates.displayName) {
        updateData.displayName = updates.displayName
      }

      if (updates.role !== undefined) {
        updateData.role = updates.role
      }

      if (updates.permissions !== undefined) {
        updateData.permissions = updates.permissions
      }

      await db.update(users).set(updateData).where(eq(users.id, id))

      return { success: true }
    }),

  // Delete user
  delete: adminProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      // Get target user
      const [targetUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, input))
        .limit(1)

      if (!targetUser) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        })
      }

      // Can't delete super_admin
      if (targetUser.role === 'super_admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot delete super admin user',
        })
      }

      // Can't delete yourself
      if (targetUser.id === ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot delete your own account',
        })
      }

      // Only super_admin can delete admins
      if (targetUser.role === 'admin' && ctx.user.role !== 'super_admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only super admins can delete admin users',
        })
      }

      await db.delete(users).where(eq(users.id, input))

      return { success: true }
    }),

  // Impersonate user (login as another user)
  impersonate: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Can't impersonate yourself
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot impersonate yourself',
        })
      }

      // Find target user
      const [targetUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)

      if (!targetUser) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        })
      }

      // Only super_admin can impersonate admins/super_admins
      if ((targetUser.role === 'admin' || targetUser.role === 'super_admin') && ctx.user.role !== 'super_admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only super admins can impersonate admin users',
        })
      }

      // Can never impersonate another super_admin
      if (targetUser.role === 'super_admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot impersonate a super admin',
        })
      }

      // Set session as the target user (same pattern as auth login)
      await setUserSession(ctx.event, {
        user: {
          id: targetUser.id,
          email: targetUser.email,
          displayName: targetUser.displayName,
          role: targetUser.role,
          permissions: targetUser.permissions,
          bio: targetUser.bio,
          isProfilePublic: targetUser.isProfilePublic,
          showWatchedFilms: targetUser.showWatchedFilms,
          showLikedFilms: targetUser.showLikedFilms,
          favoriteActorId: targetUser.favoriteActorId,
          favoriteActorName: targetUser.favoriteActorName,
          favoriteActorImage: targetUser.favoriteActorImage,
        },
      })

      return { success: true }
    }),

  // ===== Public profile endpoints =====

  // Get public profile
  getPublicProfile: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [user] = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          bio: users.bio,
          isProfilePublic: users.isProfilePublic,
          showWatchedFilms: users.showWatchedFilms,
          showLikedFilms: users.showLikedFilms,
          favoriteActorId: users.favoriteActorId,
          favoriteActorName: users.favoriteActorName,
          favoriteActorImage: users.favoriteActorImage,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' })
      }

      // Allow viewing own profile or public profiles
      if (!user.isProfilePublic && input.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ce profil est privé' })
      }

      return user
    }),

  // Get user stats
  getUserStats: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Check access
      const [targetUser] = await db
        .select({ isProfilePublic: users.isProfilePublic })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)

      if (!targetUser || (!targetUser.isProfilePublic && input.userId !== ctx.user.id)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Accès refusé' })
      }

      // Use raw SQL for complex stats
      const stats = sqlite.prepare(`
        SELECT
          COUNT(CASE WHEN wp.completed = 1 THEN 1 END) as totalWatched,
          COALESCE(SUM(CASE WHEN wp.completed = 1 THEN wp.duration ELSE 0 END), 0) as totalSeconds,
          COUNT(*) as totalStarted
        FROM watch_progress wp
        WHERE wp.user_id = ?
      `).get(input.userId) as any

      // Top genres from completed watches
      const genreRows = sqlite.prepare(`
        SELECT m.genres
        FROM watch_progress wp
        JOIN media m ON m.id = wp.media_id
        WHERE wp.user_id = ? AND wp.completed = 1
      `).all(input.userId) as any[]

      const genreCounts = new Map<string, number>()
      for (const row of genreRows) {
        if (row.genres) {
          const genres = JSON.parse(row.genres) as string[]
          for (const g of genres) {
            genreCounts.set(g, (genreCounts.get(g) || 0) + 1)
          }
        }
      }

      const topGenres = Array.from(genreCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([genre]) => genre)

      const totalWatched = stats?.totalWatched || 0
      const totalHours = Math.round((stats?.totalSeconds || 0) / 3600)
      const completionRate = stats?.totalStarted > 0
        ? Math.round((totalWatched / stats.totalStarted) * 100)
        : 0

      return { totalWatched, totalHours, topGenres, completionRate }
    }),

  // Get watched films (for public profile)
  getWatchedFilms: protectedProcedure
    .input(z.object({
      userId: z.string(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      // Check access
      const [targetUser] = await db
        .select({ isProfilePublic: users.isProfilePublic, showWatchedFilms: users.showWatchedFilms })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)

      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      const isOwnProfile = input.userId === ctx.user.id
      if (!isOwnProfile && (!targetUser.isProfilePublic || !targetUser.showWatchedFilms)) {
        return []
      }

      const rows = sqlite.prepare(`
        SELECT
          m.id, m.title, m.poster_path as posterPath, m.year, m.rating, m.media_type as mediaType
        FROM watch_progress wp
        JOIN media m ON m.id = wp.media_id
        WHERE wp.user_id = ? AND wp.completed = 1
        GROUP BY COALESCE(m.tmdb_id, m.title)
        ORDER BY wp.updated_at DESC
        LIMIT ?
      `).all(input.userId, input.limit) as any[]

      return rows
    }),

  // Get liked films (for public profile)
  getLikedFilms: protectedProcedure
    .input(z.object({
      userId: z.string(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const [targetUser] = await db
        .select({ isProfilePublic: users.isProfilePublic, showLikedFilms: users.showLikedFilms })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)

      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      const isOwnProfile = input.userId === ctx.user.id
      if (!isOwnProfile && (!targetUser.isProfilePublic || !targetUser.showLikedFilms)) {
        return []
      }

      const rows = sqlite.prepare(`
        SELECT
          m.id, m.title, m.poster_path as posterPath, m.year, m.rating, m.media_type as mediaType
        FROM media_ratings mr
        JOIN media m ON m.id = mr.media_id
        WHERE mr.user_id = ? AND mr.rating = 1
        GROUP BY COALESCE(m.tmdb_id, m.title)
        ORDER BY mr.created_at DESC
        LIMIT ?
      `).all(input.userId, input.limit) as any[]

      return rows
    }),

})
