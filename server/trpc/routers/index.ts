import { router } from '../trpc'
import { authRouter } from './auth'
import { mediaRouter } from './media'
import { usersRouter } from './users'
import { settingsRouter } from './settings'
import { libraryRouter } from './library'
import { catalogRouter } from './catalog'

export const appRouter = router({
  auth: authRouter,
  media: mediaRouter,
  users: usersRouter,
  settings: settingsRouter,
  library: libraryRouter,
  catalog: catalogRouter,
})

export type AppRouter = typeof appRouter
