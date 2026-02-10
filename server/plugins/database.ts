import { initializeDatabase } from '../db'

export default defineNitroPlugin(() => {
  console.log('Initializing database...')
  initializeDatabase()
})
