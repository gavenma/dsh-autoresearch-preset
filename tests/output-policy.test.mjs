// WS4 — Output policy v5 (GRF-2026 SOD #23/#24/#25 + user review; plan WS4).
//
// Layer 2 golden test: a three-node project (author, assembly, integration)
// whose integration run contains the full artifact set, decoy build files,
// and node receipts/ledgers. Asserts the EXACT published tree, MANIFEST
// attribution, journal merge-preservation and idempotence, fail-before-write
// behavior, resolver fallback, legacy byte-for-byte behavior, empty-
// deliverables skip, and per-issue suppression for bound runs.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
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
    const rel = path.relative(base, abs)
    if (entry.isDirectory()) out.push(...(await walk(abs, base)))
    else out.push(rel)
  }
  return out
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
    async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, dir: entry.isDirectory() })) } catch { return [] } },
    async ensureDir(target) { await fs.mkdir(target, { recursive: true }) },
    async remove(target) { await fs.rm(target, { force: true }) },
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

// ── fixture: three-node project with a fully populated integration run ─────
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-output-policy-'))
const projectDir = path.join(baseDir, '.research-agent', 'projects', 'pol-proj')
const plan = {
  schemaVersion: 2, projectId: 'pol-proj', projectName: 'Policy', approvedAt: '2026-01-01T00:00:00.000Z', revision: 1, integrationId: 'integration',
  projectContract: {
    goal: 'Policy fixture.',
    deliverables: ['final.tex', 'final.pdf', 'references.bib', 'process-issues.md', 'figure-dossier.tex', 'bib-verification-ledger.bib'],
    acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }],
  },
  nodes: [
    { id: 'author', title: 'Author', kind: 'research', roles: ['research_author'], expectedOutcome: 'Fragment.', acceptance: [{ id: 'AUT-01', text: 'Fragment exists.', required: true }], outputContract: { texMode: 'fragment' }, dependsOn: [] },
    { id: 'assembly', title: 'Assembly', kind: 'assembly', roles: ['research_author'], expectedOutcome: 'Assembled.', acceptance: [{ id: 'ASM-01', text: 'Assembled exists.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: ['author'] },
    { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: ['author', 'assembly'] },
  ],
}
await write(projectDir, 'plan.json', JSON.stringify(plan, null, 2) + '\n')

const integrationDigest = core.nodeContract(plan, 'integration').digest
const authorDigest = core.nodeContract(plan, 'author').digest
const assemblyDigest = core.nodeContract(plan, 'assembly').digest

const intRunRel = path.join('.research-agent', 'runs', 'POL-INT', '2026-01-01T00-00-00-integration')
const authorRunRel = path.join('.research-agent', 'runs', 'POL-AUTH', '2026-01-01T00-00-00-author')
const assemblyRunRel = path.join('.research-agent', 'runs', 'POL-ASM', '2026-01-01T00-00-00-assembly')

const state = {
  schemaVersion: 1, projectId: 'pol-proj', marker: 'pol-proj', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  project: { linearProjectId: '', url: '', createdAt: '' },
  integrationRevision: 1,
  nodes: {
    author: { status: 'done', issueId: 'POL-AUTH', identifier: 'POL-AUTH', url: 'https://linear/issue/POL-AUTH', linearState: 'done', runDir: authorRunRel, runStatus: 'complete', currentStep: '', currentPass: null, hasFinal: true, finalCommentId: 'fc-1', receipts: ['legacy-receipt'], updatedAt: '2026-01-02T00:00:00.000Z' },
    assembly: { status: 'done', issueId: 'POL-ASM', identifier: 'POL-ASM', url: '', linearState: 'done', runDir: assemblyRunRel, runStatus: 'complete', currentStep: '', currentPass: null, hasFinal: true, finalCommentId: '', receipts: ['legacy-receipt-asm'], updatedAt: '2026-01-02T00:00:00.000Z' },
    integration: { status: 'running', issueId: 'POL-INT', identifier: 'POL-INT', url: '', linearState: 'In Progress', runDir: intRunRel, runStatus: 'in-progress', currentStep: 'pass_02_scoring', currentPass: 2, hasFinal: false, finalCommentId: '', receipts: [], updatedAt: '2026-01-03T00:00:00.000Z' },
  },
  commentCursors: { author: ['c-1'] },
  lastError: '',
}
await write(projectDir, 'state.json', JSON.stringify(state, null, 2) + '\n')
const stateBefore = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))

