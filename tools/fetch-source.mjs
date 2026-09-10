import fs from 'node:fs/promises'
import path from 'node:path'
import { getDocument, GlobalWorkerOptions } from './vendor/pdfjs-dist/legacy/build/pdf.mjs'

// Standard-first source retrieval for AutoResearch.
//
// Policy: a normal fetch is the HOST `web` service's job (`ctx.web.fetch()`),
// because that provider owns the deployment's address safety, proxy routing,
// and content decoding. This module only adds what the standard path cannot do:
// extracting text from a resource the standard provider refuses as an
// unsupported content type (its closed `html | text` body union has no PDF
// kind). The direct path is therefore a narrow fallback, never the default, and
// it is not registered as a `web` provider — a second provider would make the
// capability ambiguous for every caller in the deployment.
//
// The direct path connects without the host provider's pinned-address
// transport, so it carries its own public-address guard: a private, loopback,
// link-local, or otherwise non-public destination is refused before any
// connection. That is a bounded re-implementation of the host policy, not the
// full transport: operator proxy configuration is not honored here, which is
// why the standard path stays first.

export const name = 'research-fetch-source'

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

export function normalizeConfig(config = {}) {
  const resolved = { ...DEFAULTS, ...config }
  positiveNumber('maxUrlLength', resolved.maxUrlLength)
  positiveNumber('maxResponseBytes', resolved.maxResponseBytes)
  positiveNumber('maxBodyChars', resolved.maxBodyChars)
  positiveNumber('timeoutMs', resolved.timeoutMs)
  if (!Number.isInteger(resolved.maxRedirects) || resolved.maxRedirects < 0) throw new Error('maxRedirects must be a non-negative integer')
  if (!Number.isInteger(resolved.maxAttempts) || resolved.maxAttempts < 1) throw new Error('maxAttempts must be a positive integer')
  return resolved
}

export function validateUrl(input, maxUrlLength) {
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

/** True for an address that is routable on the public internet. */
export function isPublicAddress(address, family) {
  const version = family === 4 || family === 6 ? family : (address.includes(':') ? 6 : 4)
  try {
    if (version === 4) {
      const parts = address.split('.').map(Number)
      if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
      const [a, b] = parts
      if (a === 0 || a === 10 || a === 127) return false
      if (a === 169 && b === 254) return false
      if (a === 172 && b >= 16 && b <= 31) return false
      if (a === 192 && b === 168) return false
      if (a === 192 && b === 0) return false
      if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
      if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
      if (a >= 224) return false // multicast + reserved + broadcast
      return true
    }
    const text = address.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase()
    if (text === '::' || text === '::1') return false
    if (text.startsWith('::ffff:')) return isPublicAddress(text.slice('::ffff:'.length), 4)
    const first = Number.parseInt(text.split(':')[0] || '0', 16)
    if (!Number.isInteger(first)) return false
    if ((first & 0xfe00) === 0xfc00) return false // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false // link local fe80::/10
    if ((first & 0xff00) === 0xff00) return false // multicast
    if (first === 0x2001 && text.startsWith('2001:db8')) return false // documentation
    return true
  } catch {
    return false
  }
}

/** Resolve a hostname and refuse any answer that is not publicly routable. */
export async function assertPublicDestination(url, lookupImpl) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literal = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')
  // Accept either a lookup function or a `{ lookup }` module shape.
  const resolve = typeof lookupImpl === 'function'
    ? lookupImpl
    : (lookupImpl?.lookup ?? (await import('node:dns/promises')).lookup)
  let answers
  if (literal) {
    answers = [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }]
  } else {
    let resolved
    try {
      resolved = await resolve(hostname, { all: true })
    } catch (error) {
      throw new Error(`cannot resolve ${hostname}: ${error instanceof Error ? error.message : String(error)}`)
    }
    answers = Array.isArray(resolved) ? resolved : [resolved]
  }
  if (answers.length === 0) throw new Error(`cannot resolve ${hostname}: no addresses`)
  const blocked = answers.filter((answer) => !isPublicAddress(answer.address, answer.family))
  if (blocked.length > 0) {
    throw new Error(`refusing a non-public destination for ${hostname} (${blocked.map((answer) => answer.address).join(', ')}); the direct PDF path connects without the host provider's pinned-address transport`)
  }
  return answers
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

