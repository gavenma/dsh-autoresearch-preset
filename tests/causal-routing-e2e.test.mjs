import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-causal-routing-'))
const projectId = 'causal-routing'
const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
const upstreamRun = path.join(baseDir, '.research-agent', 'runs', 'lit')
const consumerRun = path.join(baseDir, '.research-agent', 'runs', 'intro')
await fs.mkdir(path.join(projectDir, 'revision-requests'), { recursive: true })
await fs.mkdir(path.join(consumerRun, 'pass_01'), { recursive: true })
await fs.mkdir(upstreamRun, { recursive: true })

const plan = {
  schemaVersion: 2, projectId, projectName: 'Causal routing', approvedAt: '2026-01-01T00:00:00.000Z', revision: 1, integrationId: 'integration',
  projectContract: { goal: 'Exercise causal routing.', acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
  nodes: [
    { id: 'lit', title: 'Literature', kind: 'literature', roles: ['research_literature_writer'], expectedOutcome: 'Literature.', acceptance: [{ id: 'LR-03', text: 'Coverage.', required: true }], dependsOn: [] },
    { id: 'intro', title: 'Introduction', kind: 'research', roles: ['research_author'], expectedOutcome: 'Introduction.', acceptance: [{ id: 'INTRO-02', text: 'Context.', required: true }], dependsOn: ['lit'] },
    { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], dependsOn: ['intro'] },
  ],
}
assert.equal(core.validatePlan(plan).ok, true)
const litContract = core.nodeContract(plan, 'lit')
const introContract = core.nodeContract(plan, 'intro')
const upstreamAcceptance = { overall: 'PASS', receiptHash: 'acceptance-lit', criteria: [{ id: 'LR-03', result: 'WAIVED', waiver: { userDecision: 'Approved', rationale: 'Deferred.', scope: 'Coverage.', planRevision: 1 } }] }
const upstreamOutput = { contributions: [{ id: 'lit-coverage', importance: 'required', mutability: 'locked', evidence: [] }] }
const upstreamOutputText = JSON.stringify(upstreamOutput, null, 2) + '\n'
await fs.writeFile(path.join(projectDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
await fs.writeFile(path.join(upstreamRun, 'node-contract.json'), JSON.stringify({ projectId, nodeId: 'lit', planRevision: 1, artifactFormat: 'md', contractDigest: litContract.digest, contract: litContract }, null, 2) + '\n')
await fs.writeFile(path.join(upstreamRun, 'acceptance.json'), JSON.stringify(upstreamAcceptance, null, 2) + '\n')
await fs.writeFile(path.join(upstreamRun, 'node-output.json'), upstreamOutputText)
await fs.writeFile(path.join(consumerRun, 'node-contract.json'), JSON.stringify({ projectId, nodeId: 'intro', planRevision: 1, artifactFormat: 'md', contractDigest: introContract.digest, contract: introContract }, null, 2) + '\n')
await fs.writeFile(path.join(consumerRun, 'run.json'), JSON.stringify({ currentPass: 1, config: { backtracking: { mode: 'observe' } } }) + '\n')

const state = {
  schemaVersion: 1, projectId, integration: { epoch: 1 },
  nodes: {
    lit: { status: 'done', issueId: 'lit-issue', identifier: 'LIT', url: 'https://example.invalid/lit', linearState: 'Done', runDir: path.relative(baseDir, upstreamRun), runStatus: 'complete', currentStep: 'complete', currentPass: 1, hasFinal: true, finalCommentId: 'lit-comment', receipts: [] },
    intro: { status: 'done', issueId: 'intro-issue', identifier: 'INTRO', url: 'https://example.invalid/intro', linearState: 'Done', runDir: path.relative(baseDir, consumerRun), runStatus: 'complete', currentStep: 'complete', currentPass: 1, hasFinal: true, finalCommentId: 'intro-comment', receipts: [] },
    integration: { status: 'done', issueId: 'integration-issue', identifier: 'INT', url: 'https://example.invalid/integration', linearState: 'Done', runDir: '', runStatus: 'complete', currentStep: 'complete', currentPass: 1, hasFinal: true, finalCommentId: 'integration-comment', receipts: [] },
  },
}
await fs.writeFile(path.join(projectDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
const contextDigest = core.buildUpstreamContextText({
  plan, consumerNodeId: 'intro', records: {
    lit: { status: 'done', contract: litContract, acceptance: upstreamAcceptance, nodeOutput: upstreamOutput, contractDigest: litContract.digest, outputHash: sha256(upstreamOutputText), acceptanceHash: 'acceptance-lit' },
  },
}).contextDigest
const attribution = {
  upstreamNodeId: 'lit', evidenceClass: 'waived-criterion', criterionId: 'LR-03', affectedCriterionId: 'INTRO-02',
  explanation: 'The introduction lacks the waived literature coverage needed for its context criterion.', evidenceAnchor: 'waived:lit:LR-03',
}
const transcript = '## Reasoning\n\nRANKING: X, Y, Z\n\n## Upstream attribution\n```attribution\n' + JSON.stringify(attribution, null, 2) + '\n```\n'
await fs.writeFile(path.join(consumerRun, 'pass_01', 'judge-1.md'), transcript)
await fs.writeFile(path.join(consumerRun, 'pass_01', 'judge-2.md'), transcript)
const evidenceHash = sha256(transcript)
const attributions = [1, 2].map((judge) => ({ source: 'judge', judge, pass: 1, validRanking: true, allowedLabels: ['X', 'Y', 'Z'], evidenceFile: 'pass_01/judge-' + judge + '.md', evidenceHash, contextDigest, attribution }))
await fs.mkdir(path.join(baseDir, '.research-agent'), { recursive: true })
await fs.writeFile(path.join(baseDir, '.research-agent', 'config.json'), JSON.stringify({ backtracking: { mode: 'observe' } }) + '\n')

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
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
await fs.writeFile(path.join(baseDir, '.research-agent', 'config.json'), JSON.stringify({ backtracking: { mode: 'enforce', maxReopensPerPair: 1 } }) + '\n')
await fs.writeFile(path.join(projectDir, 'revision-requests', 'existing.json'), JSON.stringify({ projectId, nodeId: 'lit', upstreamAttribution: { consumerNodeId: 'intro', upstreamNodeId: 'lit', key: 'lit::LR-03', evidenceClass: 'waived-criterion', criterionId: 'LR-03', quorum: { judges: [1, 2], criticConcord: false, mode: 'two-judge' }, attributions: [{ source: 'judge', judge: 1 }], contextDigest, epoch: 1, override: false } }) + '\n')
const stateBeforeCap = await fs.readFile(path.join(projectDir, 'state.json'), 'utf8')
const capped = await tool.execute({ projectId, nodeId: 'intro', pass: 1, attributions }, exec)
assert.equal(capped.decision, 'escalate-budget')
assert.equal(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'), stateBeforeCap)
assert.equal((await fs.readdir(path.join(projectDir, 'revision-requests'))).length, 1)
await fs.rm(path.join(projectDir, 'revision-requests', 'existing.json'))
await fs.writeFile(path.join(baseDir, '.research-agent', 'config.json'), JSON.stringify({ backtracking: { mode: 'observe' } }) + '\n')

const observe = await tool.execute({ projectId, nodeId: 'intro', pass: 1, attributions }, exec)
assert.equal(observe.decision, 'observe')
assert.equal(observe.observed, true)
assert.equal((await fs.readdir(path.join(projectDir, 'revision-requests'))).length, 0)
let afterObserve = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
assert.equal(afterObserve.nodes.lit.status, 'done')
assert.equal(afterObserve.nodes.intro.status, 'done')
assert.equal(afterObserve.backtracking.observations.length, 1)

const consumerContractPath = path.join(consumerRun, 'node-contract.json')
const consumerContractText = await fs.readFile(consumerContractPath, 'utf8')
const forgedContract = JSON.parse(consumerContractText)
forgedContract.contractDigest = 'forged'
await fs.writeFile(consumerContractPath, JSON.stringify(forgedContract, null, 2) + '\n')
const forged = await tool.execute({ projectId, nodeId: 'intro', pass: 1, attributions }, exec)
assert.equal(forged.decision, 'abstain')
assert.equal((await fs.readdir(path.join(projectDir, 'revision-requests'))).length, 0)
assert.equal(JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8')).nodes.intro.status, 'done')
await fs.writeFile(consumerContractPath, consumerContractText)

await fs.writeFile(path.join(baseDir, '.research-agent', 'config.json'), JSON.stringify({ backtracking: { mode: 'enforce' } }) + '\n')
const enforce = await tool.execute({ projectId, nodeId: 'intro', pass: 1, attributions }, exec)
assert.equal(enforce.decision, 'reopen')
assert.equal(enforce.retargetedTo, 'lit')
assert.deepEqual(enforce.resetNodes, ['integration', 'intro', 'lit'])
assert.equal((await fs.readdir(path.join(projectDir, 'revision-requests'))).length, 1)
const afterEnforce = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
assert.equal(afterEnforce.nodes.lit.status, 'todo')
assert.equal(afterEnforce.nodes.intro.status, 'todo')
assert.equal(afterEnforce.nodes.integration.status, 'todo')
assert.equal(afterEnforce.nodes.lit.issueId, 'lit-issue')
assert.equal(afterEnforce.integration.epoch, 2)
assert.equal(afterEnforce.backtracking.reopens.length, 1)
assert.deepEqual(afterEnforce.backtracking.counts.byUpstream, { lit: 1 })
const statusTool = registered.get('autoresearch_project_status')
const projectStatus = await statusTool.execute({ projectId }, exec)
assert.equal(projectStatus.backtracking.openReopens.length, 1)
assert.equal(projectStatus.backtracking.orphans.length, 0)
assert.deepEqual(projectStatus.backtracking.counts.byUpstream, { lit: 1 })
const completedState = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
completedState.nodes.lit.status = 'done'
completedState.backtracking.reopens = []
await fs.writeFile(path.join(projectDir, 'state.json'), JSON.stringify(completedState, null, 2) + '\n')
const completedStatus = await statusTool.execute({ projectId }, exec)
assert.equal(completedStatus.backtracking.openReopens.length, 0)
assert.equal(completedStatus.backtracking.orphans.length, 0)

await fs.rm(baseDir, { recursive: true, force: true })
console.log('causal routing e2e passed for generation ' + manifest.generation)
