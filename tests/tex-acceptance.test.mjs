// WS1 — TeX acceptance (GRF-2026 SOD #1, #3, #4, #6, #7, #9, #19).
//
// Covers the comment-aware TeX needs scanner, derived-declared drift
// semantics (scanner decides pass/fail; hand-filled declared only produces
// recorded warnings), the .fls system-input whitelist, the shared TeX file
// resolver, the unified missing-source diagnostic + promotion recipe, the
// assembly texMode normalization, and tex_final_check modular-assembly
// behavior (assembled counting, degraded label cross-check, word-count
// fallback). Uses the generated bundles and real latexmk/texcount when
// available in the environment.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn as nodeSpawn, execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { plan as canonicalPlan, node as canonicalNode, criterion } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)
const { default: orchestrator, createLibraries: lib } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
assert.equal(typeof lib.helpers.resolveTexInputs, 'function')
assert.equal(typeof lib.helpers.missingSourceDiagnostic, 'function')

// ── shared test fixtures ──────────────────────────────────────────────────
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-tex-acceptance-'))
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, options = {}) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
  },
  async readBytes(target, _options, maxBytes) {
    const data = await fs.readFile(target)
    return maxBytes ? subarray(data, maxBytes) : data
  },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}
function subarray(data, maxBytes) {
  const copy = new Uint8Array(Math.min(data.length, maxBytes))
  copy.set(data.subarray(0, copy.length))
  return copy
}

// Real subprocess adapter over node:child_process. `failNames` lets a test
// simulate a missing executable (e.g. texcount) to exercise the assembled
// word-count fallback.
function makeRealSubprocess(failNames = new Set()) {
  const find = (name) => {
    if (name.includes('/')) {
      try { fsSync.accessSync(name, fsSync.constants.X_OK); return name } catch { return null }
    }
    for (const dir of String(process.env.PATH ?? '').split(':')) {
      if (!dir) continue
      const candidate = path.join(dir, name)
      try { fsSync.accessSync(candidate, fsSync.constants.X_OK); return candidate } catch {}
    }
    return null
  }
  return {
    async resolveExecutable(name) {
      if (failNames.has(name)) throw new Error('Executable not resolvable: ' + name)
      const found = find(name)
      if (!found) throw new Error('Executable not resolvable: ' + name)
      return found
    },
    spawn({ argv, cwd }) {
      const child = nodeSpawn(argv[0], argv.slice(1), { cwd: cwd ?? baseDir })
      const out = []
      const err = []
      child.stdout.on('data', (d) => out.push(d))
      child.stderr.on('data', (d) => err.push(d))
      const done = new Promise((resolve) => {
        child.on('close', (code) => resolve({ exitCode: code ?? 1 }))
        child.on('error', () => resolve({ exitCode: 127 }))
      })
      return {
        done,
        collected: {
          stdout: { readFrom: async () => ({ text: Buffer.concat(out).toString('utf8') }) },
          stderr: { readFrom: async () => ({ text: Buffer.concat(err).toString('utf8') }) },
        },
      }
    },
  }
}
const cleanupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-tex-cleanup-'))
const cleanupFops = {
  ...fileService,
  async exists(target) { return (await fileService.stat(target)) !== undefined },
  async ensureDir(target) { await fs.mkdir(target, { recursive: true }) },
  async removeTree(target) { await fs.rm(target, { recursive: true, force: true }) },
  async copy(source, destination) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(source, destination) },
  async writeJson(target, value) { await fileService.writeText(target, JSON.stringify(value, null, 2) + '\n') },
  async readJson(target) { try { return JSON.parse(await fileService.readText(target)) } catch { return null } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, dir: entry.isDirectory() })) } catch { return [] } },
}
const cleanupSubprocess = {
  async resolveExecutable() { return '/fake/latexmk' },
  spawn({ argv, cwd }) {
    const done = (async () => {
      const outDir = argv.find((arg) => String(arg).startsWith('-outdir='))?.slice('-outdir='.length)
      assert.ok(outDir)
      assert.equal(JSON.parse(await fs.readFile(path.join(outDir, '.autoresearch-compiler.json'), 'utf8')).owner, 'autoresearch-compiler')
      for (const [name, value] of [['final.log', 'ok'], ['final.fls', 'INPUT x'], ['final.pdf', '%PDF'], ['final.fdb_latexmk', 'scratch'], ['final.synctex.gz', 'scratch']]) await fs.writeFile(path.join(outDir, name), value)
      return { exitCode: 0 }
    })()
    return { done, collected: { stdout: { readFrom: async () => ({ text: '' }) }, stderr: { readFrom: async () => ({ text: '' }) } } }
  },
}
const cleanupBuild = await lib.helpers.strictTexBuild(cleanupFops, cleanupSubprocess, cleanupDir, cleanupDir, 'final.tex')
assert.equal(cleanupBuild.clean, true)
assert.equal(cleanupBuild.pdfExists, true)
assert.equal(cleanupBuild.scratchCleaned, true)
assert.equal(await fs.access(path.join(cleanupDir, '.autoresearch-compiler')).then(() => true).catch(() => false), false)
assert.equal(await fs.readFile(path.join(cleanupDir, 'final.pdf'), 'utf8'), '%PDF')
assert.equal(await fs.access(path.join(cleanupDir, 'final.log')).then(() => true).catch(() => false), false)
assert.equal(await fs.access(path.join(cleanupDir, 'final.fls')).then(() => true).catch(() => false), false)
await fs.rm(cleanupDir, { recursive: true, force: true })

