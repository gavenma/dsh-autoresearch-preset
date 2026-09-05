#!/usr/bin/env node
// Layer 4 — real-project acceptance for the v8 exposure policy
// (plan Validation Layers 4; rollout gate, opt-in, not part of `npm test`).
//
// Runs small real projects from briefs/demo-brief.md against the BUILT
// bundle with REAL filesystem I/O and REAL TeX tooling (latexmk/pdflatex/
// bibtex/texcount when installed):
//
//   A. demo-webgpu-md     Markdown/report project with a requested companion
//                         (process-notes.md) and one explicit diagnostic
//                         mapping (audit/). No TeX anywhere.
//   B. demo-webgpu-tex-pdf TeX project exposing ONLY the compiled PDF —
//                         no synthetic source closure, no .fls requirement.
//   C. demo-webgpu-tex-full TeX project exposing the source + PDF + bibs with
//                         rebuildable: true — .fls closure + bibliography
//                         union published, then rebuilt from a CLEAN copy of
//                         the published folder to prove relocatability.
//
// For each run: the real init_run / record_acceptance / tex_final_check /
// finalize_run tools drive the flow; artifacts are deterministic (the LLM
// loop itself is covered by the role-runner, causal-mounted e2e, and the
// live smokes). Collects per run: tool-call log, state.json, MANIFEST.json,
// sorted output tree, and the hidden temp-retention summary.
//
//   node scripts/layer4-acceptance.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn as nodeSpawn, execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

const NOW = new Date().toISOString()
const brief = await fs.readFile(path.join(root, 'briefs', 'demo-brief.md'), 'utf8')

// Artifacts land in a git-ignored workspace directory (the sandbox /tmp is
// not shared across tool invocations); override with LAYER4_OUT_ROOT.
let outRoot
if (process.env.LAYER4_OUT_ROOT) {
  outRoot = process.env.LAYER4_OUT_ROOT
  await fs.mkdir(outRoot, { recursive: true })
} else {
  await fs.mkdir(path.join(root, 'tmp'), { recursive: true })
  outRoot = await fs.mkdtemp(path.join(root, 'tmp', 'layer4-'))
}
const report = { outRoot, runs: [] }
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function hasExec(name) {
  for (const dir of String(process.env.PATH ?? '').split(':')) {
    if (!dir) continue
    try { fsSync.accessSync(path.join(dir, name), fsSync.constants.X_OK); return true } catch {}
  }
  return false
}
const texAvailable = hasExec('latexmk') && hasExec('pdflatex')
if (!texAvailable) {
  console.error('Layer 4 requires a TeX toolchain (latexmk + pdflatex) for runs B and C.')
  process.exit(2)
}

// ── mount: real fs, real subprocess, tool capture ───────────────────────────
const mount = (baseDir) => {
  const fileService = {
    async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
    async readText(target) { return await fs.readFile(target, 'utf8') },
    async writeText(target, content, options = {}) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
    },
    async readBytes(target, maxBytes) {
      const data = await fs.readFile(target)
      const copy = new Uint8Array(Math.min(data.length, maxBytes ?? data.length))
      copy.set(data.subarray(0, copy.length))
      return copy
    },
    async readJson(target) { try { return JSON.parse(await fs.readFile(target, 'utf8')) } catch { return undefined } },
    async writeJson(target, value) { await this.writeText(target, JSON.stringify(value, null, 2) + '\n') },
    async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
    async lstat(target) {
      try { const info = await fs.lstat(target); return { type: info.isSymbolicLink() ? 'symlink' : (info.isDirectory() ? 'directory' : 'file') } } catch { return undefined }
    },
    async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })).sort((a, b) => (a.name < b.name ? -1 : 1)) } catch { return [] } },
    async ensureDir(target) { await fs.mkdir(target, { recursive: true }) },
    async remove(target) { await fs.rm(target, { force: true }) },
    async removeTree(target) { await fs.rm(target, { recursive: true, force: true }) },
    async copy(source, destination) {
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.copyFile(source, destination)
    },
  }
  const subprocess = {
    async resolveExecutable(name) {
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
  return { fileService, subprocess, baseDir }
}

let registered = new Map()
const installTools = () => {
  registered = new Map()
  orchestrator.apply({
    get(name) {
      if (name === 'fs') return mountedFileService
      if (name === 'subprocess') return mountedSubprocess
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      return undefined
    },
  })
}
let mountedFileService = null
let mountedSubprocess = null

async function write(base, rel, content) {
  const abs = path.join(base, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
  return abs
}

async function walk(dir, base = dir) {
  let entries = []
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
  const out = []
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name)
    const rel = path.relative(base, abs).split(path.sep).join('/')
    if (entry.isDirectory()) out.push(...(await walk(abs, base)))
    else out.push(rel)
  }
  return out
}

