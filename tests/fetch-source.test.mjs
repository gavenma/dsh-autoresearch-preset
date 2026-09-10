import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertPublicDestination,
  fetchSourceDocument,
  isPublicAddress,
  normalizeConfig,
} from '../tools/fetch-source.mjs'

// Standard-first retrieval policy:
//   1. an ordinary page is the host `web` service's job — this module must
//      delegate and never touch the network itself;
//   2. a resource the standard provider refuses (its body union is a closed
//      `html | text`, so a PDF cannot be represented) falls back to direct
//      retrieval with text extraction;
//   3. the direct path connects without the host provider's pinned-address
//      transport, so it carries its own public-address guard.

const here = path.dirname(fileURLToPath(import.meta.url))
const pdfBytes = new Uint8Array(await fs.readFile(path.join(here, 'fixtures', 'pdf-source.pdf')))

const publicLookup = { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }

// ── 1. normal page: standard service only, no direct connection ────────────
{
  let directCalls = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { directCalls += 1; throw new Error('must not connect directly') }
  const web = {
    async fetch(request) {
      assert.equal(request.url, 'https://example.com/page')
      return { url: request.url, statusCode: 200, body: { kind: 'html', content: '<p>hello</p>' }, truncated: false }
    },
  }
  const result = await fetchSourceDocument({ url: 'https://example.com/page', web, ...publicLookup })
  globalThis.fetch = realFetch
  assert.equal(result.via, 'standard', 'an ordinary page must use the standard service')
  assert.equal(result.kind, 'html')
  assert.equal(result.content, '<p>hello</p>')
  assert.equal(result.fallbackReason, null)
  assert.equal(directCalls, 0, 'the standard path must not open its own connection')
}

// ── 2. PDF refused by the standard service: direct extraction ──────────────
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(pdfBytes, {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-length': String(pdfBytes.length) },
  })
  const web = {
    async fetch() {
      const error = new Error('unsupported content type "application/pdf"')
      error.code = 'WEB_UNSUPPORTED_CONTENT_TYPE'
      throw error
    },
  }
  const result = await fetchSourceDocument({ url: 'https://example.com/paper.pdf', web, ...publicLookup })
  globalThis.fetch = realFetch
  assert.equal(result.via, 'direct-pdf', 'a refused PDF must fall back to direct extraction')
  assert.equal(result.kind, 'pdf')
  assert.equal(result.fallbackReason, 'WEB_UNSUPPORTED_CONTENT_TYPE')
  assert.match(result.content, /quick brown fox/, 'extracted text must carry the document body')
  assert.match(result.content, /\[Page 1\]/, 'extraction records page boundaries')
  assert.equal(result.truncated, false)
}

// ── 3. no web service at all: direct path is the only option ───────────────
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
  const result = await fetchSourceDocument({ url: 'https://example.com/paper.pdf', web: undefined, ...publicLookup })
  globalThis.fetch = realFetch
  assert.equal(result.via, 'direct-pdf')
  assert.equal(result.fallbackReason, 'no-web-service')
}

// ── 4. an ordinary network failure is reported, not silently re-fetched ────
{
  let directCalls = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { directCalls += 1; throw new Error('must not connect directly') }
  const web = { async fetch() { const error = new Error('connect ECONNREFUSED'); error.code = 'WEB_PROVIDER_FAILED'; throw error } }
  await assert.rejects(
    () => fetchSourceDocument({ url: 'https://example.com/page', web, ...publicLookup }),
    /ECONNREFUSED/,
    'a transport failure that is not a kind/availability failure must propagate',
  )
  globalThis.fetch = realFetch
  assert.equal(directCalls, 0)
}

// ── 5. a URL that is visibly a PDF still falls back on a transport failure ──
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
  const web = { async fetch() { const error = new Error('connect ECONNREFUSED'); error.code = 'WEB_PROVIDER_FAILED'; throw error } }
  const result = await fetchSourceDocument({ url: 'https://example.com/paper.pdf', web, ...publicLookup })
  globalThis.fetch = realFetch
  assert.equal(result.via, 'direct-pdf', 'a .pdf URL is worth a direct attempt even on a transport failure')
}

