import { router } from '../trpc'
import { authRouter } from './auth'
import { mediaRouter } from './media'
import { usersRouter } from './users'
import { settingsRouter } from './settings'
import { libraryRouter } from './library'
import { catalogRouter } from './catalog'
import { announcementsRouter } from './announcements'
import { bugReportRouter } from './bugReport'

export const appRouter = router({
  auth: authRouter,
  media: mediaRouter,
  users: usersRouter,
  settings: settingsRouter,
  library: libraryRouter,
  catalog: catalogRouter,
  announcements: announcementsRouter,
  bugReport: bugReportRouter,
})

export type AppRouter = typeof appRouter
