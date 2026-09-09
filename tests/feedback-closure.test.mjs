// Phase 5 (user feedback and causal rework, plan §8) — three layers:
//   A. core units: authority classification, idempotency, cycle detection,
//      reopen closure, triage derivation/consistency, resolution check
//   B. mounted orchestrator e2e: intake → triage → minimal multi-target
//      reopen → resolution gate → close, with hash-addressed records,
//      digest links, epoch bump, unrelated nodes preserved, and
//      last-known-good / judge-quorum-bypass semantics
//   C. mounted orchestrator + fake Linear: projections to the integration
//      issue are idempotent and replayable across an outage
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { core, criterion, node, plan as makePlan, projectState, NOW } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const H = (char) => char.repeat(64)

// Distinct 64-hex digests for the scenarios.
const M = H('a') // last-known-good manifest digest
const I = H('b') // last-known-good integration input digest
const Z = H('c') // stale manifest digest
const N = H('d') // new (republished) manifest digest
const J = H('e') // new integration input digest
const R_UPSTREAM = H('f')
const R_MID = H('0')
const R_CONSUMER = H('1')
const R_SIDE = H('2')
const R_INTEGRATION = H('3')
const F_MID = H('4')
const F_CONSUMER = H('5')
const F_INTEGRATION = H('6')
const F_SIDE = H('7')

// ═══════════════════════════════════════════════════════════════════════════
// A. core units
// ═══════════════════════════════════════════════════════════════════════════

const lkg = { manifestDigest: M, inputDigest: I, publishedAt: NOW, runId: 'int-run' }

// A1. intake record shape + digest-gated user authority
{
  const fields = core.feedbackRecordFields({
    projectId: 'p1', feedback: 'The introduction overstates the SOTA claim.', receivedAt: NOW,
    baseInputDigest: I, baseManifestDigest: M, lkg,
  })
  assert.equal(fields.source, 'user', 'source is a closed literal')
  assert.equal(fields.authority, 'user', 'authority is a closed literal')
  assert.equal(fields.status, 'open')
  assert.equal(fields.userAuthority, 'granted', 'both base digests match the LKG')
  assert.equal(fields.triageDigest, null)
  assert.equal(fields.closure, null)
  assert.match(fields.idempotencyKey, /^[0-9a-f]{64}$/)
  assert.equal(core.feedbackIdempotencyKey('p1', 'The introduction overstates the SOTA claim.', NOW), fields.idempotencyKey)

  const staleIn = core.feedbackRecordFields({
    projectId: 'p1', feedback: 'x', receivedAt: NOW, baseInputDigest: H('9'), baseManifestDigest: M, lkg,
  })
  assert.equal(staleIn.userAuthority, 'stale', 'a stale base input digest can never be granted')
  const staleManifest = core.feedbackRecordFields({
    projectId: 'p1', feedback: 'x', receivedAt: NOW, baseInputDigest: I, baseManifestDigest: Z, lkg,
  })
  assert.equal(staleManifest.userAuthority, 'stale', 'a stale base manifest digest can never be granted')
  assert.equal(core.feedbackRecordFields({
    projectId: 'p1', feedback: 'x', receivedAt: NOW, baseInputDigest: I, baseManifestDigest: M, lkg: null,
  }).userAuthority, 'not-recorded', 'no LKG recorded: nothing to match against')

  // immutable content-addressed versions
  const record = core.makeRecord('user-feedback', fields)
  assert.match(record.digest, /^[0-9a-f]{64}$/)
  const triaged = core.feedbackVersion(record, { status: 'triaged', triageDigest: H('8') })
  assert.equal(triaged.idempotencyKey, record.idempotencyKey, 'identity survives versioning')
  assert.equal(triaged.baseInputDigest, record.baseInputDigest)
  assert.equal(triaged.baseManifestDigest, record.baseManifestDigest)
  assert.equal(triaged.userAuthority, record.userAuthority)
  assert.equal(triaged.triageDigest, H('8'))
  assert.notEqual(core.recordDigest(triaged), record.digest, 'a version is a new content address')
  assert.throws(() => core.feedbackVersion(record, { status: 'resolved' }), /closure/, 'resolved requires a closure object')
  assert.throws(() => core.feedbackVersion(record, { status: 'exploded' }), /invalid feedback status/)

  const closure = core.normalizeFeedbackClosure({
    affectedNodeIds: ['b', 'a'], receiptHashes: [H('9')], integrationInputDigest: J,
    publishManifestDigest: N, resolvedAt: NOW, judgeQuorumBypass: 'applied',
  })
  assert.deepEqual(closure.affectedNodeIds, ['a', 'b'], 'closure arrays are sorted')
  assert.throws(() => core.normalizeFeedbackClosure({ ...closure, judgeQuorumBypass: 'maybe' }), /judgeQuorumBypass/)
  assert.throws(() => core.normalizeFeedbackClosure({ ...closure, publishManifestDigest: 'nope' }), /publishManifestDigest/)
}

// A2. cycle detection refuses with a cycle report
{
  const cyclic = { nodes: [{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: [] }] }
  const cyc = core.detectDependencyCycles(cyclic)
  assert.equal(cyc.ok, false)
  assert.deepEqual(cyc.cycles, [['a', 'b', 'a']])
  assert.equal(core.detectDependencyCycles({ nodes: [{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }] }).ok, true)
}

