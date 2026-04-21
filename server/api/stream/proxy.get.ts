import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const ALLOWED_HEADER_NAMES = new Set([
  'accept',
  'accept-language',
  'origin',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'user-agent',
])

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const query = getQuery(event)
  const rawUrl = query.url as string
  const headersParam = query.headers as string

  if (!rawUrl) {
    throw createError({ statusCode: 400, message: 'URL parameter is required' })
  }

  const targetUrl = parseAndValidateTargetUrl(rawUrl)
  await assertSafeRemoteTarget(targetUrl)

  const customHeaders = parseCustomHeaders(headersParam)

  try {
    const fetchHeaders = buildFetchHeaders(customHeaders, getHeader(event, 'range'))

    const response = await fetch(targetUrl.toString(), {
      headers: fetchHeaders,
      redirect: 'follow',
    })

    if (!response.ok && response.status !== 206) {
      const errorBody = await response.text().catch(() => '')
      console.error(`[Proxy] Upstream error: ${response.status} ${response.statusText} | Host: ${targetUrl.host} | Body: ${errorBody.substring(0, 160)}`)
      throw createError({
        statusCode: response.status,
        message: `Upstream error: ${response.statusText}`,
      })
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'

    if (contentType.includes('text/html') && !targetUrl.pathname.endsWith('.m3u8') && !targetUrl.pathname.match(/\.srt$/i)) {
      const body = await response.text()
      const isCloudflare = body.includes('challenge-platform') || body.includes('Just a moment') || body.includes('cf-browser-verification')
      console.error(`[Proxy] Upstream returned HTML instead of media | Host: ${targetUrl.host} | Cloudflare: ${isCloudflare}`)
      throw createError({
        statusCode: 502,
        message: isCloudflare ? 'Blocked by Cloudflare protection' : 'Upstream returned HTML instead of media',
      })
    }

    if (targetUrl.pathname.match(/\.srt$/i)) {
      const text = await response.text()
      const vtt = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
      setHeader(event, 'Content-Type', 'text/vtt')
      setHeader(event, 'Access-Control-Allow-Origin', '*')
      return vtt
    }

    if (targetUrl.pathname.endsWith('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) {
      const text = await response.text()
      const rewritten = rewriteM3u8(text, targetUrl.toString(), headersParam || '')

      setHeader(event, 'Content-Type', 'application/vnd.apple.mpegurl')
      setHeader(event, 'Access-Control-Allow-Origin', '*')
      return rewritten
    }

    const respHeaders = response.headers
    if (respHeaders.get('content-type')) {
      setHeader(event, 'Content-Type', respHeaders.get('content-type')!)
    }
    if (respHeaders.get('content-length')) {
      setHeader(event, 'Content-Length', respHeaders.get('content-length')!)
    }
    setHeader(event, 'Access-Control-Allow-Origin', '*')

    if (respHeaders.get('content-range')) {
      setHeader(event, 'Content-Range', respHeaders.get('content-range')!)
    }
    setHeader(event, 'Accept-Ranges', respHeaders.get('accept-ranges') || 'bytes')

    if (response.status === 206) {
      setResponseStatus(event, 206, 'Partial Content')
    }

    if (response.body) {
      return sendStream(event, response.body as any)
    }

    return ''
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('[Proxy] Error:', error.message)
    throw createError({
      statusCode: 502,
      message: `Proxy error: ${error.message}`,
    })
  }
})

function parseAndValidateTargetUrl(rawUrl: string): URL {
  let targetUrl: URL
  try {
    targetUrl = new URL(rawUrl)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid target URL' })
  }

  if (!ALLOWED_PROTOCOLS.has(targetUrl.protocol)) {
    throw createError({ statusCode: 400, message: 'Unsupported target protocol' })
  }

  if (!targetUrl.hostname) {
    throw createError({ statusCode: 400, message: 'Invalid target host' })
  }

  return targetUrl
}