// Integration run: the full artifact set + decoys.
const outputTex = '\\documentclass{article}\n\\begin{document}\nAudit certificate body.\n\\end{document}\n'
const outputPdf = Buffer.from('%PDF-1.7 audit certificate bytes\n')
const finalTex = '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\input{sec-author}\n\\includegraphics[width=0.5\\textwidth]{figure-1.pdf}\n\\bibliography{references}\n\\end{document}\n'
const finalPdf = Buffer.from('%PDF-1.7 final product bytes\n')
const figurePdf = Buffer.from('%PDF-1.7 figure bytes\n')
const secAuthor = 'Fragment text from the author node, long enough to matter.\n'
const referencesBib = '@article{key, author={Someone}, title={Something}, year={2026}}\n'
const dossier = '\\section*{Figure dossier}\nDossier text.\n'
const bibLedger = '@comment{bib verification ledger entry}\n'
const processIssues = '# Process issues\n\nNo unresolved issues.\n'
const fls = [
  'OUTPUT final.pdf',
  'INPUT /usr/share/texlive/2024/texmf-dist/tex/latex/base/article.cls',
  'INPUT final.tex',
  'INPUT final.tex',
  'INPUT sec-author.tex',
  'INPUT figure-1.pdf',
  'INPUT /usr/share/texlive/2024/texmf-dist/fonts/tfm/public/cm/cmr10.tfm',
].join('\n') + '\n'
const integrationLedger = { ledgerVersion: 1, nodeId: 'integration', outputHash: sha256(outputTex), nodeRevision: 1, contractDigest: integrationDigest, artifactFormat: 'tex', contributions: [{ id: 'main', importance: 'required', mutability: 'editable', evidence: [] }] }
const integrationReceipt = { schemaVersion: 2, kind: 'acceptance-receipt', projectId: 'pol-proj', planRevision: 1, nodeId: 'integration', nodeContractDigest: integrationDigest, nodeRevision: 1, outputHash: sha256(outputTex), artifactFormat: 'tex', criteria: [{ id: 'INT-01', result: 'PASS' }], overall: 'PASS', receiptHash: sha256('integration-receipt') }

