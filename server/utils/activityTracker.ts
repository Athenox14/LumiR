/**
 * Tracks active users by maintaining a lastActivity timestamp per user.
 * A user is considered "active" if their last activity was within 5 minutes.
 */

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

const lastActivity = new Map<string, number>()

/**
 * Record activity for a user (call on each API request).
 */
export function recordUserActivity(userId: string) {
  lastActivity.set(userId, Date.now())
}

/**
 * Returns a list of users whose last activity was within the active threshold.
 */
export function getActiveUsers(): Array<{ userId: string, lastActive: number }> {
  const now = Date.now()
  const active: Array<{ userId: string, lastActive: number }> = []
  for (const [userId, timestamp] of lastActivity) {
    if (now - timestamp <= ACTIVE_THRESHOLD_MS) {
      active.push({ userId, lastActive: timestamp })
    } else {
      lastActivity.delete(userId)
    }
  }
  return active
}