function parseCustomHeaders(headersParam?: string): Record<string, string> {
  if (!headersParam) return {}

  let parsed: unknown = null
  try {
    parsed = JSON.parse(headersParam)
  } catch {
    try {
      parsed = JSON.parse(decodeURIComponent(headersParam))
    } catch {
      return {}
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const sanitized: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== 'string') continue
    const key = rawKey.toLowerCase()
    if (!ALLOWED_HEADER_NAMES.has(key)) continue
    sanitized[normalizeHeaderName(key)] = rawValue.slice(0, 1000)
  }

  return sanitized
}

function normalizeHeaderName(key: string): string {
  if (key === 'user-agent') return 'User-Agent'
  if (key === 'accept') return 'Accept'
  if (key === 'accept-language') return 'Accept-Language'
  if (key === 'origin') return 'Origin'
  if (key === 'referer') return 'Referer'
  if (key === 'sec-fetch-dest') return 'Sec-Fetch-Dest'
  if (key === 'sec-fetch-mode') return 'Sec-Fetch-Mode'
  if (key === 'sec-fetch-site') return 'Sec-Fetch-Site'
  return key
}

function buildFetchHeaders(customHeaders: Record<string, string>, rangeHeader?: string): Record<string, string> {
  const fetchHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    ...customHeaders,
  }

  if ((customHeaders.Referer || customHeaders.referer) && !customHeaders.Origin) {
    try {
      const refererUrl = new URL(customHeaders.Referer || customHeaders.referer!)
      fetchHeaders.Origin = refererUrl.origin
    } catch {}
  }

  if (rangeHeader) {
    fetchHeaders.Range = rangeHeader
  }

  return fetchHeaders
}

async function assertSafeRemoteTarget(targetUrl: URL) {
  const hostname = targetUrl.hostname.toLowerCase()

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw createError({ statusCode: 403, message: 'Local targets are forbidden' })
  }

  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw createError({ statusCode: 403, message: 'Private network targets are forbidden' })
  }

  const directIpType = isIP(hostname)
  if (directIpType && isPrivateIpAddress(hostname)) {
    throw createError({ statusCode: 403, message: 'Private network targets are forbidden' })
  }

  if (!directIpType) {
    let resolved
    try {
      resolved = await lookup(hostname, { all: true })
    } catch {
      throw createError({ statusCode: 400, message: 'Unable to resolve target host' })
    }

    if (!resolved.length) {
      throw createError({ statusCode: 400, message: 'Unable to resolve target host' })
    }

    for (const entry of resolved) {
      if (isPrivateIpAddress(entry.address)) {
        throw createError({ statusCode: 403, message: 'Private network targets are forbidden' })
      }
    }
  }
}

function isPrivateIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIPv4(address)
  if (family === 6) return isPrivateIPv6(address)
  return true
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true

  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase()
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.')
    || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
    || normalized.startsWith('::ffff:169.254.')
}

function rewriteM3u8(content: string, manifestUrl: string, headersParam: string): string {
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1)

  const lines = content.split('\n')
  const rewritten = lines.map(line => {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
          const absoluteUri = resolveUrl(uri, baseUrl)
          return `URI="${buildProxyUrl(absoluteUri, headersParam)}"`
        })
      }
      return line
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return buildProxyUrl(trimmed, headersParam)
    }

    const absoluteUrl = resolveUrl(trimmed, baseUrl)
    return buildProxyUrl(absoluteUrl, headersParam)
  })

  return rewritten.join('\n')
}

function resolveUrl(path: string, baseUrl: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  if (path.startsWith('/')) {
    const urlObj = new URL(baseUrl)
    return `${urlObj.origin}${path}`
  }
  return baseUrl + path
}

function buildProxyUrl(targetUrl: string, headersParam: string): string {
  let proxyUrl = `/api/stream/proxy?url=${encodeURIComponent(targetUrl)}`
  if (headersParam) {
    proxyUrl += `&headers=${encodeURIComponent(headersParam)}`
  }
  return proxyUrl
}
