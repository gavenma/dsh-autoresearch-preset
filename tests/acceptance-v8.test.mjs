// WS1 v8 — acceptance records and format-aware diagnostics (plan WS1 v8).
//
// Covers: outputContract.artifactPath honored by record_acceptance (and the
// canonical requirement that it be explicit — no hidden format default), the
// format-aware missing-source diagnostic (no LaTeX mentions for non-TeX
// artifacts), the receipt's explicit artifact record { path, format, sha256 },
// the accepted finalBuild capture for TeX runs, and the exposed-TeX
// source-usability precondition (missing inputs / unresolved labels fail
// acceptance with owner identification; PDF-only exposure skips the check
// entirely).
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { plan as canonicalPlan, node as canonicalNode, criterion } from './helpers/canonical-fixtures.mjs'
import { texAvailable } from './helpers/toolchain.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)
const { default: orchestrator, createLibraries: lib } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
assert.equal(typeof lib.helpers.exposedSourceUsability, 'function')
assert.equal(typeof lib.helpers.captureFinalBuild, 'function')

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const NOW = '2026-01-01T00:00:00.000Z'

const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-acceptance-v8-'))
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, options = {}) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
  },
  async readBytes(target, _options, maxBytes) {
    const data = await fs.readFile(target)
    if (!maxBytes) return data
    const copy = new Uint8Array(Math.min(data.length, maxBytes))
    copy.set(data.subarray(0, copy.length))
    return copy
  },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}