const intRun = path.join(baseDir, intRunRel)
await write(intRun, 'output.tex', outputTex)
await write(intRun, 'output.pdf', outputPdf)
await write(intRun, 'final.tex', finalTex)
await write(intRun, 'final.pdf', finalPdf)
await write(intRun, 'final.fls', fls)
await write(intRun, 'sec-author.tex', secAuthor)
await write(intRun, 'figure-1.pdf', figurePdf)
await write(intRun, 'references.bib', referencesBib)
await write(intRun, 'process-issues.md', processIssues)
await write(intRun, 'figure-dossier.tex', dossier)
await write(intRun, 'bib-verification-ledger.bib', bibLedger)
await write(intRun, 'node-output.json', JSON.stringify(integrationLedger, null, 2) + '\n')
await write(intRun, 'acceptance.json', JSON.stringify(integrationReceipt, null, 2) + '\n')
await write(intRun, 'run.json', JSON.stringify({ runId: 'r-int', issueId: 'POL-INT', artifactRoot: '.research-agent', status: 'in-progress', currentStep: 'pass_02_scoring', currentPass: 2, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-03T00:00:00.000Z' }, null, 2) + '\n')
await write(intRun, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'pol-proj', projectName: 'Policy', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: integrationDigest, artifactFormat: 'tex', writtenAt: '2026-01-01T00:00:00.000Z', contract: core.nodeContract(plan, 'integration') }, null, 2) + '\n')
// Decoy build files that must never be published.
await write(intRun, 'final.aux', 'aux decoy\n')
await write(intRun, 'final.log', 'log decoy\n')
await write(intRun, 'final.bbl', 'bbl decoy\n')
await write(intRun, 'final.out', 'out decoy\n')
await write(intRun, 'final.toc', 'toc decoy\n')
await write(intRun, 'final.fdb_latexmk', 'fdb decoy\n')
await write(intRun, 'final.synctex.gz', 'gz decoy\n')
await write(intRun, 'preview.tex', 'preview decoy\n')
await write(intRun, 'preview.pdf', Buffer.from('%PDF preview decoy\n'))
await write(intRun, 'pass_01/A.tex', 'candidate decoy\n')

// Other node runs: accepted artifacts + receipts + ledgers.
const authorOutput = 'Author fragment output.\n'
const assemblyOutput = 'Assembled output.\n'
for (const [nodeId, runRel, output, digest, issueId] of [
  ['author', authorRunRel, authorOutput, authorDigest, 'POL-AUTH'],
  ['assembly', assemblyRunRel, assemblyOutput, assemblyDigest, 'POL-ASM'],
]) {
  const run = path.join(baseDir, runRel)
  await write(run, 'output.tex', output)
  await write(run, 'acceptance.json', JSON.stringify({ schemaVersion: 2, kind: 'acceptance-receipt', projectId: 'pol-proj', nodeId, nodeContractDigest: digest, nodeRevision: 1, outputHash: sha256(output), artifactFormat: 'tex', criteria: [], overall: 'PASS', receiptHash: sha256('receipt-' + nodeId) }, null, 2) + '\n')
  await write(run, 'node-output.json', JSON.stringify({ ledgerVersion: 1, nodeId, outputHash: sha256(output), nodeRevision: 1, contractDigest: digest, artifactFormat: 'tex', contributions: [{ id: 'main', importance: 'required', mutability: 'editable', evidence: [] }] }, null, 2) + '\n')
  await write(run, 'run.json', JSON.stringify({ runId: 'r-' + nodeId, issueId, artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-02T00:00:00.000Z' }, null, 2) + '\n')
  await write(run, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'pol-proj', nodeId, artifactRoot: '.research-agent', planRevision: 1, contractDigest: digest, artifactFormat: 'tex', contract: core.nodeContract(plan, nodeId) }, null, 2) + '\n')
}

// ── pure-function unit checks (plan WS4 Layer 1) ───────────────────────────
{
  const helpers = lib.helpers
  // Safe relative paths only.
  assert.equal(helpers.isSafeRelPath('a/b.pdf'), true)
  assert.equal(helpers.isSafeRelPath('../evil.tex'), false)
  assert.equal(helpers.isSafeRelPath('/absolute.tex'), false)
  assert.equal(helpers.isSafeRelPath('a\\b.tex'), false)
  assert.equal(helpers.isSafeRelPath(''), false)
  assert.equal(helpers.isSafeRelPath('dir/'), false)
  // Denylist.
  assert.equal(helpers.isDenylistedRelPath('final.aux'), true)
  assert.equal(helpers.isDenylistedRelPath('x/log.log'), true)
  assert.equal(helpers.isDenylistedRelPath('final.bbl'), true)
  assert.equal(helpers.isDenylistedRelPath('final.fdb_latexmk'), true)
  assert.equal(helpers.isDenylistedRelPath('preview.tex'), true)
  assert.equal(helpers.isDenylistedRelPath('pass_01/A.tex'), true)
  assert.equal(helpers.isDenylistedRelPath('final.pdf'), false)
  assert.equal(helpers.isDenylistedRelPath('references.bib'), false)
  // fls parsing: dedup, system skip, normalization.
  const parsed = helpers.parseFlsInputs(fls, intRun, [intRun, baseDir])
  assert.deepEqual(parsed.system, ['/usr/share/texlive/2024/texmf-dist/tex/latex/base/article.cls', '/usr/share/texlive/2024/texmf-dist/fonts/tfm/public/cm/cmr10.tfm'])
  assert.deepEqual(parsed.inputs.map((item) => item.raw), ['final.tex', 'sec-author.tex', 'figure-1.pdf'], 'duplicate final.tex must be deduped')
  // Bib extraction across resolved inputs.
  const bibNames = helpers.extractBibSources([finalTex, '\\addbibresource[backend=biber]{extra}\n\\bibliography{a,b}\n'])
  assert.deepEqual(bibNames, ['references', 'a', 'b', 'extra'])
}

// ── golden publish: the complete tree ──────────────────────────────────────
{
  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: intRunRel, baseDir }, mount.exec)
  assert.equal(result.status, 'complete')
  assert.equal(result.v2.bound, true)
  // Journal merged with preservation.
  assert.equal(result.journalSync.action, 'merged')
  const stateAfter = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
  const intEntry = stateAfter.nodes.integration
  assert.equal(intEntry.status, 'done')
  assert.equal(intEntry.runStatus, 'complete')
  assert.equal(intEntry.runDir, intRunRel)
  assert.deepEqual(intEntry.receipts, [integrationReceipt.receiptHash, sha256(outputTex), path.join(intRunRel, 'acceptance.json')])
  // Every other field preserved untouched.
  assert.equal(intEntry.issueId, 'POL-INT')
  assert.equal(intEntry.identifier, 'POL-INT')
  assert.equal(intEntry.linearState, 'In Progress')
  assert.equal(intEntry.currentPass, 2)
  assert.equal(intEntry.finalCommentId, '')
  // Other nodes and cursors untouched.
  assert.deepEqual(stateAfter.nodes.author, stateBefore.nodes.author)
  assert.deepEqual(stateAfter.nodes.assembly, stateBefore.nodes.assembly)
  assert.deepEqual(stateAfter.commentCursors, stateBefore.commentCursors)

  // Project publish: exact tree.
  assert.equal(result.projectPublish.ok, true, JSON.stringify(result.projectPublish.errors))
  assert.equal(result.projectPublish.closureSource, 'fls')
  assert.deepEqual(result.deliverables, [], 'bound v2 runs must not publish per-issue folders')
  const outputsDir = path.join(baseDir, 'outputs')
  const tree = await walk(outputsDir)
  assert.deepEqual(tree, [
    'pol-proj/MANIFEST.json',
    'pol-proj/audit/acceptance/assembly.json',
    'pol-proj/audit/acceptance/author.json',
    'pol-proj/audit/acceptance/integration.json',
    'pol-proj/audit/audit-certificate.pdf',
    'pol-proj/audit/audit-certificate.tex',
    'pol-proj/audit/ledgers/assembly.json',
    'pol-proj/audit/ledgers/author.json',
    'pol-proj/audit/ledgers/integration.json',
    'pol-proj/bib-verification-ledger.bib',
    'pol-proj/final.pdf',
    'pol-proj/final.tex',
    'pol-proj/figure-1.pdf',
    'pol-proj/figure-dossier.tex',
    'pol-proj/process-issues.md',
    'pol-proj/references.bib',
    'pol-proj/sec-author.tex',
  ].sort(), 'exact published tree: ' + JSON.stringify(tree))
  // No per-issue folders, no bare output.*.
  assert.ok(!tree.some((rel) => rel.startsWith('POL-')), 'no per-issue folders: ' + JSON.stringify(tree))
  assert.ok(!tree.some((rel) => /^(?!pol-proj\/audit\/)[^/]*\/?output\./.test(rel)), 'no bare output.*: ' + JSON.stringify(tree))

  // Source-hash equality for the audit set.
  assert.equal(sha256(await fs.readFile(path.join(outputsDir, 'pol-proj', 'audit', 'audit-certificate.tex'))), sha256(outputTex))
  assert.equal(Buffer.from(await fs.readFile(path.join(outputsDir, 'pol-proj', 'audit', 'audit-certificate.pdf'))).equals(outputPdf), true)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outputsDir, 'pol-proj', 'audit', 'acceptance', 'author.json'), 'utf8')), JSON.parse(await fs.readFile(path.join(baseDir, authorRunRel, 'acceptance.json'), 'utf8')))

  // MANIFEST: every published path, source path, rule, hash; no unlisted file.
  const man = JSON.parse(await fs.readFile(path.join(outputsDir, 'pol-proj', 'MANIFEST.json'), 'utf8'))
  assert.equal(man.closureSource, 'fls')
  assert.equal(man.projectId, 'pol-proj')
  const manPaths = man.entries.map((entry) => entry.path).sort()
  const treePaths = tree.filter((rel) => !rel.endsWith('MANIFEST.json')).map((rel) => rel.slice('pol-proj/'.length)).sort()
  assert.deepEqual(manPaths, treePaths, 'manifest must list every published path exactly once (folder-relative)')
  const ruleOf = (p) => man.entries.find((entry) => entry.path === p).sourceRule
  assert.equal(ruleOf('final.tex'), 'declared')
  assert.equal(ruleOf('final.pdf'), 'declared')
  assert.equal(ruleOf('sec-author.tex'), 'fls')
  assert.equal(ruleOf('figure-1.pdf'), 'fls')
  assert.equal(ruleOf('references.bib'), 'bib')
  assert.equal(ruleOf('process-issues.md'), 'declared')
  assert.equal(ruleOf('figure-dossier.tex'), 'declared')
  assert.equal(ruleOf('bib-verification-ledger.bib'), 'declared')
  assert.equal(ruleOf('audit/audit-certificate.tex'), 'audit')
  assert.equal(ruleOf('audit/acceptance/integration.json'), 'receipt')
  assert.equal(ruleOf('audit/ledgers/author.json'), 'ledger')
  for (const entry of man.entries) {
    assert.equal(entry.hash, sha256(await fs.readFile(path.join(outputsDir, 'pol-proj', entry.path))), 'manifest hash must equal the published bytes: ' + entry.path)
  }
  // Denylist: no byproduct in the tree.
  assert.ok(!tree.some((rel) => /\.(aux|log|fls|out|toc|bbl|blg|fdb_latexmk|synctex\.gz)$/.test(rel) || rel.includes('preview.') || rel.includes('pass_')), 'denylist must hold: ' + JSON.stringify(tree))

  // ── idempotence: sentinel + second finalize + mtime stability ───────────
  const sentinel = path.join(outputsDir, 'pol-proj', 'sentinel-user-file.txt')
  await fs.writeFile(sentinel, 'user file, never prune\n')
  const mtimeBefore = [
    fsSync.statSync(path.join(outputsDir, 'pol-proj', 'final.tex')),
    fsSync.statSync(path.join(outputsDir, 'pol-proj', 'MANIFEST.json')),
  ].map((info) => info.mtimeMs)
  const second = await finalize.execute({ runDir: intRunRel, baseDir }, mount.exec)
  assert.equal(second.projectPublish.ok, true, JSON.stringify(second.projectPublish.errors))
  assert.equal(second.projectPublish.copied.length, 0, 'same-hash re-finalize must not copy anything: ' + JSON.stringify(second.projectPublish.copied))
  assert.equal(second.journalSync.action, 'current', 'repeat journal sync must be a no-op')
  const mtimeAfter = [
    fsSync.statSync(path.join(outputsDir, 'pol-proj', 'final.tex')),
    fsSync.statSync(path.join(outputsDir, 'pol-proj', 'MANIFEST.json')),
  ].map((info) => info.mtimeMs)
  assert.deepEqual(mtimeAfter, mtimeBefore, 're-finalize must not change content timestamps')
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'user file, never prune\n')
  const treeAfter = await walk(outputsDir)
  assert.ok(treeAfter.includes('pol-proj/sentinel-user-file.txt'), 'unrelated user file must be preserved')
}

