import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { createLibraries } = await import(pathToFileURL(path.join(root, manifest.entries.linear)).href)
const linear = createLibraries.linearCore
const core = createLibraries.core

const queryHashes = Object.fromEntries(Object.entries(linear.QUERIES).map(([name, query]) => [name, createHash('sha256').update(query).digest('hex')]))
assert.deepEqual(queryHashes, {
  whoami: 'b94925996822e71e700b036e3cf25ac9f906f6b1a95e121b3c114f2870741219', workspaceMetadata: '200f57d46c070994bfb5db5ac2ce6c0d4debb0290d6dd91e9a6cc99f0c0dce0a', getIssue: 'bc5c13853d9ee484479a0617e25d8284a50faf8258d7fcb998b20609b62621da', listComments: '8020687abbb003d5c0f16ce53ef15caa8544825e87b53e9ce58602835369f4b4', listIssueRelations: '82a0a04d0c63a0d5cbb5d2cfa9a1e7086d05e6070945977de671f381055584ce', issueRelationCreate: 'a6ed8007801ac5b2b0b0c08c69ca5b03ff308e2d26801907c3ace8fc32d622ae', issueRelationDelete: 'c842bca84638efba78136c4024be4ecb2ba6771a4bee24e5ff62e2b75cbffbeb', updateIssueLabels: '5c1dd7208004795e299654f092606fc31421b1f80036911e92965686b8dbdd5d', listIssues: '9514deb3736c81acfdc6b3986db7689a92b1e3d24b4f32384409035c7f460332', searchIssues: '70e06924dbedec8e16b665e6875b1ac3cbd67d03b4cdede79fcd50630090ff42', createComment: 'e80c67426c4126cf120bc08b9cd281a784bd07106534e7f831e37669dd14fe01', updateIssue: '12dfa90f08bd00512c7fedef24cf0d35524ac481e297bfb5e643edd95e416901', updateIssueDescription: '88754646bf76d11ce956a1404f5ce04dd3128306c30a73ac17cffe6044492026', projectCreate: '79e750f76fe22d51c0d736fb4b68277877b2a7daca18f25bac2f51d85241c5c2', issueCreate: '575e66ba3948fcdf9f1717448d123df8213e8a0f9bd80ecde080bc5508c235dc', listProjects: 'eecaced169954b0450e429108f904f2051e059ac01128a85e69d7e89c33f389b', listProjectIssues: 'a8668857db71ee8a2367baefdc3bf454073e356ccd5bed86ddc9e5757078fe8b',
})
const fixedVariables = { id: 'ISS-1', first: 20, after: 'cursor' }
assert.deepEqual(linear.buildRequest('listComments', fixedVariables), { query: linear.QUERIES.listComments, variables: fixedVariables })
assert.equal(linear.resolveLabelId([{ id: 'l1', name: 'AutoResearch' }], 'autoresearch'), 'l1')
assert.deepEqual(linear.shapeResult('workspaceMetadata', { issueLabels: { nodes: [{ id: 'workspace-blocked', name: 'autoresearch-blocked' }] }, teams: { nodes: [] } }).labels, [{ id: 'workspace-blocked', name: 'autoresearch-blocked' }])
assert.deepEqual(linear.deriveDependencyRelations({ nodes: [{ id: 'up', dependsOn: [] }, { id: 'down', dependsOn: ['up'] }] }, { up: { id: 'ISS-1' }, down: { id: 'ISS-2' } }), [{ issueId: 'ISS-1', relatedIssueId: 'ISS-2', type: 'blocks', upstreamNodeId: 'up', downstreamNodeId: 'down' }])
assert.deepEqual(linear.deriveDependencyRelations({ nodes: [{ id: 'z', dependsOn: ['missing', 'z'] }, { id: 'a', dependsOn: ['z'] }] }, { z: 'ISS-Z', a: 'ISS-A' }), [{ issueId: 'ISS-Z', relatedIssueId: 'ISS-A', type: 'blocks', upstreamNodeId: 'z', downstreamNodeId: 'a' }])
const converging = { nodes: [{ id: 'left', dependsOn: [] }, { id: 'right', dependsOn: [] }, { id: 'merge', dependsOn: ['left', 'right'] }] }
assert.deepEqual(linear.deriveDependencyRelations(converging, { left: 'ISS-L', right: 'ISS-R', merge: 'ISS-M' }).map(({ issueId, relatedIssueId, type }) => ({ issueId, relatedIssueId, type })), [{ issueId: 'ISS-L', relatedIssueId: 'ISS-M', type: 'blocks' }, { issueId: 'ISS-R', relatedIssueId: 'ISS-M', type: 'blocks' }])
const holdComment = linear.causalComment({ nodeId: 'merge', blockedBy: ['right', 'left'], reason: 'await both upstream receipts', eventDigest: 'evt-merge' })
assert.equal(holdComment.marker, 'autoresearch-causal:evt-merge')
assert.match(holdComment.body, /Blocked by: left, right\. Reason: await both upstream receipts/)
assert.equal(linear.confirmationMatches({ kind: 'comment-marker', marker: 'm1' }, { body: 'prefix m1 suffix' }), true)
assert.equal(linear.confirmationMatches({ kind: 'relation-edge', type: 'blocks', relatedIssueId: 'ISS-2' }, { type: 'blocks', relatedIssue: { id: 'ISS-2' } }), true)
assert.equal(linear.findExistingRelation({ relations: [{ id: 'rel-1', type: 'blocks', relatedIssue: { id: 'ISS-2' } }], inverseRelations: [] }, { issueId: 'ISS-1', relatedIssueId: 'ISS-2', type: 'blocks' }).id, 'rel-1')
assert.equal(linear.findExistingRelation({ relations: [], inverseRelations: [{ id: 'reverse', type: 'blocks', relatedIssue: { id: 'ISS-2' } }] }, { issueId: 'ISS-1', relatedIssueId: 'ISS-2', type: 'blocks' }), null)
assert.equal(linear.confirmationMatches({ kind: 'issue-state', stateId: 'state-done' }, { state: { id: 'state-done' } }), true)
assert.equal(linear.confirmationMatches({ kind: 'node-projection', stateId: 'state-done', blockedLabelId: 'blocked-label', blocked: true, commentMarker: 'autoresearch-causal:d1' }, { issue: { state: { id: 'state-done' }, labelRecords: [{ id: 'user-label' }, { id: 'blocked-label' }] }, comments: [{ body: 'autoresearch-causal:d1' }] }), true)
assert.equal(linear.confirmationMatches({ kind: 'node-projection', stateId: 'state-done', blockedLabelId: 'blocked-label', blocked: false }, { issue: { state: { id: 'state-done' }, labelRecords: [{ id: 'user-label' }] }, comments: [] }), true)
assert.equal(linear.confirmationMatches({ kind: 'labels', labelIds: ['keep', 'other'] }, { labelRecords: [{ id: 'keep' }, { id: 'other' }] }), true)
assert.equal(linear.confirmationMatches({ kind: 'labels', labelIds: ['keep'] }, { labelRecords: [{ id: 'keep' }, { id: 'other' }] }), false)
assert.equal(linear.issueUnavailable({ archivedAt: '2026-01-01T00:00:00Z' }), true)
assert.equal(linear.mutationSucceeded('labels.update', { ok: true, success: false }), false)
assert.equal(linear.mutationSucceeded('node.project', { state: { ok: true, success: true }, labels: { ok: true, success: true }, comment: { ok: true, success: false } }), false)
const blockedProjectionEvent = linear.makeSyncEvent({ projectId: 'p1', nodeId: 'n2', operation: 'node.project', payload: { issueId: 'ISS-2', stateId: 'state-hold', blockedLabelId: 'label-blocked', blockedBy: ['n1'], reason: 'upstream failed' }, createdAt: '2026-01-01T00:00:00.000Z' })
const blockedProjectionRecord = linear.makeOutboxRecord({ event: blockedProjectionEvent, mutation: { operation: 'node.project', payload: blockedProjectionEvent.payload }, createdAt: blockedProjectionEvent.createdAt })
assert.deepEqual(blockedProjectionRecord.confirms, { kind: 'node-projection', issueId: 'ISS-2', stateId: 'state-hold', blockedLabelId: 'label-blocked', blocked: true, commentMarker: 'autoresearch-causal:' + blockedProjectionEvent.digest })
assert.equal(linear.confirmationMatches({ kind: 'issue-state', stateId: 'done' }, { archivedAt: '2026-01-01', state: { id: 'done' } }), false)
const preflight = linear.preflightCapabilities({ teams: [{ id: 'team-1', name: 'Research', states: [{ id: 't', name: 'Backlog', type: 'backlog' }, { id: 's', name: 'Started', type: 'started' }, { id: 'd', name: 'Done', type: 'completed' }, { id: 'c', name: 'Canceled', type: 'canceled' }] }], labels: [{ id: 'blocked', name: 'autoresearch-blocked' }] }, { teamId: 'team-1' })
assert.equal(preflight.ok, true)
assert.equal(preflight.states.todo.id, 't')
assert.equal(preflight.blockedLabelId, 'blocked')
assert.equal(preflight.capabilities.mutation, 'unverified')
assert.equal(preflight.warnings.some((item) => item.includes('permission is unverified')), true)
assert.equal(linear.preflightCapabilities({ ok: true, teams: [{ id: 'team-1', states: [{ id: 't', type: 'backlog' }, { id: 's', type: 'started' }, { id: 'd', type: 'completed' }, { id: 'c', type: 'canceled' }] }] }, { teamId: 'team-1', requestedStateIds: ['foreign-state'], mutationCapability: 'read-write' }).ok, false)
assert.equal(linear.preflightCapabilities({ ok: true, teams: [{ id: 'team-1', states: [{ id: 't', type: 'backlog' }, { id: 's', type: 'started' }, { id: 'd', type: 'completed' }, { id: 'c', type: 'canceled' }] }] }, { teamId: 'team-1', mutationCapability: 'read-only' }).ok, false)
assert.equal(linear.preflightCapabilities({ teams: 'drifted' }, { teamId: 'team-1' }).ok, false)
assert.deepEqual(linear.mergeLabelIds([{ id: 'keep' }, { id: 'drop' }], ['add', 'keep'], ['drop']), ['keep', 'add'])
const event = linear.makeSyncEvent({ projectId: 'p1', nodeId: 'n1', operation: 'comment', payload: { marker: 'm1' }, createdAt: '2026-01-01T00:00:00.000Z' })
assert.equal(linear.verifySyncEvent(event, '').ok, true)
assert.equal(linear.verifySyncEvent({ ...event, payload: { leaseId: 'tampered' } }, '').ok, false)
assert.deepEqual(linear.causalComment({ nodeId: 'n2', blockedBy: ['n3', 'n1', 'n3'], reason: 'upstream failed', eventDigest: 'd1' }), { marker: 'autoresearch-causal:d1', body: 'autoresearch-causal:d1\n\nCausal hold for node `n2`. Blocked by: n1, n3. Reason: upstream failed', idempotencyMarker: 'autoresearch-causal:d1' })
assert.deepEqual(linear.deriveCausalHold({ nodeId: 'n2', blockedBy: ['n3', 'n1', 'n3'], reason: 'upstream failed' }), {
  kind: 'causal-hold', nodeId: 'n2', blockedBy: ['n1', 'n3'], reason: 'upstream failed', sourceEventDigest: null,
})
const outbox = linear.makeOutboxRecord({ event, mutation: { operation: 'comment', payload: { marker: 'm1' } }, createdAt: '2026-01-01T00:00:00.000Z' })
assert.equal(event.kind, 'sync-event')
assert.equal(event.phase, 'projection')
assert.equal(outbox.kind, 'outbox-record')
assert.equal(outbox.phase, 'projection')
assert.equal(outbox.confirms.kind, 'comment-marker')
assert.equal(outbox.status, 'pending')
const attempted = linear.transitionOutbox(outbox, 'attempt', {}, '2026-01-01T00:01:00.000Z')
assert.equal(attempted.status, 'inflight')
assert.equal(attempted.attempts, 1)
const confirmed = linear.transitionOutbox(attempted, 'confirm', { remoteId: 'c1' }, '2026-01-01T00:02:00.000Z')
assert.equal(confirmed.status, 'confirmed')
assert.deepEqual(linear.transitionOutbox(confirmed, 'retry'), confirmed)
assert.equal(linear.transitionOutbox({ ...attempted, attempts: 3 }, 'dead', { error: 'unavailable' }).status, 'dead')
// Legacy outbox shape (schemaVersion, no kind tag) is rejected: the runtime
// never adapts old records in place.
assert.throws(() => linear.transitionOutbox({ ...outbox, kind: undefined, schemaVersion: 1, phase: undefined, confirms: undefined }, 'attempt'), /invalid outbox record/)
const relationEvent = linear.makeSyncEvent({ projectId: 'p1', nodeId: 'merge', operation: 'relation.create', payload: { issueId: 'ISS-L', relatedIssueId: 'ISS-M', type: 'blocks' } })
const relationOutbox = linear.makeOutboxRecord({ event: relationEvent, mutation: { operation: 'relation.create', payload: relationEvent.payload } })
const relationInflight = linear.transitionOutbox(relationOutbox, 'attempt', {}, '2026-01-01T00:03:00.000Z')
const restarted = JSON.parse(JSON.stringify(relationInflight))
assert.equal(linear.confirmationMatches(restarted.confirms, { type: 'blocks', relatedIssue: { id: 'ISS-M' } }), true)
assert.equal(linear.transitionOutbox(restarted, 'confirm', { readBack: true }, '2026-01-01T00:04:00.000Z').status, 'confirmed')
const syncDir = await fs.mkdtemp('/tmp/linear-sync-test-')
const syncVersions = new Map(); let syncVersion = 0
const syncFops = {
  async ensureDir(dir) { await fs.mkdir(dir, { recursive: true }) },
  async readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return undefined } },
  async statInfo(file) { return syncVersions.has(file) ? { version: syncVersions.get(file) } : undefined },
  async writeJson(file, value, options) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    if (options?.kind === 'replaceIfVersion' && syncVersions.get(file) !== options.version) throw new Error('stale CAS')
    if (options?.kind === 'createIfAbsent') { const handle = await fs.open(file, 'wx'); await handle.writeFile(JSON.stringify(value)); await handle.close() }
    else await fs.writeFile(file, JSON.stringify(value))
    syncVersion += 1; syncVersions.set(file, 'v' + syncVersion)
  },
  async listDir(dir) { try { return (await fs.readdir(dir, { withFileTypes: true })).map((entry) => ({ name: entry.name, dir: entry.isDirectory() })) } catch { return [] } },
}
await linear.persistSyncEvent(syncFops, syncDir, 'p1', event)
await linear.persistOutboxRecord(syncFops, syncDir, 'p1', outbox)
assert.equal((await linear.listOutboxRecords(syncFops, syncDir, 'p1')).length, 1)
const nextEvent = linear.makeSyncEvent({ prevDigest: event.digest, projectId: 'p1', nodeId: 'n1', operation: 'complete', payload: {} })
await linear.persistSyncEvent(syncFops, syncDir, 'p1', nextEvent)
assert.deepEqual(JSON.parse(await fs.readFile(path.join(syncDir, '.research-agent/projects/p1/linear-sync/head.json'), 'utf8')).digest, nextEvent.digest)
const competingEvent = linear.makeSyncEvent({ prevDigest: event.digest, projectId: 'p1', nodeId: 'n2', operation: 'complete', payload: {} })
await assert.rejects(() => linear.persistSyncEvent(syncFops, syncDir, 'p1', competingEvent), /sync event predecessor mismatch/)
const noCasEvent = linear.makeSyncEvent({ prevDigest: nextEvent.digest, projectId: 'p1', nodeId: 'n3', operation: 'complete', payload: {} })
const noCasFops = { ...syncFops }; delete noCasFops.statInfo
await assert.rejects(() => linear.persistSyncEvent(noCasFops, syncDir, 'p1', noCasEvent), /requires versioned CAS support/)
const statePath = path.join(syncDir, '.research-agent/projects/p1/state.json')
// A CANONICAL journal, because markProjectionConfirmed now validates before it
// writes: acknowledging a projection must not be able to persist a journal that a
// later read would reject.
// Written THROUGH the versioned fake fs so `statInfo` knows the file: the
// projection acknowledgement CASes against that version.
await syncFops.writeJson(statePath, { kind: 'project-state',
  projectId: 'p1',
  marker: core.projectMarker('p1'),
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  project: { linearProjectId: '', url: '', createdAt: '' },
  integrationRevision: 1,
  nodes: { n1: { status: 'done', issueId: '', identifier: '', url: '', linearState: '', runDir: '', runStatus: '', currentStep: '', currentPass: null, hasFinal: false, finalCommentId: '', receipts: [], causalHolds: [], nodeRevision: 1, leaseId: '', failureReason: '', contextDigest: null, contextDigestAt: null, linearProjection: { projectId: 'p1', nodeId: 'n1', status: 'done', blockedBy: [], reason: '', updatedAt: '2026-09-14T00:00:00.000Z' }, projectionStatus: 'pending', updatedAt: '' } },
  commentCursors: {},
  integration: { epoch: 1, inputDigest: null, lastKnownGood: null, feedback: [] },
  lastError: '',
  // No `digest`: a persisted journal is the record body, and the projection
  // acknowledgement below mutates it, so a frozen constructor digest would be
  // stale by definition.
}, { kind: 'createIfAbsent' })
const nodeEvent = linear.makeSyncEvent({ projectId: 'p1', nodeId: 'n1', operation: 'node.project', payload: { issueId: 'I1', stateId: 'S1', status: 'done' } })
const nodeRecord = linear.makeOutboxRecord({ event: nodeEvent, mutation: { operation: 'node.project', payload: nodeEvent.payload } })
assert.equal((await linear.markProjectionConfirmed(syncFops, syncDir, 'p1', nodeRecord, { remoteId: 'I1' })).ok, true)
assert.equal((await syncFops.readJson(statePath)).nodes.n1.projectionStatus, 'confirmed')
await fs.rm(syncDir, { recursive: true, force: true })

