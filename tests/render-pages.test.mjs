import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderPdfPages } from '../tools/fetch-source.mjs'

// Page rendering for figure reading:
//   - a requested page becomes a real PNG under the output directory, and the
//     path is returned so the caller can read_image it;
//   - the whole document is never rasterized by accident (a cap applies);
//   - a deployment with no rasterizer degrades to a named diagnostic, and the
//     text fetch that already succeeded is not failed by it.

const here = path.dirname(fileURLToPath(import.meta.url))
const pdfBytes = new Uint8Array(await fs.readFile(path.join(here, 'fixtures', 'pdf-source.pdf')))
const multipageBytes = new Uint8Array(await fs.readFile(path.join(here, 'fixtures', 'pdf-multipage.pdf')))
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'render-pages-'))

// A subprocess stand-in shaped like the host service.
const subprocess = {
  async resolveExecutable(name) {
    if (name !== 'pdftoppm') throw new Error('not found: ' + name)
    return '/usr/bin/pdftoppm'
  },
  spawn({ argv, cwd }) {
    const child = spawn(argv[0], argv.slice(1), { cwd })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    return {
      done: new Promise((resolve) => child.on('close', (code) => resolve({ exitCode: code ?? 1 }))),
      collected: {
        stdout: { readFrom: async () => ({ text: Buffer.concat(stdout).toString('utf8') }) },
        stderr: { readFrom: async () => ({ text: Buffer.concat(stderr).toString('utf8') }) },
      },
    }
  },
}

// ── 1. one requested page becomes a real PNG ───────────────────────────────
{
  const out = path.join(tmp, 'one-page')
  const result = await renderPdfPages({ bytes: pdfBytes, pageCount: 1, outputDir: out, pages: [1], subprocess })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.renderedPages, [1])
  assert.equal(result.paths.length, 1)
  const png = await fs.readFile(result.paths[0])
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'the artifact must be a real PNG')
  assert.ok(png.length > 1000, 'a rendered page carries real content, not an empty image')
  assert.match(result.paths[0], /page-01[-\d]*\.png$/, 'the page number is preserved in the name')
  // The source PDF used for rasterization is cleaned up.
  assert.deepEqual((await fs.readdir(out)).filter((name) => name.endsWith('.pdf')), [], 'no source PDF is left behind')
}

// ── 2. the page cap holds: an unbounded request cannot rasterize everything ─
{
  const out = path.join(tmp, 'capped')
  // Three real pages, a cap of two: the third must be reported as skipped
  // rather than either rendered or silently forgotten.
  const result = await renderPdfPages({ bytes: multipageBytes, pageCount: 3, outputDir: out, maxPages: 2, subprocess })
  assert.equal(result.paths.length, 2, 'only maxPages images are produced')
  assert.deepEqual(result.renderedPages, [1, 2])
  assert.deepEqual(result.skipped, [3], 'the pages left out are reported, not silently dropped')
}