// ── fail-before-write: unmanaged destination occupancy ─────────────────────
{
  const conflictPlan = JSON.parse(JSON.stringify(plan))
  conflictPlan.projectId = 'conf-proj'
  conflictPlan.projectContract.deliverables = ['final.tex', 'final.pdf']
  const confDir = path.join(baseDir, '.research-agent', 'projects', 'conf-proj')
  await write(confDir, 'plan.json', JSON.stringify(conflictPlan, null, 2) + '\n')
  const confDigest = core.nodeContract(conflictPlan, 'integration').digest
  const confRunRel = path.join('.research-agent', 'runs', 'CONF-INT', '2026-01-01T00-00-00-conf')
  const confRun = path.join(baseDir, confRunRel)
  await write(confRun, 'output.tex', outputTex)
  await write(confRun, 'final.tex', finalTex)
  await write(confRun, 'final.pdf', finalPdf)
  await write(confRun, 'sec-author.tex', secAuthor)
  await write(confRun, 'references.bib', referencesBib)
  await write(confRun, 'figure-1.pdf', figurePdf)
  await write(confRun, 'acceptance.json', JSON.stringify({ ...integrationReceipt, nodeId: 'integration', nodeContractDigest: confDigest }, null, 2) + '\n')
  await write(confRun, 'node-output.json', JSON.stringify({ ...integrationLedger, contractDigest: confDigest }, null, 2) + '\n')
  await write(confRun, 'run.json', JSON.stringify({ runId: 'r-conf', issueId: 'CONF-INT', artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-03T00:00:00.000Z' }, null, 2) + '\n')
  await write(confRun, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'conf-proj', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: confDigest, artifactFormat: 'tex', contract: core.nodeContract(conflictPlan, 'integration') }, null, 2) + '\n')
  // Pre-occupy the destination with an unmanaged, different final.pdf.
  const occupied = path.join(baseDir, 'outputs', 'conf-proj', 'final.pdf')
  await fs.mkdir(path.dirname(occupied), { recursive: true })
  await fs.writeFile(occupied, 'user-owned bytes\n')
  const occupiedHash = sha256('user-owned bytes\n')

  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: confRunRel, baseDir }, mount.exec)
  assert.equal(result.projectPublish.ok, false, 'unmanaged destination with different content must fail preflight')
  assert.ok(result.projectPublish.errors.some((e) => e.includes('unmanaged file') && e.includes('final.pdf')), JSON.stringify(result.projectPublish.errors))
  assert.equal(sha256(await fs.readFile(occupied, 'utf8')), occupiedHash, 'the pre-existing destination must be left intact')
  const confTree = await walk(path.join(baseDir, 'outputs', 'conf-proj'))
  assert.deepEqual(confTree, ['final.pdf'], 'nothing else may be written on failure')
}

