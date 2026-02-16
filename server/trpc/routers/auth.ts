import { z } from 'zod'
import { router, publicProcedure, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db } from '../../db'
import { users, settings } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

export const authRouter = router({
  // Register new user
  register: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(8),
      displayName: z.string().min(2).max(50),
    }))
    .mutation(async ({ input, ctx }) => {
      // Check if any users exist (first user becomes super_admin)
      const existingUsers = await db.select().from(users).limit(1)
      const isFirstUser = existingUsers.length === 0

      // Check if registration is enabled (skip for first user / setup)
      if (!isFirstUser) {
        const [regSetting] = await db.select().from(settings).where(eq(settings.key, 'registrationEnabled')).limit(1)
        if (regSetting?.value === false) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Registration is disabled' })
        }
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

      // Hash password
      const passwordHash = await bcrypt.hash(input.password, 12)

      // Create user
      const userId = uuidv4()
      const role = isFirstUser ? 'super_admin' : 'user'

      await db.insert(users).values({
        id: userId,
        email: input.email.toLowerCase(),
        passwordHash,
        displayName: input.displayName,
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Set session using nuxt-auth-utils
      await setUserSession(ctx.event, {
        user: {
          id: userId,
          email: input.email.toLowerCase(),
          displayName: input.displayName,
          role,
          permissions: null,
          bio: null,
          isProfilePublic: false,
          showWatchedFilms: false,
          showLikedFilms: false,
          favoriteActorId: null,
          favoriteActorName: null,
          favoriteActorImage: null,
        },
      })

      return {
        user: {
          id: userId,
          email: input.email.toLowerCase(),
          displayName: input.displayName,
          role,
        },
      }
    }),

  // Login (accepts email or display name)
  login: publicProcedure
    .input(z.object({
      identifier: z.string().min(1),
      password: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Find user by email (exact, lowered) or display name (accent-insensitive)
      const id = input.identifier.toLowerCase()
      const normalized = input.identifier.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

      const [user] = await db
        .select()
        .from(users)
        .where(sql`${users.email} = ${id} OR normalize(${users.displayName}) = ${normalized}`)
        .limit(1)

      if (!user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid credentials',
        })
      }

      // Verify password
      const validPassword = await bcrypt.compare(input.password, user.passwordHash)
      if (!validPassword) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid credentials',
        })
      }

      // Set session using nuxt-auth-utils
      await setUserSession(ctx.event, {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          permissions: user.permissions,
          bio: user.bio,
          isProfilePublic: user.isProfilePublic,
          showWatchedFilms: user.showWatchedFilms,
          showLikedFilms: user.showLikedFilms,
          favoriteActorId: user.favoriteActorId,
          favoriteActorName: user.favoriteActorName,
          favoriteActorImage: user.favoriteActorImage,
        },
      })

      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
      }
    }),

  // Logout
  logout: protectedProcedure
    .mutation(async ({ ctx }) => {
      await clearUserSession(ctx.event)
      return { success: true }
    }),

  // Get current user
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      return null
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        permissions: users.permissions,
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
      .where(eq(users.id, ctx.user.id))
      .limit(1)

    return user || null
  }),

  // Update profile
  updateProfile: protectedProcedure
    .input(z.object({
      displayName: z.string().min(2).max(50).optional(),
      currentPassword: z.string().optional(),
      newPassword: z.string().min(8).optional(),
      bio: z.string().max(500).optional(),
      isProfilePublic: z.boolean().optional(),
      showWatchedFilms: z.boolean().optional(),
      showLikedFilms: z.boolean().optional(),
      favoriteActorId: z.number().nullish(),
      favoriteActorName: z.string().nullish(),
      favoriteActorImage: z.string().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (input.displayName) {
        updates.displayName = input.displayName
      }

      if (input.bio !== undefined) updates.bio = input.bio || null
      if (input.isProfilePublic !== undefined) updates.isProfilePublic = input.isProfilePublic
      if (input.showWatchedFilms !== undefined) updates.showWatchedFilms = input.showWatchedFilms
      if (input.showLikedFilms !== undefined) updates.showLikedFilms = input.showLikedFilms
      if (input.favoriteActorId !== undefined) updates.favoriteActorId = input.favoriteActorId
      if (input.favoriteActorName !== undefined) updates.favoriteActorName = input.favoriteActorName
      if (input.favoriteActorImage !== undefined) {
        updates.favoriteActorImage = input.favoriteActorImage
        // Also update avatarUrl for backward compatibility
        updates.avatarUrl = input.favoriteActorImage
      }

      if (input.newPassword) {
        if (!input.currentPassword) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Current password is required to set a new password',
          })
        }

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1)

        const validPassword = await bcrypt.compare(input.currentPassword, user.passwordHash)
        if (!validPassword) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Current password is incorrect',
          })
        }

        updates.passwordHash = await bcrypt.hash(input.newPassword, 12)
      }

      await db.update(users).set(updates).where(eq(users.id, ctx.user.id))

      // Refresh session with updated profile data
      const [updatedUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1)

      if (updatedUser) {
        await setUserSession(ctx.event, {
          user: {
            id: updatedUser.id,
            email: updatedUser.email,
            displayName: updatedUser.displayName,
            role: updatedUser.role,
            permissions: updatedUser.permissions,
            bio: updatedUser.bio,
            isProfilePublic: updatedUser.isProfilePublic,
            showWatchedFilms: updatedUser.showWatchedFilms,
            showLikedFilms: updatedUser.showLikedFilms,
            favoriteActorId: updatedUser.favoriteActorId,
            favoriteActorName: updatedUser.favoriteActorName,
            favoriteActorImage: updatedUser.favoriteActorImage,
          },
        })
      }

      return { success: true }
    }),

  // Check if setup is needed (no users exist)
  needsSetup: publicProcedure.query(async () => {
    const existingUsers = await db.select().from(users).limit(1)
    return existingUsers.length === 0
  }),
})
