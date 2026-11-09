import { router } from '../trpc'
import { authRouter } from './auth'
import { mediaRouter } from './media'
import { usersRouter } from './users'
import { settingsRouter } from './settings'
import { libraryRouter } from './library'
import { announcementsRouter } from './announcements'
import { bugReportRouter } from './bugReport'
import { analyticsRouter } from './analytics'
import { algorithmRouter } from './algorithm'
import { getPluginTrpcRouters } from '../../utils/pluginRouters'

export const appRouter = router({
  auth: authRouter,
  media: mediaRouter,
  users: usersRouter,
  settings: settingsRouter,
  library: libraryRouter,
  announcements: announcementsRouter,
  bugReport: bugReportRouter,
  analytics: analyticsRouter,
  algorithm: algorithmRouter,
  ...getPluginTrpcRouters(),
})

export type AppRouter = typeof appRouter
