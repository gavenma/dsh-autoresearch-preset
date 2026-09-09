import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { plan as canonicalPlan, node as canonicalNode, criterion, projectState } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-revision-baseline-'))
const projectId = 'causal-baseline'
const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
await fs.mkdir(path.join(projectDir, 'revision-requests'), { recursive: true })

const plan = canonicalPlan({
  projectId,
  projectName: 'Causal baseline',
  approvedAt: '2026-01-01T00:00:00.000Z',
  revision: 1,
  integrationId: 'integration',
  projectContract: {
    goal: 'Exercise revision routing.',
    deliverables: [],
    acceptance: [criterion('PROJECT-01', 'Complete.')],
    test: '',
    wordBudget: null,
    rebuildable: false,
    diagnosticMappings: [],
  },
  nodes: [
    canonicalNode({ id: 'upstream', kind: 'research', roles: ['research_author'], title: 'Upstream', expectedOutcome: 'Input.', acceptance: [criterion('UP-01', 'Input exists.')] }),
    canonicalNode({ id: 'consumer', kind: 'research', roles: ['research_author'], title: 'Consumer', expectedOutcome: 'Output.', acceptance: [criterion('CON-01', 'Output exists.')], dependsOn: ['upstream'] }),
    canonicalNode({ id: 'integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], title: 'Integration', expectedOutcome: 'Final.', acceptance: [criterion('INT-01', 'Final exists.')], dependsOn: ['consumer'] }),
  ],
})
const state = projectState({
  projectId,
  nodes: Object.fromEntries(plan.nodes.map((node) => [node.id, {
    status: 'done', issueId: node.id + '-issue', identifier: node.id.toUpperCase(), url: 'https://example.invalid/' + node.id,
    linearState: 'Done', runDir: 'runs/' + node.id, runStatus: 'complete', currentStep: 'complete',
    currentPass: 0, hasFinal: true, finalCommentId: node.id + '-comment', receipts: [],
    causalHolds: [], nodeRevision: 1, linearProjection: null, projectionStatus: 'none', updatedAt: '',
  }])),
})
await fs.writeFile(path.join(projectDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
await fs.writeFile(path.join(projectDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')

const registered = new Map()
const fileService = {
  async resolve(target, options = {}) {
    return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target)
  },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, options = {}) {
    await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
  },
  async stat(target) {
    try { return await fs.stat(target) } catch { return undefined }
  },
  async listDir(target) {
    try {
      const entries = await fs.readdir(target, { withFileTypes: true })
      return entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
    } catch {
      return []
    }
  },
}
orchestrator.apply({
  get(name) {
    if (name === 'fs') return fileService
    if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
    return undefined
  },
})

const revision = registered.get('autoresearch_revision_request')
assert.ok(revision, 'registered tool is required for the regression test')
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
const result = await revision.execute({ projectId, nodeId: 'consumer', epoch: 1, request: { problem: 'Baseline finding.' } }, exec)
assert.equal(result.ok, true)
assert.equal(result.consumerNodeId, 'consumer')
assert.equal(result.retargetedTo, 'consumer')
assert.deepEqual(result.resetNodes, ['consumer', 'integration'])

const requests = await fs.readdir(path.join(projectDir, 'revision-requests'))
assert.equal(requests.length, 1, 'exactly one durable revision request is written')
const stateAfter = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
assert.equal(stateAfter.nodes.upstream.status, 'done', 'upstream must remain done')
assert.equal(stateAfter.nodes.consumer.status, 'todo', 'consumer must be reset to todo')
assert.equal(stateAfter.nodes.integration.status, 'todo', 'integration must be reset to todo')
assert.equal(stateAfter.nodes.consumer.issueId, 'consumer-issue', 'issue id must be preserved through the reset')

await fs.rm(baseDir, { recursive: true, force: true })
console.log('baseline revision-request regression fixed for generation ' + manifest.generation)