// ── 3. a missing rasterizer degrades to a diagnostic ───────────────────────
{
  const out = path.join(tmp, 'no-rasterizer')
  const result = await renderPdfPages({
    bytes: pdfBytes,
    pageCount: 1,
    outputDir: out,
    pages: [1],
    subprocess: { async resolveExecutable() { throw new Error('ENOENT') }, spawn() { throw new Error('must not spawn') } },
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.paths, [])
  assert.match(result.reason, /no PDF rasterizer is resolvable/)
  assert.match(result.reason, /poppler-utils/, 'the diagnostic names the fix')
}

// ── 4. no subprocess service at all is also a diagnostic, not a throw ──────
{
  const result = await renderPdfPages({ bytes: pdfBytes, pageCount: 1, outputDir: path.join(tmp, 'none'), pages: [1] })
  assert.equal(result.ok, false)
  assert.match(result.reason, /subprocess service unavailable/)
}

// ── 5. a failing rasterizer reports the page it failed on ─────────────────
{
  const result = await renderPdfPages({
    bytes: pdfBytes,
    pageCount: 1,
    outputDir: path.join(tmp, 'failing'),
    pages: [1],
    subprocess: { async resolveExecutable() { return '/usr/bin/pdftoppm' }, spawn() { return { done: Promise.resolve({ exitCode: 2 }) } } },
  })
  assert.equal(result.ok, false)
  assert.match(result.reason, /exited 2 on page 1/)
}

// ── 6. extraction must not consume the bytes rendering needs ───────────────
// pdf.js transfers the buffer it is given, so a naive `extractPdf(bytes)` leaves
// the caller's view detached and the rasterizer receives zero bytes — page
// rendering silently produces nothing.
{
  const { extractPdf } = await import('../tools/fetch-source.mjs')
  const probe = new Uint8Array(await fs.readFile(path.join(here, 'fixtures', 'pdf-source.pdf')))
  const before = probe.byteLength
  const extracted = await extractPdf(probe, 100000)
  assert.ok(extracted.content.length > 0, 'extraction still returns text')
  assert.equal(probe.byteLength, 0, 'this test pins the pdf.js behaviour the fetch path must work around: extraction detaches its input')

  // The fetch path must therefore hand out intact bytes.
  const { fetchSourceDocument } = await import('../tools/fetch-source.mjs')
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
  let handed = null
  try {
    await fetchSourceDocument({
      url: 'https://example.com/paper.pdf',
      web: undefined,
      forceDirect: true,
      onPdfBytes: async ({ bytes }) => { handed = bytes },
    })
  } finally {
    globalThis.fetch = realFetch
  }
  assert.ok(handed !== null, 'the fetch path offers the bytes')
  assert.equal(handed.byteLength, pdfBytes.byteLength, 'the bytes offered for rendering are intact, not detached by extraction')
}

// ── 7. the registered tool wires runDir -> evidence/pages and returns paths ─
{
  const root = path.resolve(here, '..')
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
  const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
  const registered = new Map()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'render-tool-'))
  const fileService = {
    async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? workspace, target) },
    async readText(target) { return await fs.readFile(target, 'utf8') },
    async writeText(target, content) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content) },
    async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
    async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
  }
  orchestrator.apply({
    get(name) {
      if (name === 'fs') return fileService
      if (name === 'subprocess') return subprocess
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      return undefined
    },
  })
  const definition = registered.get('autoresearch_fetch_source')
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
  const exec = { agent: { session: { header: { cwd: workspace } } }, signal: new AbortController().signal, callId: 'call-render' }
  try {
    // renderPages without runDir is refused: images must be run artifacts.
    await assert.rejects(
      () => definition.execute({ urls: ['https://example.com/paper.pdf'], renderPages: [1] }, exec),
      /renderPages requires runDir/,
    )
    const runDir = 'runs/render'
    await fs.mkdir(path.join(workspace, runDir), { recursive: true })
    const result = await definition.execute({ urls: ['https://example.com/paper.pdf'], renderPages: [1], runDir, forceDirect: true }, exec)
    assert.equal(result.ok, true, JSON.stringify(result.results.map((entry) => entry.error)))
    assert.equal(result.renderedPages, 1)
    const [entry] = result.results
    assert.equal(entry.pageImages.ok, true)
    assert.deepEqual(entry.pageImages.pages, [1])
    assert.match(entry.pageImages.paths[0], /evidence\/pages\/page-01[-\d]*\.png$/, 'page images land under the run evidence tree')
    assert.match(result.instruction, /read_image/, 'the result tells the caller to actually look at the pages')
    assert.ok(await fs.readFile(entry.pageImages.paths[0]).then((bytes) => bytes.length > 1000), 'the returned path is a real image')
  } finally {
    globalThis.fetch = realFetch
    await fs.rm(workspace, { recursive: true, force: true })
  }
}

await fs.rm(tmp, { recursive: true, force: true })
console.log('render-pages tests passed')
