// WS4 — Output policy v8 (exposure-driven, format-agnostic; plan WS4 v8).
//
// Layer 2 golden test. Fixture families:
//   A. TeX integration, marker plan, rebuildable: true — the full GRF set
//      (declared deliverables, source-support closure, rebuild closure +
//      bib union, requested diagnostic mappings only, no automatic audit
//      set), MANIFEST v8, idempotence, finalBuild staleness.
//   B. Markdown/report integration, marker plan, no LaTeX files anywhere,
//      outputContract.artifactPath honored.
//   C. TeX integration exposing ONLY the accepted PDF — no synthetic
//      source closure (PDF-only exposure).
//   D. Frozen legacy adapter (marker absent): ['final.tex','final.pdf'] /
//      ['final.md'], rule 'legacy-adapter', no companions/closure/audit.
//   E. New-policy contract validation (marker ⇒ explicit list, grammar,
//      rebuildable checker, projectId, reserved names, audit-only, empty).
//   F. Fail-before-write (unsafe, missing, unmanaged occupancy, symlink,
//      conflict) — nothing written.
//   G. Rollback / interrupted-transaction recovery + temp-lifecycle states
//      (owner-only, lease, retention, live lock, confinement).
//   H. scripts/republish-outputs.mjs (dry-run default, --write, override,
//      project-id mismatch, finalBuild verification, never deletes GAV-*).
//
// Layer 0 rule honored: this file fails against the pre-v8 bundle
// (no marker policy, no exposure-driven publish, no transactional core).
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn as nodeSpawn, spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)
const { default: orchestrator, createLibraries: lib } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

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

async function dirExists(p) {
  try { const info = await fs.stat(p); return info.isDirectory() } catch { return false }
}

function makeMount(baseDir) {
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
  function makeRealSubprocess() {
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
  const registered = new Map()
  orchestrator.apply({
    get(name) {
      if (name === 'fs') return fileService
      if (name === 'subprocess') return makeRealSubprocess()
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      return undefined
    },
  })
  const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
  return { fileService, registered, exec }
}

// Plain node:fs fops for direct helper unit tests.
function makeNodeFops() {
  return {
    async resolveTarget(p) { return path.isAbsolute(p) ? p : path.resolve(p) },
    async stat(p) { try { return await fs.stat(p) } catch { return undefined } },
    async lstat(p) {
      try { const info = await fs.lstat(p); return { type: info.isSymbolicLink() ? 'symlink' : (info.isDirectory() ? 'directory' : 'file') } } catch { return undefined }
    },
    async exists(p) { try { return (await fs.stat(p)) !== undefined } catch { return false } },
    async readText(p) { return await fs.readFile(p, 'utf8') },
    async readBytes(p, maxBytes) {
      const data = await fs.readFile(p)
      const copy = new Uint8Array(Math.min(data.length, maxBytes ?? data.length))
      copy.set(data.subarray(0, copy.length))
      return copy
    },
    async writeText(p, content) { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, content) },
    async writeJson(p, value) { await this.writeText(p, JSON.stringify(value, null, 2) + '\n') },
    async readJson(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')) } catch { return undefined } },
    async ensureDir(p) { await fs.mkdir(p, { recursive: true }) },
    async remove(p) { await fs.rm(p, { force: true }) },
    async removeTree(p) { await fs.rm(p, { recursive: true, force: true }) },
    async listDir(p) {
      try { return (await fs.readdir(p, { withFileTypes: true })).map((entry) => ({ name: entry.name, dir: entry.isDirectory() })).sort((a, b) => (a.name < b.name ? -1 : 1)) } catch { return [] }
    },
    async copy(source, destination) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(source, destination) },
  }
}

const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-output-policy-v8-'))

// ── fixture scaffolding ─────────────────────────────────────────────────────
const NOW = '2026-01-01T00:00:00.000Z'

function makeReceipt({ projectId, nodeId, digest, outputHash, format = 'tex', outputPath = 'output.tex', finalBuild = null }) {
  return {
    schemaVersion: 2,
    kind: 'acceptance-receipt',
    projectId,
    planRevision: 1,
    nodeId,
    nodeContractDigest: digest,
    nodeRevision: 1,
    outputHash,
    artifact: { path: outputPath, format, sha256: outputHash },
    finalBuild,
    artifactFormat: format,
    criteria: [],
    overall: 'PASS',
    receiptHash: sha256('receipt-' + projectId + '-' + nodeId),
  }
}

function makeRunJson({ runId, issueId, outputRoot = 'outputs' }) {
  return {
    runId, issueId, artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1,
    outputRoot, config: { outputRoot }, linear: { enabled: false }, updatedAt: NOW,
  }
}

// Write a bound project: plan.json + state.json + the given node runs
// (each with run.json, node-contract.json, acceptance.json, optional ledger
// and extra files). Returns { projectDir, runDigests }.
async function setupProject({ projectId, plan, runs, stateNodes, skipValidation = false }) {
  const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
  await write(projectDir, 'plan.json', JSON.stringify(plan, null, 2) + '\n')
  if (!skipValidation) {
    const validation = core.validatePlan(plan)
    assert.equal(validation.ok, true, 'fixture plan must validate: ' + validation.errors.join('; '))
  }
  const state = {
    schemaVersion: 1,
    projectId,
    marker: projectId,
    createdAt: NOW,
    updatedAt: NOW,
    project: { linearProjectId: '', url: '', createdAt: '' },
    integrationRevision: 1,
    nodes: {},
    commentCursors: {},
    lastError: '',
  }
  const digests = {}
  for (const [nodeId, run] of Object.entries(runs ?? {})) {
    const digest = core.nodeContract(plan, nodeId).digest
    digests[nodeId] = digest
    const runDirAbs = path.join(baseDir, run.runRel)
    for (const [rel, content] of Object.entries(run.files ?? {})) await write(runDirAbs, rel, content)
    const contract = core.nodeContract(plan, nodeId)
    await write(runDirAbs, 'run.json', JSON.stringify(makeRunJson({ runId: run.issueId.toLowerCase(), issueId: run.issueId }), null, 2) + '\n')
    await write(runDirAbs, 'node-contract.json', JSON.stringify({
      schemaVersion: 2,
      kind: 'node-contract',
      projectId,
      projectName: plan.projectName ?? '',
      nodeId,
      artifactRoot: '.research-agent',
      planRevision: 1,
      contractDigest: digest,
      artifactFormat: contract.artifactFormat,
      exposurePolicyVersion: plan.projectContract?.exposurePolicyVersion === 1 ? 1 : null,
      writtenAt: NOW,
      contract,
    }, null, 2) + '\n')
    const receipt = run.receipt ?? makeReceipt({ projectId, nodeId, digest, outputHash: run.outputHash, format: contract.artifactFormat, outputPath: run.artifactPath ?? (contract.artifactFormat === 'tex' ? 'output.tex' : 'final.md'), finalBuild: run.finalBuild ?? null })
    await write(runDirAbs, 'acceptance.json', JSON.stringify(receipt, null, 2) + '\n')
    if (run.ledger !== undefined) {
      await write(runDirAbs, 'node-output.json', JSON.stringify(run.ledger ?? { ledgerVersion: 1, nodeId, outputHash: run.outputHash, nodeRevision: 1, contractDigest: digest, artifactFormat: contract.artifactFormat, contributions: [{ id: 'main', importance: 'required', mutability: 'editable', evidence: [] }] }, null, 2) + '\n')
    }
    state.nodes[nodeId] = {
      status: 'done',
      issueId: run.issueId,
      identifier: run.issueId,
      url: '',
      linearState: 'done',
      runDir: run.runRel,
      runStatus: 'complete',
      currentStep: '',
      currentPass: 1,
      hasFinal: true,
      finalCommentId: '',
      receipts: ['fixture-receipt-' + nodeId],
      updatedAt: NOW,
    }
  }
  if (stateNodes) for (const [nodeId, patch] of Object.entries(stateNodes)) state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch }
  await write(projectDir, 'state.json', JSON.stringify(state, null, 2) + '\n')
  return { projectDir, digests }
}

async function expectFinalizeError(mount, runRel, pattern) {
  const finalize = mount.registered.get('autoresearch_finalize_run')
  let error = null
  try {
    await finalize.execute({ runDir: runRel, baseDir }, mount.exec)
  } catch (err) { error = err }
  assert.ok(error, 'finalize must throw')
  assert.match(String(error.message), pattern, 'unexpected error: ' + String(error.message))
  return error
}