// A3. reopen closure: union of transitive dependents + full blocker sets
{
  const chain = { nodes: [
    { id: 'upstream', dependsOn: [] },
    { id: 'mid', dependsOn: ['upstream'] },
    { id: 'consumer', dependsOn: ['mid'] },
    { id: 'side', dependsOn: [] },
    { id: 'integration', dependsOn: ['consumer', 'side'] },
  ] }
  let c = core.computeReopenClosure(chain, ['mid'])
  assert.deepEqual(c.targets, ['mid'])
  assert.deepEqual(c.closure, ['consumer', 'integration', 'mid'])
  assert.deepEqual(c.blockers, { consumer: ['mid'], integration: ['mid'] })

  c = core.computeReopenClosure(chain, ['consumer', 'upstream'])
  assert.deepEqual(c.closure, ['consumer', 'integration', 'mid', 'upstream'])
  assert.deepEqual(c.blockers, { mid: ['upstream'], integration: ['consumer', 'upstream'] })

  c = core.computeReopenClosure(chain, ['integration'])
  assert.deepEqual(c.closure, ['integration'], 'integration-only means rerun integration only')
  assert.deepEqual(c.blockers, {})

  assert.throws(() => core.computeReopenClosure(chain, ['nope']), /unknown reopen target/)
  assert.throws(() => core.computeReopenClosure(chain, []), /at least one target/)
}

// A4. triage item normalization + decision derivation (smallest closure)
{
  const fullPlan = makePlan({
    projectId: 'triage',
    projectContract: { goal: 'Goal.', deliverables: [], acceptance: [criterion('PROJECT-01', 'Met.')], test: '', wordBudget: null, rebuildable: false, diagnosticMappings: [] },
    nodes: [
      node({ id: 'upstream', acceptance: [criterion('UP-01', 'Input.')] }),
      node({ id: 'mid', acceptance: [criterion('MID-01', 'Middle.')], dependsOn: ['upstream'] }),
      node({ id: 'consumer', acceptance: [criterion('CON-01', 'Output.')], dependsOn: ['mid'] }),
      node({ id: 'side', acceptance: [criterion('SIDE-01', 'Side.')] }),
      node({ id: 'integration', kind: 'integration', roles: ['research_integration_editor'], acceptance: [criterion('INT-01', 'Final.')], dependsOn: ['consumer', 'side'] }),
    ],
  })
  const items = core.normalizeTriageItems([
    { id: 'f1', classification: 'substantive', ownerNodeIds: ['mid'], affectedCriteria: ['MID-01'], affectedContributionIds: [], requiredChange: 'Fix the SOTA claim.', acceptanceChecks: ['MID-01'] },
    { id: 'f2', classification: 'editorial', ownerNodeIds: [], requiredChange: 'Tighten the prose.' },
  ], fullPlan)
  assert.deepEqual(core.deriveTriageTargets(items), ['mid'])
  assert.deepEqual(core.checkTriageDecision('reopen', items), [])
  assert.deepEqual(core.checkTriageTargets('reopen', ['mid'], items), [])
  assert.ok(core.checkTriageTargets('reopen', ['mid', 'consumer'], items).length > 0, 'a superset closure is refused')
  assert.ok(core.checkTriageTargets('reopen', [], items).length > 0, 'an underset closure is refused')
  assert.ok(core.checkTriageDecision('editorial-only', items).length > 0, 'a substantive item is not editorial-only')
  assert.ok(core.checkTriageDecision('ambiguous', items).length > 0)

  const ambiguous = core.normalizeTriageItems([{ id: 'a1', classification: 'ambiguous', ownerNodeIds: [], requiredChange: '' }], fullPlan)
  assert.deepEqual(core.checkTriageDecision('ambiguous', ambiguous), [])
  assert.deepEqual(core.deriveTriageTargets(ambiguous), [], 'ambiguous opens nothing')

  const unclearConflict = core.normalizeTriageItems([{ id: 'c1', classification: 'conflict', ownerNodeIds: ['consumer', 'side'], requiredChange: 'Pick a node.' }], fullPlan)
  assert.deepEqual(core.checkTriageDecision('conflict-user-choice', unclearConflict), [])
  assert.deepEqual(core.deriveTriageTargets(unclearConflict), [], 'an unclear conflict reopens nothing')

  const clearConflict = core.normalizeTriageItems([{ id: 'c2', classification: 'conflict', ownerNodeIds: ['side'], requiredChange: 'Pick a node.' }], fullPlan)
  assert.deepEqual(core.deriveTriageTargets(clearConflict), ['side'], 'a single-owner conflict reopens that node')

  const scope = core.normalizeTriageItems([{ id: 's1', classification: 'scope', ownerNodeIds: [], requiredChange: 'Out of scope.' }], fullPlan)
  assert.deepEqual(core.checkTriageDecision('scope-plan-revision', scope), [])
  const mixed = [...scope, ...ambiguous]
  assert.deepEqual(core.checkTriageDecision('ambiguous', mixed), [], 'ambiguous outranks scope (clarify first)')
  assert.ok(core.checkTriageDecision('scope-plan-revision', mixed).length > 0)

  assert.throws(() => core.normalizeTriageItems([{ id: 'x', classification: 'editorial', ownerNodeIds: [], requiredChange: 'ok', extra: 1 }], fullPlan), /unknown field/)
  assert.throws(() => core.normalizeTriageItems([{ id: 'x', classification: 'substantive', ownerNodeIds: ['nope'], requiredChange: 'ok' }], fullPlan), /not a plan node/)
  assert.throws(() => core.normalizeTriageItems([{ id: 'x', classification: 'substantive', ownerNodeIds: ['mid'], requiredChange: 'ok', acceptanceChecks: ['CON-01'] }], fullPlan), /criterion ids of the owner/, 'a check must be an owner criterion id')
  assert.throws(() => core.normalizeTriageItems([{ id: 'x', classification: 'scope', ownerNodeIds: ['mid'], requiredChange: 'ok', acceptanceChecks: ['MID-01'] }], fullPlan), /not allowed/, 'scope items re-accept nothing')
  assert.throws(() => core.normalizeTriageItems([{ id: 'x', classification: 'substantive', ownerNodeIds: ['mid'] }], fullPlan), /requiredChange/)
  assert.throws(() => core.normalizeTriageItems([], fullPlan), /non-empty/)
}

