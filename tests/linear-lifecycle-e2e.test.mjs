import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { plan as canonicalPlan, node as canonicalNode } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const orchestrator = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const linearBundle = await import(pathToFileURL(path.join(root, manifest.entries.linear)).href)
const projectstate = orchestrator.createLibraries.projectstate
const linear = linearBundle.createLibraries.linearCore
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-linear-lifecycle-'))
const projectId = 'branch-converge'
const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
const plan = canonicalPlan({
  projectId, projectName: 'Branch convergence', revision: 1, integrationId: 'integration',
  nodes: [
    canonicalNode({ id: 'left', kind: 'research', roles: ['research_author'], title: 'Left' }),
    canonicalNode({ id: 'right', kind: 'research', roles: ['research_author'], title: 'Right' }),
    canonicalNode({ id: 'merge', kind: 'research', roles: ['research_author'], title: 'Merge', dependsOn: ['left', 'right'] }),
    canonicalNode({ id: 'integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], title: 'Integration', dependsOn: ['merge'] }),
  ],
})
const versions = new Map()
const fops = {
  async ensureDir(dir) { await fs.mkdir(dir, { recursive: true }) },
  async exists(file) { try { await fs.access(file); return true } catch { return false } },
  async readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return undefined } },
  async writeJson(file, value, mode = {}) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    if (mode.kind === 'createIfAbsent' && await this.exists(file)) throw Object.assign(new Error('already exists'), { code: 'EEXIST' })
    if (mode.kind === 'replaceIfVersion' && versions.get(file) !== mode.version) throw Object.assign(new Error('version mismatch'), { code: 'VERSION_MISMATCH' })
    await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n')
    versions.set(file, (versions.get(file) ?? 0) + 1)
  },
  async statInfo(file) { return await this.exists(file) ? { version: versions.get(file) ?? 1 } : undefined },
  async listDir(dir) { try { return (await fs.readdir(dir, { withFileTypes: true })).map((entry) => ({ name: entry.name, dir: entry.isDirectory() })) } catch { return [] } },
}