export async function extractPdf(bytes, maxChars, workerSrc) {
  GlobalWorkerOptions.workerSrc = workerSrc ?? new URL('./vendor/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href
  const task = getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false })
  const document = await task.promise
  const emitted = []
  // The document's TRUE text length, accumulated whether or not the characters
  // are kept. A cap that drops text must be reported as `truncated`; deciding
  // that from the retained prefix alone reports a cut-off paper as complete.
  let available = 0
  let kept = 0
  let pagesRead = 0
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = withoutRepeatedNumericMargin(content.items.filter((item) => typeof item?.str === 'string' && item.str.length > 0))
      const text = items.map((item) => item.str).join(' ')
      const block = `\n\n[Page ${pageNumber}]\n${text}`
      available += block.length
      pagesRead = pageNumber
      if (kept < maxChars) {
        const slice = block.slice(0, Math.max(0, maxChars - kept))
        emitted.push(slice)
        kept += slice.length
      }
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  const text = emitted.join('').trim()
  const truncated = available > kept
  return { content: text.slice(0, maxChars), truncated, pagesRead, totalPages: document.numPages, availableChars: available }
}

/**
 * Rasterize PDF pages to PNGs with an installed system rasterizer.
 *
 * Text extraction and page images answer different questions: text carries
 * quotable prose and citations, images carry anything whose meaning is spatial
 * (a diagram, a chart, a page layout). A figure is only visible to a model that
 * can read an image, so pages are rendered for `read_image` rather than
 * described.
 *
 * Returns a structured outcome instead of throwing: a deployment without a
 * rasterizer must degrade to a diagnostic naming the fix, never fail the fetch
 * that already succeeded.
 *
 * @param params - `{ bytes, pageCount, outputDir, pages, dpi, maxPages, subprocess, cwd, signal }`.
 * @returns `{ ok, paths, renderedPages, skipped, reason? }`.
 */
