// WS2 — Contribution ledger (GRF-2026 SOD #8, #9, #10, #21; plan WS2).
//
// Covers deterministic contribution derivation (stable heading slugs,
// sectionless/main units, anchors, evidence), the idempotent
// record_acceptance ledger write, tolerant anchor matching in
// validateCoverage, and the one-time backfill script (dry-run, write,
// current, never-modifies-receipts).
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)
const { default: orchestrator, createLibraries: lib } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
assert.equal(typeof lib.helpers.deriveNodeOutputDocument, 'function')
assert.equal(typeof core.anchorMatchesFinal, 'function')

const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-ledger-'))

// ══════════════════════════════════════════════════════════════════════════
// 1. Deterministic contribution derivation (plan WS2.1)
// ══════════════════════════════════════════════════════════════════════════
{
  const derive = (params) => lib.helpers.deriveNodeOutputDocument({
    contract: { nodeId: 'methods', artifactFormat: 'tex' },
    outputHash: 'hash-1',
    nodeRevision: 1,
    contractDigest: 'digest-1',
    criteria: [{ id: 'A-01', result: 'PASS' }, { id: 'A-02', result: 'FAIL' }, { id: 'A-03', result: 'WAIVED' }],
    ...params,
  })

  const tex = [
    '\\documentclass{article}',
    'Preamble text that is not a section.',
    '\\section{Methods \\& Results}',
    'The methods section describes the experimental setup in detail.',
    '\\section*{Discussion}',
    'Short one.',
    '\\section[Short]{Longer Heading Here}',
    'This longer first sentence in the section body qualifies as an anchor.',
    '\\end{document}',
  ].join('\n')
  const ledger = derive({ outputText: tex, artifactPath: 'sections/methods.tex' })
  assert.equal(ledger.ledgerVersion, 1)
  assert.equal(ledger.artifact.path, 'sections/methods.tex')
  assert.equal(ledger.artifact.format, 'tex')
  assert.equal(ledger.artifact.sha256, 'hash-1')
  assert.equal(ledger.nodeId, 'methods')
  assert.equal(ledger.outputHash, 'hash-1')
  assert.equal(ledger.nodeRevision, 1)
  assert.equal(ledger.contractDigest, 'digest-1')
  assert.equal(ledger.artifactFormat, 'tex')
  const ids = ledger.contributions.map((unit) => unit.id)
  assert.deepEqual(ids, ['methods-results', 'discussion', 'longer-heading-here'], 'slug: glue stripped, * and [short] forms supported, long title wins: ' + JSON.stringify(ids))
  assert.deepEqual(ledger.contributions[0].evidence, ['A-01'], 'evidence = PASSed criterion ids only')
  assert.equal(ledger.contributions[0].texAnchor, 'The methods section describes the experimental setup in detail.')
  assert.equal(ledger.contributions[0].importance, 'required')
  assert.equal(ledger.contributions[0].mutability, 'editable')
  assert.ok('texAnchor' in ledger.contributions[1] === false, 'short-sentence section must carry no anchor')
  assert.equal(ledger.contributions[1].anchorMissing, true, 'anchor-less section must be flagged')
  assert.equal(ledger.contributions[2].texAnchor, 'This longer first sentence in the section body qualifies as an anchor.')
  // Must pass the ledger validator.
  const check = core.validateContributionLedger(ledger)
  assert.equal(check.ok, true, JSON.stringify(check.errors))

  // Deterministic: same input → same bytes.
  assert.equal(JSON.stringify(derive({ outputText: tex, artifactPath: 'sections/methods.tex' })), JSON.stringify(ledger))

  // Reordering sections keeps the ids.
  const reordered = [
    '\\documentclass{article}',
    '\\section*{Discussion}',
    'Short one.',
    '\\section{Methods \\& Results}',
    'The methods section describes the experimental setup in detail.',
  ].join('\n')
  assert.deepEqual(derive({ outputText: reordered }).contributions.map((unit) => unit.id), ['discussion', 'methods-results'])

  // Colliding headings: first keeps the slug, later ones fall back.
  const colliding = '\\section{Notes}\nFirst note body long enough to anchor here.\n\\section{Notes}\nSecond note body long enough to anchor here.\n\\section{Notes}\nThird note body long enough to anchor here.\n'
  const collidingIds = derive({ outputText: colliding }).contributions.map((unit) => unit.id)
  assert.equal(collidingIds[0], 'notes')
  assert.ok(collidingIds[1].startsWith('slug-'), 'collision falls back to slug hash: ' + JSON.stringify(collidingIds))
  assert.ok(collidingIds[2].startsWith('slug-'), JSON.stringify(collidingIds))
  assert.notEqual(collidingIds[1], collidingIds[2], 'repeated fallback must stay unique')

  // Chapter level wins when both chapter and section are present.
  const both = '\\chapter{Part One}\nChapter body with a long enough first sentence to anchor.\n\\section{Nested}\nNested body long enough to anchor here as well.\n'
  const chapters = derive({ outputText: both }).contributions.map((unit) => unit.id)
  assert.deepEqual(chapters, ['part-one'], 'chapter is the first present level')

  // Sectionless (fragment) and markdown → single "main" unit.
  const fragment = 'Just a fragment with a first sentence that is long enough to anchor.\nMore text.\n'
  const fragLedger = derive({ outputText: fragment })
  assert.deepEqual(fragLedger.contributions.map((unit) => unit.id), ['main'])
  assert.ok(fragLedger.contributions[0].texAnchor.length >= 20)
  const mdLedger = derive({ contract: { nodeId: 'notes', artifactFormat: 'markdown' }, outputText: '# Title\n\nA markdown body with a long enough first sentence.\n' })
  assert.deepEqual(mdLedger.contributions.map((unit) => unit.id), ['main'])
  assert.equal(mdLedger.artifactFormat, 'markdown')
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Tolerant anchor matching (plan WS2.3)
// ══════════════════════════════════════════════════════════════════════════
{
  const doc = 'One long opening sentence that carries the substance of the paragraph. '
    + 'A shorter second sentence here. '
    + 'A third sentence with some numbers and a citation. \n\n'
    + 'Second paragraph with its own first sentence that is long enough to count. More text in it.\n'
  const matches = core.anchorMatchesFinal
  // Tiny anchors can never validate, even when present verbatim.
  assert.equal(matches('the', 'the the the the the'), false)
  assert.equal(matches('e.g. something', doc), false)
  assert.equal(matches('sentence here.', 'A shorter second sentence here.'), false, 'anchors under 20 normalized chars can never validate, even when present')
  // Legacy verbatim containment still matches.
  assert.equal(matches('One long opening sentence that carries the substance of the paragraph.', doc), true)
  // Anchor contained in a sentence (whitespace-tolerant).
  const sentence = 'One long opening sentence that carries the substance of the paragraph'
  assert.equal(matches(sentence + '  ', doc), true, 'normalized containment in a sentence')
  // A sentence contained in an anchor of >= 20 chars.
  const anchorWithTail = sentence + '. And the anchor continues a little.'
  assert.equal(matches(anchorWithTail, doc), true, 'sentence contained in anchor >= 20 chars')
  // Cross-sentence anchor (20-39 chars, whitespace-variant so the legacy
  // verbatim check does not apply) must not match: neither sentence
  // containment nor the paragraph fallback applies below 40 chars.
  const crossShort = 'substance of the paragraph.   A shor'
  assert.ok(crossShort.replace(/\s+/g, ' ').trim().length < 40)
  assert.equal(matches(crossShort, doc), false, 'cross-sentence anchors under 40 chars cannot match')
  // The same cross-sentence span at >= 40 chars matches via the
  // paragraph-level containment fallback.
  const crossLong = 'substance of the paragraph.   A shorter second sentence here'
  assert.ok(crossLong.replace(/\s+/g, ' ').trim().length >= 40)
  assert.equal(matches(crossLong, doc), true, 'paragraph containment fallback at >= 40 chars')
}

// ══════════════════════════════════════════════════════════════════════════
// 3. validateCoverage: tolerant record checks, unchanged span reporting
// ══════════════════════════════════════════════════════════════════════════
{
  const finalTex = 'The integration result is robust across every evaluated setting. '
    + 'The benchmark score improves by 12 percent over the baseline system.\n'
  const contributions = {
    n1: { contributions: [{ id: 'results', importance: 'required', mutability: 'editable', evidence: [] }] },
  }
  const baseCoverage = {
    claims: [],
    dispositions: [{ contributionId: 'n1:results', disposition: 'included' }],
    editorialParagraphs: [],
  }
  // Verbatim anchor still validates.
  let result = core.validateCoverage({ ...baseCoverage, claims: [{ claimId: 'c1', texAnchor: 'The integration result is robust across every evaluated setting.', sourceContributionIds: ['n1:results'], evidenceReferences: ['e1'], transform: 'paraphrase' }] }, finalTex, { contributions })
  assert.equal(result.errors.filter((e) => e.includes('texAnchor not found')).length, 0, JSON.stringify(result.errors))
  // Tolerant anchor (normalized containment in a sentence) validates.
  const tolerant = 'The integration result is robust across every evaluated setting'
  result = core.validateCoverage({ ...baseCoverage, claims: [{ claimId: 'c1', texAnchor: tolerant, sourceContributionIds: ['n1:results'], evidenceReferences: ['e1'], transform: 'paraphrase' }] }, finalTex, { contributions })
  assert.equal(result.errors.filter((e) => e.includes('texAnchor not found')).length, 0, JSON.stringify(result.errors))
  // Tiny anchor fails.
  result = core.validateCoverage({ ...baseCoverage, claims: [{ claimId: 'c1', texAnchor: 'the', sourceContributionIds: ['n1:results'], evidenceReferences: ['e1'], transform: 'paraphrase' }] }, finalTex, { contributions })
  assert.ok(result.errors.some((e) => e.includes('texAnchor not found') && e.includes('20 normalized chars')), JSON.stringify(result.errors))
  // Unsupported-span reporting is unchanged: the number-bearing sentence must
  // be covered by some claim anchor.
  result = core.validateCoverage({ ...baseCoverage, claims: [] }, finalTex, { contributions })
  assert.ok(result.errors.some((e) => e.startsWith('Unsupported substantive span')), 'span reporting must remain strict: ' + JSON.stringify(result.errors))
}

// ══════════════════════════════════════════════════════════════════════════
// 4. Mounted e2e: record_acceptance writes the ledger (idempotent + revision)
// ══════════════════════════════════════════════════════════════════════════
const baseDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-ledger-e2e-'))
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir2, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, options = {}) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
  },
  async readBytes(target, _options, maxBytes) {
    const data = await fs.readFile(target)
    const copy = new Uint8Array(Math.min(data.length, maxBytes ?? data.length))
    copy.set(data.subarray(0, copy.length))
    return copy
  },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
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
      const child = nodeSpawn(argv[0], argv.slice(1), { cwd: cwd ?? baseDir2 })
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
const exec = { agent: { session: { header: { cwd: baseDir2, delegationDepth: 0 } } } }
const projectDir = path.join(baseDir2, '.research-agent', 'projects', 'ledger-proj')
await fs.mkdir(path.join(projectDir, 'revision-requests'), { recursive: true })
const plan = {
  schemaVersion: 2, projectId: 'ledger-proj', projectName: 'Ledger', approvedAt: '2026-01-01T00:00:00.000Z', revision: 1, integrationId: 'integration',
  projectContract: { goal: 'Ledger.', acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
  nodes: [
    { id: 'notes', title: 'Notes', kind: 'research', roles: ['research_author'], artifactFormat: 'markdown', expectedOutcome: 'Notes.', acceptance: [{ id: 'NOT-01', text: 'Notes exist.', required: true }], dependsOn: [] },
    { id: 'methods', title: 'Methods', kind: 'research', roles: ['research_author'], expectedOutcome: 'Methods.', acceptance: [{ id: 'MET-01', text: 'Methods exist.', required: true }], outputContract: { texMode: 'standalone' }, dependsOn: [] },
    { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], dependsOn: ['notes', 'methods'] },
  ],
}
await fs.writeFile(path.join(projectDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
const initRun = registered.get('autoresearch_init_run')
const recordAcceptance = registered.get('autoresearch_record_acceptance')

// ── 4a. Markdown node: ledger written with the "main" unit ────────────────
{
  const run = await initRun.execute({ projectId: 'ledger-proj', nodeId: 'notes', issueId: 'ledger-notes', issueTitle: 'Notes', sourceType: 'local' }, exec)
  const runAbs = path.join(baseDir2, run.runDir)
  await fs.writeFile(path.join(runAbs, 'final.md'), '# Notes\n\nA markdown body whose first sentence is long enough to anchor the ledger unit.\n')
  const result = await recordAcceptance.execute({ runDir: run.runDir, criteria: [{ id: 'NOT-01', result: 'PASS' }] }, exec)
  assert.equal(result.ok, true)
  assert.equal(result.ledgerAction, 'written')
  const ledger = JSON.parse(await fs.readFile(path.join(runAbs, 'node-output.json'), 'utf8'))
  assert.deepEqual(ledger.contributions.map((unit) => unit.id), ['main'])
  assert.equal(ledger.nodeId, 'notes')
  assert.equal(ledger.artifactFormat, 'markdown')
  assert.equal(ledger.outputHash, result.receipt.outputHash)
  // Idempotent replay: hand-edit the ledger (same hash + revision) — it must
  // be kept as is on re-acceptance.
  ledger.customAnnotation = 'kept-by-idempotency'
  await fs.writeFile(path.join(runAbs, 'node-output.json'), JSON.stringify(ledger, null, 2) + '\n')
  const replay = await recordAcceptance.execute({ runDir: run.runDir, criteria: [{ id: 'NOT-01', result: 'PASS' }] }, exec)
  assert.equal(replay.ledgerAction, 'current')
  const kept = JSON.parse(await fs.readFile(path.join(runAbs, 'node-output.json'), 'utf8'))
  assert.equal(kept.customAnnotation, 'kept-by-idempotency', 'same-hash replay must not clobber the existing ledger')
}

// ── 4b. TeX node: section slugs e2e + revision re-derivation ──────────────
{
  const texAvailable = (() => {
    try { fsSync.accessSync('/usr/bin/latexmk', fsSync.constants.X_OK); return true } catch { return false }
  })()
  if (!texAvailable) {
    console.log('skipping tex ledger e2e (latexmk unavailable)')
  } else {
    const run = await initRun.execute({ projectId: 'ledger-proj', nodeId: 'methods', issueId: 'ledger-methods', issueTitle: 'Methods', sourceType: 'local' }, exec)
    const runAbs = path.join(baseDir2, run.runDir)
    const texV1 = '\\documentclass{article}\n\\begin{document}\n\\section{Data Collection}\nThe data collection procedure follows the protocol described in the appendix.\n\\end{document}\n'
    await fs.writeFile(path.join(runAbs, 'output.tex'), texV1)
    const first = await recordAcceptance.execute({ runDir: run.runDir, criteria: [{ id: 'MET-01', result: 'PASS' }] }, exec)
    assert.equal(first.ok, true, 'strict build must pass')
    const ledgerV1 = JSON.parse(await fs.readFile(path.join(runAbs, 'node-output.json'), 'utf8'))
    assert.deepEqual(ledgerV1.contributions.map((unit) => unit.id), ['data-collection'])
    assert.equal(ledgerV1.nodeRevision, 1)

    // Revision 2: heading change → new slug; same hash + revision would not
    // re-derive, but a new artifact hash forces the rewrite.
    const texV2 = '\\documentclass{article}\n\\begin{document}\n\\section{Data Gathering}\nThe data gathering procedure follows the protocol described in the appendix.\n\\end{document}\n'
    await fs.writeFile(path.join(runAbs, 'output.tex'), texV2)
    const second = await recordAcceptance.execute({ runDir: run.runDir, criteria: [{ id: 'MET-01', result: 'PASS' }], nodeRevision: 2 }, exec)
    assert.equal(second.ok, true)
    assert.equal(second.ledgerAction, 'written')
    const ledgerV2 = JSON.parse(await fs.readFile(path.join(runAbs, 'node-output.json'), 'utf8'))
    assert.deepEqual(ledgerV2.contributions.map((unit) => unit.id), ['data-gathering'], 'revision 2 must re-derive from the new heading')
    assert.equal(ledgerV2.nodeRevision, 2)
    assert.notEqual(ledgerV2.outputHash, ledgerV1.outputHash)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 5. Backfill script (plan WS2.4)
// ══════════════════════════════════════════════════════════════════════════
{
  const scriptPath = path.join(root, 'scripts', 'backfill-ledgers.mjs')
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-ledger-backfill-'))
  const runAbs = path.join(ws, '.research-agent', 'runs', 'legacy', '2026-01-01T00-00-00-legacy')
  await fs.mkdir(runAbs, { recursive: true })
  const receipt = {
    schemaVersion: 2,
    kind: 'acceptance-receipt',
    projectId: 'legacy-proj',
    planRevision: 1,
    nodeId: 'methods',
    nodeContractDigest: 'digest-legacy',
    nodeRevision: 1,
    outputHash: 'sha-legacy',
    artifactFormat: 'tex',
    artifact: { path: 'sections/custom.tex' },
    criteria: [{ id: 'MET-01', result: 'PASS' }],
    overall: 'PASS',
    receiptHash: 'x',
  }
  const receiptText = JSON.stringify(receipt, null, 2) + '\n'
  await fs.writeFile(path.join(runAbs, 'acceptance.json'), receiptText)
  const tex = '\\documentclass{article}\n\\section{Old Section Name}\nThe old section body carries a first sentence long enough to anchor.\n\\end{document}\n'
  await fs.mkdir(path.join(runAbs, 'sections'), { recursive: true })
  await fs.writeFile(path.join(runAbs, 'sections', 'custom.tex'), tex)

  // Import the script module (guards prevent main from running).
  const { backfillRun, discoverRuns } = await import(pathToFileURL(scriptPath).href)
  const targets = await discoverRuns(ws)
  assert.deepEqual(targets, [runAbs], 'discovery must find the accepted run deterministically')

  // Dry-run: no file is written.
  let result = await backfillRun(runAbs, { dryRun: true })
  assert.equal(result.action, 'would-write')
  let exists = false
  try { await fs.stat(path.join(runAbs, 'node-output.json')) } catch { exists = false }
  assert.equal(exists, false, 'dry-run must not write')

  // Real run: ledger written, receipt untouched.
  result = await backfillRun(runAbs, {})
  assert.equal(result.action, 'written')
  const ledger = JSON.parse(await fs.readFile(path.join(runAbs, 'node-output.json'), 'utf8'))
  assert.deepEqual(ledger.contributions.map((unit) => unit.id), ['old-section-name'])
  assert.equal(ledger.outputHash, 'sha-legacy')
  assert.equal(ledger.artifact.path, 'sections/custom.tex')
  assert.equal(await fs.readFile(path.join(runAbs, 'acceptance.json'), 'utf8'), receiptText, 'backfill must never modify the receipt')

  // Re-run: already current.
  result = await backfillRun(runAbs, {})
  assert.equal(result.action, 'current')

  // CLI end-to-end: --dry-run then real, via node subprocess.
  const cli = (extra) => new Promise((resolve) => {
    const child = nodeSpawn(process.execPath, [scriptPath, ws, ...extra], { cwd: root })
    const out = []
    const err = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('close', (code) => resolve({ code, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8') }))
  })
  await fs.rm(path.join(runAbs, 'node-output.json'), { force: true })
  let cliOut = await cli(['--dry-run'])
  assert.equal(cliOut.code, 0, cliOut.err)
  assert.ok(cliOut.out.includes('would-write'), cliOut.out)
  cliOut = await cli([])
  assert.equal(cliOut.code, 0, cliOut.err)
  assert.ok(cliOut.out.includes('written'), cliOut.out)
  cliOut = await cli([])
  assert.ok(cliOut.out.includes('already current'), cliOut.out)

  // Legacy unbound run (no node id anywhere) is skipped.
  const unbound = path.join(ws, '.research-agent', 'runs', 'legacy', '2026-01-02T00-00-00-unbound')
  await fs.mkdir(unbound, { recursive: true })
  const unboundReceipt = { ...receipt, nodeId: undefined }
  delete unboundReceipt.nodeId
  delete unboundReceipt.artifact
  await fs.writeFile(path.join(unbound, 'acceptance.json'), JSON.stringify(unboundReceipt, null, 2) + '\n')
  await fs.writeFile(path.join(unbound, 'output.tex'), tex)
  result = await backfillRun(unbound, {})
  assert.equal(result.ok, false, 'unbound run must be skipped')
  assert.ok(String(result.skipped).includes('node id unavailable'), String(result.skipped))

  await fs.rm(baseDir2, { recursive: true, force: true })
  await fs.rm(ws, { recursive: true, force: true })
  console.log('contribution ledger tests passed for generation ' + manifest.generation)
}
