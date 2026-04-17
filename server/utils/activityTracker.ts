/**
 * Tracks active users for admin visibility and auto-update deferral.
 * A user is considered active if their last activity was within 5 minutes.
 */

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

interface ActivityState {
  lastActive: number
  currentPage: string | null
  skipNextCheck: boolean
}

const activity = new Map<string, ActivityState>()

export function recordUserActivity(userId: string, currentPage?: string | null) {
  const existing = activity.get(userId)
  activity.set(userId, {
    lastActive: Date.now(),
    currentPage: currentPage ?? existing?.currentPage ?? null,
    skipNextCheck: existing?.skipNextCheck ?? false,
  })
}

export function updateUserCurrentPage(userId: string, currentPage: string | null) {
  const existing = activity.get(userId)
  activity.set(userId, {
    lastActive: existing?.lastActive ?? Date.now(),
    currentPage,
    skipNextCheck: existing?.skipNextCheck ?? false,
  })
}

export function suppressUserForNextCheck(userId: string) {
  const existing = activity.get(userId)
  if (!existing) {
    activity.set(userId, {
      lastActive: Date.now(),
      currentPage: null,
      skipNextCheck: true,
    })
    return
  }

  activity.set(userId, {
    ...existing,
    skipNextCheck: true,
  })
}

export function getActiveUsers(options?: { consumeSkip?: boolean }): Array<{ userId: string, lastActive: number, currentPage: string | null }> {
  const now = Date.now()
  const active: Array<{ userId: string, lastActive: number, currentPage: string | null }> = []

  for (const [userId, state] of activity) {
    if (now - state.lastActive > ACTIVE_THRESHOLD_MS) {
      activity.delete(userId)
      continue
    }

    if (state.skipNextCheck) {
      if (options?.consumeSkip) {
        activity.set(userId, {
          ...state,
          skipNextCheck: false,
        })
      }
      continue
    }

    active.push({
      userId,
      lastActive: state.lastActive,
      currentPage: state.currentPage,
    })
  }

  return active
}

export function getActiveUserCount(options?: { consumeSkip?: boolean }): number {
  return getActiveUsers(options).length
}