async function tempRetentionSummary(baseDir) {
  // Hidden temp-retention summary (Layer 4): owner-marked staging/temp dirs
  // that survive a clean run. A successful finalize must leave none.
  const found = []
  const scan = async (dir, depth) => {
    if (depth > 4) return
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.name.startsWith('.publish-tmp-')) {
        let marker = null
        try { marker = JSON.parse(await fs.readFile(path.join(abs, 'marker.json'), 'utf8')) } catch {}
        found.push({ path: path.relative(baseDir, abs), state: marker?.state ?? 'unknown', ownerId: marker?.ownerId ?? null, expiresAt: marker?.expiresAt ?? null })
      }
      if (entry.isDirectory() && !entry.name.startsWith('.') || (entry.isDirectory() && entry.name.startsWith('.publish-tmp-'))) {
        await scan(abs, depth + 1)
      }
    }
  }
  await scan(baseDir, 0)
  const outputsAbs = path.join(baseDir, 'outputs')
  const leftovers = []
  for (const entry of await fs.readdir(outputsAbs, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.publish-tmp-')) leftovers.push('outputs/' + entry.name)
  }
  return { ownerMarkedDirs: found, stagingLeftovers: leftovers }
}

// ── project scaffolding (mirrors the coordinator's real steps) ──────────────
async function setupProject(baseDir, projectId, plan) {
  const validation = core.validatePlan(plan)
  assert.equal(validation.ok, true, projectId + ': plan must validate: ' + validation.errors.join('; '))
  const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
  await write(projectDir, 'plan.json', JSON.stringify(plan, null, 2) + '\n')
  const state = {
    schemaVersion: 1, projectId, marker: projectId, createdAt: NOW, updatedAt: NOW,
    project: { linearProjectId: '', url: '', createdAt: '' },
    integrationRevision: 1, nodes: {}, commentCursors: {}, lastError: '',
  }
  for (const node of plan.nodes) {
    state.nodes[node.id] = { status: 'todo', issueId: '', identifier: '', url: '', linearState: '', runDir: '', runStatus: '', currentStep: '', currentPass: null, hasFinal: false, finalCommentId: '', receipts: [], updatedAt: NOW }
  }
  await write(projectDir, 'state.json', JSON.stringify(state, null, 2) + '\n')
  return { projectDir, state }
}

async function initNode(baseDir, projectId, nodeId, issueId, log) {
  const initRun = registered.get('autoresearch_init_run')
  const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
  const result = await initRun.execute({ projectId, nodeId, issueId, issueTitle: nodeId, sourceType: 'local', baseDir }, exec)
  log.push({ tool: 'autoresearch_init_run', args: { projectId, nodeId, issueId }, ok: true, runDir: result.runDir })
  assert.equal(result.unbound, false, nodeId + ' run must bind to the plan')
  return result
}

async function recordAcceptance(baseDir, runDir, criteria, log) {
  const record = registered.get('autoresearch_record_acceptance')
  const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
  const result = await record.execute({ runDir, criteria, baseDir }, exec)
  log.push({ tool: 'autoresearch_record_acceptance', args: { runDir, criteria }, ok: result.ok })
  assert.equal(result.ok, true, 'acceptance must pass')
  return result
}

async function finalizeRun(baseDir, runDir, log, label) {
  const finalize = registered.get('autoresearch_finalize_run')
  const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
  const result = await finalize.execute({ runDir, baseDir }, exec)
  log.push({ tool: 'autoresearch_finalize_run', args: { runDir }, ok: true, label, projectPublish: result.projectPublish, journalSync: result.journalSync })
  return result
}

function updateState(state, nodeId, patch) {
  state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch, updatedAt: new Date().toISOString() }
}

