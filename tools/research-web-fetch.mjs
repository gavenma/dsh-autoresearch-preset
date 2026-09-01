import { getDocument, GlobalWorkerOptions } from './vendor/pdfjs-dist/legacy/build/pdf.mjs'

export const name = 'research-web-fetch'
export const inject = ['web']

const DEFAULTS = {
  maxUrlLength: 2048,
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 30_000,
  maxRedirects: 5,
  maxAttempts: 3,
  userAgent: 'deepseek-harness/0.1 AutoResearch',
}

function positiveNumber(name, value) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`)
}

function validateUrl(input, maxUrlLength) {
  if (typeof input !== 'string' || input.length === 0 || input.length > maxUrlLength) {
    throw new Error(`invalid or overlong URL (maximum ${maxUrlLength} characters)`)
  }
  const url = new URL(input)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http and https URLs are allowed')
  if (url.username || url.password) throw new Error('credentials in URLs are not allowed')
  return url
}

function sameOrigin(a, b) {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

async function readCapped(response, maxBytes, signal) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`)
  if (!response.body) return { bytes: new Uint8Array(), truncated: false }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason ?? new Error('fetch aborted')
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const remaining = maxBytes - total
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining))
        total = maxBytes
        truncated = true
        await reader.cancel()
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncated }
}

function withoutRepeatedNumericMargin(items) {
  const numericColumns = new Map()
  for (const item of items) {
    if (!/^\d+$/.test(item.str) || !Array.isArray(item.transform)) continue
    const x = Math.round(item.transform[4])
    numericColumns.set(x, (numericColumns.get(x) ?? 0) + 1)
  }
  const lineNumberColumns = new Set([...numericColumns].filter(([, count]) => count >= 5).map(([x]) => x))
  if (lineNumberColumns.size === 0) return items
  return items.filter((item) => !(/^\d+$/.test(item.str) && Array.isArray(item.transform) && lineNumberColumns.has(Math.round(item.transform[4]))))
}

async function extractPdf(bytes, maxChars) {
  GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href
  const task = getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false })
  const document = await task.promise
  const pages = []
  let total = 0
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages && total < maxChars; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = withoutRepeatedNumericMargin(content.items.filter((item) => typeof item?.str === 'string' && item.str.length > 0))
      const text = items.map((item) => item.str).join(' ')
      const block = `\n\n[Page ${pageNumber}]\n${text}`
      pages.push(block.slice(0, maxChars - total))
      total += block.length
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  const text = pages.join('').trim()
  return { content: text.slice(0, maxChars), truncated: text.length >= maxChars }
}

async function fetchWithRetry(url, options, maxAttempts) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, options)
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) return response
      await response.body?.cancel()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      if (options.signal?.aborted) throw error
      lastError = error
      if (attempt === maxAttempts) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
  }
  throw lastError ?? new Error('fetch failed after retries')
}

class ResearchFetchProvider {
  constructor(config = {}) {
    this.id = 'research-http-pdf'
    this.config = { ...DEFAULTS, ...config }
  }

  available() {
    return typeof fetch === 'function'
  }

  async fetch(request, upstreamSignal) {
    let current = validateUrl(request.url, this.config.maxUrlLength)
    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs)
    const signal = upstreamSignal ? AbortSignal.any([upstreamSignal, timeoutSignal]) : timeoutSignal
    let response

    for (let redirect = 0; redirect <= this.config.maxRedirects; redirect += 1) {
      response = await fetchWithRetry(current, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': this.config.userAgent, accept: 'text/html,text/plain,application/pdf,application/json,application/xml;q=0.9,*/*;q=0.1' },
      }, this.config.maxAttempts)
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      if (!location) break
      const next = validateUrl(new URL(location, current).href, this.config.maxUrlLength)
      if (!sameOrigin(current, next)) throw new Error(`cross-origin redirect refused: ${current.origin} -> ${next.origin}`)
      current = next
      if (redirect === this.config.maxRedirects) throw new Error(`redirect limit exceeded (${this.config.maxRedirects})`)
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    const { bytes, truncated: byteTruncated } = await readCapped(response, this.config.maxResponseBytes, signal)
    const isPdf = contentType.includes('application/pdf') || current.pathname.toLowerCase().endsWith('.pdf')

    if (isPdf) {
      if (byteTruncated) throw new Error(`PDF exceeds ${this.config.maxResponseBytes} bytes; refusing partial extraction`)
      const extracted = await extractPdf(bytes, this.config.maxBodyChars)
      return {
        url: current.href,
        statusCode: response.status,
        body: { kind: 'text', content: extracted.content },
        truncated: extracted.truncated,
      }
    }

    const textual = contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml') || contentType.includes('html')
    if (!textual) throw new Error(`unsupported content type "${contentType || 'unknown'}"`)
    const decoded = new TextDecoder('utf-8').decode(bytes)
    const charTruncated = decoded.length > this.config.maxBodyChars
    return {
      url: current.href,
      statusCode: response.status,
      body: { kind: contentType.includes('html') ? 'html' : 'text', content: decoded.slice(0, this.config.maxBodyChars) },
      truncated: byteTruncated || charTruncated,
    }
  }
}

export function apply(ctx, config = {}) {
  const resolved = { ...DEFAULTS, ...config }
  positiveNumber('maxUrlLength', resolved.maxUrlLength)
  positiveNumber('maxResponseBytes', resolved.maxResponseBytes)
  positiveNumber('maxBodyChars', resolved.maxBodyChars)
  positiveNumber('timeoutMs', resolved.timeoutMs)
  if (!Number.isInteger(resolved.maxRedirects) || resolved.maxRedirects < 0) throw new Error('maxRedirects must be a non-negative integer')
  if (!Number.isInteger(resolved.maxAttempts) || resolved.maxAttempts < 1) throw new Error('maxAttempts must be a positive integer')
  const web = ctx.get('web')
  if (!web) throw new Error('web service is required')
  // Presets can be mounted beside an existing research session. The web
  // registry is process-scoped, so reuse the already-installed provider rather
  // than failing a later preset mount with WEB_DUPLICATE_PROVIDER.
  if (web.fetchProviders instanceof Map && web.fetchProviders.has('research-http-pdf')) return
  try {
    web.registerFetchProvider(new ResearchFetchProvider(resolved))
  } catch (error) {
    if (error?.code === 'WEB_DUPLICATE_PROVIDER' || String(error?.message ?? '').includes('already registered')) return
    throw error
  }
}

export { ResearchFetchProvider }
