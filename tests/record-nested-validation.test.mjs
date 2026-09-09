import assert from 'node:assert/strict'
import * as core from '../src/autoresearch-core.mjs'

const state = {
  kind: 'project-state', projectId: 'p', marker: 'm', createdAt: 'now', updatedAt: 'now',
  project: { linearProjectId: '', url: '', createdAt: '' }, integrationRevision: 1,
  nodes: { n: { status: 'todo', issueId: '', identifier: '', url: '', linearState: '', runDir: '', runStatus: '', currentStep: '', currentPass: null, hasFinal: false, finalCommentId: '', receipts: [], causalHolds: [], nodeRevision: 1, leaseId: '', failureReason: '', contextDigest: null, contextDigestAt: null, linearProjection: null, projectionStatus: 'none', updatedAt: '' } },
  commentCursors: {}, integration: { epoch: 1, inputDigest: null, lastKnownGood: null, feedback: [] }, lastError: '',
}
assert.equal(core.validateRecord(state).ok, true)
assert.equal(core.validateRecord({ ...state, nodes: { n: { ...state.nodes.n, unexpected: true } } }).ok, false)
assert.equal(core.validateRecord({ ...state, nodes: { n: { ...state.nodes.n, causalHolds: [{ blockedBy: ['x'], reason: 'blocked', unexpected: true }] } } }).ok, false)
assert.equal(core.validateRecord({ ...state, commentCursors: { n: { unexpected: true } } }).ok, true, 'cursor values remain opaque IDs/adapter metadata')

const task = core.makeRecord('role-task', {
  runDigest: 'run', projectId: 'p', planDigest: 'plan', nodeId: 'n', contractDigest: 'contract', contextDigest: 'context', logicalGroupId: 'group', role: 'research_author', pass: 0, description: '', nextAction: '', tools: [], shellMode: 'none', readRoots: [], writeRoot: null, egress: 'none', attestationDigest: null, outputMode: 'body', outputContract: null,
  route: { model: 'm', fallbacks: [], degraded: null }, inputs: [{ name: 'x', path: 'x.md', hash: 'h', format: 'markdown', producer: 'n' }],
})
assert.equal(core.validateRecord(task).ok, true)
assert.equal(core.validateRecord({ ...task, route: { ...task.route, extra: true } }).ok, false)
assert.equal(core.validateRecord({ ...task, inputs: [{ ...task.inputs[0], extra: true }] }).ok, false)

const packet = core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'run', candidateIds: ['a'], contents: { a: 'body' } }).judges[0].map
assert.equal(core.validateRecord({ ...packet, anonymizedToOriginal: { A: { bad: true } } }).ok, false)

const manifest = core.makeRecord('publish-manifest', { projectId: 'p', planRevision: 1, integrationRun: null, artifactFormat: null, rebuildable: false, entries: [], preservedExisting: [], warnings: [] })
assert.equal(core.validateRecord({ ...manifest, entries: [{ path: 'x', sourcePath: 'x', sourceRule: 'explicit', requiredBy: [], hash: 'h', extra: true }] }).ok, false)
console.log('nested record validation tests passed')