// ── resolver fallback when the recorder is missing/stale ───────────────────
{
  const stalePlan = JSON.parse(JSON.stringify(plan))
  stalePlan.projectId = 'stale-proj'
  stalePlan.projectContract.deliverables = ['final.tex', 'final.pdf']
  const staleDir = path.join(baseDir, '.research-agent', 'projects', 'stale-proj')
  await write(staleDir, 'plan.json', JSON.stringify(stalePlan, null, 2) + '\n')
  const staleDigest = core.nodeContract(stalePlan, 'integration').digest
  const staleRunRel = path.join('.research-agent', 'runs', 'STALE-INT', '2026-01-01T00-00-00-stale')
  const staleRun = path.join(baseDir, staleRunRel)
  await write(staleRun, 'output.tex', outputTex)
  await write(staleRun, 'final.tex', finalTex)
  await write(staleRun, 'final.pdf', finalPdf)
  await write(staleRun, 'sec-author.tex', secAuthor)
  await write(staleRun, 'figure-1.pdf', figurePdf)
  await write(staleRun, 'references.bib', referencesBib)
  // Stale recorder: does not cover final.tex.
  await write(staleRun, 'final.fls', 'OUTPUT old.pdf\nINPUT old-main.tex\n')
  await write(staleRun, 'acceptance.json', JSON.stringify({ ...integrationReceipt, nodeContractDigest: staleDigest }, null, 2) + '\n')
  await write(staleRun, 'run.json', JSON.stringify({ runId: 'r-stale', issueId: 'STALE-INT', artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-03T00:00:00.000Z' }, null, 2) + '\n')
  await write(staleRun, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'stale-proj', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: staleDigest, artifactFormat: 'tex', contract: core.nodeContract(stalePlan, 'integration') }, null, 2) + '\n')

  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: staleRunRel, baseDir }, mount.exec)
  assert.equal(result.projectPublish.ok, true, JSON.stringify(result.projectPublish.errors))
  assert.equal(result.projectPublish.closureSource, 'resolver', 'stale fls must fall back to the resolver')
  assert.ok(result.projectPublish.warnings.some((w) => w.includes('stale recorder') || w.includes('does not cover final.tex')), JSON.stringify(result.projectPublish.warnings))
  const man = JSON.parse(await fs.readFile(path.join(baseDir, 'outputs', 'stale-proj', 'MANIFEST.json'), 'utf8'))
  assert.equal(man.closureSource, 'resolver')
  const ruleOf = (p) => man.entries.find((entry) => entry.path === p)?.sourceRule
  assert.equal(ruleOf('sec-author.tex'), 'resolver')
  assert.equal(ruleOf('references.bib'), 'bib')
  // Missing closure input is a hard error.
  const brokenPlan = JSON.parse(JSON.stringify(stalePlan))
  brokenPlan.projectId = 'broken-proj'
  const brokenDir = path.join(baseDir, '.research-agent', 'projects', 'broken-proj')
  await write(brokenDir, 'plan.json', JSON.stringify(brokenPlan, null, 2) + '\n')
  const brokenDigest = core.nodeContract(brokenPlan, 'integration').digest
  const brokenRunRel = path.join('.research-agent', 'runs', 'BROKEN-INT', '2026-01-01T00-00-00-broken')
  const brokenRun = path.join(baseDir, brokenRunRel)
  await write(brokenRun, 'output.tex', outputTex)
  await write(brokenRun, 'final.tex', finalTex.replace('sec-author', 'missing-fragment'))
  await write(brokenRun, 'final.pdf', finalPdf)
  await write(brokenRun, 'acceptance.json', JSON.stringify({ ...integrationReceipt, nodeContractDigest: brokenDigest }, null, 2) + '\n')
  await write(brokenRun, 'run.json', JSON.stringify({ runId: 'r-broken', issueId: 'BROKEN-INT', artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-03T00:00:00.000Z' }, null, 2) + '\n')
  await write(brokenRun, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'broken-proj', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: brokenDigest, artifactFormat: 'tex', contract: core.nodeContract(brokenPlan, 'integration') }, null, 2) + '\n')
  const brokenResult = await finalize.execute({ runDir: brokenRunRel, baseDir }, mount.exec)
  assert.equal(brokenResult.projectPublish.ok, false)
  assert.ok(brokenResult.projectPublish.errors.some((e) => e.includes('missing-fragment')), JSON.stringify(brokenResult.projectPublish.errors))
  let exists = true
  try { await fs.stat(path.join(baseDir, 'outputs', 'broken-proj')) } catch { exists = false }
  assert.equal(exists, false, 'a failed preflight must not create the destination folder')

  // Missing declared file fails with the exact path to produce.
  const ghostPlan = JSON.parse(JSON.stringify(stalePlan))
  ghostPlan.projectId = 'ghost-proj'
  ghostPlan.projectContract.deliverables = ['final.tex', 'final.pdf', 'ghost.md']
  const ghostDir = path.join(baseDir, '.research-agent', 'projects', 'ghost-proj')
  await write(ghostDir, 'plan.json', JSON.stringify(ghostPlan, null, 2) + '\n')
  const ghostDigest = core.nodeContract(ghostPlan, 'integration').digest
  const ghostRunRel = path.join('.research-agent', 'runs', 'GHOST-INT', '2026-01-01T00-00-00-ghost')
  const ghostRun = path.join(baseDir, ghostRunRel)
  await write(ghostRun, 'output.tex', outputTex)
  await write(ghostRun, 'final.tex', '\\documentclass{article}\n\\begin{document}\nGhost.\n\\end{document}\n')
  await write(ghostRun, 'final.pdf', finalPdf)
  await write(ghostRun, 'acceptance.json', JSON.stringify({ ...integrationReceipt, nodeContractDigest: ghostDigest }, null, 2) + '\n')
  await write(ghostRun, 'run.json', JSON.stringify({ runId: 'r-ghost', issueId: 'GHOST-INT', artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-03T00:00:00.000Z' }, null, 2) + '\n')
  await write(ghostRun, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'ghost-proj', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: ghostDigest, artifactFormat: 'tex', contract: core.nodeContract(ghostPlan, 'integration') }, null, 2) + '\n')
  const ghostResult = await finalize.execute({ runDir: ghostRunRel, baseDir }, mount.exec)
  assert.equal(ghostResult.projectPublish.ok, false)
  assert.ok(ghostResult.projectPublish.errors.some((e) => e.includes('declared deliverable not found: ghost.md')), JSON.stringify(ghostResult.projectPublish.errors))

  // Unsafe declared path fails.
  const unsafePlan = JSON.parse(JSON.stringify(stalePlan))
  unsafePlan.projectId = 'unsafe-proj'
  unsafePlan.projectContract.deliverables = ['final.tex', 'final.pdf', '../escape.tex']
  const unsafeDir = path.join(baseDir, '.research-agent', 'projects', 'unsafe-proj')
  await write(unsafeDir, 'plan.json', JSON.stringify(unsafePlan, null, 2) + '\n')
  const unsafeDigest = core.nodeContract(unsafePlan, 'integration').digest
  const unsafeRunRel = path.join('.research-agent', 'runs', 'UNSAFE-INT', '2026-01-01T00-00-00-unsafe')
  const unsafeRun = path.join(baseDir, unsafeRunRel)
  await write(unsafeRun, 'output.tex', outputTex)
  await write(unsafeRun, 'final.tex', '\\documentclass{article}\n\\begin{document}\nUnsafe.\n\\end{document}\n')
  await write(unsafeRun, 'final.pdf', finalPdf)
  await write(unsafeRun, 'acceptance.json', JSON.stringify({ ...integrationReceipt, nodeContractDigest: unsafeDigest }, null, 2) + '\n')
  await write(unsafeRun, 'run.json', JSON.stringify({ runId: 'r-unsafe', issueId: 'UNSAFE-INT', artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-03T00:00:00.000Z' }, null, 2) + '\n')
  await write(unsafeRun, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'unsafe-proj', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: unsafeDigest, artifactFormat: 'tex', contract: core.nodeContract(unsafePlan, 'integration') }, null, 2) + '\n')
  const unsafeResult = await finalize.execute({ runDir: unsafeRunRel, baseDir }, mount.exec)
  assert.equal(unsafeResult.projectPublish.ok, false)
  assert.ok(unsafeResult.projectPublish.errors.some((e) => e.includes('safe relative file path')), JSON.stringify(unsafeResult.projectPublish.errors))

  // Symlinked declared deliverable is rejected.
  const linkPlan = JSON.parse(JSON.stringify(stalePlan))
  linkPlan.projectId = 'link-proj'
  linkPlan.projectContract.deliverables = ['final.tex', 'final.pdf', 'linked.tex']
  const linkDir = path.join(baseDir, '.research-agent', 'projects', 'link-proj')
  await write(linkDir, 'plan.json', JSON.stringify(linkPlan, null, 2) + '\n')
  const linkDigest = core.nodeContract(linkPlan, 'integration').digest
  const linkRunRel = path.join('.research-agent', 'runs', 'LINK-INT', '2026-01-01T00-00-00-link')
  const linkRun = path.join(baseDir, linkRunRel)
  await write(linkRun, 'output.tex', outputTex)
  await write(linkRun, 'final.tex', '\\documentclass{article}\n\\begin{document}\nLink.\n\\end{document}\n')
  await write(linkRun, 'final.pdf', finalPdf)
  await write(linkRun, 'acceptance.json', JSON.stringify({ ...integrationReceipt, nodeContractDigest: linkDigest }, null, 2) + '\n')
  await write(linkRun, 'run.json', JSON.stringify({ runId: 'r-link', issueId: 'LINK-INT', artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-03T00:00:00.000Z' }, null, 2) + '\n')
  await write(linkRun, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'link-proj', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: linkDigest, artifactFormat: 'tex', contract: core.nodeContract(linkPlan, 'integration') }, null, 2) + '\n')
  await write(linkRun, 'real-target.tex', 'linked content\n')
  fsSync.symlinkSync(path.join(linkRun, 'real-target.tex'), path.join(linkRun, 'linked.tex'))
  const linkResult = await finalize.execute({ runDir: linkRunRel, baseDir }, mount.exec)
  assert.equal(linkResult.projectPublish.ok, false)
  assert.ok(linkResult.projectPublish.errors.some((e) => e.includes('declared deliverable not found: linked.tex')), 'symlinks are not regular files: ' + JSON.stringify(linkResult.projectPublish.errors))
}

// ── conflicting declared deliverables fail closed ──────────────────────────
{
  const dupPlan = JSON.parse(JSON.stringify(plan))
  dupPlan.projectId = 'dup-proj'
  dupPlan.projectContract.deliverables = ['final.tex', 'final.pdf', 'shared.md']
  const dupDir = path.join(baseDir, '.research-agent', 'projects', 'dup-proj')
  await write(dupDir, 'plan.json', JSON.stringify(dupPlan, null, 2) + '\n')
  const dupDigest = core.nodeContract(dupPlan, 'integration').digest
  const dupRunRel = path.join('.research-agent', 'runs', 'DUP-INT', '2026-01-01T00-00-00-dup')
  const dupRun = path.join(baseDir, dupRunRel)
  await write(dupRun, 'output.tex', outputTex)
  await write(dupRun, 'final.tex', '\\documentclass{article}\n\\begin{document}\nDup.\n\\end{document}\n')
  await write(dupRun, 'final.pdf', finalPdf)
  await write(dupRun, 'shared.md', '# integration version\n')
  await write(dupRun, 'acceptance.json', JSON.stringify({ ...integrationReceipt, nodeContractDigest: dupDigest }, null, 2) + '\n')
  await write(dupRun, 'run.json', JSON.stringify({ runId: 'r-dup', issueId: 'DUP-INT', artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-03T00:00:00.000Z' }, null, 2) + '\n')
  await write(dupRun, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'dup-proj', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: dupDigest, artifactFormat: 'tex', contract: core.nodeContract(dupPlan, 'integration') }, null, 2) + '\n')
  // A different workspace-root version of the same declared path.
  await write(baseDir, 'shared.md', '# workspace version\n')
  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: dupRunRel, baseDir }, mount.exec)
  assert.equal(result.projectPublish.ok, false)
  assert.ok(result.projectPublish.errors.some((e) => e.includes('conflicting declared deliverable shared.md')), JSON.stringify(result.projectPublish.errors))
  // Identical-hash duplicates are accepted and recorded.
  await fs.writeFile(path.join(baseDir, 'shared.md'), '# integration version\n')
  const retry = await finalize.execute({ runDir: dupRunRel, baseDir }, mount.exec)
  assert.equal(retry.projectPublish.ok, true, JSON.stringify(retry.projectPublish.errors))
  assert.ok(retry.projectPublish.warnings.some((w) => w.includes('shared.md') && w.includes('identical content')), JSON.stringify(retry.projectPublish.warnings))
  assert.equal(sha256(await fs.readFile(path.join(baseDir, 'outputs', 'dup-proj', 'shared.md'))), sha256('# integration version\n'))
}

// ── empty deliverables: no project publish; non-integration: suppressed ────
{
  const emptyPlan = JSON.parse(JSON.stringify(plan))
  emptyPlan.projectId = 'empty-proj'
  emptyPlan.projectContract.deliverables = []
  const emptyDir = path.join(baseDir, '.research-agent', 'projects', 'empty-proj')
  await write(emptyDir, 'plan.json', JSON.stringify(emptyPlan, null, 2) + '\n')
  const emptyDigest = core.nodeContract(emptyPlan, 'integration').digest
  const emptyRunRel = path.join('.research-agent', 'runs', 'EMPTY-INT', '2026-01-01T00-00-00-empty')
  const emptyRun = path.join(baseDir, emptyRunRel)
  await write(emptyRun, 'output.tex', outputTex)
  await write(emptyRun, 'final.tex', '\\documentclass{article}\n\\begin{document}\nEmpty.\n\\end{document}\n')
  await write(emptyRun, 'final.pdf', finalPdf)
  await write(emptyRun, 'acceptance.json', JSON.stringify({ ...integrationReceipt, nodeContractDigest: emptyDigest }, null, 2) + '\n')
  await write(emptyRun, 'run.json', JSON.stringify({ runId: 'r-empty', issueId: 'EMPTY-INT', artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-03T00:00:00.000Z' }, null, 2) + '\n')
  await write(emptyRun, 'node-contract.json', JSON.stringify({ schemaVersion: 2, kind: 'node-contract', projectId: 'empty-proj', nodeId: 'integration', artifactRoot: '.research-agent', planRevision: 1, contractDigest: emptyDigest, artifactFormat: 'tex', contract: core.nodeContract(emptyPlan, 'integration') }, null, 2) + '\n')

  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const emptyResult = await finalize.execute({ runDir: emptyRunRel, baseDir }, mount.exec)
  assert.equal(emptyResult.projectPublish.ok, true)
  assert.equal(emptyResult.projectPublish.skipped, true)
  assert.ok(String(emptyResult.projectPublish.reason).includes('explicitly empty'), JSON.stringify(emptyResult.projectPublish))
  let exists = true
  try { await fs.stat(path.join(baseDir, 'outputs', 'empty-proj')) } catch { exists = false }
  assert.equal(exists, false, 'empty deliverables must not create a project folder')

  // Bound non-integration run: no visible output at all.
  const nonInt = await finalize.execute({ runDir: authorRunRel, baseDir }, mount.exec)
  assert.deepEqual(nonInt.deliverables, [])
  assert.equal(nonInt.projectPublish.skipped, true)
  assert.ok(String(nonInt.projectPublish.reason).includes('non-integration'), JSON.stringify(nonInt.projectPublish))
  let issueFolder = true
  try { await fs.stat(path.join(baseDir, 'outputs', 'POL-AUTH')) } catch { issueFolder = false }
  assert.equal(issueFolder, false, 'bound non-integration runs must not create outputs/<issueId>/')
}

// ── legacy unbound run: outputs/<issueId>/ byte-for-byte ───────────────────
{
  const legacyRunRel = path.join('.research-agent', 'runs', 'legacy', '2026-01-01T00-00-00-legacy-issue')
  const legacyRun = path.join(baseDir, legacyRunRel)
  const legacyMd = '# Legacy final\n\nBody.\n'
  await write(legacyRun, 'final.md', legacyMd)
  await write(legacyRun, 'run.json', JSON.stringify({ runId: 'r-legacy', issueId: 'legacy-issue', artifactRoot: '.research-agent', status: 'in-progress', currentStep: '', currentPass: 1, outputRoot: 'outputs', config: { outputRoot: 'outputs' }, linear: { enabled: false }, updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n')
  const mount = makeMount(baseDir)
  const finalize = mount.registered.get('autoresearch_finalize_run')
  const result = await finalize.execute({ runDir: legacyRunRel, baseDir }, mount.exec)
  assert.equal(result.v2.bound, false)
  assert.equal(result.journalSync, null)
  assert.equal(result.projectPublish, null)
  assert.equal(result.deliverables.length, 1)
  assert.equal(result.deliverables[0].path, 'outputs/legacy-issue/final.md')
  const legacyTree = await walk(path.join(baseDir, 'outputs', 'legacy-issue'))
  assert.deepEqual(legacyTree, ['final.md'])
  assert.equal(await fs.readFile(path.join(baseDir, 'outputs', 'legacy-issue', 'final.md'), 'utf8'), legacyMd)
}

await fs.rm(baseDir, { recursive: true, force: true })
console.log('output policy golden tests passed for generation ' + manifest.generation)