// ── S1. Unit checks (Layer 1, pure) ─────────────────────────────────────────
{
  // Deliverable spec grammar.
  assert.deepEqual(core.parseDeliverableSpec('final.tex'), { ok: true, path: 'final.tex', label: '', note: '' })
  assert.deepEqual(core.parseDeliverableSpec('a/b.pdf (note with spaces)'), { ok: true, path: 'a/b.pdf', label: '', note: 'note with spaces' })
  assert.deepEqual(core.parseDeliverableSpec('submission: final.pdf (submitted rendering)'), { ok: true, path: 'final.pdf', label: 'submission', note: 'submitted rendering' })
  assert.deepEqual(core.parseDeliverableSpec('lbl_x-1: notes/report.md'), { ok: true, path: 'notes/report.md', label: 'lbl_x-1', note: '' })
  assert.equal(core.parseDeliverableSpec('a b.tex').ok, false, 'whitespace in path')
  assert.equal(core.parseDeliverableSpec('/absolute.tex').ok, false, 'absolute path')
  assert.equal(core.parseDeliverableSpec('../escape.tex').ok, false, 'traversal')
  assert.equal(core.parseDeliverableSpec('a/b/').ok, false, 'trailing separator')
  assert.equal(core.parseDeliverableSpec('a (b').ok, false, 'unbalanced paren')
  assert.equal(core.parseDeliverableSpec('').ok, false, 'empty')
  assert.equal(core.parseDeliverableSpec('9bad: x.tex').ok, false, 'label must start with a letter')
  assert.equal(core.parseDeliverableSpec('x.y: bad label: x.tex').ok, false, 'label with space/colon')

  // projectId rule.
  assert.equal(core.projectIdError('grf-proj'), null)
  assert.equal(core.projectIdError('a.b_c-9'), null)
  assert.ok(core.projectIdError('') !== null, 'empty projectId rejected')
  assert.ok(core.projectIdError('..bad') !== null, 'dotdot rejected')
  assert.ok(core.projectIdError('has/slash') !== null, 'separator rejected')
  assert.ok(core.projectIdError('a b') !== null, 'whitespace rejected')
  assert.ok(core.projectIdError('a'.repeat(66)) !== null, 'too long rejected')
  assert.equal(core.projectIdError('a'.repeat(64)), null, '64 chars ok')
  assert.ok(core.projectIdError('-lead') !== null, 'leading dot/dash rejected')

  // Marker vs legacy projectContract normalization (digest shape frozen).
  const legacyPlan = {
    schemaVersion: 2, projectId: 'pc-x', projectName: 'PC', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: { goal: 'g', acceptance: [{ id: 'P-01', text: 't', required: true }] },
    nodes: [{ id: 'integration', title: 'I', kind: 'integration', roles: ['research_integration_editor'], expectedOutcome: 'x', acceptance: [{ id: 'I-01', text: 'x', required: true }], dependsOn: [] }],
  }
  const legacyContract = core.projectContract(legacyPlan)
  assert.deepEqual(legacyContract.deliverables, ['final.tex', 'final.pdf'], 'legacy default deliverables')
  assert.equal(legacyContract.exposurePolicyVersion, undefined, 'legacy has no marker')
  assert.equal(legacyContract.rebuildable, undefined, 'legacy has no rebuildable')
  assert.equal(legacyContract.diagnosticMappings, undefined, 'legacy has no mappings')
  const markerPlan = JSON.parse(JSON.stringify(legacyPlan))
  markerPlan.projectId = 'pc-y'
  markerPlan.projectContract.exposurePolicyVersion = 1
  markerPlan.projectContract.deliverables = ['final.pdf']
  markerPlan.projectContract.rebuildable = true
  markerPlan.projectContract.diagnosticMappings = [{ sourcePath: 'output.tex', destinationPath: 'audit/cert.tex' }]
  const markerContract = core.projectContract(markerPlan)
  assert.equal(markerContract.exposurePolicyVersion, 1)
  assert.equal(markerContract.rebuildable, true)
  assert.deepEqual(markerContract.deliverables, ['final.pdf'])
  assert.deepEqual(markerContract.diagnosticMappings, [{ sourcePath: 'output.tex', destinationPath: 'audit/cert.tex', label: '', note: '' }])
  assert.notEqual(markerContract.digest, core.projectContract(legacyPlan).digest, 'marker must change the digest')
  const omittedPlan = JSON.parse(JSON.stringify(markerPlan))
  omittedPlan.projectContract.deliverables = undefined
  const omittedContract = core.projectContract(omittedPlan)
  assert.deepEqual(omittedContract.deliverables, [], 'marker + omitted list = explicit no-exposure ([])')
  assert.equal(omittedContract.deliverablesOmitted, true)

  // Temp staging names are safe + unique per owner.
  assert.equal(lib.helpers.tempStagingName('RR-INT'), '.publish-tmp-RR-INT')
  assert.equal(lib.helpers.tempStagingName('a/b: c'), '.publish-tmp-a-b--c')
  assert.equal(lib.helpers.tempStagingName('RR-INT'), lib.helpers.tempStagingName('RR-INT'), 'staging names are deterministic')
  assert.ok(lib.helpers.TEMP_RETENTION_TTL_MS > lib.helpers.TEMP_LEASE_GRACE_MS, 'retention ttl exceeds lease grace')
}

// ── shared TeX fixture contents ─────────────────────────────────────────────
const outputTex = '\\documentclass{article}\n\\begin{document}\nAudit certificate body.\n\\end{document}\n'
const outputPdf = Buffer.from('%PDF-1.7 audit certificate bytes\n')
const finalTex = [
  '\\documentclass{article}',
  '\\usepackage{graphicx}',
  '\\usepackage{custom}',
  '\\begin{document}',
  '\\section{Main}\\label{sec:main}',
  '\\input{sec-author}',
  '\\includegraphics[width=0.5\\textwidth]{figure-1.pdf}',
  'See \\ref{fig:one}.',
  '\\bibliography{references,extra-bib}',
  '\\end{document}',
].join('\n') + '\n'
const secAuthor = 'Fragment text from the author node, long enough to matter.\n\\begin{figure}\n\\includegraphics{figure-1.pdf}\n\\caption{Fig.}\n\\label{fig:one}\n\\end{figure}\n'
const finalPdf = Buffer.from('%PDF-1.7 final product bytes\n')
const figurePdf = Buffer.from('%PDF-1.7 figure bytes\n')
const customSty = '\\ProvidesPackage{custom}\n'
const referencesBib = '@article{knuth1984, author={Knuth}, title={The Art}, year={1984}}\n'
const extraBib = '@article{extra2026, author={Extra}, title={More}, year={2026}}\n'
const dossier = '\\section*{Figure dossier}\nDossier text.\n'
const bibLedger = '@comment{bib verification ledger entry}\n'
const processIssues = '# Process issues\n\nNo unresolved issues.\n'
const fls = [
  'OUTPUT final.pdf',
  'INPUT /usr/share/texlive/2024/texmf-dist/tex/latex/base/article.cls',
  'INPUT final.tex',
  'INPUT sec-author.tex',
  'INPUT figure-1.pdf',
  'INPUT custom.sty',
  'INPUT /usr/share/texlive/2024/texmf-dist/fonts/tfm/public/cm/cmr10.tfm',
].join('\n') + '\n'
const DECOYS = { 'final.aux': 'aux decoy\n', 'final.log': 'log decoy\n', 'final.bbl': 'bbl decoy\n', 'final.out': 'out decoy\n', 'final.toc': 'toc decoy\n', 'final.fdb_latexmk': 'fdb decoy\n', 'final.synctex.gz': Buffer.from('gz decoy\n'), 'preview.tex': 'preview decoy\n', 'preview.pdf': Buffer.from('%PDF preview decoy\n'), 'pass_01/A.tex': 'candidate decoy\n' }

