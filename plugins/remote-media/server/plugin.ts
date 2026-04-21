import { catalogRouter } from '../../../server/trpc/routers/catalog'

export const trpcRouters = {
  remoteMedia: catalogRouter,
}
