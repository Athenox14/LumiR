export default defineEventHandler(async (event) => {
  // Authentication check
  const session = await getUserSession(event)
  if (!session?.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const query = getQuery(event)
  const url = query.url as string
  const headersParam = query.headers as string

  if (!url) {
    throw createError({ statusCode: 400, message: 'URL parameter is required' })
  }

  // Parse custom headers (Referer, etc.)
  // Note: getQuery already decodes URI components, so no need for decodeURIComponent
  let customHeaders: Record<string, string> = {}
  if (headersParam) {
    try {
      customHeaders = JSON.parse(headersParam)
    } catch {
      try {
        // Fallback: try with decodeURIComponent in case of double encoding
        customHeaders = JSON.parse(decodeURIComponent(headersParam))
      } catch {
        // Ignore invalid headers
      }
    }
  }

  try {
    // Derive Origin from Referer if available (many streaming servers check both)
    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      ...customHeaders,
    }

    // Add Origin from Referer if we have one
    if (customHeaders.Referer || customHeaders.referer) {
      try {
        const refererUrl = new URL(customHeaders.Referer || customHeaders.referer)
        fetchHeaders['Origin'] = refererUrl.origin
      } catch {}
    }

    // Forward Range header from browser for seeking in MP4/media files
    const rangeHeader = getHeader(event, 'range')
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader
    }

    console.log(`[Proxy] Fetching: ${url.substring(0, 100)}... | Referer: ${fetchHeaders.Referer || 'none'} | Origin: ${fetchHeaders.Origin || 'none'}${rangeHeader ? ` | Range: ${rangeHeader}` : ''}`)

    const response = await fetch(url, {
      headers: fetchHeaders,
      redirect: 'follow',
    })

    // 206 Partial Content is OK (Range response)
    if (!response.ok && response.status !== 206) {
      const errorBody = await response.text().catch(() => '')
      console.error(`[Proxy] Upstream error: ${response.status} ${response.statusText} | URL: ${url.substring(0, 100)}... | Body: ${errorBody.substring(0, 200)}`)
      throw createError({
        statusCode: response.status,
        message: `Upstream error: ${response.statusText}`,
      })
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'

    // Guard: if upstream returns HTML when we expect media, it's likely a Cloudflare challenge or error page
    if (contentType.includes('text/html') && !url.endsWith('.m3u8') && !url.match(/\.srt(\?.*)?$/i)) {
      const body = await response.text()
      const isCloudflare = body.includes('challenge-platform') || body.includes('Just a moment') || body.includes('cf-browser-verification')
      console.error(`[Proxy] Upstream returned HTML instead of media | URL: ${url.substring(0, 100)} | Cloudflare: ${isCloudflare} | Body: ${body.substring(0, 300)}`)
      throw createError({
        statusCode: 502,
        message: isCloudflare ? 'Blocked by Cloudflare protection' : 'Upstream returned HTML instead of media',
      })
    }

    // If this is an SRT subtitle, convert to VTT for browser compatibility
    if (url.match(/\.srt(\?.*)?$/i)) {
      const text = await response.text()
      const vtt = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
      setHeader(event, 'Content-Type', 'text/vtt')
      setHeader(event, 'Access-Control-Allow-Origin', '*')
      return vtt
    }

    // If this is an m3u8 manifest, rewrite URLs to go through the proxy
    if (url.endsWith('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) {
      const text = await response.text()
      const rewritten = rewriteM3u8(text, url, headersParam || '')

      setHeader(event, 'Content-Type', 'application/vnd.apple.mpegurl')
      setHeader(event, 'Access-Control-Allow-Origin', '*')
      return rewritten
    }

    // For segments (.ts, .mp4, etc.), pipe the response
    const respHeaders = response.headers
    if (respHeaders.get('content-type')) {
      setHeader(event, 'Content-Type', respHeaders.get('content-type')!)
    }
    if (respHeaders.get('content-length')) {
      setHeader(event, 'Content-Length', respHeaders.get('content-length')!)
    }
    setHeader(event, 'Access-Control-Allow-Origin', '*')

    // Forward Range-related headers for seeking support
    if (respHeaders.get('content-range')) {
      setHeader(event, 'Content-Range', respHeaders.get('content-range')!)
    }
    if (respHeaders.get('accept-ranges')) {
      setHeader(event, 'Accept-Ranges', respHeaders.get('accept-ranges')!)
    } else {
      setHeader(event, 'Accept-Ranges', 'bytes')
    }

    // Return 206 if upstream returned partial content
    if (response.status === 206) {
      setResponseStatus(event, 206, 'Partial Content')
    }

    // Stream the response body
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

function rewriteM3u8(content: string, manifestUrl: string, headersParam: string): string {
  // Resolve base URL for relative paths
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1)

  const lines = content.split('\n')
  const rewritten = lines.map(line => {
    const trimmed = line.trim()

    // Skip empty lines and comments/tags
    if (!trimmed || trimmed.startsWith('#')) {
      // But check for URI= attributes in tags (e.g., #EXT-X-KEY:METHOD=AES-128,URI="...")
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
          const absoluteUri = resolveUrl(uri, baseUrl)
          return `URI="${buildProxyUrl(absoluteUri, headersParam)}"`
        })
      }
      return line
    }

    // If line is a URL (segment or sub-playlist)
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return buildProxyUrl(trimmed, headersParam)
    }

    // Relative URL
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
    // Absolute path - need origin from baseUrl
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
