// Phase 4 (Linear-first node context, plan §7) — mounted-plugin e2e with the
// fake Linear harness. state.json is NEVER created: every step proves the
// owned Current Node Context block in the Linear issue is the source of truth.
//
//   - context-missing with a contract → repair via linear_update_node_context
//   - init → evidence events (idempotent) → reduce → update (digest rotation)
//   - stale digest rejected at projection and at CAS; concurrent human edit
//     surfaces LINEAR_CONTEXT_CONCURRENT and is never overwritten
//   - crash-after-write → outbox replay confirms from read-back, recovery
//     cache settled; no duplicate comments or description mutations
//   - outage → structured linear-unavailable (pause), fail-closed update,
//     replayable enqueue; recovery on reconnection
//   - evidence reference integrity: verified / unverified / missing
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { core } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const linearBundle = await import(pathToFileURL(path.join(root, manifest.entries.linear)).href)
const linearCore = linearBundle.createLibraries.linearCore
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-linear-context-'))
const projectId = 'ctx-e2e'

const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
  async processPath(target) { return target },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, mode = {}) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (mode.kind === 'createIfAbsent') await fs.writeFile(target, content, { flag: 'wx' })
    else await fs.writeFile(target, content)
  },
  async stat(target) { try { await fs.stat(target); return { version: 1 } } catch { return undefined } },
  async remove(target) { await fs.rm(target, { force: true }) },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}

// Local evidence artifacts for the integrity checks (plan §7.4 step 7).
const evidenceText = 'draft analysis, units verified\n'
await fs.mkdir(path.join(baseDir, 'evidence'), { recursive: true })
await fs.writeFile(path.join(baseDir, 'evidence', 'draft.md'), evidenceText)
const evidenceHash = core.sha256Text(evidenceText)

const specBlock = core.renderSpecBlock({
  projectId, planRevision: 1, nodeRevision: 1, digest: 'c'.repeat(64), nodeId: 'alpha',
  kind: 'research', artifactFormat: 'tex', roles: ['research_author'], effectiveBudget: {},
})
const userText = '# Alpha node\n\nUser-authored intro paragraph.\n\n'

const remote = {
  outage: false,
  failNextDescriptionUpdate: false,
  descriptionMutations: 0,
  issues: {
    'ISS-1': {
      id: 'ISS-1', identifier: 'AR-1', title: 'Alpha node', description: userText + specBlock, url: 'https://linear.invalid/AR-1',
      state: { id: 'todo', name: 'Todo', type: 'unstarted' }, labels: [], comments: [], archivedAt: null, trashed: false,
    },
    'ISS-2': {
      id: 'ISS-2', identifier: 'AR-2', title: 'Bare node', description: 'Just a user note. No owned blocks.', url: 'https://linear.invalid/AR-2',
      state: { id: 'todo', name: 'Todo', type: 'unstarted' }, labels: [], comments: [], archivedAt: null, trashed: false,
    },
  },
}

