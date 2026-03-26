import type { H3Event } from 'h3'
import { db } from '../db'
import { recordUserActivity } from '../utils/activityTracker'

export interface User {
  id: string
  email: string
  displayName: string
  role: 'super_admin' | 'admin' | 'user'
  permissions: string[] | null
}

export interface Context {
  event: H3Event
  user: User | null
  db: typeof db
}

export async function createContext(event: H3Event): Promise<Context> {
  let user: User | null = null

  try {
    const session = await getUserSession(event)
    if (session?.user) {
      user = session.user as User
      // Track user activity for auto-update system
      recordUserActivity(user.id)
    }
  } catch {
    // No session, user remains null
  }

  return {
    event,
    user,
    db,
  }
}
