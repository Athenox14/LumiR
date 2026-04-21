import type { ClientPluginDefinition } from '../../../app/types/plugins'

const plugin: ClientPluginDefinition = {
  id: 'remote-media',
  name: 'Remote Media',
  description: 'Online catalog, streaming and downloads.',
  navigation: [
    {
      id: 'remote-media.catalog',
      to: '/p/remote-media',
      label: 'plugins.remoteMedia.catalog',
      icon: 'globe',
      beta: true,
    },
    {
      id: 'remote-media.downloads',
      to: '/p/remote-media/downloads',
      label: 'plugins.remoteMedia.downloads',
      icon: 'download',
      beta: true,
    },
  ],
  pages: {
    '/': {
      title: 'Catalog',
      component: () => import('../../../app/pages/catalog/index.vue'),
    },
    '/downloads': {
      title: 'Downloads',
      component: () => import('../../../app/pages/downloads.vue'),
    },
    '/movie/': {
      title: 'Movie',
      component: () => import('../../../app/pages/catalog/movie/[id].vue'),
    },
    '/tv/': {
      title: 'TV',
      component: () => import('../../../app/pages/catalog/tv/[id].vue'),
    },
    '/watch/': {
      title: 'Watch',
      component: () => import('../../../app/pages/catalog/watch/[id].vue'),
    },
    '/person/': {
      title: 'Person',
      component: () => import('../../../app/pages/catalog/person/[id].vue'),
    },
  },
  settings: {
    fields: [
      {
        key: 'tmdbApiKey',
        label: 'TMDB API Key',
        type: 'password',
        placeholder: 'eyJhbG...',
        description: 'Required to query TMDB metadata for the plugin.',
        required: true,
      },
    ],
  },
  i18n: {
    fr: {
      plugins: {
        remoteMedia: {
          name: 'Médias distants',
          description: 'Catalogue en ligne, streaming et téléchargements.',
          catalog: 'Catalogue',
          downloads: 'Téléchargements',
        },
      },
    },
    en: {
      plugins: {
        remoteMedia: {
          name: 'Remote Media',
          description: 'Online catalog, streaming and downloads.',
          catalog: 'Catalog',
          downloads: 'Downloads',
        },
      },
    },
    de: {
      plugins: {
        remoteMedia: {
          name: 'Remote Media',
          description: 'Online-Katalog, Streaming und Downloads.',
          catalog: 'Katalog',
          downloads: 'Downloads',
        },
      },
    },
  },
}

export default plugin