function processHandle(stdout = '', stderr = '', exitCode = 0) {
  return { done: Promise.resolve({ exitCode }), collected: { stdout: { async readFrom() { return { text: stdout } } }, stderr: { async readFrom() { return { text: stderr } } } } }
}
function apiResult(data) { return JSON.stringify({ statusCode: 200, bodyText: JSON.stringify({ data }) }) }
function issueData(issue) {
  return { ...issue, labels: { nodes: issue.labels }, relations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, inverseRelations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
}
const subprocess = {
  async resolveExecutable(name) { return name },
  spawn(options) {
    if (options.argv[0] === '/bin/mkdir') { fs.mkdir(options.argv.at(-1), { recursive: true }); return processHandle() }
    if (options.argv.includes('-e')) return processHandle('"auto"\n')
    const request = JSON.parse(options.stdio.stdin.data)
    if (remote.outage) return processHandle(JSON.stringify({ error: 'simulated Linear outage' }))
    const { query, variables } = request
    const issue = remote.issues[variables.id]
    if (query.includes('query IssueComments')) {
      if (!issue) return processHandle(apiResult({ issue: null }))
      const firstPage = issue.comments.length > 0 && !variables.after
      return processHandle(apiResult({ issue: { comments: { nodes: firstPage ? [] : issue.comments, pageInfo: { hasNextPage: firstPage, endCursor: firstPage ? 'comments-page-2' : null } } } }))
    }
    if (query.includes('query IssueRelations')) {
      if (!issue) return processHandle(apiResult({ issue: null }))
      return processHandle(apiResult({ issue: { relations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, inverseRelations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }))
    }
    if (query.includes('query Issue(')) {
      if (!issue) return processHandle(apiResult({ issue: null }))
      return processHandle(apiResult({ issue: issueData(issue) }))
    }
    if (query.includes('mutation IssueDescriptionUpdate')) {
      if (!issue) throw new Error('unexpected: description update on unknown issue')
      remote.descriptionMutations += 1
      issue.description = variables.description
      if (remote.failNextDescriptionUpdate) { remote.failNextDescriptionUpdate = false; return processHandle(JSON.stringify({ error: 'response lost after description commit' })) }
      return processHandle(apiResult({ issueUpdate: { success: true, issue: { id: issue.id, identifier: issue.identifier, title: issue.title, description: issue.description, url: issue.url } } }))
    }
    if (query.includes('mutation IssueUpdate')) {
      remote.issues[variables.id].state = { id: variables.stateId, name: variables.stateId, type: variables.stateId === 'done' ? 'completed' : 'started' }
      return processHandle(apiResult({ issueUpdate: { success: true, issue: { id: variables.id, state: remote.issues[variables.id].state } } }))
    }
    if (query.includes('mutation IssueLabelsUpdate')) {
      remote.issues[variables.id].labels = variables.labelIds.map((id) => ({ id, name: id }))
      return processHandle(apiResult({ issueUpdate: { success: true, issue: { id: variables.id, labels: { nodes: remote.issues[variables.id].labels } } } }))
    }
    if (query.includes('mutation CommentCreate')) {
      const target = remote.issues[variables.id]
      target.comments.push({ id: 'comment-' + target.comments.length, body: variables.body, createdAt: '2026-09-06T00:00:00Z', updatedAt: null, user: { id: 'bot', name: 'bot' } })
      return processHandle(apiResult({ commentCreate: { success: true, comment: { id: target.comments.at(-1).id } } }))
    }
    throw new Error('unexpected fake Linear query: ' + query.slice(0, 80))
  },
}

const tools = new Map()
linearBundle.default.apply({ get(name) { if (name === 'tools') return { register(definition) { tools.set(definition.name, definition) } }; if (name === 'fs') return fileService; if (name === 'subprocess') return subprocess; if (name === 'credentials') return { async resolve() { return { value: 'fake-token' } } }; return undefined } })
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
const invoke = (name, args) => tools.get(name).execute(args, exec)
const descriptionOf = (id) => remote.issues[id].description

try {
  // ── A. context-missing with a contract; projection fails closed ──────────
  {
    const missing = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    assert.equal(missing.status, 'context-missing')
    assert.equal(missing.freshness.contextDigest, '')
    assert.equal(missing.ok, true, 'a structured result, never a throw, for a missing block')
    assert.match(missing.repairHint, /linear_update_node_context/)
    assert.match(missing.freshness.drift.join('; '), /initialize it from the contract/)
    // state.json does not exist in this test at all — reconstruction is Linear-only.
    let stateJsonExists = true
    try { await fileService.readText(path.join(baseDir, '.research-agent', 'projects', projectId, 'state.json')) } catch { stateJsonExists = false }
    assert.equal(stateJsonExists, false, 'no local state file was needed for context reconstruction')
    await assert.rejects(
      invoke('linear_project_node', { projectId, nodeId: 'alpha', issueId: 'ISS-1', stateId: 'ip', blockedLabelId: 'autoresearch-blocked', status: 'in_progress', baseDir }),
      /LINEAR_CONTEXT_MISSING/,
      'projection of a blockless issue fails closed',
    )
  }

  // ── B. initialize the owned block (user text preserved) ──────────────────
  const initialState = {
    kind: 'node-context',
    nodeId: 'alpha',
    status: 'todo',
    objective: 'Deliver the analysis section',
    contract: { planRevision: 1, nodeRevision: 1, contractDigest: 'c'.repeat(64) },
    completed: [],
    findings: [],
    requiredRevisions: [],
    remaining: [
      { id: 'w1', text: 'Draft the analysis' },
      { id: 'w2', text: 'Run the sensitivity analysis' },
    ],
    dependencies: [],
    nextAction: { text: 'Draft the analysis', owner: 'research_author', expectedOutput: 'analysis.md', acceptanceCheck: 'outline accepted' },
    evidenceRefs: [
      { ref: 'evidence/draft.md', hash: evidenceHash, kind: 'file' },
      { ref: 'evidence/absent.md', hash: 'd'.repeat(64), kind: 'file' },
      { ref: 'https://linear.invalid/AR-1#evidence', hash: 'e'.repeat(64), kind: 'url' },
    ],
    watermark: '2026-09-05T00:00:00.000Z',
    lastVerified: null,
  }
  let digest = ''
  {
    const init = await invoke('linear_update_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', state: initialState, expectedContextDigest: '', baseDir })
    assert.equal(init.ok, true)
    assert.match(init.contextDigest, /^[0-9a-f]{64}$/)
    digest = init.contextDigest
    assert.equal(init.outboxStatus, 'confirmed')
    assert.equal(init.recoveryCache, 'cleared', 'the crash-safe intent settles on read-back confirmation and is deleted (plan §7.7)')
    const description = descriptionOf('ISS-1')
    assert.ok(description.startsWith(userText), 'user text before the block is preserved')
    const parsed = core.parseContextBlock(description)
    assert.equal(parsed.ok, true)
    assert.equal(core.contextBlockDigest(parsed.state), digest)
    // The recovery cache file is deleted once confirmed (intent-only, settled).
    const cachePath = path.join(baseDir, '.research-agent', 'projects', projectId, 'linear-sync', 'recovery', 'alpha.json')
    await assert.rejects(fs.readFile(cachePath), /ENOENT|not found/, 'a confirmed recovery cache must not accumulate')
  }

  // ── C. fresh query: ok, evidence integrity, no duplicate intake ──────────
  let workContext = null
  {
    workContext = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    assert.equal(workContext.status, 'ok')
    assert.equal(workContext.freshness.contextDigest, digest)
    assert.equal(workContext.freshness.newHumanComments, 0)
    const byRef = Object.fromEntries(workContext.evidenceStatus.map((entry) => [entry.ref, entry.status]))
    assert.equal(byRef['evidence/draft.md'], 'verified', 'local file with matching hash is verified')
    assert.equal(byRef['evidence/absent.md'], 'missing', 'an absent local file is missing, never blocking')
    assert.equal(byRef['https://linear.invalid/AR-1#evidence'], 'unverified', 'a non-local reference with a hash is unverified')
    assert.ok(workContext.markdown.includes('## Evidence Integrity'))
    assert.equal(workContext.recoveryCache, undefined, 'a settled cache is not reported')
  }

  // ── D. evidence events are idempotent ─────────────────────────────────────
  {
    const first = await invoke('linear_post_evidence_event', { issueId: 'ISS-1', projectId, nodeId: 'alpha', type: 'node-claimed', summary: 'Alpha node claimed', baseDir })
    assert.equal(first.ok, true)
    assert.equal(first.outboxStatus, 'confirmed')
    assert.match(first.marker, /^autoresearch-evidence:[0-9a-f]{64}$/)
    assert.equal(remote.issues['ISS-1'].comments.length, 1)
    const replay = await invoke('linear_post_evidence_event', { issueId: 'ISS-1', projectId, nodeId: 'alpha', type: 'node-claimed', summary: 'Alpha node claimed', baseDir })
    assert.equal(replay.skipped, true, 'the same event digest dedupes by marker')
    assert.equal(replay.outboxStatus, 'confirmed')
    assert.equal(remote.issues['ISS-1'].comments.length, 1, 'no duplicate evidence comment')
    assert.throws(() => core.makeEvidenceEvent({ projectId, nodeId: 'alpha', type: 'not-a-milestone', summary: 'x' }), /unknown evidence event type/)
  }

  // ── E. human comment → reduce → update (digest rotation) ─────────────────
  {
    remote.issues['ISS-1'].comments.push({ id: 'c-100', body: 'Please add error bars to the figure.', createdAt: '2026-09-07T00:00:00Z', updatedAt: null, user: { id: 'human', name: 'Reviewer' } })
    const fresh = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    assert.equal(fresh.freshness.contextDigest, digest, 'comments rotate freshness, not the block digest')
    assert.equal(fresh.freshness.newHumanComments, 1)
    const reduced = core.reduceNodeContext(fresh.context, {
      events: [core.makeEvidenceEvent({ projectId, nodeId: 'alpha', type: 'node-claimed', summary: 'Alpha node claimed', at: '2026-09-06T00:00:00.000Z' })],
      userComments: [{ id: 'c-100', body: 'Please add error bars to the figure.', createdAt: '2026-09-07T00:00:00Z' }],
      nextAction: { text: 'Add error bars', owner: 'research_author', expectedOutput: 'analysis-v2.md', acceptanceCheck: 'bars present' },
      now: '2026-09-07T01:00:00.000Z',
    })
    assert.equal(reduced.state.status, 'in_progress')
    assert.ok(reduced.state.findings.some((item) => item.id === 'user-c-100'))
    const before = remote.descriptionMutations
    const updated = await invoke('linear_update_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', state: reduced.state, expectedContextDigest: digest, baseDir })
    assert.equal(updated.ok, true)
    assert.notEqual(updated.contextDigest, digest, 'the content change rotates the digest')
    digest = updated.contextDigest
    assert.equal(remote.descriptionMutations, before + 1)
    const reparsed = core.parseContextBlock(descriptionOf('ISS-1'))
    assert.equal(reparsed.ok, true)
    assert.equal(reparsed.state.status, 'in_progress')
    assert.ok(reparsed.state.findings.some((item) => item.id === 'user-c-100'))
    // The stale digest is now rejected by CAS.
    await assert.rejects(
      invoke('linear_update_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', state: reduced.state, expectedContextDigest: core.contextBlockDigest(fresh.context), baseDir }),
      (error) => {
        assert.match(error.message, /LINEAR_CONTEXT_CONCURRENT/)
        assert.equal(error.code, 'LINEAR_CONTEXT_CONCURRENT')
        assert.equal(error.liveDigest, digest, 'the live state is returned for a fresh reduce')
        return true
      },
    )
  }

  // ── F. stale digest rejected at projection; live digest commits ──────────
  {
    await assert.rejects(
      invoke('linear_project_node', { projectId, nodeId: 'alpha', issueId: 'ISS-1', stateId: 'ip', blockedLabelId: 'autoresearch-blocked', status: 'in_progress', contextDigest: 'f'.repeat(64), baseDir }),
      /LINEAR_CONTEXT_STALE/,
      'a stale digest cannot commit a lifecycle transition',
    )
    await assert.rejects(
      invoke('linear_project_node', { projectId, nodeId: 'alpha', issueId: 'ISS-1', stateId: 'ip', blockedLabelId: 'autoresearch-blocked', status: 'in_progress', baseDir }),
      /LINEAR_CONTEXT_STALE/,
      'a missing digest cannot commit a lifecycle transition',
    )
    const projected = await invoke('linear_project_node', { projectId, nodeId: 'alpha', issueId: 'ISS-1', stateId: 'in-progress', blockedLabelId: 'autoresearch-blocked', status: 'in_progress', contextDigest: digest, baseDir })
    assert.equal(projected.outboxStatus, 'confirmed')
    assert.equal(remote.issues['ISS-1'].state.id, 'in-progress')
    // The projection left the block untouched.
    assert.equal(core.parseContextBlock(descriptionOf('ISS-1')).state.status, 'in_progress')
  }

  // ── G1. human edit OUTSIDE the block does not rotate the digest ──────────
  {
    const fresh = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    assert.equal(fresh.freshness.contextDigest, digest)
    remote.issues['ISS-1'].description = descriptionOf('ISS-1') + '\n\nHuman paragraph after the block.'
    const fresh2 = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    assert.equal(fresh2.status, 'ok')
    assert.equal(fresh2.freshness.contextDigest, digest, 'user text outside the block does not rotate the digest')
    const reduced = core.reduceNodeContext(fresh2.context, { now: '2026-09-08T01:00:00.000Z' })
    const ok = await invoke('linear_update_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', state: reduced.state, expectedContextDigest: digest, baseDir })
    assert.equal(ok.ok, true)
    assert.ok(descriptionOf('ISS-1').includes('Human paragraph after the block.'), 'the trailing user paragraph survives the update')
  }

  // ── G2. human edit INSIDE the block → conflict surfaced, repaired by CAS ─
  {
    const fresh = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    const priorDigest = fresh.freshness.contextDigest
    // A human edits the owned block directly in Linear (inside the block),
    // breaking the digest binding.
    const humanEdited = descriptionOf('ISS-1').replace('- [ ] w2: Run the sensitivity analysis', '- [ ] w2: Run the sensitivity analysis (human added emphasis)')
    assert.notEqual(humanEdited, descriptionOf('ISS-1'), 'fixture sanity: the in-block edit happened')
    remote.issues['ISS-1'].description = humanEdited
    const editedDigest = core.contextBlockDigest(core.parseContextBlock(humanEdited).state)
    assert.notEqual(editedDigest, priorDigest, 'the in-block human edit rotates the digest')
    // The now-untrusted block is surfaced as a conflict, not silently trusted.
    const conflicted = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    assert.equal(conflicted.status, 'context-missing', 'a digest-mismatched block is not current truth')
    // A write CASed against the pre-edit digest fails, surfacing the live edit.
    const reduced = core.reduceNodeContext(fresh.context, { now: '2026-09-08T01:15:00.000Z' })
    await assert.rejects(
      invoke('linear_update_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', state: reduced.state, expectedContextDigest: priorDigest, baseDir }),
      (error) => {
        assert.match(error.message, /LINEAR_CONTEXT_CONCURRENT/)
        assert.equal(error.liveDigest, editedDigest, 'the computed digest of the human edit is returned')
        assert.ok(error.liveState.remaining.some((item) => item.text.includes('human added emphasis')), 'the human edit is visible in the returned live state')
        return true
      },
    )
    assert.equal(descriptionOf('ISS-1'), humanEdited, 'the human edit was not overwritten')
    // The coordinator acknowledges the human edit (CAS against its digest) and
    // rewrites a properly reduced block — the conflict is resolved, not lost.
    const reduced2 = core.reduceNodeContext(fresh.context, {
      nextAction: { text: 'Run the sensitivity analysis', owner: 'research_author', expectedOutput: 'sensitivity.md', acceptanceCheck: 'table accepted' },
      now: '2026-09-08T01:30:00.000Z',
    })
    const repaired = await invoke('linear_update_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', state: reduced2.state, expectedContextDigest: editedDigest, baseDir })
    assert.equal(repaired.ok, true, 'repairing the conflict re-validates the block')
    const reparsed = core.parseContextBlock(descriptionOf('ISS-1'))
    assert.equal(reparsed.ok, true)
    assert.ok(descriptionOf('ISS-1').includes('Human paragraph after the block.'), 'the out-of-block user text still survives the repair')
  }

  // ── H. crash after write → outbox replay + recovery cache ─────────────────
  {
    const fresh = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    const digestBefore = fresh.freshness.contextDigest
    const reduced = core.reduceNodeContext(fresh.context, {
      events: [core.makeEvidenceEvent({ projectId, nodeId: 'alpha', type: 'test-build-completed', summary: 'Build passed', completes: 'w1', evidence: ['build-1.log'], at: '2026-09-08T02:00:00.000Z' })],
      now: '2026-09-08T02:30:00.000Z',
    })
    assert.equal(reduced.state.completed.length, 1, 'w1 moved to Completed')
    remote.failNextDescriptionUpdate = true
    const mutationsBefore = remote.descriptionMutations
    await assert.rejects(
      invoke('linear_update_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', state: reduced.state, expectedContextDigest: digestBefore, baseDir }),
      /response lost after description commit/,
      'the tool fails closed when the commit response is lost',
    )
    assert.equal(remote.descriptionMutations, mutationsBefore + 1, 'the description mutation landed remotely')
    // The crash left a recovery cache entry and a replayable outbox record. The
    // read path RECONCILES it: the live block already carries the intent digest
    // (the write landed before the response was lost), so reading the context
    // confirms and clears the entry instead of reporting a settled write as
    // outstanding forever. That is the read path's job — nothing else reconciles
    // it on read, and a lingering `pending` is what made a later CAS fail against
    // a digest that was never live.
    const pending = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    assert.equal(pending.recoveryCache?.status, 'confirmed', 'a pending entry whose digest matches the live block is confirmed by the read')
    // Reconciliation still confirms the outbox intent from read-back without
    // re-mutating: the write already landed, so replay adds no description
    // mutation.
    const mutationsAtCrash = remote.descriptionMutations
    const reconcile = await invoke('linear_sync_reconcile', { projectId, baseDir, maxAttempts: 5 })
    const entry = reconcile.results.at(-1)
    assert.equal(entry.status, 'confirmed')
    assert.equal(entry.readBack, true, 'confirmed from a Linear read-back')
    // The cache settled at the READ (above), so the replay finds nothing left to
    // clear and reports the field as absent rather than claiming a second settle.
    // What matters is that it settled exactly once and the replay stayed
    // idempotent: asserting a `cleared` here would require the read NOT to
    // reconcile, which is the behaviour this change removes.
    assert.equal(entry.recoveryCache ?? null, null, 'the recovery cache was already settled by the read and is gone')
    assert.equal(remote.descriptionMutations, mutationsAtCrash, 'no duplicate description mutation on replay')
    const reparsed = core.parseContextBlock(descriptionOf('ISS-1'))
    assert.equal(reparsed.ok, true)
    assert.equal(reparsed.state.completed.length, 1)
    // The live digest now equals the crashed intent's digest.
    assert.equal(pending.recoveryCache.contextDigest, core.contextBlockDigest(reparsed.state))
    // A second reconcile makes no further mutation (the record is confirmed).
    const stableMutations = remote.descriptionMutations
    const again = await invoke('linear_sync_reconcile', { projectId, baseDir, maxAttempts: 5 })
    assert.equal(remote.descriptionMutations, stableMutations)
    assert.ok(again.results.every((item) => item.status === 'confirmed' || item.journalRecovery === true))
    // The recovery cache is deleted once settled on disk (plan §7.7).
    await assert.rejects(fs.readFile(path.join(baseDir, '.research-agent', 'projects', projectId, 'linear-sync', 'recovery', 'alpha.json')), /ENOENT|not found/, 'a settled recovery cache must not accumulate')
    // Direct library classification of the pending intent (plan §7.7):
    // Linear is read first; the intent never authorizes anything on its own.
    const pendingCache = {
      kind: 'linear-node-context-recovery',
      projectId,
      nodeId: 'alpha',
      issueId: 'ISS-1',
      expectedContextDigest: pending.recoveryCache?.expectedContextDigest ?? '',
      contextDigest: core.contextBlockDigest(reparsed.state),
      description: descriptionOf('ISS-1'),
      createdAt: '2026-09-08T02:30:00.000Z',
      status: 'pending',
    }
    assert.equal(linearCore.reconcileRecoveryCache(pendingCache, descriptionOf('ISS-1')).status, 'applied', 'live block carries the intent digest')
    const other = core.renderContextBlock({ ...core.normalizeContextState(reparsed.state), status: 'done' })
    assert.equal(linearCore.reconcileRecoveryCache(pendingCache, other).status, 'conflict', 'a different live digest is a conflict, never an overwrite')
    assert.equal(linearCore.reconcileRecoveryCache({ ...pendingCache, expectedContextDigest: '', contextDigest: '0'.repeat(64) }, '').status, 'not-applied', 'no live block and an empty prior: a replay is safe')
    assert.equal(linearCore.reconcileRecoveryCache({ ...pendingCache, issueId: '' }, '').status, 'invalid', 'a malformed cache is rejected')
  }

  // ── I. outage → structured unavailable, fail-closed, replayable ──────────
  {
    remote.outage = true
    const unavailable = await invoke('linear_get_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', baseDir })
    assert.equal(unavailable.ok, false)
    assert.equal(unavailable.status, 'linear-unavailable', 'an outage is a structured pause signal, not a throw')
    assert.match(unavailable.error, /simulated Linear outage/)
    await assert.rejects(
      invoke('linear_update_node_context', { issueId: 'ISS-1', projectId, nodeId: 'alpha', state: initialState, expectedContextDigest: '', baseDir }),
      /simulated Linear outage/,
      'the context write path fails closed during an outage',
    )
    const mutationsBefore = remote.descriptionMutations
    // The projection is bound to the CURRENT block digest (gate 12); the
    // replayed intent must carry the digest it was projected against.
    const outageDigest = core.contextBlockDigest(core.parseContextBlock(descriptionOf('ISS-1')).state)
    await assert.rejects(
      invoke('linear_project_node', { projectId, nodeId: 'alpha', issueId: 'ISS-1', stateId: 'done', blockedLabelId: 'autoresearch-blocked', status: 'done', contextDigest: outageDigest, baseDir }),
      /simulated Linear outage/,
    )
    assert.equal(remote.descriptionMutations, mutationsBefore, 'no remote mutation during the outage')
    remote.outage = false
    const recovered = await invoke('linear_sync_reconcile', { projectId, baseDir, maxAttempts: 5 })
    const entry = recovered.results.find((item) => item.status === 'confirmed' || item.status === 'retry')
    assert.ok(entry, 'the outage enqueue is replayed on reconnection')
    const last = recovered.results.at(-1)
    assert.equal(last.status, 'confirmed')
    assert.equal(remote.issues['ISS-1'].state.id, 'done', 'the lifecycle commit lands after recovery')
    assert.equal(core.parseContextBlock(descriptionOf('ISS-1')).ok, true, 'the replay confirmed the block on read-back')
  }

  // ── J. context-missing without a contract (bare issue) ───────────────────
  {
    const bare = await invoke('linear_get_node_context', { issueId: 'ISS-2', baseDir })
    assert.equal(bare.status, 'context-missing')
    assert.match(bare.repairHint, /linear_update_node_context/)
    assert.ok(!bare.freshness.drift.some((line) => /node contract/.test(line)), 'no contract drift on a bare issue')
    await assert.rejects(
      invoke('linear_project_node', { projectId, nodeId: 'bare', issueId: 'ISS-2', stateId: 'done', blockedLabelId: 'autoresearch-blocked', status: 'done', baseDir }),
      /LINEAR_CONTEXT_MISSING/,
    )
  }

  console.log('linear context reconcile e2e passed for generation ' + manifest.generation)
} finally {
  await fs.rm(baseDir, { recursive: true, force: true })
}