// A5. feedback-resolution check (plan §8.4 mechanical gate)
{
  const triage = { targetNodeIds: ['mid'], items: [{ id: 'f1', ownerNodeIds: ['mid'], acceptanceChecks: ['MID-01'] }] }
  const feedback = { digest: H('9'), baseInputDigest: I, baseManifestDigest: M }
  const requests = [{ nodeId: 'mid', supersedes: [R_MID] }]
  const journal = { mid: { status: 'done', receipts: [F_MID] } }
  const acceptances = { mid: { receiptHash: F_MID, criteria: [{ id: 'MID-01', result: 'PASS' }] } }
  const base = { triage, feedback, requests, journal, acceptances, inputDigest: J, manifestDigest: N, lkgManifestDigest: N }
  assert.equal(core.feedbackResolutionCheck(base).ok, true, 'the healthy repair passes')

  assert.ok(core.feedbackResolutionCheck({ ...base, lkgManifestDigest: M }).failures.some((f) => f.includes('last-known-good')), 'stale manifest digest fails')
  assert.ok(core.feedbackResolutionCheck({ ...base, inputDigest: I }).failures.some((f) => f.includes('unchanged')), 'unchanged input digest fails')
  assert.ok(core.feedbackResolutionCheck({ ...base, journal: { mid: { status: 'todo', receipts: [] } } }).failures.some((f) => f.includes('not done')), 'an unfinished node fails')
  assert.ok(core.feedbackResolutionCheck({ ...base, journal: { mid: { status: 'done', receipts: [R_MID] } }, acceptances: { mid: { receiptHash: R_MID, criteria: [{ id: 'MID-01', result: 'PASS' }] } } }).failures.some((f) => f.includes('superseded')), 'the superseded receipt never counts')
  assert.ok(core.feedbackResolutionCheck({ ...base, acceptances: { mid: { receiptHash: H('8'), criteria: [{ id: 'MID-01', result: 'PASS' }] } } }).failures.some((f) => f.includes('hash-bound')), 'an unbound acceptance fails')
  assert.ok(core.feedbackResolutionCheck({ ...base, acceptances: { mid: { receiptHash: F_MID, criteria: [{ id: 'MID-01', result: 'FAIL' }] } } }).failures.some((f) => f.includes('not PASS')), 'an uncovered check fails')
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared mounted-orchestrator harness
// ═══════════════════════════════════════════════════════════════════════════

const orchestratorBundle = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

function processHandle(stdout = '', stderr = '', exitCode = 0) {
  return { done: Promise.resolve({ exitCode }), collected: { stdout: { async readFrom() { return { text: stdout } } }, stderr: { async readFrom() { return { text: stderr } } } } }
}

async function mountOrchestrator(baseDir) {
  const fileService = {
    async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
    async readText(target) { return await fs.readFile(target, 'utf8') },
    async writeText(target, content, mode = {}) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      if (mode.kind === 'createIfAbsent') await fs.writeFile(target, content, { flag: 'wx' })
      else await fs.writeFile(target, content)
    },
    async stat(target) { try { await fs.stat(target); return { version: 1 } } catch { return undefined } },
    async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
  }
  const subprocess = {
    async resolveExecutable(name) { return name },
    spawn(options) {
      if (options.argv[0] === '/bin/mkdir') { fs.mkdir(options.argv.at(-1), { recursive: true }); return processHandle() }
      throw new Error('unexpected subprocess call: ' + options.argv.join(' '))
    },
  }
  const registered = new Map()
  orchestratorBundle.default.apply({
    get(name) {
      if (name === 'fs') return fileService
      if (name === 'subprocess') return subprocess
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      return undefined
    },
  })
  const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
  const invoke = (name, args) => registered.get(name).execute(args, exec)
  return { registered, invoke, fileService, subprocess }
}

function doneEntry(id, { receipt, runDir = 'runs/' + id } = {}) {
  return {
    status: 'done', issueId: id + '-issue', identifier: id.toUpperCase(), url: 'https://example.invalid/' + id, linearState: 'Done',
    runDir, runStatus: 'complete', currentStep: 'complete', currentPass: 0, hasFinal: true, finalCommentId: id + '-comment',
    receipts: [receipt, H('8'), runDir + '/acceptance.json'],
    causalHolds: [], nodeRevision: 1, linearProjection: null, projectionStatus: 'none', updatedAt: NOW,
  }
}

function acceptanceFile(receiptHash, criteria) {
  return JSON.stringify({ receiptHash, criteria }, null, 2) + '\n'
}

