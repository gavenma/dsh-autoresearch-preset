import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-revision-wiring-'))
const projectId = 'revision-wiring'
const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
await fs.mkdir(path.join(projectDir, 'revision-requests'), { recursive: true })

const plan = {
  schemaVersion: 2, projectId, projectName: 'Revision wiring', approvedAt: '2026-01-01T00:00:00.000Z', revision: 1, integrationId: 'integration',
  projectContract: { goal: 'Verify tool wiring.', acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
  nodes: [
    { id: 'upstream', title: 'Upstream', kind: 'research', roles: ['research_author'], expectedOutcome: 'Input.', acceptance: [{ id: 'UP-01', text: 'Input.', required: true }], dependsOn: [] },
    { id: 'consumer', title: 'Consumer', kind: 'research', roles: ['research_author'], expectedOutcome: 'Output.', acceptance: [{ id: 'CON-01', text: 'Output.', required: true }], dependsOn: ['upstream'] },
    { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], dependsOn: ['consumer'] },
  ],
}
const state = {
  schemaVersion: 1, projectId,
  nodes: Object.fromEntries(plan.nodes.map((node) => [node.id, {
    status: 'done', issueId: node.id + '-issue', identifier: node.id.toUpperCase(), url: 'https://example.invalid/' + node.id, linearState: 'Done',
    runDir: 'runs/' + node.id, runStatus: 'complete', currentStep: 'complete', currentPass: 1, hasFinal: true, finalCommentId: node.id + '-comment', receipts: [], updatedAt: '',
  }])),
}
await fs.writeFile(path.join(projectDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
await fs.writeFile(path.join(projectDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')

const registered = new Map()
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, options = {}) { await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined) },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}
orchestrator.apply({ get(name) { return name === 'fs' ? fileService : name === 'tools' ? { register(definition) { registered.set(definition.name, definition) } } : undefined } })
const tool = registered.get('autoresearch_revision_request')
assert.ok(tool)
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
const result = await tool.execute({ projectId, nodeId: 'consumer', epoch: 1, request: { problem: 'Concrete issue.', requiredChange: 'Revise.', acceptanceChecks: ['Recheck.'] } }, exec)
assert.equal(result.ok, true)
assert.equal(result.consumerNodeId, 'consumer')
assert.equal(result.retargetedTo, 'consumer')
assert.deepEqual(result.resetNodes, ['consumer', 'integration'])
assert.equal((await fs.readdir(path.join(projectDir, 'revision-requests'))).length, 1)
const stateAfter = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
assert.equal(stateAfter.nodes.upstream.status, 'done')
assert.equal(stateAfter.nodes.consumer.status, 'todo')
assert.equal(stateAfter.nodes.integration.status, 'todo')
assert.equal(stateAfter.nodes.consumer.issueId, 'consumer-issue')
assert.equal(stateAfter.nodes.consumer.url, 'https://example.invalid/consumer')

await fs.rm(baseDir, { recursive: true, force: true })
console.log('revision request wiring passed for generation ' + manifest.generation)
