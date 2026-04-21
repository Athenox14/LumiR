import { execSync } from 'child_process'
import { mkdirSync, createWriteStream, writeFileSync, existsSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { fetchLatestRelease, getReleaseZipAsset } from './releases'

function ensureTrustedDownloadUrl(downloadUrl: string) {
  const parsed = new URL(downloadUrl)
  const allowedHosts = new Set(['github.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'])

  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
    throw new Error('Untrusted release asset host')
  }
}

export async function resolveReleaseForInstall(version?: string | null) {
  const release = await fetchLatestRelease()

  if (version && release.tag_name !== version) {
    throw new Error(`Requested version ${version} does not match latest release ${release.tag_name}`)
  }

  const asset = getReleaseZipAsset(release)
  if (!asset?.browser_download_url) {
    throw new Error('No zip asset found for latest release')
  }

  ensureTrustedDownloadUrl(asset.browser_download_url)

  return {
    version: release.tag_name,
    downloadUrl: asset.browser_download_url,
  }
}

export async function installRelease(downloadUrl: string, version: string): Promise<void> {
  ensureTrustedDownloadUrl(downloadUrl)

  const appDir = process.cwd()
  const tempDir = join(appDir, `.update-${Date.now()}`)
  const zipPath = join(appDir, '.update.zip')

  try {
    const headers: Record<string, string> = {
      Accept: 'application/octet-stream',
      'User-Agent': 'LumiR-Updater',
    }

    const response = await fetch(downloadUrl, { headers })
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status}`)
    }

    const fileStream = createWriteStream(zipPath)
    await pipeline(Readable.fromWeb(response.body as any), fileStream)

    mkdirSync(tempDir, { recursive: true })

    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`)
    } else {
      execSync(`unzip -o "${zipPath}" -d "${tempDir}"`)
    }

    const outputDir = join(appDir, '.output')
    const oldOutputDir = join(appDir, '.output.old')

    if (existsSync(oldOutputDir)) {
      rmSync(oldOutputDir, { recursive: true, force: true })
    }

    if (existsSync(outputDir)) {
      renameSync(outputDir, oldOutputDir)
    }

    const newOutputDir = join(tempDir, '.output')
    if (existsSync(newOutputDir)) {
      renameSync(newOutputDir, outputDir)
    } else {
      renameSync(tempDir, outputDir)
    }

    writeFileSync(join(appDir, 'BUILD_VERSION'), `${version}\n`, 'utf-8')

    if (existsSync(zipPath)) rmSync(zipPath, { force: true })
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    if (existsSync(oldOutputDir)) rmSync(oldOutputDir, { recursive: true, force: true })

    try {
      execSync('pm2 restart all', { timeout: 5000 })
    } catch {
      try {
        execSync('systemctl restart lumir', { timeout: 5000 })
      } catch {
        setTimeout(() => process.exit(0), 1000)
      }
    }
  } catch (error) {
    if (existsSync(zipPath)) rmSync(zipPath, { force: true })
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    throw error
  }
}
