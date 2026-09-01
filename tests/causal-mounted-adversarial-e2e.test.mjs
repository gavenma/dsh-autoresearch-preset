import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const composition = await fs.readFile(path.join(root, 'agent.cordis.yml'), 'utf8')
const mountedMatch = composition.match(/\.\/tools\/(research-orchestrator-[0-9a-f]{12}\.mjs)/)
assert.ok(mountedMatch, 'agent.cordis.yml must mount a generated orchestrator bundle')
assert.equal('tools/' + mountedMatch[1], manifest.entries.orchestrator, 'mounted orchestrator must match build manifest')
const mountedLinearMatch = composition.match(/\.\/tools\/(linear-[0-9a-f]{12}\.mjs)/)
assert.ok(mountedLinearMatch, 'agent.cordis.yml must mount a generated linear bundle')
assert.equal('tools/' + mountedLinearMatch[1], manifest.entries.linear, 'mounted linear must match build manifest')
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const { default: linearPlugin } = await import(pathToFileURL(path.join(root, manifest.entries.linear)).href)
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-causal-mounted-'))
const projectId = 'causal-mounted'
const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
const upstreamRun = path.join(baseDir, '.research-agent', 'runs', 'upstream')
const consumerRun = path.join(baseDir, '.research-agent', 'runs', 'consumer')
await fs.mkdir(path.join(projectDir, 'revision-requests'), { recursive: true })
await fs.mkdir(path.join(consumerRun, 'pass_01'), { recursive: true })
await fs.mkdir(upstreamRun, { recursive: true })

const plan = {
  schemaVersion: 2, projectId, projectName: 'Mounted adversarial routing', approvedAt: '2026-01-01T00:00:00.000Z', revision: 1, integrationId: 'integration',
  projectContract: { goal: 'Exercise mounted causal routing.', acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
  nodes: [
    { id: 'upstream', title: 'Upstream', kind: 'research', roles: ['research_author'], expectedOutcome: 'Input.', acceptance: [{ id: 'UP-01', text: 'Input.', required: true }], dependsOn: [] },
    { id: 'consumer', title: 'Consumer', kind: 'research', roles: ['research_author'], expectedOutcome: 'Output.', acceptance: [{ id: 'CON-01', text: 'Output.', required: true }], dependsOn: ['upstream'] },
    { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], dependsOn: ['consumer'] },
  ],
}
const state = {
  schemaVersion: 1, projectId, integration: { epoch: 1 },
  nodes: Object.fromEntries(plan.nodes.map((node) => [node.id, {
    status: 'done', issueId: node.id + '-issue', identifier: node.id.toUpperCase(), url: 'https://example.invalid/' + node.id, linearState: 'Done',
    runDir: node.id === 'upstream' ? path.relative(baseDir, upstreamRun) : node.id === 'consumer' ? path.relative(baseDir, consumerRun) : '',
    runStatus: 'complete', currentStep: 'complete', currentPass: 1, hasFinal: true, finalCommentId: node.id + '-comment', receipts: [],
  }])),
}
const upstreamAcceptance = { criteria: [{ id: 'UP-01', result: 'WAIVED', waiver: { userDecision: 'Approved', rationale: 'Deferred.', scope: 'Input.', planRevision: 1 } }] }
const upstreamOutput = { contributions: [{ id: 'upstream-1', importance: 'required', mutability: 'locked' }] }
await fs.writeFile(path.join(projectDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
await fs.writeFile(path.join(projectDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
await fs.writeFile(path.join(upstreamRun, 'acceptance.json'), JSON.stringify(upstreamAcceptance, null, 2) + '\n')
await fs.writeFile(path.join(upstreamRun, 'node-output.json'), JSON.stringify(upstreamOutput, null, 2) + '\n')

const registered = new Map()
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, options = {}) { await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined) },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}
orchestrator.apply({ get(name) { return name === 'fs' ? fileService : name === 'tools' ? { register(definition) { registered.set(definition.name, definition) } } : undefined } })
for (const name of ['autoresearch_parse_attribution', 'autoresearch_revision_request', 'autoresearch_project_status', 'autoresearch_build_probe']) assert.ok(registered.has(name), 'mounted bundle must register ' + name)

const linearRegistered = new Map()
linearPlugin.apply({ get(name) { return name === 'tools' ? { register(definition) { linearRegistered.set(definition.name, definition) } } : undefined } })
assert.ok(linearRegistered.has('linear_build_probe'), 'mounted linear bundle must register linear_build_probe')

const parse = registered.get('autoresearch_parse_attribution')
const attribution = { upstreamNodeId: 'upstream', evidenceClass: 'waived-criterion', criterionId: 'UP-01', affectedCriterionId: 'CON-01', explanation: 'The consumer may lack the waived upstream input.', evidenceAnchor: 'waived:upstream:UP-01' }
const validTranscript = 'RANKING: X, Y, Z\n\n```attribution\n' + JSON.stringify(attribution) + '\n```\n'
assert.equal((await parse.execute({ text: validTranscript }, {})).valid, true)
assert.equal((await parse.execute({ text: validTranscript + '\n```attribution\n' + JSON.stringify(attribution) + '\n```\n' }, {})).valid, false, 'multiple attribution blocks must fail closed')
const trailingAccepted = (await parse.execute({ text: validTranscript + 'unparsed trailing text' }, {})).valid
assert.equal(trailingAccepted, false, 'trailing text after attribution must fail closed')

const status = registered.get('autoresearch_project_status')
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
const planBefore = await fs.readFile(path.join(projectDir, 'plan.json'), 'utf8')
const stateBefore = await fs.readFile(path.join(projectDir, 'state.json'), 'utf8')
const durableRequest = {
  projectId, nodeId: 'upstream',
  upstreamAttribution: {
    consumerNodeId: 'consumer', upstreamNodeId: 'upstream', key: 'upstream::UP-01', evidenceClass: 'waived-criterion', criterionId: 'UP-01',
    quorum: { judges: [1, 2], criticConcord: false, mode: 'two-judge' }, attributions: [{ source: 'judge', judge: 1 }, { source: 'judge', judge: 2 }], contextDigest: sha256('context'), epoch: 1, override: false,
  },
}
await fs.writeFile(path.join(projectDir, 'revision-requests', 'orphan.json'), JSON.stringify(durableRequest, null, 2) + '\n')
await fs.writeFile(path.join(projectDir, 'revision-requests', 'corrupt.json'), '{broken json\n')
const report = await status.execute({ projectId }, exec)
assert.equal(report.backtracking.corruptRequestFiles.length, 1, 'corrupt durable request must be surfaced')
assert.equal(report.backtracking.openReopens.length, 0, 'request before reset leaves upstream still done')
assert.equal(report.backtracking.orphans.length, 1, 'durable request before reset must be reported as orphaned for replay')
assert.equal(await fs.readFile(path.join(projectDir, 'plan.json'), 'utf8'), planBefore, 'status must not mutate plan')
assert.equal(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'), stateBefore, 'status must not mutate state without cursor input')

await fs.rm(baseDir, { recursive: true, force: true })
console.log('causal mounted adversarial e2e passed for generation ' + manifest.generation)