// ── run A: markdown report + companion + audit mapping ──────────────────────
async function runA() {
  const baseDir = await fs.mkdtemp(path.join(outRoot, 'run-a-'))
  await write(baseDir, 'briefs/demo-brief.md', brief)
  mountedFileService = null
  const m = mount(baseDir)
  mountedFileService = m.fileService
  mountedSubprocess = m.subprocess
  installTools()

  const plan = {
    schemaVersion: 2, projectId: 'demo-webgpu-md', projectName: 'WebGPU adoption decision (Markdown report)',
    approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'Decide whether to migrate the data-viz product from WebGL2 to WebGPU.',
      exposurePolicyVersion: 1,
      deliverables: ['report.md', 'process-notes.md'],
      diagnosticMappings: [{ sourcePath: 'acceptance.json', destinationPath: 'audit/acceptance-integration.json' }],
      acceptance: [{ id: 'PROJECT-01', text: 'Report answers all four brief success criteria.', required: true }],
      test: 'Check the four success-criteria sections and source list against briefs/demo-brief.md.',
      finalWordBudget: 8000,
    },
    nodes: [
      {
        id: 'analysis', title: 'Evidence analysis', kind: 'research',
        roles: ['research_scout', 'evidence_verifier', 'research_author', 'research_critic', 'research_synthesizer', 'research_judge', 'research_reporter'],
        expectedOutcome: 'analysis-fragment.md quantifying browser support and migration cost with sources.',
        acceptance: [{ id: 'AN-01', text: 'Fragment quantifies browser support and cites at least two sources.', required: true }],
        test: 'Grep the fragment for support percentages and source entries.',
        artifactFormat: 'markdown',
        outputContract: { artifactPath: 'analysis-fragment.md' },
        budget: { numScouts: 1, numJudges: 2, maxPasses: 1, convergenceThreshold: 2 },
        dependsOn: [],
      },
      {
        id: 'integration', title: 'Final decision report', kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        expectedOutcome: 'report.md with the four success-criteria sections plus the process-notes.md companion.',
        acceptance: [{ id: 'INT-01', text: 'Report contains recommendation, evidence, risks, and cost sections.', required: true }],
        test: 'Check the four section headings and the source list.',
        artifactFormat: 'markdown',
        outputContract: { artifactPath: 'report.md' },
        budget: { numScouts: 0, numJudges: 0, maxPasses: 1, convergenceThreshold: 2 },
        dependsOn: ['analysis'],
      },
    ],
  }
  const log = []
  const { projectDir, state } = await setupProject(baseDir, plan.projectId, plan)
  const initA = await initNode(baseDir, plan.projectId, 'analysis', 'MD-AN-01', log)
  const initI = await initNode(baseDir, plan.projectId, 'integration', 'MD-INT-01', log)
  updateState(state, 'analysis', { issueId: 'MD-AN-01', runDir: initA.runDir })
  updateState(state, 'integration', { issueId: 'MD-INT-01', runDir: initI.runDir })

  // Analysis node artifacts (deterministic stand-ins for the role loop).
  const aRun = path.join(baseDir, initA.runDir)
  await write(aRun, 'evidence/evidence_brief.md', '# Evidence brief\n\nBrowser support: Chrome/Edge shipped WebGPU 1.0 in 2024; Firefox shipping in phased rollout; Safari 26+ required. (Sources listed in fragment.)\n')
  await write(aRun, 'pass_00/A.md', '# Analysis draft\n\nSupport and cost figures per evidence brief.\n')
  await write(aRun, 'analysis-fragment.md', '# Analysis\n\nBrowser support: desktop Chrome/Edge 100% since 2024; Firefox partial; Safari requires 26+. Integrated-GPU fallback covers ~15% of corporate fleet per brief context. Migration cost: 2.5-4 engineer-quarters staged (compute-shader port first).\n\nSources: W3C WebGPU 1.0 TR; browser status trackers (see report).\n')
  await recordAcceptance(baseDir, initA.runDir, [{ id: 'AN-01', result: 'PASS' }], log)
  updateState(state, 'analysis', { status: 'done', runStatus: 'complete', hasFinal: true, receipts: ['acceptance', 'output', 'acceptance.json'] })
  await write(projectDir, 'state.json', JSON.stringify(state, null, 2) + '\n')

  // Integration node: the report + the requested companion, staged in the
  // integration run dir BEFORE acceptance (the v8 companion rule).
  const iRun = path.join(baseDir, initI.runDir)
  const reportMd = `# Should we adopt WebGPU for the data-viz product?

## 1. Recommendation: adopt later (start the port in Q3)

The evidence supports a staged migration: begin compute-shader porting now,
flip the default renderer when Safari 26+ and Firefox coverage reach the
policy bar for last-two-versions desktop support.

## 2. Evidence

- Desktop Chrome/Edge ship WebGPU 1.0; Firefox is in phased rollout; Safari
  requires 26+. Last-two-versions desktop coverage is currently ~85-90%
  (sources: W3C WebGPU 1.0 TR; browser status trackers).
- At 500k points / 20k shapes, the current WebGL2 path is draw-call bound on
  integrated GPUs; a compute-shader point splatting prototype shows a
  material frame-time reduction on the reference hardware.

## 3. Browser-support and fallback risks

- Integrated GPUs and corporate-managed browsers remain the fallback cohort
  (~15% of fleet per the brief); the WebGL2 path must stay supported.
- Older Windows + managed-browser policy means a two-quarter fallback window.

## 4. Migration-cost estimate (staged)

| Stage | Scope | Effort |
|---|---|---|
| 1 | Compute-shader point backend | 1 engineer-quarter |
| 2 | Shape/path rasterizer port | 1 engineer-quarter |
| 3 | Default flip + WebGL2 fallback hardening | 0.5-1 engineer-quarter |

Total: 2.5-3 engineer-quarters, inside the two-quarter roadmap slack plus
one quarter of headroom.
`
  await write(iRun, 'report.md', reportMd)
  await write(iRun, 'process-notes.md', '# Process notes\n\n- Evidence phase locked the browser-support numbers against the brief.\n- No unresolved conflicts between nodes.\n- Companion staged in the integration run directory and listed in projectContract.deliverables.\n')
  await recordAcceptance(baseDir, initI.runDir, [{ id: 'INT-01', result: 'PASS' }], log)

  const fin = await finalizeRun(baseDir, initI.runDir, log, 'first')

  // Exact tree: the two declared files + the mapped audit file + MANIFEST.
  const tree = (await walk(path.join(baseDir, 'outputs', 'demo-webgpu-md'))).sort()
  assert.deepEqual(tree, ['MANIFEST.json', 'audit/acceptance-integration.json', 'process-notes.md', 'report.md'].sort(), 'A: exact exposure tree: ' + JSON.stringify(tree))
  const man = JSON.parse(await fs.readFile(path.join(baseDir, 'outputs', 'demo-webgpu-md', 'MANIFEST.json'), 'utf8'))
  const ruleOf = Object.fromEntries(man.entries.map((e) => [e.path, e.sourceRule]))
  assert.equal(ruleOf['report.md'], 'declared')
  assert.equal(ruleOf['process-notes.md'], 'declared', 'companion is a declared deliverable')
  assert.equal(ruleOf['audit/acceptance-integration.json'], 'audit', 'internal evidence only via diagnostic mapping')
  assert.equal(man.policyVersion, 1)
  assert.equal(man.projectId, 'demo-webgpu-md')
  assert.ok(!tree.some((rel) => /\.(tex|fls|aux|pdf)$/.test(rel)), 'A: no TeX artifacts for a markdown project')

  // No per-issue folders for bound v2 runs; one project folder only.
  const outputsTop = (await fs.readdir(path.join(baseDir, 'outputs'))).sort()
  assert.deepEqual(outputsTop, ['demo-webgpu-md'], 'A: exactly one project folder: ' + JSON.stringify(outputsTop))

  // Journal synced by finalize (merge/patch).
  const stateAfter = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
  assert.equal(stateAfter.nodes.integration.status, 'done')
  assert.equal(stateAfter.nodes.integration.runStatus, 'complete')
  assert.ok(Array.isArray(stateAfter.nodes.integration.receipts) && stateAfter.nodes.integration.receipts.length >= 3)

  // Idempotent re-finalize: no content or timestamp churn.
  const hashTree = async (dir) => {
    const rels = (await walk(dir)).sort()
    const out = []
    for (const rel of rels) {
      const abs = path.join(dir, rel)
      const st = await fs.stat(abs)
      out.push(rel + '|' + sha256(await fs.readFile(abs)) + '|' + st.mtimeMs)
    }
    return out
  }
  const before = await hashTree(path.join(baseDir, 'outputs', 'demo-webgpu-md'))
  await finalizeRun(baseDir, initI.runDir, log, 'idempotent')
  const after = await hashTree(path.join(baseDir, 'outputs', 'demo-webgpu-md'))
  assert.deepEqual(after, before, 'A: re-finalize changes neither content nor timestamps')

  const temp = await tempRetentionSummary(baseDir)
  assert.deepEqual(temp.stagingLeftovers, [], 'A: no staging leftovers: ' + JSON.stringify(temp))

  report.runs.push({
    run: 'A', projectId: 'demo-webgpu-md', format: 'markdown',
    workspace: baseDir,
    exposure: { deliverables: plan.projectContract.deliverables, diagnosticMappings: plan.projectContract.diagnosticMappings },
    tree, manifest: man, journalSync: fin.journalSync, tempRetention: temp, toolLog: log,
  })
  console.log('A. markdown + companion + audit mapping: OK — tree = [' + tree.join(', ') + ']')
}

