import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// End-to-end check of the REGISTERED `autoresearch_fetch_source` tool: it must
// appear in the mounted catalog with the schema generated from the core, and a
// real call must (a) delegate an ordinary page to the standard web service and
// (b) fall back to direct PDF extraction when the standard provider refuses the
// body kind. Canaries are asserted here because a PDF's extracted text is the
// only evidence the model ever sees.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const core = (await import(pathToFileURL(path.join(root, manifest.entries.core)).href))
const pdfBytes = new Uint8Array(await fs.readFile(path.join(root, 'tests', 'fixtures', 'pdf-source.pdf')))

const registered = new Map()
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? root, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content) },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}

let standardCalls = 0
let standardBehaviour = async (request) => ({
  url: request.url,
  statusCode: 200,
  body: { kind: 'html', content: '<html>ordinary page</html>' },
  truncated: false,
})
const webService = {
  fetchProviders: new Map(),
  searchProviders: new Map(),
  async fetch(request, signal) { standardCalls += 1; return await standardBehaviour(request, signal) },
}

orchestrator.apply({
  get(name) {
    if (name === 'fs') return fileService
    if (name === 'web') return webService
    if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
    return undefined
  },
})

// ── registration + generated schema equality ───────────────────────────────
const definition = registered.get('autoresearch_fetch_source')
assert.ok(definition, 'autoresearch_fetch_source must be registered by the orchestrator plugin')
const generated = core.generateToolSchemas()
assert.deepEqual(definition.parameters, generated.autoresearch_fetch_source, 'registered schema must equal the generated one')
assert.deepEqual(definition.parameters.required, ['urls'], 'urls is the only required parameter')
assert.ok(String(definition.description).includes('web_fetch'), 'the description must tell the caller to try the standard tool first')

const exec = { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal, callId: 'call-1' }

// ── ordinary page: standard service, direct path untouched ─────────────────
{
  const callsBefore = standardCalls
  const result = await definition.execute({ urls: ['https://example.com/page'] }, exec)
  assert.equal(standardCalls, callsBefore + 1, 'an ordinary page must go through the standard web service')
  assert.equal(result.ok, true)
  assert.equal(result.count, 1)
  assert.equal(result.direct, 0)
  const [entry] = result.results
  assert.equal(entry.via, 'standard')
  assert.equal(entry.kind, 'html')
  assert.equal(entry.error, null)
  assert.match(entry.content, /ordinary page/)
}

// ── PDF refused by the standard provider: direct extraction ────────────────
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(pdfBytes, {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-length': String(pdfBytes.length) },
  })
  const previousBehaviour = standardBehaviour
  standardBehaviour = async () => {
    const error = new Error('unsupported content type "application/pdf"')
    error.code = 'WEB_UNSUPPORTED_CONTENT_TYPE'
    throw error
  }
  const result = await definition.execute({ urls: ['https://example.com/paper.pdf'] }, exec)
  globalThis.fetch = realFetch
  standardBehaviour = previousBehaviour
  assert.equal(result.ok, true)
  assert.equal(result.direct, 1, 'the refused PDF must be reported as retrieved directly')
  const [entry] = result.results
  assert.equal(entry.via, 'direct-pdf')
  assert.equal(entry.kind, 'pdf')
  assert.equal(entry.fallbackReason, 'WEB_UNSUPPORTED_CONTENT_TYPE')
  assert.match(entry.content, /quick brown fox/, 'the model must receive the extracted text')
  assert.ok(entry.contentLength > 0)
}

// ── failure surfacing: a refused destination is an error entry, not a throw ─
{
  const result = await definition.execute({ urls: ['http://169.254.169.254/latest/meta-data/'], forceDirect: true }, exec)
  assert.equal(result.ok, false, 'a refused source must be reported as a failed entry')
  const [entry] = result.results
  assert.equal(entry.ok, false)
  assert.match(String(entry.error), /non-public destination/)
  assert.equal(entry.content, '')
}

// ── empty input is a caller error ──────────────────────────────────────────
await assert.rejects(() => definition.execute({ urls: [] }, exec), /at least one URL/)

// ── the result must be lossless JSON (registry contract) ───────────────────
{
  const result = await definition.execute({ urls: ['https://example.com/page'] }, exec)
  const roundTripped = JSON.parse(JSON.stringify(result))
  assert.deepEqual(roundTripped, result, 'the tool result must survive a JSON round trip unchanged')
}

console.log('fetch_source tool tests passed for generation ' + manifest.generation)