const failNames = new Set()
const subprocess = {
  async resolveExecutable(name) {
    if (failNames.has(name)) throw new Error('Executable not resolvable: ' + name)
    const find = (n) => {
      if (n.includes('/')) { try { fsSync.accessSync(n, fsSync.constants.X_OK); return n } catch { return null } }
      for (const dir of String(process.env.PATH ?? '').split(':')) {
        if (!dir) continue
        const candidate = path.join(dir, n)
        try { fsSync.accessSync(candidate, fsSync.constants.X_OK); return candidate } catch {}
      }
      return null
    }
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


const registered = new Map()
orchestrator.apply({
  get(name) {
    if (name === 'fs') return fileService
    if (name === 'subprocess') return subprocess
    if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
    return undefined
  },
})
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
const initRun = registered.get('autoresearch_init_run')
const recordAcceptance = registered.get('autoresearch_record_acceptance')

async function write(base, rel, content) {
  const abs = path.join(base, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
  return abs
}

// Write an approved canonical plan + journal, then bind runs via the REAL init_run.
async function makeBoundProject({ projectId, plan, issueIds, validate = true }) {
  const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
  await write(projectDir, 'plan.json', JSON.stringify(plan, null, 2) + '\n')
  if (validate) {
    const validation = core.validatePlan(plan)
    assert.equal(validation.ok, true, 'fixture plan must validate: ' + validation.errors.join('; '))
  }
  const state = {
    kind: 'project-state', projectId, marker: 'autoresearch-project:' + projectId, createdAt: NOW, updatedAt: NOW,
    project: { linearProjectId: '', url: '', createdAt: '' },
    integrationRevision: 1, nodes: {}, commentCursors: {}, lastError: '',
  }
  for (const node of plan.nodes) {
    state.nodes[node.id] = { status: 'todo', issueId: issueIds[node.id] ?? '', identifier: issueIds[node.id] ?? '', url: '', linearState: '', runDir: '', runStatus: '', currentStep: '', currentPass: null, hasFinal: false, finalCommentId: '', receipts: [], updatedAt: NOW }
  }
  await write(projectDir, 'state.json', JSON.stringify(state, null, 2) + '\n')
  const inits = {}
  for (const [nodeId, issueId] of Object.entries(issueIds)) {
    inits[nodeId] = await initRun.execute({ projectId, nodeId, issueId, issueTitle: nodeId + ' issue', sourceType: 'local' }, exec)
    assert.equal(inits[nodeId].unbound, false, nodeId + ' run must bind')
  }
  // Record the run dirs in the journal (the coordinator does this in the
  // live flow; owner-identification diagnostics read them from state.json).
  for (const [nodeId, init] of Object.entries(inits)) {
    state.nodes[nodeId].issueId = init.issueId
    state.nodes[nodeId].runDir = init.runDir
    state.nodes[nodeId].updatedAt = new Date().toISOString()
  }
  await write(projectDir, 'state.json', JSON.stringify(state, null, 2) + '\n')
  return { projectDir, inits }
}

// ── 1. artifactPath: custom artifact name is accepted and recorded ────────
{
  const plan = canonicalPlan({
    projectId: 'art-proj',
    projectName: 'ART',
    projectContract: {
      goal: 'Artifact path fixture.',
      deliverables: ['report.md'],
      acceptance: [criterion('PROJECT-01', 'Complete.')],
      test: '',
      wordBudget: null,
      rebuildable: false,
      diagnosticMappings: [],
    },
    nodes: [
      canonicalNode({
        id: 'integration',
        kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        artifactFormat: 'markdown',
        expectedOutcome: 'Final.',
        acceptance: [criterion('INT-01', 'Final.')],
        outputContract: { artifactPath: 'report.md' },
      }),
    ],
  })
  const { inits } = await makeBoundProject({ projectId: 'art-proj', plan, issueIds: { integration: 'ART-INT' } })
  const runDirAbs = path.join(baseDir, inits.integration.runDir)
  await write(runDirAbs, 'report.md', '# Report\n\nAccepted custom artifact.\n')
  const result = await recordAcceptance.execute({ runDir: inits.integration.runDir, criteria: [{ id: 'INT-01', result: 'PASS' }] }, exec)
  assert.equal(result.ok, true, JSON.stringify(result))
  const receipt = JSON.parse(await fs.readFile(path.join(runDirAbs, 'acceptance.json'), 'utf8'))
  assert.equal(receipt.artifact.path, 'report.md', 'receipt must record the contract artifactPath')
  assert.equal(receipt.artifact.format, 'markdown')
  assert.equal(receipt.artifact.sha256, sha256('# Report\n\nAccepted custom artifact.\n'))
  assert.equal(receipt.outputHash, receipt.artifact.sha256, 'outputHash stays the compatibility alias')
  assert.equal(receipt.finalBuild, null, 'markdown runs carry no finalBuild record')
  // Canonical cut: there is no hidden format default. A contract without an
  // explicit artifactPath fails validation with a field-specific error, and
  // init_run refuses to contract-bind against such a plan.
  const noPathPlan = canonicalPlan({
    projectId: 'artdef-proj',
    projectName: 'ARTDEF',
    projectContract: {
      goal: 'Artifact path fixture.',
      deliverables: ['final.md'],
      acceptance: [criterion('PROJECT-01', 'Complete.')],
      test: '',
      wordBudget: null,
      rebuildable: false,
      diagnosticMappings: [],
    },
    nodes: [
      canonicalNode({
        id: 'integration',
        kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        artifactFormat: 'markdown',
        expectedOutcome: 'Final.',
        acceptance: [criterion('INT-01', 'Final.')],
        outputContract: {},
      }),
    ],
  })
  await makeBoundProject({ projectId: 'artdef-proj', plan: noPathPlan, issueIds: {}, validate: false })
  const noPathValidation = core.validatePlan(noPathPlan)
  assert.equal(noPathValidation.ok, false, 'a node contract without an explicit artifactPath must not validate')
  assert.ok(noPathValidation.errors.some((entry) => String(entry).includes('outputContract.artifactPath')), 'field-specific error expected: ' + noPathValidation.errors.join('; '))
  let bindError = null
  try {
    await initRun.execute({ projectId: 'artdef-proj', nodeId: 'integration', issueId: 'ARTDEF-INT2', issueTitle: 'default artifact', sourceType: 'local' }, exec)
  } catch (err) { bindError = err }
  assert.ok(bindError, 'init_run must refuse to contract-bind against an invalid plan')
  assert.ok(String(bindError.message).includes('approved plan is invalid'), String(bindError.message))
}

// ── 2. Format-aware missing-source diagnostic (no LaTeX for markdown) ─────
{
  const plan = canonicalPlan({
    projectId: 'diag-proj',
    projectName: 'DIAG',
    projectContract: {
      goal: 'Diag fixture.',
      deliverables: ['final.md'],
      acceptance: [criterion('PROJECT-01', 'Complete.')],
      test: '',
      wordBudget: null,
      rebuildable: false,
      diagnosticMappings: [],
    },
    nodes: [
      canonicalNode({
        id: 'integration',
        kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        artifactFormat: 'markdown',
        expectedOutcome: 'Final.',
        acceptance: [criterion('INT-01', 'Final.')],
        outputContract: { artifactPath: 'final.md' },
      }),
    ],
  })
  const { inits } = await makeBoundProject({ projectId: 'diag-proj', plan, issueIds: { integration: 'DIAG-INT' } })
  let error = null
  try {
    await recordAcceptance.execute({ runDir: inits.integration.runDir, criteria: [{ id: 'INT-01', result: 'PASS' }] }, exec)
  } catch (err) { error = err }
  assert.ok(error, 'acceptance must fail without the artifact')
  const msg = String(error.message)
  assert.ok(msg.includes('Expected output source "final.md" is missing'), msg)
  assert.ok(msg.includes('(Artifact format: markdown'), 'diagnostic must name the format: ' + msg)
  assert.ok(!msg.includes('latexmk'), 'markdown diagnostic must not mention latexmk: ' + msg)
  assert.ok(!msg.includes('promote_artifact'), 'markdown diagnostic must not give the TeX promotion recipe: ' + msg)
}

// ── 3. Exposed-TeX source usability: missing input fails acceptance ───────
{
  const master = '\\documentclass{article}\n\\begin{document}\n\\input{ghost}\n\\end{document}\n'
  const cert = '\\documentclass{article}\n\\begin{document}\nCertificate.\n\\end{document}\n'
  const plan = canonicalPlan({
    projectId: 'usab-proj',
    projectName: 'USAB',
    projectContract: {
      goal: 'Usability fixture.',
      deliverables: ['final.tex'],
      acceptance: [criterion('PROJECT-01', 'Complete.')],
      test: '',
      wordBudget: null,
      rebuildable: false,
      diagnosticMappings: [],
    },
    nodes: [
      canonicalNode({
        id: 'author',
        kind: 'research',
        roles: ['research_author'],
        expectedOutcome: 'a.',
        acceptance: [criterion('AUT-01', 'a.')],
        outputContract: { artifactPath: 'output.tex', texMode: 'fragment' },
      }),
      canonicalNode({
        id: 'integration',
        kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        expectedOutcome: 'Final.',
        acceptance: [criterion('INT-01', 'Final.')],
        outputContract: { artifactPath: 'output.tex', texMode: 'standalone' },
        dependsOn: ['author'],
      }),
    ],
  })
  const { inits } = await makeBoundProject({ projectId: 'usab-proj', plan, issueIds: { author: 'USAB-AUTH', integration: 'USAB-INT' } })
  const intRunAbs = path.join(baseDir, inits.integration.runDir)
  const authorRunAbs = path.join(baseDir, inits.author.runDir)
  await write(intRunAbs, 'output.tex', cert)
  await write(intRunAbs, 'final.tex', master)
  await write(authorRunAbs, 'output.tex', 'Author fragment.\n')
  let error = null
  try {
    await recordAcceptance.execute({ runDir: inits.integration.runDir, criteria: [{ id: 'INT-01', result: 'PASS' }] }, exec)
  } catch (err) { error = err }
  assert.ok(error, 'acceptance must fail when the exposed master has a missing input')
  const msg3 = String(error.message)
  if (texAvailable) {
    assert.ok(msg3.includes('missing local input for the exposed TeX source final.tex: ghost'), msg3)
  } else {
    // Toolchain-less runners fail at the strict build first (the wrapped
    // diagnostic), which is still a hard failure, never a pass.
    assert.ok(msg3.includes('Strict TeX validation failed before acceptance'), msg3)
  }
}

// ── 4. Unresolved \ref names the owning node when identifiable ─────────────
{
  const master = '\\documentclass{article}\n\\begin{document}\nSee \\ref{eq:other}.\n\\end{document}\n'
  const cert = '\\documentclass{article}\n\\begin{document}\nCertificate.\n\\end{document}\n'
  const authorFragment = '\\begin{equation}\nx = 1 \\label{eq:other}\n\\end{equation}\n'
  const plan = canonicalPlan({
    projectId: 'refl-proj',
    projectName: 'REFL',
    projectContract: {
      goal: 'Ref owner fixture.',
      deliverables: ['final.tex'],
      acceptance: [criterion('PROJECT-01', 'Complete.')],
      test: '',
      wordBudget: null,
      rebuildable: false,
      diagnosticMappings: [],
    },
    nodes: [
      canonicalNode({
        id: 'author',
        kind: 'research',
        roles: ['research_author'],
        expectedOutcome: 'a.',
        acceptance: [criterion('AUT-01', 'a.')],
        outputContract: { artifactPath: 'output.tex', texMode: 'fragment' },
      }),
      canonicalNode({
        id: 'integration',
        kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        expectedOutcome: 'Final.',
        acceptance: [criterion('INT-01', 'Final.')],
        outputContract: { artifactPath: 'output.tex', texMode: 'standalone' },
        dependsOn: ['author'],
      }),
    ],
  })
  const { inits } = await makeBoundProject({ projectId: 'refl-proj', plan, issueIds: { author: 'REFL-AUTH', integration: 'REFL-INT' } })
  const intRunAbs = path.join(baseDir, inits.integration.runDir)
  const authorRunAbs = path.join(baseDir, inits.author.runDir)
  await write(intRunAbs, 'output.tex', cert)
  await write(intRunAbs, 'final.tex', master)
  await write(authorRunAbs, 'output.tex', authorFragment)
  let error = null
  try {
    await recordAcceptance.execute({ runDir: inits.integration.runDir, criteria: [{ id: 'INT-01', result: 'PASS' }] }, exec)
  } catch (err) { error = err }
  assert.ok(error, 'acceptance must fail on an unresolved ref in the exposed master')
  const msg = String(error.message)
  if (texAvailable) {
    assert.ok(msg.includes('unresolved \\ref target "eq:other"'), msg)
    assert.ok(msg.includes('node author'), 'diagnostic must name the owning node: ' + msg)
  } else {
    assert.ok(msg.includes('Strict TeX validation failed before acceptance'), msg)
  }
}

// ── 5. Resolvable exposed master passes (real build when available) ────────
{
  const master = '\\documentclass{article}\n\\begin{document}\n\\section{Main}\\label{sec:main}\n\\input{sec}\nSee \\ref{eq:here}.\n\\end{document}\n'
  const sec = 'Fragment.\n\\begin{equation}\ny = 2 \\label{eq:here}\n\\end{equation}\n'
  const cert = '\\documentclass{article}\n\\begin{document}\nCertificate.\n\\end{document}\n'
  const plan = canonicalPlan({
    projectId: 'okusab-proj',
    projectName: 'OKUSAB',
    projectContract: {
      goal: 'Usability pass fixture.',
      deliverables: ['final.tex', 'final.pdf'],
      acceptance: [criterion('PROJECT-01', 'Complete.')],
      test: '',
      wordBudget: null,
      rebuildable: true,
      diagnosticMappings: [],
    },
    nodes: [
      canonicalNode({
        id: 'integration',
        kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        expectedOutcome: 'Final.',
        acceptance: [criterion('INT-01', 'Final.')],
        outputContract: { artifactPath: 'output.tex', texMode: 'standalone' },
      }),
    ],
  })
  const { inits } = await makeBoundProject({ projectId: 'okusab-proj', plan, issueIds: { integration: 'OKUSAB-INT' } })
  const intRunAbs = path.join(baseDir, inits.integration.runDir)
  await write(intRunAbs, 'output.tex', cert)
  await write(intRunAbs, 'final.tex', master)
  await write(intRunAbs, 'sec.tex', sec)
  let error = null
  let result = null
  try {
    result = await recordAcceptance.execute({ runDir: inits.integration.runDir, criteria: [{ id: 'INT-01', result: 'PASS' }] }, exec)
  } catch (err) { error = err }
  if (texAvailable) {
    assert.equal(error, null, 'resolvable exposed master must accept: ' + (error && error.message))
    assert.equal(result.ok, true)
  } else {
    // Without latexmk the strict build cannot run — the usability check
    // itself must still be the ONLY possible failure class here; verify the
    // acceptance attempt reached the build (not the usability precondition).
    assert.ok(!String(error?.message ?? '').includes('Exposed-TeX source usability'), 'usability must not fail: ' + (error && error.message))
  }
}

// ── 6. PDF-only exposure skips the source-usability precondition ───────────
{
  const master = '\\documentclass{article}\n\\begin{document}\n\\input{ghost}\n\\end{document}\n'
  const cert = '\\documentclass{article}\n\\begin{document}\nCertificate.\n\\end{document}\n'
  const finalPdf = Buffer.from('%PDF-1.7 final\n')
  const plan = canonicalPlan({
    projectId: 'pdfonly-proj',
    projectName: 'PDFONLY',
    projectContract: {
      goal: 'PDF-only fixture.',
      deliverables: ['final.pdf'],
      acceptance: [criterion('PROJECT-01', 'Complete.')],
      test: '',
      wordBudget: null,
      rebuildable: false,
      diagnosticMappings: [],
    },
    nodes: [
      canonicalNode({
        id: 'integration',
        kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        expectedOutcome: 'Final.',
        acceptance: [criterion('INT-01', 'Final.')],
        outputContract: { artifactPath: 'output.tex', texMode: 'standalone' },
      }),
    ],
  })
  const { inits } = await makeBoundProject({ projectId: 'pdfonly-proj', plan, issueIds: { integration: 'PDFONLY-INT' } })
  const intRunAbs = path.join(baseDir, inits.integration.runDir)
  await write(intRunAbs, 'output.tex', cert)
  await write(intRunAbs, 'final.tex', master)
  await write(intRunAbs, 'final.pdf', finalPdf)
  let error = null
  let result = null
  try {
    result = await recordAcceptance.execute({ runDir: inits.integration.runDir, criteria: [{ id: 'INT-01', result: 'PASS' }] }, exec)
  } catch (err) { error = err }
  if (texAvailable) {
    assert.equal(error, null, 'PDF-only exposure must not run the TeX source usability precondition: ' + (error && error.message))
    assert.equal(result.ok, true)
  } else {
    assert.ok(!String(error?.message ?? '').includes('Exposed-TeX source usability'), 'usability must not run: ' + (error && error.message))
  }
  if (texAvailable) {
    const receipt = JSON.parse(await fs.readFile(path.join(intRunAbs, 'acceptance.json'), 'utf8'))
    // finalBuild capture: exposed final.tex + accepted PDF (no recorder in
    // the run dir, so fls fields are absent).
    assert.ok(receipt.finalBuild, 'tex acceptance must capture the finalBuild record')
    assert.equal(receipt.finalBuild.sourcePath, 'final.tex')
    assert.equal(receipt.finalBuild.sourceHash, sha256(master))
    assert.equal(receipt.finalBuild.pdfPath, 'final.pdf')
    assert.equal(receipt.finalBuild.pdfHash, sha256(finalPdf))
    assert.equal(receipt.finalBuild.flsPath, undefined, 'no recorder present, no fls fields')
    assert.equal(receipt.artifact.path, 'output.tex', 'tex default artifact path')
    assert.equal(receipt.artifact.format, 'tex')
  }
}

await fs.rm(baseDir, { recursive: true, force: true })
console.log('acceptance v8 tests passed for generation ' + manifest.generation)
