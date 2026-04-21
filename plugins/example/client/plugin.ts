import ExampleHomePage from './pages/index.vue'
import type { ClientPluginDefinition } from '../../../app/types/plugins'

const plugin: ClientPluginDefinition = {
  id: 'example',
  name: 'Example Plugin',
  description: 'Minimal plugin example kept in the repository as a reference.',
  navigation: [
    {
      id: 'example.home',
      to: '/p/example',
      label: 'Example',
      icon: 'lucide:puzzle',
    },
  ],
  pages: {
    '/': {
      component: ExampleHomePage,
      title: 'Example Plugin',
    },
  },
}

export default plugin