// ═══════════════════════════════════════════════════════════════════════════
// B. mounted orchestrator e2e: the full feedback lifecycle
// ═══════════════════════════════════════════════════════════════════════════
{
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-feedback-closure-'))
  const projectId = 'fb-e2e'
  const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
  const planDoc = makePlan({
    projectId,
    projectContract: { goal: 'A feedback-driven project.', deliverables: [], acceptance: [criterion('PROJECT-01', 'Met.')], test: '', wordBudget: null, rebuildable: false, diagnosticMappings: [] },
    nodes: [
      node({ id: 'upstream', acceptance: [criterion('UP-01', 'Input.')] }),
      node({ id: 'mid', acceptance: [criterion('MID-01', 'The middle claim is accurate and sourced.')], dependsOn: ['upstream'] }),
      node({ id: 'consumer', acceptance: [criterion('CON-01', 'Output.')], dependsOn: ['mid'] }),
      node({ id: 'side', acceptance: [criterion('SIDE-01', 'Side.')] }),
      node({ id: 'integration', kind: 'integration', roles: ['research_integration_editor'], acceptance: [criterion('INT-01', 'Final.')], dependsOn: ['consumer', 'side'] }),
    ],
  })
  const stateDoc = projectState({
    projectId,
    nodes: {
      upstream: doneEntry('upstream', { receipt: R_UPSTREAM }),
      mid: doneEntry('mid', { receipt: R_MID }),
      consumer: doneEntry('consumer', { receipt: R_CONSUMER }),
      side: doneEntry('side', { receipt: R_SIDE }),
      integration: doneEntry('integration', { receipt: R_INTEGRATION }),
    },
    integration: {
      epoch: 3,
      inputDigest: I,
      lastKnownGood: { manifestDigest: M, inputDigest: I, publishedAt: NOW, runId: 'int-run' },
      feedback: [],
    },
  })
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(path.join(projectDir, 'plan.json'), JSON.stringify(planDoc, null, 2) + '\n')
  await fs.writeFile(path.join(projectDir, 'state.json'), JSON.stringify(stateDoc, null, 2) + '\n')
  for (const [id, [receipt, crit]] of [
    ['upstream', [R_UPSTREAM, 'UP-01']], ['mid', [R_MID, 'MID-01']], ['consumer', [R_CONSUMER, 'CON-01']],
    ['side', [R_SIDE, 'SIDE-01']], ['integration', [R_INTEGRATION, 'INT-01']],
  ]) {
    await fs.mkdir(path.join(baseDir, 'runs', id), { recursive: true })
    await fs.writeFile(path.join(baseDir, 'runs', id, 'acceptance.json'), acceptanceFile(receipt, [{ id: crit, result: 'PASS' }]))
  }

  const { invoke } = await mountOrchestrator(baseDir)
  const readState = async () => JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
  const writeState = async (mutate) => {
    const current = await readState()
    mutate(current)
    await fs.writeFile(path.join(projectDir, 'state.json'), JSON.stringify(current, null, 2) + '\n')
  }

  // ── B1. intake: granted, hash-addressed, idempotent, projected event ─────
  let sub
  {
    sub = await invoke('autoresearch_submit_feedback', {
      projectId,
      feedback: 'The introduction overstates the SOTA claim.',
      baseInputDigest: I,
      baseManifestDigest: M,
      receivedAt: '2026-01-02T00:00:00.000Z',
    })
    assert.equal(sub.ok, true)
    assert.equal(sub.created, true)
    assert.equal(sub.userAuthority, 'granted', 'base digests match the last-known-good')
    assert.equal(sub.record.source, 'user')
    assert.equal(sub.record.authority, 'user')
    assert.equal(sub.record.status, 'open')
    assert.match(sub.record.digest, /^[0-9a-f]{64}$/)
    const onDisk = JSON.parse(await fs.readFile(path.join(projectDir, 'feedback', sub.record.digest + '.json'), 'utf8'))
    assert.equal(onDisk.digest, sub.record.digest, 'the record is hash-addressed')
    assert.equal(onDisk.feedback, 'The introduction overstates the SOTA claim.', 'the feedback is stored verbatim')
    const st = await readState()
    assert.deepEqual(st.integration.feedback, [{ feedbackId: sub.record.digest, status: 'open' }], 'journal pointer is digest + status only')
    assert.equal(sub.event.type, 'user-feedback-received')
    assert.ok(sub.event.summary.includes('The introduction overstates the SOTA claim.'), 'the verbatim feedback rides the projection event')
    assert.equal(sub.integrationNodeId, 'integration')

    const replay = await invoke('autoresearch_submit_feedback', {
      projectId,
      feedback: 'The introduction overstates the SOTA claim.',
      baseInputDigest: I,
      baseManifestDigest: M,
      receivedAt: '2026-01-02T00:00:00.000Z',
    })
    assert.equal(replay.created, false, 'an exact retry converges by idempotency key')
    assert.equal(replay.record.digest, sub.record.digest)
  }

  // ── B2. intake: stale base digests can never claim authority ─────────────
  let subStale
  {
    subStale = await invoke('autoresearch_submit_feedback', {
      projectId,
      feedback: 'The SOTA claim needs the 2024 baseline table.',
      baseInputDigest: I,
      baseManifestDigest: Z,
      receivedAt: '2026-01-02T01:00:00.000Z',
    })
    assert.equal(subStale.ok, true)
    assert.equal(subStale.userAuthority, 'stale', 'a stale manifest digest is classified stale, never granted')
  }

  // ── B3. triage: closed shape, derivation, minimal closure ────────────────
  let triage
  let triagedFeedback
  {
    const items = [
      { id: 'f1', classification: 'substantive', ownerNodeIds: ['mid'], affectedCriteria: ['MID-01'], affectedContributionIds: [], requiredChange: 'Re-source the SOTA claim or weaken it.', acceptanceChecks: ['MID-01'] },
      { id: 'f2', classification: 'editorial', ownerNodeIds: [], requiredChange: 'Tighten the abstract.' },
    ]
    const inconsistent = await invoke('autoresearch_record_feedback_triage', {
      projectId, feedbackId: sub.record.digest, decision: 'editorial-only', items, targetNodeIds: [], rationale: 'Try to shrink the closure.',
    })
    assert.equal(inconsistent.ok, false)
    assert.match(inconsistent.error, /inconsistent/, 'a substantive item cannot be triaged editorial-only')

    const superset = await invoke('autoresearch_record_feedback_triage', {
      projectId, feedbackId: sub.record.digest, decision: 'reopen', items, targetNodeIds: ['mid', 'consumer'], rationale: 'Try to widen the closure.',
    })
    assert.equal(superset.ok, false)
    assert.match(superset.error, /exactly/, 'a superset closure is refused at triage')

    triage = await invoke('autoresearch_record_feedback_triage', {
      projectId, feedbackId: sub.record.digest, decision: 'reopen', items, targetNodeIds: ['mid'], rationale: 'The mid node owns the claim.',
    })
    assert.equal(triage.ok, true)
    assert.equal(triage.created, true)
    assert.deepEqual(triage.targetNodeIds, ['mid'])
    assert.match(triage.triage.digest, /^[0-9a-f]{64}$/)
    await fs.access(path.join(projectDir, 'feedback', 'triage-' + sub.record.digest.slice(0, 12) + '-' + triage.triage.digest + '.json'))
    triagedFeedback = triage.feedback
    assert.equal(triagedFeedback.status, 'triaged')
    assert.equal(triagedFeedback.triageDigest, triage.triage.digest)
    assert.notEqual(triagedFeedback.digest, sub.record.digest, 'a new immutable version, not a mutation')
    const st = await readState()
    assert.deepEqual(st.integration.feedback, [
      { feedbackId: triagedFeedback.digest, status: 'triaged' },
      { feedbackId: subStale.record.digest, status: 'open' },
    ], 'the journal pointer advances to the new version, other feedbacks untouched')
    assert.ok(triage.projection.body.includes('Reopen targets (smallest responsible closure): mid'))
    assert.ok(triage.suggestedContextUpdate.nextAction.text.includes('mid'))

    const again = await invoke('autoresearch_record_feedback_triage', {
      projectId, feedbackId: sub.record.digest, decision: 'editorial-only', items: [{ id: 'z', classification: 'editorial', ownerNodeIds: [], requiredChange: 'x' }], targetNodeIds: [], rationale: 're-triage',
    })
    assert.equal(again.ok, false, 'a feedback with a recorded triage cannot be triaged again')
    assert.match(again.error, /already triaged/)
  }

  // ── B3b. ambiguous feedback opens nothing ────────────────────────────────
  let ambSub2Digest
  {
    const sub2 = await invoke('autoresearch_submit_feedback', {
      projectId,
      feedback: 'Which figure was the feedback about again?',
      baseInputDigest: I,
      baseManifestDigest: M,
      receivedAt: '2026-01-02T02:00:00.000Z',
    })
    const amb = await invoke('autoresearch_record_feedback_triage', {
      projectId, feedbackId: sub2.record.digest, decision: 'ambiguous',
      items: [{ id: 'a1', classification: 'ambiguous', ownerNodeIds: [], requiredChange: '' }],
      targetNodeIds: [], rationale: 'The user must say which figure.',
    })
    ambSub2Digest = amb.feedback.digest
    assert.equal(amb.ok, true)
    assert.deepEqual(amb.targetNodeIds, [], 'ambiguous feedback reopens nothing')
    const requestFiles = await fs.readdir(path.join(projectDir, 'revision-requests')).catch(() => [])
    assert.equal(requestFiles.length, 0, 'no revision request was created for ambiguous feedback')
  }

  // ── B4. multi-target reopen: one transaction, minimal closure ────────────
  {
    const reopen = await invoke('autoresearch_revision_request', {
      projectId, nodeId: 'integration', nodeIds: ['mid'], feedbackId: triagedFeedback.digest,
    })
    assert.equal(reopen.ok, true)
    assert.equal(reopen.created, true)
    assert.equal(reopen.epochBefore, 3)
    assert.equal(reopen.epochAfter, 4, 'the integration epoch bumped in the same transaction')
    assert.deepEqual(reopen.targets, ['mid'])
    assert.deepEqual(reopen.resetNodes, ['consumer', 'integration', 'mid'], 'the closure, in dependency order')
    assert.equal(reopen.requests.length, 1)
    const req = reopen.requests[0]
    assert.equal(req.nodeId, 'mid')
    assert.deepEqual(req.supersedes, [R_MID], 'the prior acceptance receipt is linked, never mutated')
    const reqFile = path.join(projectDir, 'revision-requests', 'mid-3-' + req.requestDigest + '.json')
    const parsed = JSON.parse(await fs.readFile(reqFile, 'utf8'))
    assert.equal(parsed.feedbackDigest, triagedFeedback.digest, 'linked to the feedback by digest')
    assert.equal(parsed.triageDigest, triage.triage.digest, 'linked to the triage by digest')
    assert.deepEqual(parsed.supersedes, [R_MID])

    const st = await readState()
    assert.equal(st.integration.epoch, 4)
    assert.equal(st.nodes.mid.status, 'todo')
    assert.equal(st.nodes.mid.nodeRevision, 2, 'direct targets bump nodeRevision')
    assert.equal(st.nodes.consumer.status, 'todo')
    assert.equal(st.nodes.consumer.nodeRevision, 1, 'dependents do not bump nodeRevision')
    assert.deepEqual(st.nodes.consumer.causalHolds.map((h) => h.blockedBy), [['mid']], 'dependents hold the full blocker set')
    assert.deepEqual(st.nodes.integration.causalHolds.map((h) => h.blockedBy), [['mid']])
    assert.equal(st.nodes.upstream.status, 'done', 'unrelated completed nodes are preserved')
    assert.equal(st.nodes.side.status, 'done')
    assert.equal(st.nodes.side.receipts[0], R_SIDE, 'unrelated receipts are preserved')
    // The pointer advances to a REAL resolving record (phase-5 discipline:
    // every status change writes a new immutable version).
    assert.equal(st.integration.feedback[0].status, 'resolving')
    assert.notEqual(st.integration.feedback[0].feedbackId, triagedFeedback.digest, 'the journal points at the resolving version, not the triaged one')
    const resolvingRecord = JSON.parse(await fs.readFile(path.join(projectDir, 'feedback', st.integration.feedback[0].feedbackId + '.json'), 'utf8'))
    assert.equal(resolvingRecord.status, 'resolving')
    assert.equal(resolvingRecord.triageDigest, triage.triage.digest, 'the resolving version carries the triage link forward')
    assert.deepEqual(st.integration.feedback.slice(1), [
      { feedbackId: subStale.record.digest, status: 'open' },
      { feedbackId: ambSub2Digest, status: 'triaged' },
    ])

    let widenedRejected = ''
    try {
      await invoke('autoresearch_revision_request', {
        projectId, nodeId: 'integration', nodeIds: ['mid', 'upstream'], feedbackId: triagedFeedback.digest,
      })
    } catch (error) {
      widenedRejected = error.message
    }
    assert.match(widenedRejected, /exactly/, 'a superset reopen set is refused (smallest responsible closure)')

    const replay = await invoke('autoresearch_revision_request', {
      projectId, nodeId: 'integration', nodeIds: ['mid'], feedbackId: triagedFeedback.digest,
    })
    assert.equal(replay.created, false, 'replay converges: the request file already exists')
    assert.equal(replay.epochAfter, 4, 'replay does not bump the epoch again')
    assert.deepEqual(replay.resetNodes, [], 'replay does not reset state again')
    const st2 = await readState()
    assert.equal(st2.nodes.mid.nodeRevision, 2, 'no double revision bump on replay')
  }

  // ── B5. resolution gate: fail-closed until every check passes ────────────
  {
    const early = await invoke('autoresearch_close_feedback', {
      projectId, feedbackId: triagedFeedback.digest, integrationInputDigest: J, publishManifestDigest: N,
    })
    assert.equal(early.ok, false)
    assert.match(early.error, /node mid is not done/, 'an unfinished target fails the gate')

    // Simulate the repair: closure nodes re-accepted with fresh receipts.
    await writeState((st) => {
      st.nodes.mid = doneEntry('mid', { receipt: F_MID })
      st.nodes.consumer = doneEntry('consumer', { receipt: F_CONSUMER })
      st.nodes.integration = doneEntry('integration', { receipt: F_INTEGRATION })
      st.integration.lastKnownGood = { manifestDigest: N, inputDigest: J, publishedAt: '2026-01-03T00:00:00.000Z', runId: 'int-run-2' }
    })
    await fs.writeFile(path.join(baseDir, 'runs', 'mid', 'acceptance.json'), acceptanceFile(F_MID, [{ id: 'MID-01', result: 'PASS' }]))
    await fs.writeFile(path.join(baseDir, 'runs', 'consumer', 'acceptance.json'), acceptanceFile(F_CONSUMER, [{ id: 'CON-01', result: 'PASS' }]))
    await fs.writeFile(path.join(baseDir, 'runs', 'integration', 'acceptance.json'), acceptanceFile(F_INTEGRATION, [{ id: 'INT-01', result: 'PASS' }]))

    const staleManifest = await invoke('autoresearch_close_feedback', {
      projectId, feedbackId: triagedFeedback.digest, integrationInputDigest: J, publishManifestDigest: M,
    })
    assert.equal(staleManifest.ok, false)
    assert.match(staleManifest.error, /last-known-good/, 'a non-current manifest digest fails the gate')

    const unchangedInput = await invoke('autoresearch_close_feedback', {
      projectId, feedbackId: triagedFeedback.digest, integrationInputDigest: I, publishManifestDigest: N,
    })
    assert.equal(unchangedInput.ok, false)
    assert.match(unchangedInput.error, /unchanged/, 'nothing changed: the input digest must differ from the base')

    await writeState((st) => { st.nodes.mid = { ...st.nodes.mid, receipts: [R_MID, H('8'), 'runs/mid/acceptance.json'] } })
    await fs.writeFile(path.join(baseDir, 'runs', 'mid', 'acceptance.json'), acceptanceFile(R_MID, [{ id: 'MID-01', result: 'PASS' }]))
    const superseded = await invoke('autoresearch_close_feedback', {
      projectId, feedbackId: triagedFeedback.digest, integrationInputDigest: J, publishManifestDigest: N,
    })
    assert.equal(superseded.ok, false)
    assert.match(superseded.error, /superseded/, 'the superseded receipt never counts as a repair')
    await writeState((st) => { st.nodes.mid = doneEntry('mid', { receipt: F_MID }) })
    await fs.writeFile(path.join(baseDir, 'runs', 'mid', 'acceptance.json'), acceptanceFile(F_MID, [{ id: 'MID-01', result: 'PASS' }]))

    await fs.writeFile(path.join(baseDir, 'runs', 'mid', 'acceptance.json'), acceptanceFile(F_MID, [{ id: 'MID-01', result: 'FAIL' }]))
    const uncovered = await invoke('autoresearch_close_feedback', {
      projectId, feedbackId: triagedFeedback.digest, integrationInputDigest: J, publishManifestDigest: N,
    })
    assert.equal(uncovered.ok, false)
    assert.match(uncovered.error, /not PASS/, 'the triage acceptance check must PASS in a fresh owner receipt')
    await fs.writeFile(path.join(baseDir, 'runs', 'mid', 'acceptance.json'), acceptanceFile(F_MID, [{ id: 'MID-01', result: 'PASS' }]))
  }

  // ── B6. close: new resolved version + closure + republished event ────────
  let closed
  {
    closed = await invoke('autoresearch_close_feedback', {
      projectId, feedbackId: triagedFeedback.digest, integrationInputDigest: J, publishManifestDigest: N,
      resolvedAt: '2026-01-03T01:00:00.000Z',
    })
    assert.equal(closed.ok, true)
    assert.equal(closed.feedback.status, 'resolved')
    assert.notEqual(closed.feedback.digest, triagedFeedback.digest, 'closing writes a new version, never a mutation')
    assert.equal(closed.closure.judgeQuorumBypass, 'applied', 'a granted base digest applies the quorum bypass')
    assert.deepEqual(closed.closure.affectedNodeIds, ['mid'])
    assert.deepEqual(closed.closure.receiptHashes, [F_MID])
    assert.equal(closed.closure.integrationInputDigest, J)
    assert.equal(closed.closure.publishManifestDigest, N)
    assert.equal(closed.event.type, 'project-republished')
    assert.ok(closed.event.summary.includes(N.slice(0, 12)))
    const st = await readState()
    assert.deepEqual(st.integration.feedback, [
      { feedbackId: closed.feedback.digest, status: 'resolved' },
      { feedbackId: subStale.record.digest, status: 'open' },
      { feedbackId: ambSub2Digest, status: 'triaged' },
    ])
    assert.equal(st.integration.lastKnownGood.manifestDigest, N, 'the LKG pointer is unchanged by closing')

    const again = await invoke('autoresearch_close_feedback', {
      projectId, feedbackId: closed.feedback.digest, integrationInputDigest: J, publishManifestDigest: N,
    })
    assert.equal(again.ok, false, 'a resolved feedback cannot be closed again')
  }

  // ── B7. stale feedback: full repair, bypass NOT applied ──────────────────
  {
    const items = [
      { id: 'g1', classification: 'substantive', ownerNodeIds: ['side'], affectedCriteria: ['SIDE-01'], affectedContributionIds: [], requiredChange: 'Add the 2024 baseline table.', acceptanceChecks: ['SIDE-01'] },
    ]
    const tri2 = await invoke('autoresearch_record_feedback_triage', {
      projectId, feedbackId: subStale.record.digest, decision: 'reopen', items, targetNodeIds: ['side'], rationale: 'The side node owns the baseline.',
    })
    assert.equal(tri2.ok, true)
    const re2 = await invoke('autoresearch_revision_request', {
      projectId, nodeId: 'integration', nodeIds: ['side'], feedbackId: tri2.feedback.digest,
    })
    assert.equal(re2.ok, true)
    assert.equal(re2.created, true)
    assert.deepEqual(re2.resetNodes, ['integration', 'side'], 'the side closure excludes the mid branch')
    const st = await readState()
    assert.equal(st.nodes.mid.status, 'done', 'the repaired mid node is untouched by this closure')
    assert.equal(st.integration.epoch, 5)

    await writeState((s) => { s.nodes.side = doneEntry('side', { receipt: F_SIDE }) })
    await fs.writeFile(path.join(baseDir, 'runs', 'side', 'acceptance.json'), acceptanceFile(F_SIDE, [{ id: 'SIDE-01', result: 'PASS' }]))
    const close2 = await invoke('autoresearch_close_feedback', {
      projectId, feedbackId: tri2.feedback.digest, integrationInputDigest: J, publishManifestDigest: N,
      resolvedAt: '2026-01-03T02:00:00.000Z',
    })
    assert.equal(close2.ok, true)
    assert.equal(close2.closure.judgeQuorumBypass, 'not-applied', 'a stale base digest never applies the quorum bypass')
  }

  // ── B8. project status exposes LKG + feedback pointers (operational) ─────
  {
    const status = await invoke('autoresearch_project_status', { projectId, baseDir })
    assert.equal(status.ok, true)
    assert.equal(status.integration.lastKnownGood.manifestDigest, N)
    assert.equal(status.integration.lastKnownGood.inputDigest, J)
    // Three feedbacks live here: the main one (resolved), the stale one
    // (resolved), and the ambiguous one (triaged, never reopened).
    const statuses = status.integration.feedback.map((entry) => entry.status).sort()
    assert.deepEqual(statuses, ['resolved', 'resolved', 'triaged'])
    const raw = await readState()
    assert.ok(!JSON.stringify(raw.integration.feedback).includes('overstates'), 'the journal never carries the narrative')
  }

  await fs.rm(baseDir, { recursive: true, force: true })
}

