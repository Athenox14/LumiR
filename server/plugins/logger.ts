import { setupServerLogging } from '../utils/serverLogger'

export default defineNitroPlugin(() => {
  setupServerLogging()
})
