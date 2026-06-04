import { getExternalPluginsDir } from './shared/pluginPaths'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  alias: {
    '#lumir-external-plugins': getExternalPluginsDir(),
  },
  compatibilityDate: '2025-01-27',
  devtools: { enabled: true },
  devServer: {
    https: true
  },

  vue: {
    compilerOptions: {
      isCustomElement: (tag: string) => tag.startsWith('media-'),
    },
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
      ],
      script: [
        {
          src: 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1',
        },
        {
          src: '//instant.page/5.2.0',
          type: 'module',
          integrity: 'sha384-jnZyxPjiipYXnSU0ygqeac2q7CVYMbh84q0uHVRRxEtvFPiQYbXWUorga2aqZJ0z',
        }
      ]
    }
  },

  nitro: {
    experimental: {
      asyncContext: true
    },
    alias: {
      '#lumir-external-plugins': getExternalPluginsDir(),
    },
    externals: {
      // Prevent Nitro from bundling the ONNX runtime — it contains native binaries
      // that must stay as-is in node_modules.
      external: ['@huggingface/transformers', 'onnxruntime-node'],
    },
  },

  vite: {
    server: {
      fs: {
        allow: [
          getExternalPluginsDir(),
        ]
      }
    }
  }
})