// ── S2. Fixture A: TeX marker plan, rebuildable true (full GRF set) ─────────
const grfPlan = {
  schemaVersion: 2, projectId: 'grf-proj', projectName: 'GRF', approvedAt: NOW, revision: 1, integrationId: 'integration',
  projectContract: {
    goal: 'GRF fixture.',
    exposurePolicyVersion: 1,
    deliverables: [
      'final.tex (submission source)',
      'submission: final.pdf (submitted rendering)',
      'references.bib (updated bibliography)',
      'process-issues.md',
      'figure-dossier.tex',
      'bib-verification-ledger.bib',
    ],
    rebuildable: true,
    diagnosticMappings: [
      { sourcePath: 'output.tex', destinationPath: 'audit/audit-certificate.tex', label: 'certificate', note: 'accepted build certificate' },
      { sourcePath: 'output.pdf', destinationPath: 'audit/audit-certificate.pdf' },
    ],
    acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }],
  },
  nodes: [
    { id: 'author', title: 'Author', kind: 'research', roles: ['research_author'], expectedOutcome: 'Fragment.', acceptance: [{ id: 'AUT-01', text: 'Fragment exists.', required: true }], outputContract: { texMode: 'fragment' }, dependsOn: [] },
    { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: ['author'] },
  ],
}
const grfFinalBuild = {
  sourcePath: 'final.tex',
  sourceHash: sha256(finalTex),
  flsPath: 'final.fls',
  flsHash: sha256(fls),
  pdfPath: 'final.pdf',
  pdfHash: sha256(finalPdf),
}
{
  const intRunRel = path.join('.research-agent', 'runs', 'GRF-INT', '2026-01-01T00-00-00-integration')
  const authorRunRel = path.join('.research-agent', 'runs', 'GRF-AUTH', '2026-01-01T00-00-00-author')
  const { projectDir, digests } = await setupProject({
    projectId: 'grf-proj',
    plan: grfPlan,
    runs: {
      author: {
        issueId: 'GRF-AUTH', runRel: authorRunRel, outputHash: sha256('Author fragment output.\n'),
        files: { 'output.tex': 'Author fragment output.\n' }, ledger: {},
      },
      integration: {
        issueId: 'GRF-INT', runRel: intRunRel, outputHash: sha256(outputTex), finalBuild: grfFinalBuild,
        files: {
          'output.tex': outputTex,
          'output.pdf': outputPdf,
          'final.tex': finalTex,
          'final.pdf': finalPdf,
          'final.fls': fls,
          'sec-author.tex': secAuthor,
          'figure-1.pdf': figurePdf,
          'custom.sty': customSty,
          'references.bib': referencesBib,
          'extra-bib.bib': extraBib,
          'process-issues.md': processIssues,
          'figure-dossier.tex': dossier,
          'bib-verification-ledger.bib': bibLedger,
          ...DECOYS,
        },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', currentStep: 'pass_02_scoring', currentPass: 2, hasFinal: false, linearState: 'In Progress', receipts: [] } },
  })
  const stateBefore = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))

  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: intRunRel, baseDir }, mount.exec)
  assert.equal(result.v2.bound, true)
  const runAfter = JSON.parse(await fs.readFile(path.join(baseDir, intRunRel, 'run.json'), 'utf8'))
  assert.equal(runAfter.status, 'complete', 'successful finalize must complete the run')

  // Journal merged with preservation.
  assert.equal(result.journalSync.action, 'merged')
  const stateAfter = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
  const intEntry = stateAfter.nodes.integration
  assert.equal(intEntry.status, 'done')
  assert.equal(intEntry.runStatus, 'complete')
  assert.equal(intEntry.runDir, intRunRel)
  assert.equal(intEntry.issueId, 'GRF-INT', 'non-merged fields preserved')
  assert.equal(intEntry.linearState, 'In Progress', 'non-merged fields preserved')
  assert.equal(intEntry.currentPass, 2, 'non-merged fields preserved')
  assert.deepEqual(stateAfter.nodes.author, stateBefore.nodes.author)

  // Project publish: EXACT exposure-driven tree.
  assert.equal(result.projectPublish.ok, true, JSON.stringify(result.projectPublish.errors))
  assert.equal(result.projectPublish.mode, 'new')
  assert.equal(result.projectPublish.closureSource, 'source-support')
  assert.deepEqual(result.deliverables, [], 'bound v2 runs must not publish per-issue folders')
  const outputsDir = path.join(baseDir, 'outputs')
  const tree = await walk(outputsDir)
  assert.deepEqual(tree, [
    'grf-proj/MANIFEST.json',
    'grf-proj/audit/audit-certificate.pdf',
    'grf-proj/audit/audit-certificate.tex',
    'grf-proj/bib-verification-ledger.bib',
    'grf-proj/custom.sty',
    'grf-proj/extra-bib.bib',
    'grf-proj/figure-1.pdf',
    'grf-proj/figure-dossier.tex',
    'grf-proj/final.pdf',
    'grf-proj/final.tex',
    'grf-proj/process-issues.md',
    'grf-proj/references.bib',
    'grf-proj/sec-author.tex',
  ].sort(), 'exact published tree: ' + JSON.stringify(tree))
  assert.ok(!tree.some((rel) => rel.startsWith('GRF-')), 'no per-issue folders: ' + JSON.stringify(tree))
  assert.ok(!tree.some((rel) => rel.includes('output.')), 'no bare output.* published: ' + JSON.stringify(tree))
  assert.ok(!tree.some((rel) => rel.includes('audit/acceptance/') || rel.includes('audit/ledgers/')), 'no automatic audit set on new-policy plans: ' + JSON.stringify(tree))
  assert.ok(!tree.some((rel) => /\.(aux|log|fls|out|toc|bbl|blg|fdb_latexmk|synctex\.gz)$/.test(rel) || rel.includes('preview.') || rel.includes('pass_')), 'denylist must hold: ' + JSON.stringify(tree))

  // Byte equality for a binary + a text entry.
  assert.ok(Buffer.from(await fs.readFile(path.join(outputsDir, 'grf-proj', 'final.pdf'))).equals(finalPdf))
  assert.equal(await fs.readFile(path.join(outputsDir, 'grf-proj', 'sec-author.tex'), 'utf8'), secAuthor)

  // MANIFEST v8.
  const man = JSON.parse(await fs.readFile(path.join(outputsDir, 'grf-proj', 'MANIFEST.json'), 'utf8'))
  assert.equal(man.kind, 'project-publish-manifest')
  assert.equal(man.policyVersion, 1)
  assert.equal(man.projectId, 'grf-proj')
  assert.equal(man.planRevision, 1)
  assert.equal(man.artifactFormat, 'tex')
  assert.equal(man.rebuildable, true)
  assert.equal(man.integrationRun, intRunRel)
  const manPaths = man.entries.map((entry) => entry.path).sort()
  const treePaths = tree.filter((rel) => !rel.endsWith('MANIFEST.json')).map((rel) => rel.slice('grf-proj/'.length)).sort()
  assert.deepEqual(manPaths, treePaths, 'manifest must list every published path exactly once (folder-relative)')
  const entryOf = (p) => man.entries.find((entry) => entry.path === p)
  assert.equal(entryOf('final.tex').sourceRule, 'declared')
  assert.equal(entryOf('final.pdf').sourceRule, 'declared')
  assert.equal(entryOf('final.pdf').label, 'submission', 'labeled spec must carry the label')
  assert.equal(entryOf('final.pdf').note, 'submitted rendering')
  assert.equal(entryOf('sec-author.tex').sourceRule, 'source-support')
  assert.equal(entryOf('sec-author.tex').requiredBy, 'source-support(final.tex)')
  assert.equal(entryOf('figure-1.pdf').sourceRule, 'source-support', 'graphics closure is source-support')
  assert.equal(entryOf('custom.sty').sourceRule, 'rebuild', 'fls-only input is rebuild')
  assert.equal(entryOf('custom.sty').requiredBy, 'rebuild(final.fls)')
  assert.equal(entryOf('extra-bib.bib').sourceRule, 'rebuild', 'bib union entry')
  assert.equal(entryOf('extra-bib.bib').requiredBy, 'rebuild(bib:extra-bib)')
  assert.equal(entryOf('references.bib').sourceRule, 'declared', 'declared bib wins dedup')
  assert.equal(entryOf('audit/audit-certificate.tex').sourceRule, 'audit')
  assert.equal(entryOf('audit/audit-certificate.tex').requiredBy, 'diagnostic-mapping(output.tex)')
  assert.equal(entryOf('audit/audit-certificate.tex').label, 'certificate')
  assert.equal(entryOf('audit/audit-certificate.pdf').requiredBy, 'diagnostic-mapping(output.pdf)')
  for (const entry of man.entries) {
    assert.equal(entry.hash, sha256(await fs.readFile(path.join(outputsDir, 'grf-proj', entry.path))), 'manifest hash must equal the published bytes: ' + entry.path)
  }
  assert.deepEqual(man.preservedExisting, [], 'no user files yet')

  // ── idempotence: user files + re-finalize + mtime stability ──────────────
  // (The manifest legitimately rewrites ONCE to record the newly preserved
  // user files; a further re-finalize then changes no bytes or timestamps.)
  const sentinel = path.join(outputsDir, 'grf-proj', 'sentinel-user-file.txt')
  await fs.writeFile(sentinel, 'user file, never prune\n')
  const gavenDecoy = path.join(outputsDir, 'grf-proj', 'GAV-99', 'report.md')
  await fs.mkdir(path.dirname(gavenDecoy), { recursive: true })
  await fs.writeFile(gavenDecoy, '# existing GAV report, never touch\n')
  const second = await finalize.execute({ runDir: intRunRel, baseDir }, mount.exec)
  assert.equal(second.projectPublish.ok, true, JSON.stringify(second.projectPublish.errors))
  assert.equal(second.projectPublish.copied.length, 0, 'same-hash re-finalize must not copy deliverables: ' + JSON.stringify(second.projectPublish.copied))
  assert.equal(second.journalSync.action, 'current', 'repeat journal sync must be a no-op')
  const man2 = JSON.parse(await fs.readFile(path.join(outputsDir, 'grf-proj', 'MANIFEST.json'), 'utf8'))
  const preservedPaths = man2.preservedExisting.map((item) => item.path).sort()
  assert.deepEqual(preservedPaths, ['GAV-99/report.md', 'sentinel-user-file.txt'], 'preservedExisting inventory: ' + JSON.stringify(preservedPaths))
  assert.ok(!man2.entries.some((entry) => entry.path === 'sentinel-user-file.txt'), 'user file must not be a managed entry')
  const mtimeBefore = [
    fsSync.statSync(path.join(outputsDir, 'grf-proj', 'final.tex')),
    fsSync.statSync(path.join(outputsDir, 'grf-proj', 'MANIFEST.json')),
  ].map((info) => info.mtimeMs)
  const third = await finalize.execute({ runDir: intRunRel, baseDir }, mount.exec)
  assert.equal(third.projectPublish.ok, true, JSON.stringify(third.projectPublish.errors))
  assert.equal(third.projectPublish.copied.length, 0, 'steady-state re-finalize must not copy anything: ' + JSON.stringify(third.projectPublish.copied))
  assert.equal(third.journalSync.action, 'current', 'repeat journal sync must be a no-op')
  const mtimeAfter = [
    fsSync.statSync(path.join(outputsDir, 'grf-proj', 'final.tex')),
    fsSync.statSync(path.join(outputsDir, 'grf-proj', 'MANIFEST.json')),
  ].map((info) => info.mtimeMs)
  assert.deepEqual(mtimeAfter, mtimeBefore, 'steady-state re-finalize must not change content timestamps')
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'user file, never prune\n')
  assert.equal(await fs.readFile(gavenDecoy, 'utf8'), '# existing GAV report, never touch\n')
  // No staging leftovers.
  const outputsTop = await fs.readdir(outputsDir)
  assert.ok(!outputsTop.some((name) => name.startsWith('.publish-tmp-')), 'no staging leftovers: ' + JSON.stringify(outputsTop))
  const stableTree = (await walk(outputsDir)).sort()

  // ── finalBuild staleness: changed master must block rebuild publish ───────
  await fs.writeFile(path.join(baseDir, intRunRel, 'final.tex'), finalTex + '\n% drift\n')
  await expectFinalizeError(mount, intRunRel, /finalBuild record is stale/)
  // The run stays repairable: a failed publish must not corrupt the
  // published tree or the acceptance binding.
  const treeAfterFail = (await walk(outputsDir)).sort()
  assert.deepEqual(treeAfterFail, stableTree, 'failed publish must not change the published tree')
  // Restore → publish works again (idempotent, same hashes).
  await fs.writeFile(path.join(baseDir, intRunRel, 'final.tex'), finalTex)
  const restored = await finalize.execute({ runDir: intRunRel, baseDir }, mount.exec)
  assert.equal(restored.projectPublish.ok, true, JSON.stringify(restored.projectPublish.errors))
  assert.equal(restored.projectPublish.copied.length, 0, 'restored same-hash publish must not copy: ' + JSON.stringify(restored.projectPublish.copied))
  // No retained staging left behind by the failed attempt (preflight failure
  // happens before staging; a recovery would clean it anyway).
  assert.ok(!(await fs.readdir(outputsDir)).some((name) => name.startsWith('.publish-tmp-')), 'no staging leftovers after failure')
}