// ── shared TeX fixtures ──────────────────────────────────────────────────────
const certTex = '\\documentclass{article}\n\\begin{document}\n\\section*{Integration audit certificate}\nAll planned contributions are present and current; no unresolved findings. Cross-references verified against the assembled master.\n\\end{document}\n'

// ── run B: TeX, PDF-only exposure ───────────────────────────────────────────
async function runB() {
  const baseDir = await fs.mkdtemp(path.join(outRoot, 'run-b-'))
  await write(baseDir, 'briefs/demo-brief.md', brief)
  const m = mount(baseDir)
  mountedFileService = m.fileService
  mountedSubprocess = m.subprocess
  installTools()

  const finalTex = [
    '\\documentclass{article}',
    '\\title{Adopting WebGPU for the Data-Viz Product}',
    '\\author{AutoResearch Layer-4 Acceptance Run B}',
    '\\date{\\today}',
    '\\begin{document}',
    '\\maketitle',
    '\\section{Recommendation}\\label{sec:rec}',
    'Adopt WebGPU on a staged timeline: start the compute-shader port now and',
    'flip the default renderer once last-two-versions desktop coverage holds. The',
    'evidence is summarized in \\ref{sec:evidence}; risks in \\ref{sec:risks}; cost in \\ref{sec:cost}.',
    '\\section{Evidence}\\label{sec:evidence}',
    'Desktop Chrome and Edge ship WebGPU 1.0; Firefox is in phased rollout; Safari',
    'requires 26+. At 500k points and 20k shapes the current WebGL2 path is',
    'draw-call bound on integrated GPUs.',
    '\\section{Risks}\\label{sec:risks}',
    'Integrated GPUs and corporate-managed browsers form the fallback cohort',
    '(roughly 15\\% of the fleet). The WebGL2 path must remain supported for two',
    'quarters after the default flip.',
    '\\section{Cost Estimate}\\label{sec:cost}',
    '\\begin{tabular}{ll}',
    'Stage & Effort \\\\',
    'Compute-shader point backend & 1 engineer-quarter \\\\',
    'Shape rasterizer port & 1 engineer-quarter \\\\',
    'Default flip and fallback hardening & 0.5--1 engineer-quarter \\\\',
    '\\end{tabular}',
    'Total 2.5--3 engineer-quarters, within the stated roadmap slack.',
    '\\end{document}',
    '',
  ].join('\n')

  const plan = {
    schemaVersion: 2, projectId: 'demo-webgpu-tex-pdf', projectName: 'WebGPU adoption decision (TeX, PDF-only exposure)',
    approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'Decide whether to migrate the data-viz product from WebGL2 to WebGPU.',
      exposurePolicyVersion: 1,
      deliverables: ['final.pdf'],
      acceptance: [{ id: 'PROJECT-01', text: 'Compiled decision report PDF is current.', required: true }],
      test: 'Verify the PDF builds and the four sections are present.',
      finalWordBudget: 8000,
    },
    nodes: [
      {
        id: 'integration', title: 'Final decision report', kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        expectedOutcome: 'final.pdf decision report; source and build evidence stay internal.',
        acceptance: [{ id: 'INT-01', text: 'final.tex compiles and contains the four sections with resolving references.', required: true }],
        test: 'latexmk strict build plus label/citation checks.',
        artifactFormat: 'tex',
        outputContract: { artifactPath: 'output.tex', texMode: 'standalone' },
        budget: { numScouts: 0, numJudges: 0, maxPasses: 1, convergenceThreshold: 2 },
        dependsOn: [],
      },
    ],
  }
  const log = []
  const { state } = await setupProject(baseDir, plan.projectId, plan)
  const initI = await initNode(baseDir, plan.projectId, 'integration', 'PDF-INT-01', log)
  updateState(state, 'integration', { issueId: 'PDF-INT-01', runDir: initI.runDir })

  const iRun = path.join(baseDir, initI.runDir)
  await write(iRun, 'output.tex', certTex)
  await write(iRun, 'final.tex', finalTex)

  // Real integration final check: builds final.pdf via latexmk, runs
  // citation/label/word-budget/.fls checks.
  const texCheck = registered.get('autoresearch_tex_final_check')
  const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
  const check = await texCheck.execute({ projectId: plan.projectId, runDir: initI.runDir, baseDir }, exec)
  log.push({ tool: 'autoresearch_tex_final_check', args: { runDir: initI.runDir }, ok: check.ok, clean: check.clean, wordCount: check.wordCount, budgetOk: check.budgetOk })
  assert.equal(check.ok, true, 'B: tex_final_check must pass: ' + JSON.stringify(check.staticErrors ?? check.errors ?? check, null, 2).slice(0, 800))
  assert.equal(check.clean, true, 'B: strict build must be clean')
  assert.equal(check.budgetOk, true, 'B: word budget must hold')

  await recordAcceptance(baseDir, initI.runDir, [{ id: 'INT-01', result: 'PASS' }], log)
  const receipt = JSON.parse(await fs.readFile(path.join(iRun, 'acceptance.json'), 'utf8'))
  assert.ok(receipt.finalBuild, 'B: finalBuild record must be captured')
  assert.equal(receipt.finalBuild.sourcePath, 'final.tex')
  assert.equal(receipt.finalBuild.pdfPath, 'final.pdf')

  const fin = await finalizeRun(baseDir, initI.runDir, log, 'first')
  const tree = (await walk(path.join(baseDir, 'outputs', 'demo-webgpu-tex-pdf'))).sort()
  assert.deepEqual(tree, ['MANIFEST.json', 'final.pdf'], 'B: PDF-only exposure tree: ' + JSON.stringify(tree))
  assert.ok(!tree.some((rel) => rel.endsWith('.tex') || rel.endsWith('.fls') || rel.endsWith('.bib')), 'B: no source/fls/bib exposure')
  const man = JSON.parse(await fs.readFile(path.join(baseDir, 'outputs', 'demo-webgpu-tex-pdf', 'MANIFEST.json'), 'utf8'))
  assert.equal(man.entries.find((e) => e.path === 'final.pdf').sourceRule, 'declared')
  // The published PDF is byte-identical to the accepted build.
  const publishedPdf = await fs.readFile(path.join(baseDir, 'outputs', 'demo-webgpu-tex-pdf', 'final.pdf'))
  assert.ok(publishedPdf.subarray(0, 4).toString() === '%PDF', 'B: published file must be a real PDF')
  assert.equal(sha256(publishedPdf), receipt.finalBuild.pdfHash, 'B: published PDF hash must match the accepted build')

  const outputsTop = (await fs.readdir(path.join(baseDir, 'outputs'))).sort()
  assert.deepEqual(outputsTop, ['demo-webgpu-tex-pdf'])
  const temp = await tempRetentionSummary(baseDir)
  assert.deepEqual(temp.stagingLeftovers, [], 'B: no staging leftovers')

  report.runs.push({ run: 'B', projectId: 'demo-webgpu-tex-pdf', format: 'tex', workspace: baseDir, exposure: { deliverables: plan.projectContract.deliverables }, tree, manifest: man, journalSync: fin.journalSync, tempRetention: temp, texFinalCheck: { clean: check.clean, wordCount: check.wordCount, budgetOk: check.budgetOk }, toolLog: log })
  console.log('B. tex PDF-only exposure: OK — tree = [' + tree.join(', ') + '] (build clean, wordCount=' + check.wordCount + ')')
}

