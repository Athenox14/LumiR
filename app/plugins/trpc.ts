import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../server/trpc/routers'

export default defineNuxtPlugin(() => {
  // During SSR, Node.js fetch() doesn't support relative URLs
  // so we need the absolute origin, plus we forward cookies for auth
  let ssrBaseUrl = ''
  let ssrCookie = ''

  if (import.meta.server) {
    ssrCookie = useRequestHeaders(['cookie']).cookie || ''
    try {
      ssrBaseUrl = useRequestURL().origin
    } catch {
      ssrBaseUrl = 'http://localhost:3000'
    }
  }

  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: import.meta.server ? `${ssrBaseUrl}/api/trpc` : '/api/trpc',
        headers() {
          if (import.meta.server && ssrCookie) {
            return { cookie: ssrCookie }
          }
          return {}
        },
      }),
    ],
  })

  return {
    provide: {
      trpc: client,
    },
  }
})

declare module '#app' {
  interface NuxtApp {
    $trpc: ReturnType<typeof createTRPCClient<AppRouter>>
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $trpc: ReturnType<typeof createTRPCClient<AppRouter>>
  }
}