// ── S3. Fixture B: markdown/report, no LaTeX files, artifactPath honored ────
{
  const mdPlan = {
    schemaVersion: 2, projectId: 'md-proj', projectName: 'MD', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'Report fixture.',
      exposurePolicyVersion: 1,
      deliverables: ['report.md', 'appendix/notes.md'],
      acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }],
    },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], artifactFormat: 'markdown', expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { artifactPath: 'report.md' }, dependsOn: [] },
    ],
  }
  const reportMd = '# Report\n\nBody text for the report.\n'
  const notesMd = '# Notes\n\nAppendix notes.\n'
  const intRunRel = path.join('.research-agent', 'runs', 'MD-INT', '2026-01-01T00-00-00-integration')
  await setupProject({
    projectId: 'md-proj',
    plan: mdPlan,
    runs: {
      integration: {
        issueId: 'MD-INT', runRel: intRunRel, outputHash: sha256(reportMd), artifactPath: 'report.md',
        files: { 'report.md': reportMd, 'appendix/notes.md': notesMd },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: intRunRel, baseDir }, mount.exec)
  assert.equal(result.projectPublish.ok, true, JSON.stringify(result.projectPublish.errors))
  const tree = await walk(path.join(baseDir, 'outputs', 'md-proj'))
  assert.deepEqual(tree.sort(), ['MANIFEST.json', 'appendix/notes.md', 'report.md'].sort(), 'markdown exposure: ' + JSON.stringify(tree))
  const man = JSON.parse(await fs.readFile(path.join(baseDir, 'outputs', 'md-proj', 'MANIFEST.json'), 'utf8'))
  assert.equal(man.policyVersion, 1)
  assert.equal(man.artifactFormat, 'markdown')
  assert.equal(man.rebuildable, false)
  assert.equal(man.entries.find((entry) => entry.path === 'report.md').sourceRule, 'declared')
  assert.ok(!tree.some((rel) => rel.endsWith('.tex') || rel.includes('audit/')), 'no TeX or audit artifacts for a markdown project')
}

// ── S4. Fixture C: TeX, PDF-only exposure — no synthetic source closure ─────
{
  const pdfPlan = {
    schemaVersion: 2, projectId: 'pdf-proj', projectName: 'PDF', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'PDF-only fixture.',
      exposurePolicyVersion: 1,
      deliverables: ['final.pdf'],
      acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }],
    },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    ],
  }
  const intRunRel = path.join('.research-agent', 'runs', 'PDF-INT', '2026-01-01T00-00-00-integration')
  await setupProject({
    projectId: 'pdf-proj',
    plan: pdfPlan,
    runs: {
      integration: {
        issueId: 'PDF-INT', runRel: intRunRel, outputHash: sha256(outputTex),
        files: {
          'output.tex': outputTex,
          'output.pdf': outputPdf,
          'final.tex': finalTex,
          'final.pdf': finalPdf,
          'final.fls': fls,
          'sec-author.tex': secAuthor,
          'figure-1.pdf': figurePdf,
        },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: intRunRel, baseDir }, mount.exec)
  assert.equal(result.projectPublish.ok, true, JSON.stringify(result.projectPublish.errors))
  const tree = await walk(path.join(baseDir, 'outputs', 'pdf-proj'))
  assert.deepEqual(tree.sort(), ['MANIFEST.json', 'final.pdf'].sort(), 'PDF-only exposure must not synthesize a source closure: ' + JSON.stringify(tree))
  assert.ok(Buffer.from(await fs.readFile(path.join(baseDir, 'outputs', 'pdf-proj', 'final.pdf'))).equals(finalPdf))
}

// ── S5. Fixture D: frozen legacy adapter (marker absent) ────────────────────
{
  // TeX legacy: default primaries, rule legacy-adapter, nothing else.
  const legacyPlan = {
    schemaVersion: 2, projectId: 'leg-proj', projectName: 'LEG', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: { goal: 'Legacy.', acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    ],
  }
  const legRunRel = path.join('.research-agent', 'runs', 'LEG-INT', '2026-01-01T00-00-00-integration')
  await setupProject({
    projectId: 'leg-proj',
    plan: legacyPlan,
    runs: {
      integration: {
        issueId: 'LEG-INT', runRel: legRunRel, outputHash: sha256(outputTex),
        files: {
          'output.tex': outputTex,
          'final.tex': '\\documentclass{article}\n\\begin{document}\nLegacy final.\n\\end{document}\n',
          'final.pdf': finalPdf,
          'sec-author.tex': secAuthor,
          'references.bib': referencesBib,
        },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: legRunRel, baseDir }, mount.exec)
  assert.equal(result.projectPublish.ok, true, JSON.stringify(result.projectPublish.errors))
  assert.equal(result.projectPublish.mode, 'legacy-adapter')
  const tree = await walk(path.join(baseDir, 'outputs', 'leg-proj'))
  assert.deepEqual(tree.sort(), ['MANIFEST.json', 'final.pdf', 'final.tex'].sort(), 'legacy adapter publishes the frozen primaries only: ' + JSON.stringify(tree))
  const man = JSON.parse(await fs.readFile(path.join(baseDir, 'outputs', 'leg-proj', 'MANIFEST.json'), 'utf8'))
  assert.equal(man.policyVersion, 'legacy-adapter')
  assert.equal(man.rebuildable, false)
  for (const entry of man.entries) assert.equal(entry.sourceRule, 'legacy-adapter')
  assert.ok(!tree.some((rel) => rel.includes('sec-author') || rel.includes('references.bib') || rel.includes('audit/')), 'no companions/closure/audit for legacy: ' + JSON.stringify(tree))

  // Markdown legacy: final.md only.
  const legmdPlan = {
    schemaVersion: 2, projectId: 'legmd-proj', projectName: 'LEGMD', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: { goal: 'Legacy MD.', acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], artifactFormat: 'markdown', expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], dependsOn: [] },
    ],
  }
  const legmdRunRel = path.join('.research-agent', 'runs', 'LEGMD-INT', '2026-01-01T00-00-00-integration')
  await setupProject({
    projectId: 'legmd-proj',
    plan: legmdPlan,
    runs: {
      integration: {
        issueId: 'LEGMD-INT', runRel: legmdRunRel, outputHash: sha256('# Legacy MD\n'),
        files: { 'final.md': '# Legacy MD\n' },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const legmdResult = await finalize.execute({ runDir: legmdRunRel, baseDir }, mount.exec)
  assert.equal(legmdResult.projectPublish.ok, true, JSON.stringify(legmdResult.projectPublish.errors))
  const legmdTree = await walk(path.join(baseDir, 'outputs', 'legmd-proj'))
  assert.deepEqual(legmdTree.sort(), ['MANIFEST.json', 'final.md'].sort(), 'legacy markdown adapter: ' + JSON.stringify(legmdTree))

  // Legacy explicit empty list: skip, no folder.
  const legEpPlan = JSON.parse(JSON.stringify(legacyPlan))
  legEpPlan.projectId = 'legep-proj'
  legEpPlan.projectContract.deliverables = []
  const legEpRunRel = path.join('.research-agent', 'runs', 'LEGEp-INT', '2026-01-01T00-00-00-integration')
  await setupProject({
    projectId: 'legep-proj',
    plan: legEpPlan,
    runs: {
      integration: {
        issueId: 'LEGEp-INT', runRel: legEpRunRel, outputHash: sha256(outputTex),
        files: { 'output.tex': outputTex, 'final.tex': '\\documentclass{article}\n\\begin{document}\nEmpty.\n\\end{document}\n', 'final.pdf': finalPdf },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const legEpResult = await finalize.execute({ runDir: legEpRunRel, baseDir }, mount.exec)
  assert.equal(legEpResult.projectPublish.skipped, true)
  assert.ok(!await dirExists(path.join(baseDir, 'outputs', 'legep-proj')), 'legacy explicit empty list must not create a folder')
}

// ── S6. New-policy validation + marker-omitted reject ───────────────────────
{
  const base = {
    schemaVersion: 2, projectId: 'val-proj', projectName: 'VAL', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: { goal: 'Validation.', acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    ],
  }
  // Marker without deliverables list → rejected.
  const noList = JSON.parse(JSON.stringify(base))
  noList.projectContract.exposurePolicyVersion = 1
  const noListValidation = core.validatePlan(noList)
  assert.equal(noListValidation.ok, false)
  assert.ok(noListValidation.errors.some((e) => e.includes('explicit projectContract.deliverables array')), JSON.stringify(noListValidation.errors))
  // Marker with a malformed spec → rejected with the grammar error.
  const badSpec = JSON.parse(JSON.stringify(noList))
  badSpec.projectContract.deliverables = ['bad path.tex']
  const badSpecValidation = core.validatePlan(badSpec)
  assert.equal(badSpecValidation.ok, false)
  assert.ok(badSpecValidation.errors.some((e) => e.includes('safe relative file path')), JSON.stringify(badSpecValidation.errors))
  // Marker with rebuildable but no exposed TeX source → rejected.
  const noTex = JSON.parse(JSON.stringify(noList))
  noTex.projectContract.deliverables = ['final.pdf']
  noTex.projectContract.rebuildable = true
  const noTexValidation = core.validatePlan(noTex)
  assert.equal(noTexValidation.ok, false)
  assert.ok(noTexValidation.errors.some((e) => e.includes('exposed TeX source deliverable')), JSON.stringify(noTexValidation.errors))
  // Marker with a bad projectId → rejected.
  const badId = JSON.parse(JSON.stringify(noList))
  badId.projectId = 'bad id'
  badId.projectContract.deliverables = ['final.tex']
  const badIdValidation = core.validatePlan(badId)
  assert.equal(badIdValidation.ok, false)
  assert.ok(badIdValidation.errors.some((e) => e.includes('projectId')), JSON.stringify(badIdValidation.errors))
  // Diagnostic mapping outside audit/ → rejected.
  const badMap = JSON.parse(JSON.stringify(noList))
  badMap.projectContract.deliverables = ['final.tex']
  badMap.projectContract.diagnosticMappings = [{ sourcePath: 'output.tex', destinationPath: 'cert.tex' }]
  const badMapValidation = core.validatePlan(badMap)
  assert.equal(badMapValidation.ok, false)
  assert.ok(badMapValidation.errors.some((e) => e.includes('under audit/')), JSON.stringify(badMapValidation.errors))
  // Valid marker plan passes.
  const good = JSON.parse(JSON.stringify(noList))
  good.projectContract.deliverables = ['final.tex']
  assert.equal(core.validatePlan(good).ok, true, JSON.stringify(core.validatePlan(good).errors))

  // (the marker-omitted finalize rejection is exercised in the next block,
  // which hand-writes the deliberately invalid plan)
}

// (S6 continuation — hand-written invalid-plan fixture)
{
  const badPlan = {
    schemaVersion: 2, projectId: 'valbad-proj', projectName: 'VALBAD', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: { goal: 'Validation.', exposurePolicyVersion: 1, acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    ],
  }
  const projectDir = path.join(baseDir, '.research-agent', 'projects', 'valbad-proj')
  await write(projectDir, 'plan.json', JSON.stringify(badPlan, null, 2) + '\n')
  const runRel = path.join('.research-agent', 'runs', 'VALBAD-INT', '2026-01-01T00-00-00-integration')
  const digest = core.nodeContract(badPlan, 'integration').digest
  const contract = core.nodeContract(badPlan, 'integration')
  await write(baseDir, path.join(runRel, 'run.json'), JSON.stringify(makeRunJson({ runId: 'valbad-int', issueId: 'VALBAD-INT' }), null, 2) + '\n')
  await write(baseDir, path.join(runRel, 'node-contract.json'), JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'valbad-proj', projectName: 'VALBAD', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: digest, artifactFormat: 'tex', exposurePolicyVersion: 1, writtenAt: NOW, contract }, null, 2) + '\n')
  await write(baseDir, path.join(runRel, 'acceptance.json'), JSON.stringify(makeReceipt({ projectId: 'valbad-proj', nodeId: 'integration', digest, outputHash: sha256(outputTex) }), null, 2) + '\n')
  await write(baseDir, path.join(runRel, 'output.tex'), outputTex)
  await write(projectDir, 'state.json', JSON.stringify({ schemaVersion: 1, projectId: 'valbad-proj', marker: 'valbad-proj', createdAt: NOW, updatedAt: NOW, project: {}, integrationRevision: 1, nodes: { integration: { status: 'running', issueId: 'VALBAD-INT', identifier: 'VALBAD-INT', url: '', linearState: '', runDir: runRel, runStatus: 'in-progress', currentStep: '', currentPass: 1, hasFinal: false, finalCommentId: '', receipts: [], updatedAt: NOW } }, commentCursors: {}, lastError: '' }, null, 2) + '\n')
  const mount = makeMount(baseDir)
  await expectFinalizeError(mount, runRel, /exposure-policy contract requires an explicit projectContract\.deliverables array/)
  assert.ok(!await dirExists(path.join(baseDir, 'outputs', 'valbad-proj')), 'rejected contract must not create a folder')
}

// ── S7. Reserved internal names point at diagnosticMappings ─────────────────
{
  const reservedPlan = {
    schemaVersion: 2, projectId: 'resv-proj', projectName: 'RESV', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'Reserved.',
      exposurePolicyVersion: 1,
      deliverables: ['output.tex'],
      acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }],
    },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    ],
  }
  const runRel = path.join('.research-agent', 'runs', 'RESV-INT', '2026-01-01T00-00-00-integration')
  await setupProject({
    projectId: 'resv-proj',
    plan: reservedPlan,
    runs: {
      integration: {
        issueId: 'RESV-INT', runRel, outputHash: sha256(outputTex),
        files: { 'output.tex': outputTex, 'final.tex': '\\documentclass{article}\n\\begin{document}\nR.\n\\end{document}\n', 'final.pdf': finalPdf },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const mount = makeMount(baseDir)
  await expectFinalizeError(mount, runRel, /reserved internal name.*diagnosticMappings/s)
  assert.ok(!await dirExists(path.join(baseDir, 'outputs', 'resv-proj')), 'reserved-name rejection must not create a folder')
}

// ── S8. Audit-only mapping (deliverables [] + mappings) ─────────────────────
{
  const auditPlan = {
    schemaVersion: 2, projectId: 'aud-proj', projectName: 'AUD', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'Audit-only.',
      exposurePolicyVersion: 1,
      deliverables: [],
      diagnosticMappings: [{ sourcePath: 'output.tex', destinationPath: 'audit/certificate.tex', note: 'build certificate' }],
      acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }],
    },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    ],
  }
  const runRel = path.join('.research-agent', 'runs', 'AUD-INT', '2026-01-01T00-00-00-integration')
  await setupProject({
    projectId: 'aud-proj',
    plan: auditPlan,
    runs: {
      integration: {
        issueId: 'AUD-INT', runRel, outputHash: sha256(outputTex),
        files: { 'output.tex': outputTex, 'output.pdf': outputPdf, 'final.tex': '\\documentclass{article}\n\\begin{document}\nA.\n\\end{document}\n', 'final.pdf': finalPdf },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: runRel, baseDir }, mount.exec)
  assert.equal(result.projectPublish.ok, true, JSON.stringify(result.projectPublish.errors))
  const tree = await walk(path.join(baseDir, 'outputs', 'aud-proj'))
  assert.deepEqual(tree.sort(), ['MANIFEST.json', 'audit/certificate.tex'].sort(), 'audit-only publish: ' + JSON.stringify(tree))
  const man = JSON.parse(await fs.readFile(path.join(baseDir, 'outputs', 'aud-proj', 'MANIFEST.json'), 'utf8'))
  const entry = man.entries.find((item) => item.path === 'audit/certificate.tex')
  assert.equal(entry.sourceRule, 'audit')
  assert.equal(entry.requiredBy, 'diagnostic-mapping(output.tex)')
  assert.equal(entry.note, 'build certificate')
  assert.ok(!tree.some((rel) => rel === 'final.pdf' || rel === 'final.tex'), 'nothing else is exposed: ' + JSON.stringify(tree))
}

// ── S9. Marker plan, empty deliverables, no mappings → skip ─────────────────
{
  const emptyPlan = {
    schemaVersion: 2, projectId: 'empty-proj', projectName: 'EMPTY', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'Nothing exposed.',
      exposurePolicyVersion: 1,
      deliverables: [],
      acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }],
    },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    ],
  }
  const runRel = path.join('.research-agent', 'runs', 'EMPTY-INT', '2026-01-01T00-00-00-integration')
  await setupProject({
    projectId: 'empty-proj',
    plan: emptyPlan,
    runs: {
      integration: {
        issueId: 'EMPTY-INT', runRel, outputHash: sha256(outputTex),
        files: { 'output.tex': outputTex, 'final.tex': '\\documentclass{article}\n\\begin{document}\nEmpty.\n\\end{document}\n', 'final.pdf': finalPdf },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: runRel, baseDir }, mount.exec)
  assert.equal(result.projectPublish.ok, true)
  assert.equal(result.projectPublish.skipped, true)
  assert.match(String(result.projectPublish.reason), /nothing exposed/)
  assert.ok(!await dirExists(path.join(baseDir, 'outputs', 'empty-proj')), 'empty exposure must not create a folder')

  // Bound non-integration run: no visible output at all.
  const nonIntPlan = {
    schemaVersion: 2, projectId: 'ni-proj', projectName: 'NI', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: { goal: 'NI.', exposurePolicyVersion: 1, deliverables: ['final.tex'], acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
    nodes: [
      { id: 'work', title: 'Work', kind: 'research', roles: ['research_author'], expectedOutcome: 'w.', acceptance: [{ id: 'W-01', text: 'w.', required: true }], outputContract: { texMode: 'fragment' }, dependsOn: [] },
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: ['work'] },
    ],
  }
  const workRunRel = path.join('.research-agent', 'runs', 'NI-WORK', '2026-01-01T00-00-00-work')
  await setupProject({
    projectId: 'ni-proj',
    plan: nonIntPlan,
    runs: { work: { issueId: 'NI-WORK', runRel: workRunRel, outputHash: sha256('Work output.\n'), files: { 'output.tex': 'Work output.\n' }, ledger: {} } },
    stateNodes: { work: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const nonInt = await finalize.execute({ runDir: workRunRel, baseDir }, mount.exec)
  assert.deepEqual(nonInt.deliverables, [])
  assert.equal(nonInt.projectPublish.skipped, true)
  assert.match(String(nonInt.projectPublish.reason), /non-integration/)
  assert.ok(!await dirExists(path.join(baseDir, 'outputs', 'NI-WORK')), 'bound non-integration runs must not create outputs/<issueId>/')
}

// ── S10. Fail-before-write ──────────────────────────────────────────────────
async function makeFailProject({ projectId, deliverables, extraFiles = {}, occupy = null, conflictWorkspace = null, skipValidation = false }) {
  const plan = {
    schemaVersion: 2, projectId, projectName: projectId.toUpperCase(), approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'Fail fixture.',
      exposurePolicyVersion: 1,
      deliverables,
      acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }],
    },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    ],
  }
  const runRel = path.join('.research-agent', 'runs', projectId.toUpperCase().replace(/[^A-Z0-9-]/g, '-') + '-INT', '2026-01-01T00-00-00-integration')
  const files = {
    'output.tex': outputTex,
    'final.tex': '\\documentclass{article}\n\\begin{document}\nFail.\n\\end{document}\n',
    'final.pdf': finalPdf,
    ...extraFiles,
  }
  if (conflictWorkspace !== null) await write(baseDir, conflictWorkspace, '# workspace version\n')
  if (occupy !== null) {
    const occupied = path.join(baseDir, 'outputs', projectId, occupy[0])
    await fs.mkdir(path.dirname(occupied), { recursive: true })
    await fs.writeFile(occupied, occupy[1])
  }
  await setupProject({
    projectId,
    plan,
    runs: { integration: { issueId: projectId.toUpperCase().replace(/[^A-Z0-9-]/g, '-') + '-INT', runRel, outputHash: sha256(outputTex), files, ledger: {} } },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
    skipValidation,
  })
  return runRel
}
{
  const mount = makeMount(baseDir)

  // Unsafe declared path (traversal) → grammar rejection before fs.
  const unsafeRunRel = await makeFailProject({ projectId: 'unsafe-proj', deliverables: ['../escape.tex'], skipValidation: true })
  await expectFinalizeError(mount, unsafeRunRel, /safe relative file path/)
  assert.ok(!await dirExists(path.join(baseDir, 'outputs', 'unsafe-proj')), 'unsafe path must not create a folder')

  // Missing declared file → exact-path error, no folder.
  const missingRunRel = await makeFailProject({ projectId: 'miss-proj', deliverables: ['ghost.md'] })
  await expectFinalizeError(mount, missingRunRel, /declared deliverable not found: ghost\.md/)
  assert.ok(!await dirExists(path.join(baseDir, 'outputs', 'miss-proj')), 'missing declared file must not create a folder')

  // Unmanaged destination occupancy → preflight fail, file intact.
  const occRunRel = await makeFailProject({ projectId: 'occ-proj', deliverables: ['final.pdf'], occupy: ['final.pdf', 'user-owned bytes\n'] })
  await expectFinalizeError(mount, occRunRel, /final\.pdf.*unmanaged file/s)
  const occupied = path.join(baseDir, 'outputs', 'occ-proj', 'final.pdf')
  assert.equal(sha256(await fs.readFile(occupied)), sha256('user-owned bytes\n'), 'pre-existing destination must be left intact')
  const occTree = await walk(path.join(baseDir, 'outputs', 'occ-proj'))
  assert.deepEqual(occTree, ['final.pdf'], 'nothing else may be written on failure: ' + JSON.stringify(occTree))

  // Symlinked destination → preflight fail.
  const symRunRel = await makeFailProject({ projectId: 'sym-proj', deliverables: ['final.pdf'] })
  const symDest = path.join(baseDir, 'outputs', 'sym-proj', 'final.pdf')
  await fs.mkdir(path.dirname(symDest), { recursive: true })
  fsSync.symlinkSync(path.join(baseDir, 'some-external.pdf'), symDest)
  await expectFinalizeError(mount, symRunRel, /symbolic link/)
  assert.ok(!await dirExists(path.join(baseDir, 'outputs', 'sym-proj', 'final.tex')), 'symlink destination must not be touched')

  // Conflicting declared deliverable (different hashes across roots).
  const confRunRel = await makeFailProject({ projectId: 'conf-proj', deliverables: ['shared.md'], extraFiles: { 'shared.md': '# integration version\n' }, conflictWorkspace: 'shared.md' })
  await expectFinalizeError(mount, confRunRel, /conflicting declared deliverable shared\.md/)
  assert.ok(!await dirExists(path.join(baseDir, 'outputs', 'conf-proj')), 'conflict must not create a folder')
  // Identical content in multiple roots → accepted with a warning.
  await fs.writeFile(path.join(baseDir, 'shared.md'), '# integration version\n')
  const okResult = await mount.registered.get('autoresearch_finalize_run').execute({ runDir: confRunRel, baseDir }, mount.exec)
  assert.equal(okResult.projectPublish.ok, true, JSON.stringify(okResult.projectPublish.errors))
  assert.ok(okResult.projectPublish.warnings.some((w) => w.includes('shared.md') && w.includes('identical content')), JSON.stringify(okResult.projectPublish.warnings))
  assert.equal(sha256(await fs.readFile(path.join(baseDir, 'outputs', 'conf-proj', 'shared.md'))), sha256('# integration version\n'))
}

// ── S11. Rollback / interrupted-transaction recovery + temp lifecycle ───────
{
  // A crashed publish left: an interrupted staging dir (owner RR-INT) with a
  // journal, plus partially installed destination bytes.
  const rrPlan = {
    schemaVersion: 2, projectId: 'rr-proj', projectName: 'RR', approvedAt: NOW, revision: 1, integrationId: 'integration',
    projectContract: { goal: 'Rollback.', exposurePolicyVersion: 1, deliverables: ['final.tex'], acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    ],
  }
  const runRel = path.join('.research-agent', 'runs', 'RR-INT', '2026-01-01T00-00-00-integration')
  await setupProject({
    projectId: 'rr-proj',
    plan: rrPlan,
    runs: {
      integration: {
        issueId: 'RR-INT', runRel, outputHash: sha256(outputTex),
        files: {
          'output.tex': outputTex,
          'final.tex': 'v2 final\n',
          'final.pdf': finalPdf,
        },
        ledger: {},
      },
    },
    stateNodes: { integration: { status: 'running', runStatus: 'in-progress', hasFinal: false, receipts: [] } },
  })
  const v1Content = 'v1 final\n'
  const v1Hash = sha256(v1Content)
  const projDir = path.join(baseDir, 'outputs', 'rr-proj')
  await write(projDir, 'final.tex', v1Content)
  await write(projDir, 'final.pdf', 'crash-bytes\n')
  const stagingName = lib.helpers.tempStagingName('RR-INT')
  const stagingDir = path.join(baseDir, 'outputs', stagingName)
  await write(stagingDir, 'marker.json', JSON.stringify({
    schema: 1, ownerId: 'RR-INT', runId: 'RR-INT', operation: 'publish-transaction', projectId: 'rr-proj',
    state: 'installing', runDir: runRel,
    createdAt: '2026-01-01T20:00:00.000Z', expiresAt: '2026-01-01T20:15:00.000Z',
  }, null, 2) + '\n')
  await write(stagingDir, 'journal.json', JSON.stringify({
    schema: 1, ownerId: 'RR-INT', runId: 'RR-INT', projectId: 'rr-proj', createdAt: '2026-01-01T20:00:00.000Z',
    snapshot: [{ path: 'final.tex', hash: v1Hash }, { path: 'MANIFEST.json', hash: '' }],
    backups: ['final.tex'],
    installedNew: ['final.pdf'],
  }, null, 2) + '\n')
  await write(stagingDir, 'backup/final.tex', v1Content)

  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: runRel, baseDir }, mount.exec)
  assert.equal(result.projectPublish.ok, true, JSON.stringify(result.projectPublish.errors))
  // The crash's partially installed bytes are gone; the new publish stands.
  assert.equal(await fs.readFile(path.join(projDir, 'final.tex'), 'utf8'), 'v2 final\n')
  let crashPdfGone = false
  try { await fs.stat(path.join(projDir, 'final.pdf')) } catch { crashPdfGone = true }
  assert.equal(crashPdfGone, true, 'newly created crash file must be rolled back (final.pdf is not exposed)')
  assert.ok(!await dirExists(stagingDir), 'recovered staging dir must be removed')
  const tree = await walk(projDir)
  assert.deepEqual(tree.sort(), ['MANIFEST.json', 'final.tex'].sort(), 'post-recovery tree: ' + JSON.stringify(tree))
  const man = JSON.parse(await fs.readFile(path.join(projDir, 'MANIFEST.json'), 'utf8'))
  assert.equal(man.entries.length, 1)
  assert.equal(man.entries[0].path, 'final.tex')

  // ── cleanupTempOwners unit (injected clock, owner-only, states) ───────────
  const cleanBase = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-temp-cleanup-'))
  const cleanFops = makeNodeFops()
  const parent = path.join(cleanBase, 'outputs')
  await fs.mkdir(parent, { recursive: true })
  const now = Date.parse('2026-01-02T00:00:00.000Z')
  const mk = async (name, marker) => {
    const dir = path.join(parent, '.publish-tmp-' + name)
    await fs.mkdir(dir, { recursive: true })
    if (marker !== null) await fs.writeFile(path.join(dir, 'marker.json'), JSON.stringify({ schema: 1, createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:15:00.000Z', ...marker }, null, 2))
    return '.publish-tmp-' + name
  }
  const leased = await mk('leased', { ownerId: 'OWN', runId: 'OWN', state: 'owned', runDir: 'rd-a', expiresAt: '2026-01-02T12:00:00.000Z' })
  const lateNoLock = await mk('late-nolock', { ownerId: 'OWN', runId: 'OWN', state: 'owned', runDir: 'rd-b', expiresAt: '2025-12-31T00:00:00.000Z' })
  const lateLocked = await mk('late-locked', { ownerId: 'OWN', runId: 'OWN', state: 'owned', runDir: 'rd-live', expiresAt: '2025-12-31T00:00:00.000Z' })
  await fs.mkdir(path.join(cleanBase, '.research-agent', 'locks'), { recursive: true })
  await fs.writeFile(path.join(cleanBase, '.research-agent', 'locks', 'LIVE.lock'), JSON.stringify({ issueId: 'LIVE', runDir: 'rd-live' }))
  const retainedGone = await mk('retained-gone', { ownerId: 'OWN', runId: 'OWN', state: 'retained', runDir: 'rd-c', expiresAt: '2025-12-31T00:00:00.000Z' })
  const retainedKeep = await mk('retained-keep', { ownerId: 'OWN', runId: 'OWN', state: 'retained', runDir: 'rd-d', expiresAt: '2026-01-03T00:00:00.000Z' })
  const consumed = await mk('consumed', { ownerId: 'OWN', runId: 'OWN', state: 'consumed', runDir: 'rd-e' })
  const committed = await mk('committed', { ownerId: 'OWN', runId: 'OWN', state: 'committed', runDir: 'rd-f' })
  const otherOwner = await mk('other-owner', { ownerId: 'OTHER', runId: 'OTHER', state: 'consumed', runDir: 'rd-g' })
  const noMarker = path.join(parent, '.publish-tmp-nomarker')
  await fs.mkdir(noMarker, { recursive: true })
  const plain = path.join(parent, 'plain-dir')
  await fs.mkdir(plain, { recursive: true })
  const report = await lib.helpers.cleanupTempOwners(cleanFops, cleanBase, parent, { ownerId: 'OWN', runId: 'OWN', now })
  assert.deepEqual(report.removed.sort(), [committed, consumed, lateNoLock, retainedGone].sort(), JSON.stringify(report))
  assert.deepEqual(report.skipped.map((item) => item.name).sort(), [leased, lateLocked, otherOwner, retainedKeep, '.publish-tmp-nomarker'].sort(), JSON.stringify(report))
  assert.deepEqual(report.cleanupErrors, [])
  assert.ok(await dirExists(plain), 'non-temp directories are never touched')
  assert.ok(await dirExists(path.join(parent, otherOwner)), 'other owners are never touched')
  assert.ok(await dirExists(path.join(parent, '.publish-tmp-nomarker')), 'unmarked directories are never touched')
  // A live lock blocks owned-marker recovery.
  assert.ok(await dirExists(path.join(parent, lateLocked)), 'owned marker with a live run lock must survive')
  // Remove the lock → next boundary deletes it.
  await fs.rm(path.join(cleanBase, '.research-agent', 'locks', 'LIVE.lock'))
  const report2 = await lib.helpers.cleanupTempOwners(cleanFops, cleanBase, parent, { ownerId: 'OWN', runId: 'OWN', now })
  assert.ok(report2.removed.includes(lateLocked), 'after the lock is gone the abandoned owned marker is recovered')
  assert.ok(!await dirExists(path.join(parent, lateLocked)))
  await fs.rm(cleanBase, { recursive: true, force: true })
}

// ── S12. scripts/republish-outputs.mjs ──────────────────────────────────────
{
  const scriptPath = path.join(root, 'scripts', 'republish-outputs.mjs')
  const grfRunRel = path.join('.research-agent', 'runs', 'GRF-INT', '2026-01-01T00-00-00-integration')
  const grfOutputs = path.join(baseDir, 'outputs', 'grf-proj')
  const runScript = async (args) => {
    const { spawnSync } = await import('node:child_process')
    const res = spawnSync(process.execPath, [scriptPath, '--base-dir', baseDir, '--project-id', 'grf-proj', '--source-root', path.join(baseDir, grfRunRel), ...args], { encoding: 'utf8', cwd: baseDir })
    return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
  }
  const treeBefore = (await walk(path.join(baseDir, 'outputs'))).sort()

  // Dry-run (default): proposes, changes nothing.
  const dry = await runScript([])
  assert.equal(dry.code, 0, 'dry-run must exit 0: ' + dry.stderr)
  const dryJson = JSON.parse(dry.stdout)
  assert.equal(dryJson.dryRun, true)
  assert.equal(dryJson.policyVersion, 1)
  assert.equal(dryJson.rebuildable, true)
  assert.ok(dryJson.entries.some((entry) => entry.path === 'final.tex' && entry.sourceRule === 'declared'), JSON.stringify(dryJson.entries))
  assert.ok(!dryJson.entries.some((entry) => entry.path === 'output.tex'), 'internal names never appear as exposed entries')
  const treeAfterDry = (await walk(path.join(baseDir, 'outputs'))).sort()
  assert.deepEqual(treeAfterDry, treeBefore, 'dry-run must change nothing')
  const outputsTop = await fs.readdir(path.join(baseDir, 'outputs'))
  assert.ok(!outputsTop.some((name) => name.startsWith('.publish-tmp-')), 'dry-run must not stage: ' + JSON.stringify(outputsTop))

  // Project-id mismatch → rejected, non-zero. A project folder whose plan
  // carries a DIFFERENT projectId simulates a moved/renamed project.
  await write(path.join(baseDir, '.research-agent', 'projects', 'mism-proj'), 'plan.json', JSON.stringify({ ...grfPlan, projectId: 'grf-proj' }, null, 2) + '\n')
  const mismatchRes = spawnSync(process.execPath, [scriptPath, '--base-dir', baseDir, '--project-id', 'mism-proj', '--source-root', path.join(baseDir, grfRunRel)], { encoding: 'utf8', cwd: baseDir })
  assert.equal(mismatchRes.status, 1, 'project-id mismatch must fail: ' + mismatchRes.stdout)
  assert.match(mismatchRes.stderr, /project-id mismatch/)

  // finalBuild verification: wrong hash → rejected.
  const badBuildFile = path.join(baseDir, 'bad-final-build.json')
  await fs.writeFile(badBuildFile, JSON.stringify({ sourcePath: 'final.tex', sourceHash: sha256('wrong bytes\n'), pdfPath: 'final.pdf', pdfHash: sha256(finalPdf) }))
  const badBuildRes = spawnSync(process.execPath, [scriptPath, '--base-dir', baseDir, '--project-id', 'grf-proj', '--source-root', path.join(baseDir, grfRunRel), '--final-build-file', badBuildFile], { encoding: 'utf8', cwd: baseDir })
  assert.equal(badBuildRes.status, 1, 'finalBuild hash mismatch must fail: ' + badBuildRes.stdout)
  assert.match(badBuildRes.stderr, /finalBuild verification failed/)
  const backslashBuildFile = path.join(baseDir, 'backslash-final-build.json')
  await fs.writeFile(backslashBuildFile, JSON.stringify({ sourcePath: 'sub\\final.tex', sourceHash: sha256('wrong bytes\n') }))
  const backslashBuildRes = spawnSync(process.execPath, [scriptPath, '--base-dir', baseDir, '--project-id', 'grf-proj', '--source-root', path.join(baseDir, grfRunRel), '--final-build-file', backslashBuildFile], { encoding: 'utf8', cwd: baseDir })
  assert.equal(backslashBuildRes.status, 1)
  assert.match(backslashBuildRes.stderr, /must be a safe relative path/)

  // Reviewed override (PDF-only historical republish): verifies the accepted
  // PDF with a correct finalBuild file, publishes ONLY the exposed PDF,
  // prunes the previously managed set, and never touches GAV-99.
  const overrideFile = path.join(baseDir, 'republish-override.json')
  await fs.writeFile(overrideFile, JSON.stringify({
    projectId: 'grf-proj',
    deliverables: ['final.pdf'],
    rebuildable: false,
  }))
  const goodBuildFile = path.join(baseDir, 'good-final-build.json')
  await fs.writeFile(goodBuildFile, JSON.stringify({ sourcePath: 'final.tex', sourceHash: sha256(finalTex), pdfPath: 'final.pdf', pdfHash: sha256(finalPdf) }))
  const writeRes = spawnSync(process.execPath, [scriptPath, '--base-dir', baseDir, '--project-id', 'grf-proj', '--source-root', path.join(baseDir, grfRunRel), '--deliverables-file', overrideFile, '--final-build-file', goodBuildFile, '--write'], { encoding: 'utf8', cwd: baseDir })
  assert.equal(writeRes.status, 0, 'override republish must succeed: ' + writeRes.stderr)
  const finalTree = (await walk(grfOutputs)).sort()
  assert.deepEqual(finalTree, ['MANIFEST.json', 'GAV-99/report.md', 'final.pdf', 'sentinel-user-file.txt'].sort(), 'override shrinks the managed set and preserves user files: ' + JSON.stringify(finalTree))
  const finalMan = JSON.parse(await fs.readFile(path.join(grfOutputs, 'MANIFEST.json'), 'utf8'))
  assert.equal(finalMan.entries.length, 1)
  assert.equal(finalMan.entries[0].path, 'final.pdf')
  assert.equal(finalMan.rebuildable, false)
  assert.deepEqual(finalMan.preservedExisting.map((item) => item.path).sort(), ['GAV-99/report.md', 'sentinel-user-file.txt'].sort())
  assert.ok(Buffer.from(await fs.readFile(path.join(grfOutputs, 'final.pdf'))).equals(finalPdf))
}

await fs.rm(baseDir, { recursive: true, force: true })
console.log('output policy v8 golden tests passed for generation ' + manifest.generation)
