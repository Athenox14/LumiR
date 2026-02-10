import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '../../trpc/routers'
import { createContext } from '../../trpc/context'

export default defineEventHandler(async (event) => {
  const response = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: toWebRequest(event),
    router: appRouter,
    createContext: () => createContext(event),
    onError: ({ error, path }) => {
      console.error(`tRPC error on ${path}:`, error)
    },
  })

  return response
})
