// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-27',
  devtools: { enabled: true },
  devServer: {
    https: true
  },

  modules: [
    '@nuxt/eslint',
    '@nuxtjs/tailwindcss',
    'nuxt-auth-utils',
  ],

  runtimeConfig: {
    // Server-side only
    tmdbApiKey: process.env.TMDB_API_KEY || '',
    session: {
      maxAge: 60 * 60 * 24 * 30, // 30 days
      cookie: {
        secure: true,
        sameSite: 'lax'
      }
    },
    // Public (exposed to client)
    public: {
      appName: 'LumiR'
    }
  },

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts',
  },

  app: {
    head: {
      meta: [
        { name: 'description', content: 'Self-hosted media library' },
        { name: 'theme-color', content: '#0a0a0a' },
        { name: 'robots', content: 'noindex, nofollow' }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
      ]
    }
  },

  nitro: {
    experimental: {
      asyncContext: true
    }
  }
})