// ── run C: TeX, exposed source + rebuildable: true ──────────────────────────
async function runC() {
  const baseDir = await fs.mkdtemp(path.join(outRoot, 'run-c-'))
  await write(baseDir, 'briefs/demo-brief.md', brief)
  const m = mount(baseDir)
  mountedFileService = m.fileService
  mountedSubprocess = m.subprocess
  installTools()

  const finalTex = [
    '\\documentclass{article}',
    '\\usepackage{amsmath}',
    '\\title{Adopting WebGPU for the Data-Viz Product (Reproducible Source Package)}',
    '\\author{AutoResearch Layer-4 Acceptance Run C}',
    '\\date{\\today}',
    '\\begin{document}',
    '\\maketitle',
    '\\section{Executive Summary}\\label{sec:summary}',
    'This document accompanies the compiled decision report. The frame-budget',
    'model of \\ref{sec:methods} drives the staged migration recommendation of',
    'section \\ref{sec:rec}, following the WebGPU specification \\cite{webgpu2020}',
    'and the asynchronous-compute analysis of \\cite{gpu2023}.',
    '\\input{sec-methods}',
    '\\section{Recommendation}\\label{sec:rec}',
    'Adopt on a staged timeline: port the point backend first, then the shape',
    'rasterizer, then flip the default with the WebGL2 fallback retained for two',
    'quarters. Total cost 2.5--3 engineer-quarters.',
    '\\bibliographystyle{plain}',
    '\\bibliography{references,extra-refs}',
    '\\end{document}',
    '',
  ].join('\n')
  const methodsTex = [
    '\\section{Methods}\\label{sec:methods}',
    'The frame budget model is',
    '\\begin{equation}',
    'T_{\\text{frame}} = T_{\\text{cpu}} + T_{\\text{gpu}}(N)',
    '\\label{eq:gpu}',
    '\\end{equation}',
    'where $N$ is the draw-call count and $T_{\\text{gpu}}(N)$ saturates past',
    'the integrated-GPU bandwidth limit.',
    '',
  ].join('\n')
  const referencesBib = '@misc{webgpu2020, author={Khronos Group}, title={WebGPU 1.0 Specification}, year={2020}, note={W3C Working Draft}}\n@article{gpu2023, author={Chen, Alice and Rao, Prakash}, title={Asynchronous compute for large-scale data visualization}, journal={Journal of Graphics Tools}, volume={28}, year={2023}}\n'
  const extraBib = '@misc{fleet2024, author={Fleet Analytics Team}, title={Corporate browser fleet survey}, year={2024}, note={Internal}}\n'

  const plan = {
    schemaVersion: 2, projectId: 'demo-webgpu-tex-full', projectName: 'WebGPU adoption decision (TeX, reproducible package)',
    approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'Decide whether to migrate the data-viz product from WebGL2 to WebGPU.',
      exposurePolicyVersion: 1,
      deliverables: ['final.tex', 'final.pdf', 'references.bib', 'extra-refs.bib (supporting entries)'],
      rebuildable: true,
      diagnosticMappings: [{ sourcePath: 'output.tex', destinationPath: 'audit/audit-certificate.tex' }],
      acceptance: [{ id: 'PROJECT-01', text: 'Reproducible source package with resolved references.', required: true }],
      test: 'Rebuild the published package in a clean directory.',
      finalWordBudget: 8000,
    },
    nodes: [
      {
        id: 'integration', title: 'Final decision report', kind: 'integration',
        roles: ['research_integration_editor', 'research_integration_verifier'],
        expectedOutcome: 'final.tex master + sec-methods.tex fragment + bibs + compiled final.pdf.',
        acceptance: [{ id: 'INT-01', text: 'final.tex compiles with resolving labels, citations, and a clean .fls.', required: true }],
        test: 'latexmk strict build plus label/citation/bibliography checks.',
        artifactFormat: 'tex',
        outputContract: { artifactPath: 'output.tex', texMode: 'standalone' },
        budget: { numScouts: 0, numJudges: 0, maxPasses: 1, convergenceThreshold: 2 },
        dependsOn: [],
      },
    ],
  }
  const log = []
  const { state } = await setupProject(baseDir, plan.projectId, plan)
  const initI = await initNode(baseDir, plan.projectId, 'integration', 'FULL-INT-01', log)
  updateState(state, 'integration', { issueId: 'FULL-INT-01', runDir: initI.runDir })

  const iRun = path.join(baseDir, initI.runDir)
  await write(iRun, 'output.tex', certTex)
  await write(iRun, 'final.tex', finalTex)
  await write(iRun, 'sec-methods.tex', methodsTex)
  await write(iRun, 'references.bib', referencesBib)
  await write(iRun, 'extra-refs.bib', extraBib)

  const texCheck = registered.get('autoresearch_tex_final_check')
  const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
  const check = await texCheck.execute({ projectId: plan.projectId, runDir: initI.runDir, bibliographyPath: 'references.bib', baseDir }, exec)
  log.push({ tool: 'autoresearch_tex_final_check', args: { runDir: initI.runDir, bibliographyPath: 'references.bib' }, ok: check.ok, clean: check.clean, budgetOk: check.budgetOk })
  assert.equal(check.ok, true, 'C: tex_final_check must pass: ' + JSON.stringify(check.staticErrors ?? check.errors ?? check, null, 2).slice(0, 800))
  assert.equal(check.clean, true, 'C: strict build must be clean')

  await recordAcceptance(baseDir, initI.runDir, [{ id: 'INT-01', result: 'PASS' }], log)
  const receipt = JSON.parse(await fs.readFile(path.join(iRun, 'acceptance.json'), 'utf8'))
  assert.ok(receipt.finalBuild?.flsPath, 'C: finalBuild must carry the recorder (flsPath)')

  const fin = await finalizeRun(baseDir, initI.runDir, log, 'first')
  const projDir = path.join(baseDir, 'outputs', 'demo-webgpu-tex-full')
  const tree = (await walk(projDir)).sort()
  assert.deepEqual(tree, [
    'MANIFEST.json',
    'audit/audit-certificate.tex',
    'extra-refs.bib',
    'final.pdf',
    'final.tex',
    'references.bib',
    'sec-methods.tex',
  ].sort(), 'C: reproducible package tree: ' + JSON.stringify(tree))
  assert.ok(!tree.some((rel) => /\.(fls|aux|log|bbl|blg)$/.test(rel)), 'C: compiler byproducts stay internal')

  const man = JSON.parse(await fs.readFile(path.join(projDir, 'MANIFEST.json'), 'utf8'))
  assert.equal(man.rebuildable, true)
  const entry = (p) => man.entries.find((e) => e.path === p)
  assert.equal(entry('final.tex').sourceRule, 'declared')
  assert.equal(entry('final.pdf').sourceRule, 'declared')
  assert.equal(entry('references.bib').sourceRule, 'declared')
  assert.equal(entry('extra-refs.bib').sourceRule, 'declared', 'noted bib is a declared deliverable')
  assert.equal(entry('extra-refs.bib').note, 'supporting entries', 'the (note) suffix must be preserved in the manifest')
  assert.equal(entry('sec-methods.tex').sourceRule, 'source-support', 'the fragment is the minimal exposed-source closure')
  assert.equal(entry('audit/audit-certificate.tex').sourceRule, 'audit', 'internal certificate only via mapping')

  // ── clean-workspace rebuild: the published package must be relocatable ────
  const cleanDir = path.join(outRoot, 'run-c-clean-rebuild')
  await fs.cp(projDir, cleanDir, { recursive: true })
  await fs.rm(path.join(cleanDir, 'MANIFEST.json'), { force: true })
  await fs.rm(path.join(cleanDir, 'audit'), { recursive: true, force: true })
  let rebuild = { ok: false, detail: '' }
  try {
    execFileSync('latexmk', ['-pdf', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-recorder', 'final.tex'], { cwd: cleanDir, stdio: 'pipe' })
    const pdf = await fs.readFile(path.join(cleanDir, 'final.pdf'))
    rebuild = { ok: pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 1000, detail: 'rebuilt ' + pdf.length + ' bytes' }
  } catch (error) {
    rebuild = { ok: false, detail: String(error?.message ?? error).slice(0, 400) }
  }
  assert.ok(rebuild.ok, 'C: clean-workspace rebuild must succeed: ' + rebuild.detail)

  const temp = await tempRetentionSummary(baseDir)
  assert.deepEqual(temp.stagingLeftovers, [], 'C: no staging leftovers')

  report.runs.push({ run: 'C', projectId: 'demo-webgpu-tex-full', format: 'tex', workspace: baseDir, exposure: { deliverables: plan.projectContract.deliverables, rebuildable: true }, tree, manifest: man, journalSync: fin.journalSync, tempRetention: temp, cleanRebuild: rebuild, toolLog: log })
  console.log('C. tex rebuildable package: OK — tree = [' + tree.join(', ') + '] (clean rebuild: ' + rebuild.detail + ')')
}

// ── go ───────────────────────────────────────────────────────────────────────
console.log('Layer 4 acceptance — built generation ' + manifest.generation + ', outRoot ' + outRoot)
await runA()
await runB()
await runC()

// Per-run artifact collection (plan Layer 4): run log, state.json, MANIFEST,
// sorted tree, temp-retention summary.
for (const run of report.runs) {
  const projectDir = path.join(run.workspace, '.research-agent', 'projects', run.projectId)
  const collected = path.join(outRoot, 'collected-' + run.run + '.json')
  await fs.mkdir(path.join(outRoot, 'collection'), { recursive: true })
  const state = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
  const logPath = path.join(outRoot, 'collection', 'run-log-' + run.run + '.jsonl')
  await fs.writeFile(logPath, run.toolLog.map((line) => JSON.stringify(line)).join('\n') + '\n')
  await fs.writeFile(path.join(outRoot, 'collection', 'state-' + run.run + '.json'), JSON.stringify(state, null, 2) + '\n')
  await fs.writeFile(collected, JSON.stringify({ run, logPath, state }, null, 2) + '\n')
  report.runs[report.runs.indexOf(run)].collected = collected
}
await fs.writeFile(path.join(outRoot, 'layer4-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log('\nLAYER 4 ACCEPTANCE PASSED')
console.log('  A. demo-webgpu-md        (markdown + companion + audit mapping)')
console.log('  B. demo-webgpu-tex-pdf   (tex, PDF-only exposure)')
console.log('  C. demo-webgpu-tex-full  (tex, rebuildable, clean rebuild verified)')
console.log('Artifacts: ' + path.join(outRoot, 'layer4-report.json'))
