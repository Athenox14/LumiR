const STORAGE_KEY = 'lumir-update-dismissed'
const CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

interface DismissInfo {
  version: string
  dismissedAt: number
  remindAfter?: number // timestamp after which to show again
}

interface UpdateData {
  currentVersion: string
  latestVersion: string
  latestName: string
  publishedAt: string
  releaseUrl: string
  releaseNotes: string
  hasUpdate: boolean
  downloadUrl: string | null
  downloadSize: number
}

// Shared state across all component instances
const updateData = ref<UpdateData | null>(null)
const checking = ref(false)
const installing = ref(false)
const installError = ref('')
let _checkTimer: ReturnType<typeof setInterval> | null = null
let initialized = false

function getDismissInfo(): DismissInfo | null {
  if (!import.meta.client) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function setDismissInfo(info: DismissInfo) {
  if (!import.meta.client) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(info))
}

function clearDismissInfo() {
  if (!import.meta.client) return
  localStorage.removeItem(STORAGE_KEY)
}

function isDismissed(version: string): boolean {
  const info = getDismissInfo()
  if (!info || info.version !== version) return false
  // If remindAfter is set, check if it's time to remind
  if (info.remindAfter && Date.now() >= info.remindAfter) return false
  // Dismissed permanently (until next version) or remind time not reached
  return true
}

export function useUpdateChecker() {
  const { isAdmin } = useAuth()
  const showPopup = ref(false)

  async function checkForUpdate() {
    if (!isAdmin.value || checking.value) return
    checking.value = true
    try {
      updateData.value = await $fetch('/api/admin/check-update')
      // Show popup if there's an update and it's not dismissed
      if (updateData.value?.hasUpdate && !isDismissed(updateData.value.latestVersion)) {
        showPopup.value = true
      } else {
        showPopup.value = false
      }
    } catch {
      // Silent fail - background check
    } finally {
      checking.value = false
    }
  }

  function dismiss() {
    if (!updateData.value) return
    setDismissInfo({
      version: updateData.value.latestVersion,
      dismissedAt: Date.now(),
    })
    showPopup.value = false
  }

  function remindLater(hours: number) {
    if (!updateData.value) return
    setDismissInfo({
      version: updateData.value.latestVersion,
      dismissedAt: Date.now(),
      remindAfter: Date.now() + hours * 60 * 60 * 1000,
    })
    showPopup.value = false
  }

  async function performUpdate() {
    if (!updateData.value?.downloadUrl) return
    installing.value = true
    installError.value = ''
    try {
      await $fetch('/api/admin/update', {
        method: 'POST',
        body: {
          downloadUrl: updateData.value.downloadUrl,
          version: updateData.value.latestVersion,
        },
      })
      // Clear dismiss info so next version shows popup
      clearDismissInfo()
      showPopup.value = false
      // Reload after restart
      setTimeout(() => window.location.reload(), 5000)
      return true
    } catch (e: any) {
      installError.value = e.data?.statusMessage || e.message || 'Update failed'
      return false
    } finally {
      installing.value = false
    }
  }

  // Start background checking (once per app lifecycle)
  function startBackgroundCheck() {
    if (!import.meta.client || initialized) return
    initialized = true

    // Initial check after 5 seconds (non-blocking)
    setTimeout(() => checkForUpdate(), 5000)

    // Periodic check
    _checkTimer = setInterval(() => checkForUpdate(), CHECK_INTERVAL_MS)
  }

  // Recheck visibility (e.g. after dismiss timer expired)
  function recheckVisibility() {
    if (updateData.value?.hasUpdate && !isDismissed(updateData.value.latestVersion)) {
      showPopup.value = true
    }
  }

  return {
    updateData: readonly(updateData),
    showPopup: readonly(showPopup),
    checking: readonly(checking),
    installing,
    installError,
    checkForUpdate,
    dismiss,
    remindLater,
    performUpdate,
    startBackgroundCheck,
    recheckVisibility,
  }
}