export async function renderPdfPages(params = {}) {
  const { bytes, subprocess, outputDir } = params
  if (subprocess === undefined || typeof subprocess.spawn !== 'function') {
    return { ok: false, paths: [], renderedPages: [], skipped: [], reason: 'subprocess service unavailable; cannot rasterize PDF pages.' }
  }
  const totalPages = Number.isInteger(params.pageCount) && params.pageCount > 0 ? params.pageCount : 0
  const maxPages = Number.isInteger(params.maxPages) && params.maxPages > 0 ? params.maxPages : 8
  const dpi = Number.isInteger(params.dpi) && params.dpi >= 36 && params.dpi <= 600 ? params.dpi : 150
  const explicit = Array.isArray(params.pages) && params.pages.length > 0
  const requested = explicit
    ? [...new Set(params.pages.filter((page) => Number.isInteger(page) && page >= 1 && (totalPages === 0 || page <= totalPages)))].sort((a, b) => a - b)
    : Array.from({ length: Math.min(totalPages, maxPages) }, (_, index) => index + 1)
  if (requested.length === 0) return { ok: false, paths: [], renderedPages: [], skipped: [], reason: 'no page in range; this PDF reports no pages to rasterize.' }

  const targets = requested.slice(0, maxPages)
  // What the cap left out. An explicit request reports the dropped page
  // numbers; an implicit "render some pages" request reports the remaining
  // page numbers, which is bounded by the document rather than by a
  // caller-supplied list (so a 5000-page PDF does not build a 5000-entry list
  // just to describe what was skipped).
  const skipped = explicit
    ? requested.slice(targets.length)
    : Array.from({ length: Math.max(0, (totalPages || targets.length) - targets.length) }, (_, index) => targets.length + index + 1)
  let binary
  try {
    binary = await subprocess.resolveExecutable('pdftoppm')
  } catch {
    binary = undefined
  }
  if (binary === undefined || binary === null) {
    return {
      ok: false,
      paths: [],
      renderedPages: [],
      skipped,
      reason: 'no PDF rasterizer is resolvable (pdftoppm from poppler-utils); page images are unavailable, so use the extracted text or install poppler-utils.',
    }
  }

  await fs.mkdir(outputDir, { recursive: true })
  const sourcePath = path.join(outputDir, '.source.pdf')
  await fs.writeFile(sourcePath, bytes)
  const paths = []
  const renderedPages = []
  try {
    for (const page of targets) {
      const prefix = path.join(outputDir, `page-${String(page).padStart(2, '0')}`)
      const handle = subprocess.spawn({
        argv: [binary, '-f', String(page), '-l', String(page), '-r', String(dpi), '-png', sourcePath, prefix],
        cwd: params.cwd ?? outputDir,
        ...(params.signal === undefined ? {} : { signal: params.signal }),
      })
      let outcome
      try {
        outcome = await handle.done
      } catch (error) {
        return { ok: false, paths, renderedPages, skipped, reason: `rasterizer failed on page ${page}: ${error instanceof Error ? error.message : String(error)}` }
      }
      if (outcome !== undefined && outcome.exitCode !== 0) {
        return { ok: false, paths, renderedPages, skipped, reason: `rasterizer exited ${outcome.exitCode} on page ${page}.` }
      }
      // pdftoppm names its output after the page number in the document, not
      // the requested index, so discover the artifact rather than guessing.
      const written = (await fs.readdir(outputDir)).filter((name) => name.startsWith(path.basename(prefix)) && name.endsWith('.png')).sort()
      if (written.length === 0) {
        return { ok: false, paths, renderedPages, skipped, reason: `rasterizer produced no image for page ${page}.` }
      }
      for (const name of written) {
        const absolute = path.join(outputDir, name)
        paths.push(absolute)
        renderedPages.push(page)
      }
    }
    return { ok: paths.length > 0, paths, renderedPages, skipped, ...(paths.length === 0 ? { reason: 'rasterizer produced no page images.' } : {}) }
  } finally {
    await fs.rm(sourcePath, { force: true })
  }
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

/**
 * Retrieve one URL directly and decode it, extracting text for PDF bodies.
 * Carries the public-address guard; this is the fallback, not the default path.
 */
export async function fetchDirect(url, config, options = {}) {
  const resolved = normalizeConfig(config)
  let current = validateUrl(url, resolved.maxUrlLength)
  await assertPublicDestination(current, options.lookup)
  const timeoutSignal = AbortSignal.timeout(resolved.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
  let response

  for (let redirect = 0; redirect <= resolved.maxRedirects; redirect += 1) {
    response = await fetchWithRetry(current, {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': resolved.userAgent, accept: 'text/html,text/plain,application/pdf,application/json,application/xml;q=0.9,*/*;q=0.1' },
    }, resolved.maxAttempts)
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location) break
    const next = validateUrl(new URL(location, current).href, resolved.maxUrlLength)
    if (!sameOrigin(current, next)) throw new Error(`cross-origin redirect refused: ${current.origin} -> ${next.origin}`)
    // Every hop is re-validated: a redirect must not reach a private address.
    await assertPublicDestination(next, options.lookup)
    current = next
    if (redirect === resolved.maxRedirects) throw new Error(`redirect limit exceeded (${resolved.maxRedirects})`)
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  const { bytes, truncated: byteTruncated } = await readCapped(response, resolved.maxResponseBytes, signal)
  const isPdf = contentType.includes('application/pdf') || current.pathname.toLowerCase().endsWith('.pdf')

  if (isPdf) {
    if (byteTruncated) throw new Error(`PDF exceeds ${resolved.maxResponseBytes} bytes; refusing partial extraction`)
    // pdf.js TRANSFERS the buffer it is handed: after extraction the caller's
    // own view is detached (byteLength becomes 0). Extraction therefore must not
    // consume the only copy — a page-image request still needs these bytes — so
    // pdf.js gets a copy and the caller keeps the original.
    const extracted = await extractPdf(bytes.slice(), resolved.maxBodyChars, options.workerSrc)
    // Hand the original bytes to the caller so a page-image request does not
    // re-download the document, and so rendering never depends on the text cap.
    if (typeof options.onPdfBytes === 'function') {
      try { await options.onPdfBytes({ bytes, pageCount: extracted.totalPages }) } catch { /* rendering is additive; never fail the fetch */ }
    }
    return {
      url: current.href,
      statusCode: response.status,
      kind: 'pdf',
      content: extracted.content,
      truncated: extracted.truncated,
      pagesRead: extracted.pagesRead,
      totalPages: extracted.totalPages,
      availableChars: extracted.availableChars,
      via: 'direct-pdf',
    }
  }

  const textual = contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml') || contentType.includes('html')
  if (!textual) throw new Error(`unsupported content type "${contentType || 'unknown'}"`)
  const decoded = new TextDecoder('utf-8').decode(bytes)
  const charTruncated = decoded.length > resolved.maxBodyChars
  return {
    url: current.href,
    statusCode: response.status,
    kind: contentType.includes('html') ? 'html' : 'text',
    content: decoded.slice(0, resolved.maxBodyChars),
    truncated: byteTruncated || charTruncated,
    via: 'direct',
  }
}

const FALLBACK_CODES = new Set(['WEB_UNSUPPORTED_CONTENT_TYPE', 'WEB_PROVIDER_UNAVAILABLE', 'WEB_PROVIDER_AMBIGUOUS'])

function fallbackReason(error) {
  const code = error && typeof error.code === 'string' ? error.code : ''
  const message = error instanceof Error ? error.message : String(error)
  if (FALLBACK_CODES.has(code)) return code
  // A URL that plainly targets a PDF is worth a direct attempt even when the
  // standard provider fails for a transport reason instead of a kind reason.
  return message
}

/**
 * Retrieve one source URL with the standard-first policy.
 *
 * @param params - `{ url, web, config, signal, lookup, forceDirect, workerSrc }`.
 *   `web` is the host service (`ctx.web`) when the caller has one.
 * @returns `{ url, statusCode, kind, content, truncated, via, fallbackReason }`.
 */
export async function fetchSourceDocument(params = {}) {
  const { url, web } = params
  const resolved = normalizeConfig(params.config)
  const target = validateUrl(url, resolved.maxUrlLength)
  const looksPdf = target.pathname.toLowerCase().endsWith('.pdf')

  if (params.forceDirect !== true && web !== undefined && typeof web.fetch === 'function') {
    try {
      const result = await web.fetch({ url: target.href }, params.signal)
      return {
        url: result.url ?? target.href,
        statusCode: result.statusCode,
        kind: result.body?.kind ?? 'text',
        content: result.body?.content ?? '',
        truncated: result.truncated === true,
        via: 'standard',
        fallbackReason: null,
      }
    } catch (error) {
      const reason = fallbackReason(error)
      // Only a kind/availability failure justifies the direct path; a plain
      // network failure is reported as-is unless the URL is visibly a PDF.
      if (!looksPdf && !FALLBACK_CODES.has(reason)) throw error
      const direct = await fetchDirect(target.href, params.config, params)
      return { ...direct, fallbackReason: reason }
    }
  }

  const direct = await fetchDirect(target.href, params.config, params)
  return { ...direct, fallbackReason: web === undefined ? 'no-web-service' : 'forced-direct' }
}
