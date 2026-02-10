import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const middleware = t.middleware

// Auth middleware
const isAuthenticated = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    })
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  })
})

// Admin middleware
const isAdmin = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    })
  }
  if (ctx.user.role !== 'admin' && ctx.user.role !== 'super_admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You must be an admin to perform this action',
    })
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  })
})

// Super admin middleware
const isSuperAdmin = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    })
  }
  if (ctx.user.role !== 'super_admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You must be a super admin to perform this action',
    })
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  })
})

export const protectedProcedure = publicProcedure.use(isAuthenticated)
export const adminProcedure = publicProcedure.use(isAdmin)
export const superAdminProcedure = publicProcedure.use(isSuperAdmin)
