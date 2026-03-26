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
 * Returns the number of users whose last activity was within the active threshold.
 */
export function getActiveUserCount(): number {
  const now = Date.now()
  let count = 0
  for (const [userId, timestamp] of lastActivity) {
    if (now - timestamp <= ACTIVE_THRESHOLD_MS) {
      count++
    } else {
      // Clean up stale entries
      lastActivity.delete(userId)
    }
  }
  return count
}
