export const LUMIR_GITHUB_REPO = 'Athenox14/LumiR'

export interface GitHubReleaseAsset {
  name: string
  url: string
  browser_download_url: string
  size: number
}

export interface GitHubRelease {
  tag_name: string
  name: string
  published_at: string
  html_url: string
  body: string
  assets: GitHubReleaseAsset[]
}

export async function fetchLatestRelease(): Promise<GitHubRelease> {
  const response = await fetch(`https://api.github.com/repos/${LUMIR_GITHUB_REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LumiR-Updater',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub API error: ${response.status} ${text}`)
  }

  return await response.json() as GitHubRelease
}

export function getReleaseZipAsset(release: GitHubRelease): GitHubReleaseAsset | null {
  return release.assets.find(asset => asset.name.endsWith('.zip')) || null
}