// ═══════════════════════════════════════════════════════════════════════════
// C. mounted orchestrator + fake Linear: projections are idempotent and
//    replayable across an outage
// ═══════════════════════════════════════════════════════════════════════════
{
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-feedback-linear-'))
  const projectId = 'fb-linear'
  const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
  const planDoc = makePlan({
    projectId,
    projectContract: { goal: 'A Linear-bound feedback project.', deliverables: [], acceptance: [criterion('PROJECT-01', 'Met.')], test: '', wordBudget: null, rebuildable: false, diagnosticMappings: [] },
    nodes: [
      node({ id: 'alpha', acceptance: [criterion('AL-01', 'Alpha.')] }),
      node({ id: 'integration', kind: 'integration', roles: ['research_integration_editor'], acceptance: [criterion('INT-01', 'Final.')], dependsOn: ['alpha'] }),
    ],
  })
  const stateDoc = projectState({
    projectId,
    project: { linearProjectId: 'LP-1', url: 'https://linear.invalid/LP-1', createdAt: NOW },
    nodes: {
      alpha: doneEntry('alpha', { receipt: R_UPSTREAM }),
      integration: { ...doneEntry('integration', { receipt: R_INTEGRATION }), issueId: 'ISS-INT' },
    },
    integration: {
      epoch: 1,
      inputDigest: I,
      lastKnownGood: { manifestDigest: M, inputDigest: I, publishedAt: NOW, runId: 'int-run' },
      feedback: [],
    },
  })
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(path.join(projectDir, 'plan.json'), JSON.stringify(planDoc, null, 2) + '\n')
  await fs.writeFile(path.join(projectDir, 'state.json'), JSON.stringify(stateDoc, null, 2) + '\n')

  const remote = {
    outage: false,
    issues: {
      'ISS-INT': {
        id: 'ISS-INT', identifier: 'AR-9', title: 'Integration', description: '# Integration\n\nUser-authored text.\n', url: 'https://linear.invalid/AR-9',
        state: { id: 'done', name: 'Done', type: 'completed' }, labels: [], comments: [], archivedAt: null, trashed: false,
      },
    },
  }
  function apiResult(data) { return JSON.stringify({ statusCode: 200, bodyText: JSON.stringify({ data }) }) }
  function issueData(issue) {
    return { ...issue, labels: { nodes: issue.labels }, relations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, inverseRelations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
  }
  const fileService = {
    async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
    async readText(target) { return await fs.readFile(target, 'utf8') },
    async writeText(target, content, mode = {}) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      if (mode.kind === 'createIfAbsent') await fs.writeFile(target, content, { flag: 'wx' })
      else await fs.writeFile(target, content)
    },
    async stat(target) { try { await fs.stat(target); return { version: 1 } } catch { return undefined } },
    async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
  }
  const subprocess = {
    async resolveExecutable(name) { return name },
    spawn(options) {
      if (options.argv[0] === '/bin/mkdir') { fs.mkdir(options.argv.at(-1), { recursive: true }); return processHandle() }
      const request = JSON.parse(options.stdio.stdin.data)
      if (remote.outage) return processHandle(JSON.stringify({ error: 'simulated Linear outage' }))
      const { query, variables } = request
      const issue = remote.issues[variables.id]
      if (query.includes('query IssueComments')) {
        if (!issue) return processHandle(apiResult({ issue: null }))
        return processHandle(apiResult({ issue: { comments: { nodes: issue.comments, pageInfo: { hasNextPage: false, endCursor: null } } } }))
      }
      if (query.includes('query Issue(')) {
        if (!issue) return processHandle(apiResult({ issue: null }))
        return processHandle(apiResult({ issue: issueData(issue) }))
      }
      if (query.includes('mutation CommentCreate')) {
        const target = remote.issues[variables.id]
        target.comments.push({ id: 'comment-' + target.comments.length, body: variables.body, createdAt: '2026-09-06T00:00:00Z', updatedAt: null, user: { id: 'bot', name: 'bot' } })
        return processHandle(apiResult({ commentCreate: { success: true, comment: { id: target.comments.at(-1).id } } }))
      }
      throw new Error('unexpected fake Linear query: ' + query.slice(0, 80))
    },
  }
  const linearBundle = await import(pathToFileURL(path.join(root, manifest.entries.linear)).href)
  const registered = new Map()
  orchestratorBundle.default.apply({
    get(name) {
      if (name === 'fs') return fileService
      if (name === 'subprocess') return subprocess
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      return undefined
    },
  })
  linearBundle.default.apply({
    get(name) {
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      if (name === 'fs') return fileService
      if (name === 'subprocess') return subprocess
      if (name === 'credentials') return { async resolve() { return { value: 'fake-token' } } }
      return undefined
    },
  })
  const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
  const invoke = (name, args) => registered.get(name).execute(args, exec)

  // C1. intake projects to the integration issue (verbatim, marker-deduped)
  const sub = await invoke('autoresearch_submit_feedback', {
    projectId,
    feedback: 'The conclusion paragraph is missing the limitation discussion.',
    baseInputDigest: I,
    baseManifestDigest: M,
    receivedAt: '2026-01-02T00:00:00.000Z',
  })
  assert.equal(sub.ok, true)
  assert.equal(sub.integrationIssueId, 'ISS-INT', 'the integration issue id comes from the journal')
  const post = async (event) => invoke('linear_post_evidence_event', {
    issueId: 'ISS-INT', projectId, nodeId: 'integration',
    type: event.type, summary: event.summary, evidence: event.evidence, at: event.at, baseDir,
  })
  const first = await post(sub.event)
  assert.equal(first.ok, true)
  assert.equal(first.outboxStatus, 'confirmed')
  assert.equal(remote.issues['ISS-INT'].comments.length, 1)
  assert.ok(remote.issues['ISS-INT'].comments[0].body.includes('The conclusion paragraph is missing the limitation discussion.'), 'the verbatim feedback is on the Linear issue')
  const replay = await post(sub.event)
  assert.equal(replay.skipped, true, 'repeated projection dedupes by marker')
  assert.equal(remote.issues['ISS-INT'].comments.length, 1, 'no duplicate intake comment')

  // C2. outage: fail-closed, replayable, no duplicate on recovery
  {
    const event2 = core.makeEvidenceEvent({
      projectId, nodeId: 'integration', type: 'project-republished',
      summary: 'Project republished after user feedback (affected: alpha); manifest ' + N.slice(0, 12),
      evidence: [H('9'), N], at: '2026-01-03T01:00:00.000Z',
    })
    remote.outage = true
    let outageFailed = ''
    try {
      await post(event2)
    } catch (error) {
      outageFailed = error.message
    }
    assert.match(outageFailed, /Linear|outage/i, 'a mutation during an outage fails closed')
    assert.equal(remote.issues['ISS-INT'].comments.length, 1, 'nothing was posted during the outage')
    remote.outage = false
    await invoke('linear_sync_reconcile', { projectId, baseDir, maxAttempts: 5 })
    assert.equal(remote.issues['ISS-INT'].comments.length, 2, 'the queued event posted exactly once after recovery')
    assert.match(remote.issues['ISS-INT'].comments[1].body, /Project Republished/)
  }

  // C3. the reconcile path dedupes (no duplicates on replay)
  {
    await invoke('linear_sync_reconcile', { projectId, baseDir, maxAttempts: 5 })
    assert.equal(remote.issues['ISS-INT'].comments.length, 2, 'reconcile replays create no duplicates')
  }

  await fs.rm(baseDir, { recursive: true, force: true })
}

console.log('feedback closure tests passed for generation ' + manifest.generation)