// ── strictTexBuild: typed failure evidence + SOURCE_DATE_EPOCH pinning + ──
//    no dot-prefixed compiler job names (plan §9/§11)
{
  const evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-tex-evidence-'))
  await fs.writeFile(path.join(evidenceDir, 'final.tex'), '\\documentclass{article}\n\\begin{document}\n\\foo\n\\end{document}\n')
  const evidenceFops = {
    ...fileService,
    async exists(target) { return fs.access(target).then(() => true).catch(() => false) },
    async ensureDir(target) { await fs.mkdir(target, { recursive: true }) },
    async removeTree(target) { await fs.rm(target, { recursive: true, force: true }) },
    async copy(source, destination) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(source, destination) },
    async writeJson(target, value) { await fileService.writeText(target, JSON.stringify(value, null, 2) + '\n') },
    async readJson(target) { try { return JSON.parse(await fileService.readText(target)) } catch { return null } },
  }
  const spawns = []
  const failingSubprocess = {
    async resolveExecutable(name) { return '/fake/bin/' + name },
    spawn({ argv, cwd, env }) {
      spawns.push({ argv, env })
      const outDir = argv.find((arg) => String(arg).startsWith('-outdir='))?.slice('-outdir='.length)
      const done = (async () => {
        await fs.writeFile(path.join(outDir, 'final.log'), 'log bytes')
        await fs.writeFile(path.join(outDir, 'final.fls'), 'INPUT x')
        return { exitCode: 42 }
      })()
      return {
        done,
        collected: {
          stdout: { readFrom: async () => ({ text: 'Runaway?\n' }) },
          stderr: { readFrom: async () => ({ text: '! Undefined control sequence.\nl.42 \\foo\nMore context.\n' }) },
        },
      }
    },
  }
  const evidence = await lib.helpers.strictTexBuild(evidenceFops, failingSubprocess, evidenceDir, evidenceDir, 'final.tex', { sourceDateEpoch: 1700000000 })
  assert.equal(evidence.clean, false)
  assert.equal(evidence.exitCode, 42)
  assert.equal(evidence.firstError, 'Undefined control sequence.', 'the first ! error line is retained')
  assert.equal(evidence.errorLine, 42, 'the l.<N> line number is retained')
  assert.equal(evidence.errorContext, '\\foo', 'the error line context is retained')
  assert.match(evidence.command, /latexmk/, 'the exact command is recorded')
  assert.ok(evidence.logTail.includes('Runaway?'), 'the bounded tail is retained')
  assert.equal(evidence.scratchCleaned, true)
  assert.equal(evidence.cleanupError, null)
  assert.equal(evidence.sourceDateEpoch, 1700000000, 'the pinned epoch is recorded')
  assert.equal(spawns.length, 1)
  const spawn = spawns[0]
  assert.equal(spawn.env.SOURCE_DATE_EPOCH, '1700000000', 'SOURCE_DATE_EPOCH rides the compiler environment')
  assert.ok(!spawn.argv.includes('-jobname'), 'no -jobname is ever passed: ' + JSON.stringify(spawn.argv))
  assert.ok(!spawn.argv.some((arg) => String(arg).startsWith('.') && !String(arg).startsWith('-')), 'no dot-prefixed compiler job name is generated: ' + JSON.stringify(spawn.argv))
  assert.equal(spawn.argv.at(-1), 'final.tex', 'the job name is the source basename')
  await fs.rm(evidenceDir, { recursive: true, force: true })

  // Deterministic fragment-template generation: same inputs, same bytes.
  const fragment = 'The fragment body with math $x^2$.\n'
  const template = '\\documentclass{article}\n\\begin{document}\n% FRAGMENT %\n\\end{document}\n'
  const previewA = core.buildPreviewTex(fragment, template)
  const previewB = core.buildPreviewTex(fragment, template)
  assert.equal(previewA, previewB, 'preview assembly is deterministic')
  assert.ok(previewA.includes(fragment), 'the fragment body rides the template')
  assert.ok(previewA.includes('\\begin{document}'), 'the assembled preview is a complete document')
}

const previewSafetyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-preview-safety-'))
await fs.writeFile(path.join(previewSafetyDir, 'final.pdf'), '%PDF')
await fs.mkdir(path.join(previewSafetyDir, 'preview'), { recursive: true })
await fs.writeFile(path.join(previewSafetyDir, 'preview', 'user-file.txt'), 'do not remove')
const previewSafetyFops = {
  ...fileService,
  async exists(target) { return fs.access(target).then(() => true).catch(() => false) },
  async readJson(target) { try { return JSON.parse(await fs.readFile(target, 'utf8')) } catch { return undefined } },
  async listDir(target) { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, dir: entry.isDirectory() })) },
  async removeTree(target) { await fs.rm(target, { recursive: true, force: true }) },
  async ensureDir(target) { await fs.mkdir(target, { recursive: true }) },
  async writeJson(target, value) { await fs.writeFile(target, JSON.stringify(value)) },
}
await assert.rejects(() => lib.helpers.renderPreview(previewSafetyFops, { async resolveExecutable() { throw new Error('not reached') } }, baseDir, previewSafetyDir), /not owned by AutoResearch/)
assert.equal(await fs.readFile(path.join(previewSafetyDir, 'preview', 'user-file.txt'), 'utf8'), 'do not remove')
await fs.rm(previewSafetyDir, { recursive: true, force: true })

const registered = new Map()
const failNames = new Set()
const subprocess = makeRealSubprocess(failNames)
orchestrator.apply({
  get(name) {
    if (name === 'fs') return fileService
    if (name === 'subprocess') return subprocess
    if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
    return undefined
  },
})
for (const name of ['autoresearch_init_run', 'autoresearch_record_acceptance', 'autoresearch_tex_check', 'autoresearch_tex_final_check']) {
  assert.ok(registered.has(name), 'mounted bundle must register ' + name)
}
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }

// ══════════════════════════════════════════════════════════════════════════
// 1. Comment-aware TeX needs scanner (SOD #8 / WS1.8, #9)
// ══════════════════════════════════════════════════════════════════════════
{
  const strip = core.stripTexComments
  assert.equal(strip('% whole line comment \\usepackage{nope}\n\\usepackage{real}'), '\n\\usepackage{real}', 'comment lines are blanked but line structure is kept')
  assert.equal(strip('\\usepackage{a} % trailing \\usepackage{b}'), '\\usepackage{a} ', 'trailing comment is cut, leading text kept')
  // \% is not a comment start.
  assert.equal(strip('100\\% sure % real comment'), '100\\% sure ', 'escaped percent must not start a comment')
  // \verb|…%…| content is preserved.
  assert.equal(strip('show \\verb|% not a comment \\usepackage{v}| here'), 'show \\verb|% not a comment \\usepackage{v}| here')
  // verbatim environments preserve comments; only "verbatim" is honored.
  const verbatim = '\\begin{verbatim}\n% fake \\usepackage{z}\n\\end{verbatim}\n\\usepackage{real}'
  assert.equal(strip(verbatim), verbatim)
  // Unterminated verbatim keeps the rest.
  assert.equal(strip('\\begin{verbatim}\n% fake rest'), '\\begin{verbatim}\n% fake rest')

  const needs = core.texNeeds
  const commented = { ...needs('%\\usepackage{commented}\n\\usepackage{real}') }
  assert.deepEqual(commented.packages, ['real'], 'commented-out package must not be scanned')
  const verbEnv = needs('\\begin{verbatim}\n\\usepackage{inenv}\n\\end{verbatim}')
  assert.ok(verbEnv.packages.includes('inenv'), 'verbatim environment content must be scanned as a real need')
  const macro = needs('\\newcommand{\\R}{\\mathbb{R}}')
  assert.ok(macro.macros.includes('R'))
  const input = needs('\\input{sec}')
  assert.ok(input.inputs.includes('sec'))
  const graphic = needs('\\includegraphics{fig}')
  assert.ok(graphic.graphics.includes('fig'))
  const bib = needs('\\bibliography{refs}')
  assert.ok(bib.bibliographies.includes('refs'))

  // Comment-only markers (identity markers, commented-out \input and
  // \bibliographystyle) must not affect any scan (plan §11).
  const markerText = '% autoresearch-causal-event:proj:1:node:abc123\n% \\input{secret.tex}\n\\input{sec}\n% \\bibliographystyle{ieeetr}\n\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}\n'
  const markerNeeds = needs(markerText)
  assert.deepEqual(markerNeeds.inputs, ['sec'], 'a commented-out \\input is not a need')
  assert.deepEqual(markerNeeds.bibliographies, [], 'a commented-out \\bibliographystyle is not a need')
  const markerValid = core.validateTexOutput(markerText, { texMode: 'standalone', declared: { packages: [], macros: [], inputs: ['sec'], graphics: [], bibliographies: [] } })
  assert.equal(markerValid.ok, true, 'marker comments must not trip validation: ' + JSON.stringify(markerValid.errors))
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Derived-declared drift semantics (SOD #3 / WS1.3): the scanner decides
//    pass/fail; a hand-filled contract declared list only yields warnings.
// ══════════════════════════════════════════════════════════════════════════
{
  const text = '\\documentclass{article}\n\\usepackage{amsmath}\n\\newcommand{\\R}{\\mathbb{R}}\n\\input{sec}\n\\begin{document}\n\\R\n\\end{document}\n'
  const declared = { packages: ['otherpkg'], macros: [], inputs: [], graphics: [], bibliographies: [] }
  const result = core.validateTexOutput(text, { texMode: 'standalone', declared })
  assert.equal(result.ok, true, 'drift must not fail acceptance: ' + JSON.stringify(result.errors))
  assert.ok(result.warnings.length >= 3, 'expected drift warnings for amsmath, sec, and unused otherpkg: ' + JSON.stringify(result.warnings))
  assert.ok(result.warnings.some((w) => w.includes('amsmath')), 'used-but-not-declared package must be warned')
  assert.ok(result.warnings.some((w) => w.includes('sec')), 'used-but-not-declared input must be warned')
  assert.ok(result.warnings.some((w) => w.includes('otherpkg')), 'declared-but-unused package must be warned')
  assert.ok(result.warnings.every((w) => w.includes('drift')), 'drift warnings must be labeled: ' + JSON.stringify(result.warnings))
  assert.deepEqual(result.used.packages, ['amsmath'])

  // Hard errors still fail closed.
  assert.equal(core.validateTexOutput('\\write18{rm -rf /}\n', { texMode: 'standalone', declared: {} }).ok, false, 'shell escape (\\write18) must remain a hard error')
  assert.equal(core.validateTexOutput('\\documentclass{article}\n', { texMode: 'fragment', declared: {} }).ok, false, 'complete document in fragment mode must remain a hard error')
  assert.equal(core.validateTexOutput('', { texMode: 'standalone', declared: {} }).ok, false, 'empty output must remain a hard error')
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Assembly texMode normalization (SOD #7 / WS1.4): assembly contracts
//    default to standalone; explicit values preserved; digests consistent.
// ══════════════════════════════════════════════════════════════════════════
{
  const node = (id, kind, outputContract) => {
    const n = { id, title: id, kind, roles: kind === 'integration' ? ['research_integration_editor', 'research_integration_verifier'] : ['research_author'], expectedOutcome: 'x', acceptance: [], dependsOn: [] }
    if (outputContract !== undefined) n.outputContract = outputContract
    return n
  }
  const assemblyDefault = core.nodeContract({ nodes: [node('a', 'assembly')] }, 'a')
  assert.equal(assemblyDefault.outputContract.texMode, 'standalone', 'assembly without texMode must default to standalone')
  const assemblyExplicit = core.nodeContract({ nodes: [node('a', 'assembly', { texMode: 'fragment' })] }, 'a')
  assert.equal(assemblyExplicit.outputContract.texMode, 'fragment', 'explicit fragment must be preserved')
  const assemblyExplicitStandalone = core.nodeContract({ nodes: [node('a', 'assembly', { texMode: 'standalone' })] }, 'a')
  assert.equal(assemblyDefault.digest, assemblyExplicitStandalone.digest, 'defaulted and explicit standalone contracts must digest identically')
  const researchPlain = core.nodeContract({ nodes: [node('r', 'research')] }, 'r')
  assert.ok(!('texMode' in researchPlain.outputContract), 'non-assembly nodes must not gain a texMode default')
}

// ══════════════════════════════════════════════════════════════════════════
// 4. Assembled word count + skipLabelChecks (SOD #6 / WS1.6, #19 / WS1.7)
// ══════════════════════════════════════════════════════════════════════════
{
  assert.equal(core.countAssembledWords('Hello world % comment'), 2)
  assert.equal(core.countAssembledWords(''), 0)
  assert.equal(core.countAssembledWords('\\alpha = 1'), 2)

  const doc = '\\documentclass{article}\n\\begin{document}\nSee \\ref{missing}.\n\\end{document}\n'
  const strict = core.validateFinalTexStructure(doc, {})
  assert.ok(strict.errors.some((e) => e === 'Cross-reference to missing label: missing'), 'missing ref must fail by default')
  const skipped = core.validateFinalTexStructure(doc, { skipLabelChecks: true })
  assert.ok(!skipped.errors.some((e) => e.includes('missing label')), 'skipLabelChecks must suppress missing-label errors')
  assert.equal(skipped.ok, true)
}

// ══════════════════════════════════════════════════════════════════════════
// 5. .fls system-input whitelist (SOD #4 / WS1.5)
// ══════════════════════════════════════════════════════════════════════════
{
  const isTex = lib.helpers.isTexSystemInput
  for (const allowed of [
    '/usr/share/texmf/web2c/texmf.cnf',
    '/var/lib/texmf/fonts/pdftex/fmt/pdflatex.fmt',
    '/usr/share/texlive/2024/texmf-dist/fonts/pdftex/map/pdftex.map',
    '/etc/texmf/texmf.cnf',
    '/usr/local/texlive/2023/texmf-dist/web2c/pdftex',
    '/Library/TeX/texbin/../texmf-dist/fonts/type1',
  ]) {
    assert.equal(isTex(allowed), true, 'must allow system input: ' + allowed)
  }
  for (const rejected of ['/home/user/docs/other.sty', './local.sty', '/home/user/texlive-2023/custom.sty']) {
    assert.equal(isTex(rejected), false, 'must reject workspace-local input: ' + rejected)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 6. Shared TeX file resolver (SOD #6 / WS1.6): recursion, cycles, depth,
//    unresolvable targets.
// ══════════════════════════════════════════════════════════════════════════
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-tex-resolve-'))
  // Build a minimal fops on top of node fs rooted at `dir` so
  // resolveTexInputs can be exercised directly.
  const svc = {
    async resolve(target) { return path.isAbsolute(target) ? target : path.resolve(dir, target) },
    async readText(target) { return await fs.readFile(await svc.resolve(target), 'utf8') },
    async exists(target) { return (await svc.stat(target)) !== undefined },
    async stat(target) { try { return await fs.stat(await svc.resolve(target)) } catch { return undefined } },
    async lstat(target) { try { const info = await fs.lstat(await svc.resolve(target)); return { type: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : 'file' } } catch { return undefined } },
  }
  const join = (rel) => path.join(dir, rel)
  await fs.writeFile(join('main.tex'), '\\input{a}\n')
  await fs.writeFile(join('a.tex'), '\\input{b}\n\\input{missing}\n')
  await fs.writeFile(join('b.tex'), 'leaf content\n')
  const res = await lib.helpers.resolveTexInputs(svc, dir, 'main.tex')
  assert.deepEqual(res.files.map((f) => f.relPath), ['a.tex', 'b.tex'], 'nested inputs must be resolved in order')
  assert.deepEqual(res.unresolved, ['missing'], 'unresolvable targets must be reported')

  // Cycle guard: m3 -> cyc2 -> m3, in a fresh subdirectory.
  const cycleDir = path.join(dir, 'cycle')
  await fs.mkdir(cycleDir)
  const svc2 = {
    async resolve(target) { return path.isAbsolute(target) ? target : path.resolve(cycleDir, target) },
    async readText(target) { return await fs.readFile(await svc2.resolve(target), 'utf8') },
    async exists(target) { return (await svc2.stat(target)) !== undefined },
    async stat(target) { try { return await fs.stat(await svc2.resolve(target)) } catch { return undefined } },
  }
  await fs.writeFile(path.join(cycleDir, 'm3.tex'), '\\input{cyc2}\n')
  await fs.writeFile(path.join(cycleDir, 'cyc2.tex'), '\\input{m3}\n')
  const cyclic = await lib.helpers.resolveTexInputs(svc2, cycleDir, 'm3.tex')
  assert.deepEqual(cyclic.files.map((f) => f.relPath), ['cyc2.tex'], 'cycle must not loop forever')

  // Depth bound.
  for (let i = 0; i < 6; i++) await fs.writeFile(join('d' + i + '.tex'), '\\input{d' + (i + 1) + '}\n')
  const deep = await lib.helpers.resolveTexInputs(svc, dir, 'd0.tex', { maxDepth: 2 })
  assert.equal(deep.files.length, 2, 'depth must be bounded')
  assert.ok(deep.unresolved.length >= 1, 'targets beyond depth must be reported unresolved')

  // Nested imports resolve relative to the including file and cannot escape
  // the run root through traversal.
  await fs.mkdir(join('sections'))
  await fs.writeFile(join('sections/main.tex'), '\\input{child}\n')
  await fs.writeFile(join('sections/child.tex'), 'nested leaf\n')
  const nested = await lib.helpers.resolveTexInputs(svc, dir, 'sections/main.tex')
  assert.deepEqual(nested.files.map((f) => f.relPath), ['sections/child.tex'])
  await fs.writeFile(join('escape.tex'), '\\input{../outside}\n')
  await fs.writeFile(join('outside.tex'), 'must not resolve\n')
  const escaped = await lib.helpers.resolveTexInputs(svc, dir, 'escape.tex')
  assert.equal(escaped.files.length, 0)
  assert.ok(escaped.unresolved.some((item) => item.includes('escapes run directory')))

  await fs.writeFile(join('unsafe-paths.tex'), '\\input{/etc/passwd}\n\\input{C:\\secrets\\paper}\n')
  const unsafePaths = await lib.helpers.resolveTexInputs(svc, dir, 'unsafe-paths.tex')
  assert.equal(unsafePaths.files.length, 0)
  assert.equal(unsafePaths.unresolved.length, 2)
  assert.ok(unsafePaths.unresolved.every((item) => item.includes('escapes run directory')))

  const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-tex-external-'))
  await fs.writeFile(path.join(externalDir, 'secret.tex'), 'external content\n')
  await fs.symlink(externalDir, join('linked'))
  await fs.writeFile(join('symlink-main.tex'), '\\input{linked/secret}\n')
  const symlinked = await lib.helpers.resolveTexInputs(svc, dir, 'symlink-main.tex')
  assert.equal(symlinked.files.length, 0)
  assert.deepEqual(symlinked.unresolved, ['linked/secret'])
  await fs.rm(externalDir, { recursive: true, force: true })

  await fs.rm(dir, { recursive: true, force: true })
}

// ══════════════════════════════════════════════════════════════════════════
// 7. Missing-source diagnostic + candidate listing (SOD #9 / WS1.9, #1 / WS1.1)
// ══════════════════════════════════════════════════════════════════════════
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-tex-missing-'))
  const svc = {
    async listDir(target) {
      try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, dir: entry.isDirectory() })) } catch { return [] }
    },
  }
  const empty = await lib.helpers.missingSourceDiagnostic(svc, dir, 'output.tex')
  assert.ok(empty.includes('Expected output source "output.tex" is missing'), empty)
  assert.ok(empty.includes('(empty)'), empty)

  await fs.mkdir(path.join(dir, 'pass_01'))
  await fs.writeFile(path.join(dir, 'pass_01', 'A.tex'), 'a\n')
  await fs.writeFile(path.join(dir, 'final.log'), 'log\n')
  await fs.writeFile(path.join(dir, 'final.aux'), 'aux\n')
  await fs.writeFile(path.join(dir, 'final.pdf'), 'pdf\n')
  const orphaned = await lib.helpers.missingSourceDiagnostic(svc, dir, 'output.tex')
  assert.ok(orphaned.includes('Directory contains'), orphaned)
  assert.ok(orphaned.includes('Sanctioned cleanup is `latexmk -C`'), 'orphaned artifacts must point at latexmk -C: ' + orphaned)
  const candidates = await lib.helpers.listPassTexCandidates(svc, dir)
  assert.deepEqual(candidates, ['pass_01/A.tex'])
  await fs.rm(dir, { recursive: true, force: true })
}

// ══════════════════════════════════════════════════════════════════════════
// 8. Mounted e2e: bound runs, record_acceptance, tex_check, tex_final_check
// ══════════════════════════════════════════════════════════════════════════
const projectDir = path.join(baseDir, '.research-agent', 'projects', 'tex-acc')
await fs.mkdir(path.join(projectDir, 'revision-requests'), { recursive: true })
const plan = canonicalPlan({
  projectId: 'tex-acc', projectName: 'Tex acceptance', approvedAt: '2026-01-01T00:00:00.000Z', revision: 1, integrationId: 'integration',
  projectContract: {
    goal: 'Exercise TeX acceptance.',
    deliverables: [],
    acceptance: [criterion('PROJECT-01', 'Complete.')],
    test: '',
    wordBudget: null,
    rebuildable: false,
    diagnosticMappings: [],
  },
  nodes: [
    canonicalNode({ id: 'lit', kind: 'literature', roles: ['research_literature_writer'], title: 'Lit', expectedOutcome: 'Lit.', acceptance: [criterion('LIT-01', 'Lit exists.')] }),
    canonicalNode({ id: 'notes', kind: 'research', roles: ['research_author'], artifactFormat: 'markdown', title: 'Notes', expectedOutcome: 'Notes.', acceptance: [criterion('NOT-01', 'Notes exist.')] }),
    canonicalNode({ id: 'assembly', kind: 'assembly', roles: ['research_coder', 'research_unit_tester'], title: 'Assembly', expectedOutcome: 'Assembled.', acceptance: [criterion('ASM-01', 'Assembled.')], dependsOn: ['lit', 'notes'] }),
    canonicalNode({ id: 'integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], title: 'Integration', expectedOutcome: 'Final.', acceptance: [criterion('INT-01', 'Final.')], dependsOn: ['assembly'] }),
  ],
})
await fs.writeFile(path.join(projectDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')

const initRun = registered.get('autoresearch_init_run')
const recordAcceptance = registered.get('autoresearch_record_acceptance')
const texCheck = registered.get('autoresearch_tex_check')
const texFinalCheck = registered.get('autoresearch_tex_final_check')

// ── 8a. init_run normalizes the assembly contract to standalone ──────────
const assemblyInit = await initRun.execute({ projectId: 'tex-acc', nodeId: 'assembly', issueId: 'tex-acc-assembly', issueTitle: 'Assembly run', sourceType: 'local' }, exec)
assert.equal(assemblyInit.unbound, false, 'assembly run must bind to its node contract')
const assemblyRunDirAbs = path.join(baseDir, assemblyInit.runDir)
const assemblyContractFile = JSON.parse(await fs.readFile(path.join(assemblyRunDirAbs, 'node-contract.json'), 'utf8'))
assert.equal(assemblyContractFile.contract.outputContract.texMode, 'standalone', 'init_run must write a standalone assembly contract')
const assemblyRunDir = assemblyInit.runDir

// ── 8b. record_acceptance with output.tex missing → recipe (SOD #1) ──────
const litInit = await initRun.execute({ projectId: 'tex-acc', nodeId: 'lit', issueId: 'tex-acc-lit', issueTitle: 'Lit run', sourceType: 'local' }, exec)
const litRunDirAbs = path.join(baseDir, litInit.runDir)
await fs.mkdir(path.join(litRunDirAbs, 'pass_01'), { recursive: true })
await fs.mkdir(path.join(litRunDirAbs, 'pass_02'), { recursive: true })
await fs.writeFile(path.join(litRunDirAbs, 'pass_01', 'A.tex'), 'a\n')
await fs.writeFile(path.join(litRunDirAbs, 'pass_02', 'AB.tex'), 'ab\n')
await fs.writeFile(path.join(litRunDirAbs, 'final.log'), 'log\n')
await fs.writeFile(path.join(litRunDirAbs, 'final.aux'), 'aux\n')
await fs.writeFile(path.join(litRunDirAbs, 'final.pdf'), 'pdf\n')
let missingError = null
try {
  await recordAcceptance.execute({ runDir: litInit.runDir, criteria: [{ id: 'LIT-01', result: 'PASS' }] }, exec)
} catch (error) { missingError = error }
assert.ok(missingError, 'record_acceptance must fail when output.tex is missing')
const msg = String(missingError.message)
assert.ok(msg.includes('Expected output source "output.tex" is missing'), msg)
assert.ok(msg.includes('autoresearch_promote_artifact'), 'recipe must name the promotion tool: ' + msg)
assert.ok(msg.includes('destinationPath "output.tex"'), 'recipe must give the destination: ' + msg)
assert.ok(msg.includes('pass_01/A.tex') && msg.includes('pass_02/AB.tex'), 'recipe must list the candidate files: ' + msg)
assert.ok(msg.includes('latexmk -C'), 'orphaned build artifacts must point at latexmk -C: ' + msg)

// ── 8c. tex_check with output.tex missing → diagnostic record (SOD #9) ───
const missingRecord = await texCheck.execute({ runDir: litInit.runDir }, exec)
assert.equal(missingRecord.staticOk, false)
assert.ok(missingRecord.errors[0].includes('Expected output source "output.tex" is missing'), JSON.stringify(missingRecord.errors))
assert.ok(missingRecord.errors[0].includes('Directory contains'), JSON.stringify(missingRecord.errors))

// ── 8d. texMode guardrail: fragment + no template + complete document ────
await fs.writeFile(path.join(litRunDirAbs, 'output.tex'), '\\documentclass{article}\n\\begin{document}\nFull document.\n\\end{document}\n')
const guardRecord = await texCheck.execute({ runDir: litInit.runDir }, exec)
assert.equal(guardRecord.staticOk, false)
assert.ok(guardRecord.errors[0].includes('texMode: standalone'), 'guardrail must name the fix: ' + JSON.stringify(guardRecord.errors))
assert.ok(guardRecord.errors[0].includes('fragment'), JSON.stringify(guardRecord.errors))

// ── 8e. record_acceptance success: standalone + real build + drift warns ─
{
  const assemblyText = '\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\newcommand{\\R}{\\mathbb{R}}\n\\begin{document}\nThe reals are $\\R$ and $x^2$ is quadratic.\n\\end{document}\n'
  await fs.writeFile(path.join(assemblyRunDirAbs, 'output.tex'), assemblyText)
  const result = await recordAcceptance.execute({
    runDir: assemblyRunDir,
    criteria: [{ id: 'ASM-01', result: 'PASS' }],
  }, exec)
  assert.equal(result.ok, true, 'standalone acceptance must pass despite an empty declared list (scanner is the source of truth)')
  assert.equal(result.receipt.overall, 'PASS')
  assert.ok(Array.isArray(result.receipt.derivedDeclared?.packages), 'receipt must carry derivedDeclared')
  assert.ok(result.receipt.derivedDeclared.packages.includes('amsmath'), JSON.stringify(result.receipt.derivedDeclared))
  assert.ok(result.receipt.derivedDeclared.macros.includes('R'), JSON.stringify(result.receipt.derivedDeclared))
  assert.ok(result.receipt.warnings.length >= 2, 'receipt must record drift warnings: ' + JSON.stringify(result.receipt.warnings))
  const onDisk = JSON.parse(await fs.readFile(path.join(assemblyRunDirAbs, 'acceptance.json'), 'utf8'))
  assert.ok(onDisk.derivedDeclared && Array.isArray(onDisk.warnings), 'acceptance.json must persist derivedDeclared + warnings')
}

// ── 8f. record_acceptance success: markdown node (no TeX) ────────────────
{
  const notesInit = await initRun.execute({ projectId: 'tex-acc', nodeId: 'notes', issueId: 'tex-acc-notes', issueTitle: 'Notes run', sourceType: 'local' }, exec)
  await fs.writeFile(path.join(baseDir, notesInit.runDir, 'final.md'), '# Notes\n\nSome notes.\n')
  const result = await recordAcceptance.execute({ runDir: notesInit.runDir, criteria: [{ id: 'NOT-01', result: 'PASS' }] }, exec)
  assert.equal(result.ok, true)
  assert.equal(result.receipt.derivedDeclared, null, 'markdown receipts must not carry derivedDeclared')
  assert.deepEqual(result.receipt.warnings, [])

  // Missing non-tex source → shared diagnostic, no promotion recipe.
  const notesInit2 = await initRun.execute({ projectId: 'tex-acc', nodeId: 'notes', issueId: 'tex-acc-notes2', issueTitle: 'Notes run 2', sourceType: 'local' }, exec)
  let mdError = null
  try {
    await recordAcceptance.execute({ runDir: notesInit2.runDir, criteria: [{ id: 'NOT-01', result: 'PASS' }] }, exec)
  } catch (error) { mdError = error }
  assert.ok(mdError, 'markdown acceptance must fail without final.md')
  assert.ok(String(mdError.message).includes('Expected output source "final.md" is missing'), String(mdError.message))
  assert.ok(!String(mdError.message).includes('promote_artifact'), 'markdown recipe must not mention TeX promotion')
}

// ── 8g. tex_final_check: modular assembly resolves across \input files ───
{
  const dir = path.join(baseDir, 'final-check-assembly')
  await fs.mkdir(dir, { recursive: true })
  const finalTex = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nSee \\ref{eq:alpha} and \\cite{knuth1984}.\n\\input{sec}\n\\end{document}\n'
  const secTex = 'The assembled fragment contributes several countable words.\n\\begin{equation}\nx^2 = 1 \\label{eq:alpha}\n\\end{equation}\n'
  await fs.writeFile(path.join(dir, 'final.tex'), finalTex)
  await fs.writeFile(path.join(dir, 'sec.tex'), secTex)
  const rel = path.relative(baseDir, dir)
  const record = await texFinalCheck.execute({ runDir: rel, bibliographyKeys: ['knuth1984'] }, exec)
  assert.equal(record.staticOk, true, JSON.stringify(record.staticErrors))
  assert.equal(record.citationCount, 1, 'citation in final.tex must be counted')
  assert.ok(record.labelCount >= 1, 'label living in sec.tex must be counted via the resolver')
  assert.deepEqual(record.includedInputs, ['sec.tex'])
  assert.deepEqual(record.unresolvedInputs, [])
  assert.equal(record.labelCheck.ok, true)
  assert.equal(record.labelCheck.degraded, null)
  assert.deepEqual(record.labelCheck.warnings, [])
  assert.ok(record.wordCount > 0, 'word count must include the assembled fragment')
  assert.equal(record.ok, true, JSON.stringify(record.staticErrors))

  // ── 8g-i. texcount unavailable → assembled word-count fallback ─────────
  failNames.add('texcount')
  const fallback = await texFinalCheck.execute({ runDir: rel, bibliographyKeys: ['knuth1984'] }, exec)
  failNames.delete('texcount')
  assert.equal(fallback.wordCountSource, 'assembled-fallback', JSON.stringify(fallback.wordCountSource))
  assert.equal(fallback.wordCount, core.countAssembledWords(finalTex + '\n' + secTex), 'fallback must count the assembled text')
  assert.ok(fallback.wordCount >= record.wordCount * 0.5, 'fallback count must not under-count the assembly')
}

// ── 8h. tex_final_check: unresolved input degrades label check to warns ──
{
  const dir = path.join(baseDir, 'final-check-missing-input')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'final.tex'), '\\documentclass{article}\n\\begin{document}\nSee \\ref{eq:ghost}.\n\\input{missing}\n\\end{document}\n')
  const rel = path.relative(baseDir, dir)
  const record = await texFinalCheck.execute({ runDir: rel }, exec)
  assert.equal(record.labelCheck.degraded, 'fragments-unavailable', JSON.stringify(record.labelCheck))
  assert.ok(record.labelCheck.warnings.some((w) => w.includes('eq:ghost') && w.includes('warning only')), JSON.stringify(record.labelCheck.warnings))
  assert.ok(!record.staticErrors.some((e) => e.includes('Cross-reference to missing label')), 'unavailable fragments must not hard-fail labels: ' + JSON.stringify(record.staticErrors))
}

// ── 8i. tex_final_check: available input + missing ref is still a hard fail ─
{
  const dir = path.join(baseDir, 'final-check-hard-label')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'final.tex'), '\\documentclass{article}\n\\begin{document}\nSee \\ref{eq:missing}.\n\\input{sec}\n\\end{document}\n')
  await fs.writeFile(path.join(dir, 'sec.tex'), 'no labels here.\n')
  const rel = path.relative(baseDir, dir)
  const record = await texFinalCheck.execute({ runDir: rel }, exec)
  assert.ok(record.staticErrors.some((e) => e === 'Cross-reference to missing label: eq:missing'), 'hard label failure must remain when all sources are available: ' + JSON.stringify(record.staticErrors))
  assert.equal(record.labelCheck.degraded, null)
}

// ── 8j. tex_final_check: final.tex missing → diagnostic, no build attempt ─
{
  const dir = path.join(baseDir, 'final-check-missing')
  await fs.mkdir(dir, { recursive: true })
  const rel = path.relative(baseDir, dir)
  const record = await texFinalCheck.execute({ runDir: rel }, exec)
  assert.equal(record.ok, false)
  assert.ok(record.staticErrors[0].includes('Expected output source "final.tex" is missing'), JSON.stringify(record.staticErrors))
  assert.equal(record.labelCheck.degraded, 'final-source-missing')
  assert.ok(!(await fs.readdir(dir)).some((name) => name.endsWith('.log')), 'no build may be attempted without the source')
}

// ── 8k. texcount -sum parsing (input-based masters, plan §11) ─────────────
{
  assert.equal(core.parseTexcountWords('Words in text: 1234\n'), 1234, 'the texcount total is the counted value')
  assert.equal(core.parseTexcountWords('Words in text: 500\nSum count: 999.\n'), 500, 'the Words-in-text total is what the parser consumes')
  assert.equal(core.parseTexcountWords('no count here'), null)
}

await fs.rm(baseDir, { recursive: true, force: true })
console.log('tex acceptance tests passed for generation ' + manifest.generation)
