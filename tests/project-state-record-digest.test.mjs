import assert from 'node:assert/strict'
import * as core from '../src/autoresearch-core.mjs'
import orchestrator, { createLibraries } from '../src/research-orchestrator.mjs'

const state = createLibraries.projectstate.emptyState({
  projectId: 'digest-proj',
  nodes: [{ id: 'integration' }],
})
assert.equal(core.validateRecord(state).ok, true, 'emptyState must match project-state definition')
assert.deepEqual(Object.keys(state).sort(), [
  'commentCursors', 'createdAt', 'integration', 'integrationRevision', 'kind', 'lastError',
  'marker', 'nodes', 'project', 'projectId', 'updatedAt',
])

const roleTask = core.makeRecord('role-task', {
  runDigest: 'run', projectId: 'p', planDigest: 'plan', nodeId: 'n',
  contractDigest: 'contract', contextDigest: 'context', logicalGroupId: 'group',
  role: 'research_author', pass: 0, description: '', nextAction: '', tools: [],
  shellMode: 'none', readRoots: [], writeRoot: null, egress: 'none',
  attestationDigest: null, outputMode: 'body', outputContract: null, route: null,
})
const roleResult = core.makeRecord('role-result', {
  runDigest: 'run', projectId: 'p', nodeId: 'n', contractDigest: 'contract',
  logicalGroupId: 'group', role: 'research_author', pass: 0, attempt: 1,
  attemptId: 'attempt', status: 'terminal', outcomeClass: 'success', outputRef: null,
  outputHash: null, output: null, summary: '', limitations: [],
  requestedProvider: null, requestedModel: null, actualProvider: null, actualModel: null,
  routeSource: null, tools: [], nextAction: '', createdAt: 'now', finishedAt: 'later',
})
const packet = core.buildBlindPackets({
  pass: 0, judgeCount: 1, runDigest: 'run', candidateIds: ['a'], contents: { a: 'body' },
}).judges[0].map
const manifest = core.makeRecord('publish-manifest', {
  projectId: 'p', planRevision: 1, integrationRun: null, artifactFormat: null,
  rebuildable: false, entries: [], preservedExisting: [], warnings: [],
})
for (const record of [roleTask, roleResult, packet, manifest]) {
  assert.equal(typeof record.digest, 'string')
  assert.equal(core.validateRecord(record).ok, true, record.kind + ' must validate after construction')
  assert.equal(record.digest, core.recordDigest(record))
}
assert.equal(core.validateRecord({ ...roleTask, digest: 'wrong' }).ok, false)
assert.equal(core.validateRecord({ ...manifest, digest: undefined }).ok, true, 'digest may be absent before construction')

void orchestrator
console.log('project-state and record digest tests passed')