try {
  await fs.mkdir(projectDir, { recursive: true })
  await fops.writeJson(path.join(projectDir, 'plan.json'), plan)
  const state = projectstate.emptyState(plan)
  state.project.linearProjectId = 'LP-1'
  await fops.writeJson(path.join(projectDir, 'state.json'), state)
  const approvedPlan = await fs.readFile(path.join(projectDir, 'plan.json'), 'utf8')

  assert.deepEqual(projectstate.readySet(plan, state), ['left', 'right'])
  assert.equal(projectstate.readySet(plan, state)[0], 'left')
  // Linear-bound project (state.project.linearProjectId set): claim/complete
  // require the freshly queried Linear context digest (plan §7.4).
  const ctxDigestA = 'a'.repeat(64)
  const ctxDigestB = 'b'.repeat(64)
  const ctxDigestC = 'c'.repeat(64)
  await assert.rejects(projectstate.transitionNode(fops, baseDir, projectId, 'left', 'claim', { leaseId: 'left-lease' }), /linear-bound claim requires contextDigest/)
  const leftClaim = await projectstate.transitionNode(fops, baseDir, projectId, 'left', 'claim', { leaseId: 'left-lease', contextDigest: ctxDigestA })
  assert.equal(leftClaim.state.nodes.left.contextDigest, ctxDigestA)
  assert.deepEqual(projectstate.readySet(plan, leftClaim.state), ['right'])
  await projectstate.transitionNode(fops, baseDir, projectId, 'right', 'claim', { leaseId: 'right-lease', contextDigest: ctxDigestB })
  await projectstate.transitionNode(fops, baseDir, projectId, 'left', 'complete', { receipts: ['left-receipt'], contextDigest: ctxDigestA })
  const failure = await projectstate.failNode(fops, baseDir, projectId, 'right', 'verification failed')

  assert.deepEqual(failure.heldNodeIds, ['merge', 'integration'])
  assert.equal(failure.state.nodes.left.status, 'done')
  assert.equal(failure.state.nodes.right.status, 'todo')
  assert.deepEqual(failure.state.nodes.merge.causalHolds[0].blockedBy, ['right'])
  assert.deepEqual(failure.state.nodes.integration.causalHolds[0].blockedBy, ['right'])
  assert.equal(failure.state.nodes.merge.projectionStatus, 'pending')
  assert.equal(failure.state.nodes.integration.projectionStatus, 'pending')
  assert.deepEqual(projectstate.readySet(plan, failure.state), ['right'])
  const recovered = await projectstate.transitionNode(fops, baseDir, projectId, 'right', 'complete', { receipts: ['right-receipt'], contextDigest: ctxDigestB })
  assert.deepEqual(recovered.state.nodes.merge.causalHolds, [])
  assert.deepEqual(recovered.state.nodes.integration.causalHolds, [])
  assert.equal(recovered.state.nodes.merge.projectionStatus, 'pending')
  assert.deepEqual(projectstate.readySet(plan, recovered.state), ['merge'])
  let injectedContention = false
  const contendedFops = { ...fops, async readJson(file) { const value = await fops.readJson(file); if (!injectedContention && file.endsWith('/state.json')) { injectedContention = true; versions.set(file, (versions.get(file) ?? 0) + 1) } return value } }
  await assert.rejects(projectstate.transitionNode(contendedFops, baseDir, projectId, 'merge', 'claim', { leaseId: 'losing-writer', contextDigest: ctxDigestC }), /version mismatch/)
  assert.equal((await fops.readJson(path.join(projectDir, 'state.json'))).nodes.merge.status, 'todo')
  const merged = await projectstate.transitionNode(fops, baseDir, projectId, 'merge', 'complete', { receipts: ['merge-receipt'], contextDigest: ctxDigestC })
  assert.equal(projectstate.integrationStatus(plan, merged.state).allLeavesDone, true)
  assert.equal(projectstate.integrationStatus(plan, merged.state).ready, true)
  assert.deepEqual(projectstate.readySet(plan, merged.state), [])
  assert.equal(await fs.readFile(path.join(projectDir, 'plan.json'), 'utf8'), approvedPlan)

  const issueMap = { left: 'ISS-L', right: 'ISS-R', merge: 'ISS-M', integration: 'ISS-I' }
  const edges = linear.deriveDependencyRelations(plan, issueMap)
  assert.deepEqual(edges.map(({ issueId, relatedIssueId }) => [issueId, relatedIssueId]).sort(), [['ISS-L', 'ISS-M'], ['ISS-M', 'ISS-I'], ['ISS-R', 'ISS-M']])

  const interruptedEdge = edges.find((edge) => edge.upstreamNodeId === 'right' && edge.downstreamNodeId === 'merge')
  const event = linear.makeSyncEvent({ projectId, nodeId: 'merge', operation: 'relation.create', payload: interruptedEdge })
  const outbox = linear.transitionOutbox(linear.makeOutboxRecord({ event, mutation: { operation: 'relation.create', payload: interruptedEdge } }), 'attempt')
  const afterRestart = JSON.parse(JSON.stringify(outbox))
  assert.equal(linear.confirmationMatches(afterRestart.confirms, { type: 'blocks', relatedIssue: { id: 'ISS-M' } }), true)
  assert.equal(linear.transitionOutbox(afterRestart, 'confirm', { readBack: true }).status, 'confirmed')

  const walProject = 'wal-order'
  const firstEvent = linear.makeSyncEvent({ projectId: walProject, nodeId: 'merge', operation: 'node.project', payload: { issueId: 'ISS-M', stateId: 'started', blockedLabelId: 'blocked', blockedBy: [] }, createdAt: '2026-01-01T00:00:00.000Z' })
  await linear.persistSyncEvent(fops, baseDir, walProject, firstEvent)
  const firstRecord = linear.makeOutboxRecord({ event: firstEvent, mutation: { operation: firstEvent.operation, payload: firstEvent.payload }, createdAt: firstEvent.createdAt })
  await linear.persistOutboxRecord(fops, baseDir, walProject, firstRecord)
  const secondEvent = linear.makeSyncEvent({ prevDigest: firstEvent.digest, projectId: walProject, nodeId: 'merge', operation: 'node.project', payload: { issueId: 'ISS-M', stateId: 'done', blockedLabelId: 'blocked', blockedBy: [] }, createdAt: '2026-01-01T00:00:01.000Z' })
  await linear.persistSyncEvent(fops, baseDir, walProject, secondEvent)
  const secondRecord = linear.makeOutboxRecord({ event: secondEvent, mutation: { operation: secondEvent.operation, payload: secondEvent.payload }, createdAt: secondEvent.createdAt })
  await linear.persistOutboxRecord(fops, baseDir, walProject, secondRecord)
  const ordered = await linear.listOutboxRecords(fops, baseDir, walProject)
  assert.deepEqual(ordered.map((record) => record.payload.stateId), ['started', 'done'])
  const corruptPath = path.join(linear.syncRoot(baseDir, walProject), 'outbox', secondRecord.mutationKey + '.json')
  await fops.writeJson(corruptPath, { ...secondRecord, payload: { ...secondRecord.payload, stateId: 'tampered' } })
  await assert.rejects(linear.listOutboxRecords(fops, baseDir, walProject), /does not match its WAL event/)

  console.log('fake Linear branching/converging lifecycle e2e passed for generation ' + manifest.generation)
} finally {
  await fs.rm(baseDir, { recursive: true, force: true })
}
