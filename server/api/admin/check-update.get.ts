import { readFileSync } from 'fs'
import { join } from 'path'
import { fetchLatestRelease, getReleaseZipAsset } from '../../utils/releases'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const role = (session?.user as any)?.role
  if (role !== 'admin' && role !== 'super_admin') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  let release
  try {
    release = await fetchLatestRelease()
  } catch (error: any) {
    throw createError({ statusCode: 502, statusMessage: error.message || 'Unable to fetch latest release' })
  }

  // Current version - try root first, then .output/ (zip extracts build info inside .output/)
  let currentVersion = 'dev'
  for (const base of [process.cwd(), join(process.cwd(), '.output')]) {
    try {
      currentVersion = readFileSync(join(base, 'BUILD_VERSION'), 'utf-8').trim()
      break
    } catch {}
  }

  const asset = getReleaseZipAsset(release)
  const downloadUrl = asset?.browser_download_url || null

  return {
    currentVersion,
    latestVersion: release.tag_name,
    latestName: release.name,
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
    releaseNotes: release.body,
    hasUpdate: currentVersion !== release.tag_name && currentVersion !== 'dev',
    downloadUrl,
    downloadSize: asset?.size || 0,
  }
})