const requests = []
const transport = async (request) => {
  requests.push(request)
  if (request.query.includes('IssueComments') && !request.variables.after) {
    return { statusCode: 200, bodyText: JSON.stringify({ data: { issue: { comments: { nodes: [{ id: 'c1', body: 'one', createdAt: 't', user: { id: 'u1', name: 'A' } }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } } } } }) }
  }
  return { statusCode: 200, bodyText: JSON.stringify({ data: { issue: { comments: { nodes: [{ id: 'c2', body: 'two', createdAt: 't2', user: null }], pageInfo: { hasNextPage: false, endCursor: null } } } } }) }
}
const comments = await linear.listComments('issue-1', transport, { first: 1 })
assert.deepEqual(comments.comments.map((comment) => comment.id), ['c1', 'c2'])
assert.equal(requests[0].variables.first, 1)
assert.equal(requests[1].variables.after, 'cursor-1')
const oversizedProjectTransport = async () => ({ statusCode: 200, bodyText: JSON.stringify({ data: { project: { issues: { nodes: [{ id: 'i1' }, { id: 'i2' }], pageInfo: { hasNextPage: false, endCursor: null } } } } }) })
await assert.rejects(linear.listProjectIssues('project-1', oversizedProjectTransport, { maxNodes: 1 }), /node ceiling exceeded/)
const truncatedProjectTransport = async () => ({ statusCode: 200, bodyText: JSON.stringify({ data: { project: { issues: { nodes: [{ id: 'i1' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } } } }) })
await assert.rejects(linear.listProjectIssues('project-1', truncatedProjectTransport, { maxPages: 1 }), /page ceiling exceeded/)

const shaped = linear.shapeRelations({ nodes: [{ id: 'r1', type: 'blocks', relatedIssue: { id: 'i2', identifier: 'AR-2', title: 'Downstream', url: 'u' } }] })
assert.equal(shaped.nodes[0].relatedIssue.identifier, 'AR-2')

let markerIssues = []
let markerProjects = []
let createdInput = null
const markerTransport = async (request) => {
  if (request.query.includes('query {\n      teams')) return { statusCode: 200, bodyText: JSON.stringify({ data: { teams: { nodes: [{ id: 'team-1', name: 'Research', key: 'RES', states: { nodes: [] }, labels: { nodes: [] } }] } } }) }
  if (request.query.includes('query ProjectIssues')) return { statusCode: 200, bodyText: JSON.stringify({ data: { project: { issues: { nodes: markerIssues, pageInfo: { hasNextPage: false, endCursor: null } } } } }) }
  if (request.query.includes('query Projects')) return { statusCode: 200, bodyText: JSON.stringify({ data: { projects: { nodes: markerProjects, pageInfo: { hasNextPage: false, endCursor: null } } } }) }
  if (request.query.includes('mutation IssueCreate')) {
    createdInput = request.variables.input
    return { statusCode: 200, bodyText: JSON.stringify({ data: { issueCreate: { success: true, issue: { id: 'new-1', identifier: 'AR-9', title: 'Node', url: 'u' } } } }) }
  }
  throw new Error('unexpected marker transport query')
}
const canonicalMarker = linear.nodeMarker('auto-project', 'node-1')
markerIssues = [{ id: 'i1', description: canonicalMarker }, { id: 'i2', description: canonicalMarker }]
await assert.rejects(linear.reconcileIssueCandidates('linear-project', 'auto-project', 'node-1', markerTransport), /Multiple Linear issues/)
const projectMarker = linear.projectMarker('auto-project')
markerProjects = [{ id: 'p1', description: projectMarker }, { id: 'p2', description: projectMarker }]
await assert.rejects(linear.reconcileProject('auto-project', markerTransport), /Multiple Linear projects/)
// The legacy Linear-project-UUID-keyed marker is no longer recognized at
// runtime (the Phase 1 canonical cut removed in-place marker migration): an
// issue carrying only the legacy marker is not matched, a fresh canonical
// issue is created, and the legacy description is left untouched.
const legacyMarker = linear.nodeMarker('linear-project', 'node-1')
const legacyDescription = 'User-authored prose.\n\n' + legacyMarker
markerIssues = [{ id: 'legacy-1', identifier: 'AR-1', title: 'Node', description: legacyDescription, url: 'u' }]
let approvals = 0
const created = await linear.createIssueFlow({ projectId: 'linear-project', autoresearchProjectId: 'auto-project', nodeId: 'node-1', title: 'Node', teamId: 'team-1' }, markerTransport, async () => { approvals += 1 })
assert.equal(created.created, true)
assert.equal(created.reconciled, false)
assert.equal(created.migrated, undefined, 'no in-place legacy marker migration in the canonical runtime')
assert.equal(approvals, 1)
assert.ok(createdInput.description.includes(canonicalMarker))
assert.equal(createdInput.description.includes(legacyMarker), false)
assert.equal(createdInput.description.includes('User-authored prose'), false, 'legacy prose is never folded into a new canonical issue')

// ── Phase 4: Linear-first node context (plan §7) ────────────────────────────
{
  const core = createLibraries.core
  const state = {
    kind: 'node-context', nodeId: 'n1', status: 'in_progress',
    objective: 'Deliver the section',
    completed: [], findings: [], requiredRevisions: [],
    remaining: [{ id: 'w1', text: 'Write the section' }],
    dependencies: [],
    nextAction: { text: 'Write the section', owner: 'research_author', expectedOutput: 'section.md', acceptanceCheck: 'reviewed' },
    evidenceRefs: [], watermark: '2026-01-01T00:00:00.000Z', lastVerified: null,
  }
  const block = core.renderContextBlock(state)
  const blockDigest = core.contextBlockDigest(state)
  // context-block confirmation: only the owned digest confirms a read-back.
  assert.equal(linear.confirmationMatches({ kind: 'context-block', issueId: 'I1', contextDigest: blockDigest }, { issue: { description: block } }), true)
  assert.equal(linear.confirmationMatches({ kind: 'context-block', issueId: 'I1', contextDigest: '0'.repeat(64) }, { issue: { description: block } }), false)
  assert.equal(linear.confirmationMatches({ kind: 'context-block', issueId: 'I1', contextDigest: blockDigest }, { issue: { description: 'no block' } }), false)
  // node.context.update outbox record shape.
  const ctxEvent = linear.makeSyncEvent({ projectId: 'p1', nodeId: 'n1', operation: 'node.context.update', payload: { issueId: 'I1', contextDigest: blockDigest, description: block, nodeId: 'n1' }, createdAt: '2026-01-01T00:05:00.000Z' })
  const ctxRecord = linear.makeOutboxRecord({ event: ctxEvent, mutation: { operation: 'node.context.update', payload: ctxEvent.payload }, createdAt: ctxEvent.createdAt })
  assert.deepEqual(ctxRecord.confirms, { kind: 'context-block', issueId: 'I1', contextDigest: blockDigest })
  assert.equal(linear.isSupportedOutboxOperation('node.context.update'), true)
  // The record round-trips through a transition without losing its confirms.
  const ctxInflight = linear.transitionOutbox(ctxRecord, 'attempt', {}, '2026-01-01T00:06:00.000Z')
  assert.equal(linear.confirmationMatches(ctxInflight.confirms, { issue: { description: block } }), true)
  // buildContextDescription upserts the block and preserves user text.
  const described = linear.buildContextDescription('# Title\n\nUser text.\n\n', state)
  assert.equal(described.startsWith('# Title\n\nUser text.\n\n'), true)
  assert.equal(core.parseContextBlock(described).ok, true)
  // Recovery cache helpers (plan §7.7): intent-only, never authoritative.
  const cacheDir = await fs.mkdtemp('/tmp/linear-recovery-')
  const cacheFops = {
    async ensureDir(dir) { await fs.mkdir(dir, { recursive: true }) },
    async readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return undefined } },
    async writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value)) },
    async remove(file) { await fs.rm(file, { force: true }) },
  }
  const written = await linear.writeRecoveryCache(cacheFops, cacheDir, 'p1', 'n1', { issueId: 'I1', expectedContextDigest: '', contextDigest: blockDigest, description: block, state, createdAt: '2026-01-01T00:07:00.000Z' })
  assert.equal(written.status, 'pending')
  assert.deepEqual(await linear.readRecoveryCache(cacheFops, cacheDir, 'p1', 'n1'), written)
  assert.equal(await linear.readRecoveryCache(cacheFops, cacheDir, 'p1', 'missing'), null)
  // Read-Linear-first classification of the pending intent.
  assert.equal(linear.reconcileRecoveryCache(written, block).status, 'applied')
  assert.equal(linear.reconcileRecoveryCache(written, '').status, 'not-applied', 'no live block and an empty prior: a replay is safe')
  assert.equal(linear.reconcileRecoveryCache(written, core.renderContextBlock({ ...state, status: 'done' })).status, 'conflict')
  assert.equal(linear.reconcileRecoveryCache({ ...written, kind: 'not-a-cache' }, block).status, 'invalid')
  const marked = await linear.markRecoveryCacheConfirmed(cacheFops, cacheDir, 'p1', 'n1', '2026-01-01T00:08:00.000Z')
  assert.equal(marked.cache.status, 'confirmed')
  assert.equal((await linear.readRecoveryCache(cacheFops, cacheDir, 'p1', 'n1')).status, 'confirmed')
  assert.deepEqual(await linear.markRecoveryCacheConfirmed(cacheFops, cacheDir, 'p1', 'n1'), { ok: true, skipped: true, cache: await linear.readRecoveryCache(cacheFops, cacheDir, 'p1', 'n1') }, 'confirming an already-confirmed cache is idempotent')
  assert.equal(await linear.clearRecoveryCache(cacheFops, cacheDir, 'p1', 'n1'), true)
  assert.equal(await linear.readRecoveryCache(cacheFops, cacheDir, 'p1', 'n1'), null)
  await fs.rm(cacheDir, { recursive: true, force: true })
  // Capability flag: the context write path requires a read-write mutation.
  const meta = { ok: true, teams: [{ id: 'team-1', states: [{ id: 't', type: 'backlog' }, { id: 's', type: 'started' }, { id: 'd', type: 'completed' }, { id: 'c', type: 'canceled' }] }] }
  assert.equal(linear.preflightCapabilities(meta, { teamId: 'team-1', mutationCapability: 'read-write' }).capabilities.contextDescription, 'available')
  assert.equal(linear.preflightCapabilities(meta, { teamId: 'team-1', mutationCapability: 'read-only' }).capabilities.contextDescription, 'unavailable')
  assert.equal(linear.preflightCapabilities(meta, { teamId: 'team-1' }).capabilities.contextDescription, 'unavailable')
}

console.log('linear core tests passed')
