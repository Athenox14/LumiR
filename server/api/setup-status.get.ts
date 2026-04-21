import { db } from '../db'
import { users } from '../db/schema'

export default defineEventHandler(async () => {
  const existingUsers = await db.select().from(users).limit(1)

  return {
    needsSetup: existingUsers.length === 0,
  }
})
