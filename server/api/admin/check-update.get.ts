import { readFileSync } from 'fs'
import { join } from 'path'
import { db } from '../../db'
import { settings } from '../../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const role = (session?.user as any)?.role
  if (role !== 'admin' && role !== 'super_admin') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // Get GitHub settings from DB
  const [repoSetting] = await db.select().from(settings).where(eq(settings.key, 'githubRepo')).limit(1)
  const [tokenSetting] = await db.select().from(settings).where(eq(settings.key, 'githubToken')).limit(1)

  const repo = repoSetting?.value as string
  const token = tokenSetting?.value as string

  if (!repo) {
    throw createError({ statusCode: 400, statusMessage: 'GitHub repo not configured' })
  }

  // Fetch latest release from GitHub
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LumiR-Updater',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers })

  if (!response.ok) {
    const text = await response.text()
    throw createError({ statusCode: response.status, statusMessage: `GitHub API error: ${text}` })
  }

  const release = await response.json() as {
    tag_name: string
    name: string
    published_at: string
    html_url: string
    body: string
    assets: Array<{ name: string; url: string; browser_download_url: string; size: number }>
  }

  // Current version
  let currentVersion = 'dev'
  try {
    currentVersion = readFileSync(join(process.cwd(), 'BUILD_VERSION'), 'utf-8').trim()
  } catch {
    // dev mode
  }

  const asset = release.assets.find(a => a.name.endsWith('.zip'))

  // For private repos: use the asset API URL (not browser_download_url which returns 404 with token auth)
  const downloadUrl = token && asset?.url
    ? asset.url
    : asset?.browser_download_url || null

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