// ── 6. the public-address guard ────────────────────────────────────────────
{
  // Public addresses pass.
  for (const address of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address, address.includes(':') ? 6 : 4), true, address + ' must be public')
  }
  // Private, loopback, link-local (cloud metadata), CGNAT, multicast, reserved.
  for (const address of [
    '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '198.18.0.1', '192.0.2.5',
  ]) {
    assert.equal(isPublicAddress(address, 4), false, address + ' must be refused')
  }
  for (const address of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
    assert.equal(isPublicAddress(address, 6), false, address + ' must be refused')
  }
  assert.equal(isPublicAddress('::ffff:127.0.0.1', 6), false, 'IPv4-mapped loopback must be refused')
  assert.equal(isPublicAddress('::ffff:8.8.8.8', 6), true, 'IPv4-mapped public must pass')

  // Resolution: every answer must be public, so a host that resolves to a
  // private address is refused before any connection.
  await assert.rejects(
    () => assertPublicDestination(new URL('http://localhost:8080/admin'), { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }),
    /non-public destination/,
  )
  await assert.rejects(
    () => assertPublicDestination(new URL('http://metadata.internal/'), { lookup: async () => [{ address: '169.254.169.254', family: 4 }] }),
    /non-public destination/,
  )
  await assert.rejects(
    () => assertPublicDestination(new URL('http://mixed.example.com/'), {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }],
    }),
    /non-public destination/,
    'a host with any private answer is refused',
  )
  await assert.doesNotReject(
    () => assertPublicDestination(new URL('https://example.com/'), publicLookup),
  )
  // An IP literal needs no resolution at all.
  await assert.rejects(
    () => assertPublicDestination(new URL('http://169.254.169.254/latest/meta-data/'), { lookup: async () => { throw new Error('must not resolve a literal') } }),
    /non-public destination/,
  )
}

// ── 7. the direct path refuses a private destination before connecting ─────
{
  let connected = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { connected += 1; return new Response('x', { status: 200 }) }
  await assert.rejects(
    () => fetchSourceDocument({
      url: 'http://169.254.169.254/latest/meta-data/',
      web: undefined,
      forceDirect: true,
      lookup: async () => [{ address: '169.254.169.254', family: 4 }],
    }),
    /non-public destination/,
  )
  globalThis.fetch = realFetch
  assert.equal(connected, 0, 'a non-public destination must be refused before any connection')
}

// ── 8. config validation ───────────────────────────────────────────────────
{
  assert.equal(normalizeConfig({}).maxBodyChars, 100_000)
  assert.throws(() => normalizeConfig({ maxResponseBytes: 0 }), /positive finite number/)
  assert.throws(() => normalizeConfig({ maxRedirects: -1 }), /non-negative integer/)
  assert.throws(() => normalizeConfig({ maxAttempts: 0 }), /positive integer/)
}

// ── 9. truncation must be reported, never silently implied as complete ─────
// A cap that drops text is a FACT about the result. Deriving it from the
// retained prefix reports a cut-off document as whole.
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } })

  const whole = await fetchSourceDocument({
    url: 'https://example.com/paper.pdf', web: undefined, config: { maxBodyChars: 5_000_000 }, ...publicLookup,
  })
  assert.equal(whole.truncated, false, 'a document under the cap is complete')
  assert.equal(whole.pagesRead, whole.totalPages, 'every page is read when nothing is dropped')
  assert.ok(whole.availableChars > 0, 'the true text length is reported')

  const capped = await fetchSourceDocument({
    url: 'https://example.com/paper.pdf', web: undefined, config: { maxBodyChars: Math.floor(whole.availableChars / 2) }, ...publicLookup,
  })
  globalThis.fetch = realFetch
  assert.equal(capped.truncated, true, 'dropping text must set truncated even though the retained text is shorter than the cap')
  assert.ok(capped.availableChars > capped.content.length, 'the result must disclose the text it did NOT return')
  assert.equal(capped.totalPages, whole.totalPages, 'the page count is a property of the document, not of the cap')
}

console.log('fetch-source policy tests passed')
