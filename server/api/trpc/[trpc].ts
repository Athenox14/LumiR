import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '../../trpc/routers'
import { createContext } from '../../trpc/context'
import { serverAutoReport } from '../../utils/autoReport'

// tRPC error codes that are intentional business-logic responses —
// they should be logged as warnings, not errors, and never auto-reported.
const EXPECTED_CODES = new Set([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_SUPPORTED',
  'TOO_MANY_REQUESTS',
  'BAD_REQUEST',
  'PRECONDITION_FAILED',
])

export default defineEventHandler(async (event) => {
  const response = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: toWebRequest(event),
    router: appRouter,
    createContext: () => createContext(event),
    onError: ({ error, path }) => {
      if (EXPECTED_CODES.has(error.code)) {
        // Expected — log as warning, not an error
        console.warn(`tRPC ${error.code} on ${path}: ${error.message}`)
        return
      }

      // Unexpected server error — log and auto-report
      console.error(`tRPC error on ${path}:`, error)
      serverAutoReport({
        title: `${error.code} on ${path}: ${error.message}`,
        description: `An unexpected tRPC error occurred on \`${path}\`.\n\n**Code:** ${error.code}\n**Message:** ${error.message}`,
        stack: error.stack,
      })
    },
  })

  return response
})
