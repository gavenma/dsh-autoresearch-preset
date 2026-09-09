import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { plan as canonicalPlan, node as canonicalNode, criterion, projectState } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-revision-wiring-'))
const projectId = 'revision-wiring'
const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
await fs.mkdir(path.join(projectDir, 'revision-requests'), { recursive: true })

const plan = canonicalPlan({
  projectId, projectName: 'Revision wiring', approvedAt: '2026-01-01T00:00:00.000Z', revision: 1, integrationId: 'integration',
  projectContract: {
    goal: 'Verify tool wiring.',
    deliverables: [],
    acceptance: [criterion('PROJECT-01', 'Complete.')],
    test: '',
    wordBudget: null,
    rebuildable: false,
    diagnosticMappings: [],
  },
  nodes: [
    canonicalNode({ id: 'upstream', kind: 'research', roles: ['research_author'], title: 'Upstream', expectedOutcome: 'Input.', acceptance: [criterion('UP-01', 'Input.')] }),
    canonicalNode({ id: 'consumer', kind: 'research', roles: ['research_author'], title: 'Consumer', expectedOutcome: 'Output.', acceptance: [criterion('CON-01', 'Output.')], dependsOn: ['upstream'] }),
    canonicalNode({ id: 'integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], title: 'Integration', expectedOutcome: 'Final.', acceptance: [criterion('INT-01', 'Final.')], dependsOn: ['consumer'] }),
  ],
})
const state = projectState({
  projectId,
  nodes: Object.fromEntries(plan.nodes.map((node) => [node.id, {
    status: 'done', issueId: node.id + '-issue', identifier: node.id.toUpperCase(), url: 'https://example.invalid/' + node.id, linearState: 'Done',
    runDir: 'runs/' + node.id, runStatus: 'complete', currentStep: 'complete', currentPass: 0, hasFinal: true, finalCommentId: node.id + '-comment', receipts: [],
    causalHolds: [], nodeRevision: 1, linearProjection: null, projectionStatus: 'none', updatedAt: '',
  }])),
})
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
assert.equal(stateAfter.nodes.consumer.nodeRevision, 2)
stateAfter.nodes.consumer.status = 'done'
stateAfter.nodes.consumer.receipts = ['fresh-acceptance']
await fs.writeFile(path.join(projectDir, 'state.json'), JSON.stringify(stateAfter, null, 2) + '\n')
const replay = await tool.execute({ projectId, nodeId: 'consumer', epoch: 1, request: { problem: 'Concrete issue.', requiredChange: 'Revise.', acceptanceChecks: ['Recheck.'] } }, exec)
assert.equal(replay.created, false)
assert.deepEqual(replay.resetNodes, [])
const stateAfterReplay = JSON.parse(await fs.readFile(path.join(projectDir, 'state.json'), 'utf8'))
assert.equal(stateAfterReplay.nodes.consumer.status, 'done')
assert.equal(stateAfterReplay.nodes.consumer.nodeRevision, 2)
assert.deepEqual(stateAfterReplay.nodes.consumer.receipts, ['fresh-acceptance'])

// ── multi-target feedback reopen (plan §8.3) ──────────────────────────────
{
  const H = (char) => char.repeat(64)
  const M = H('a') // LKG manifest digest
  const I = H('b') // LKG input digest
  const multiId = 'revision-multi'
  const multiDir = path.join(baseDir, '.research-agent', 'projects', multiId)
  const multiPlan = canonicalPlan({
    projectId: multiId, projectName: 'Multi revision', approvedAt: '2026-01-01T00:00:00.000Z', revision: 1, integrationId: 'integration',
    projectContract: {
      goal: 'Verify multi-target wiring.',
      deliverables: [],
      acceptance: [criterion('PROJECT-01', 'Complete.')],
      test: '',
      wordBudget: null,
      rebuildable: false,
      diagnosticMappings: [],
    },
    nodes: [
      canonicalNode({ id: 'upstream', acceptance: [criterion('UP-01', 'Input.')] }),
      canonicalNode({ id: 'mid', acceptance: [criterion('MID-01', 'Middle.')], dependsOn: ['upstream'] }),
      canonicalNode({ id: 'consumer', acceptance: [criterion('CON-01', 'Output.')], dependsOn: ['mid'] }),
      canonicalNode({ id: 'side', acceptance: [criterion('SIDE-01', 'Side.')] }),
      canonicalNode({ id: 'integration', kind: 'integration', roles: ['research_integration_editor'], acceptance: [criterion('INT-01', 'Final.')], dependsOn: ['consumer', 'side'] }),
    ],
  })
  const receipts = { upstream: H('f'), mid: H('0'), consumer: H('1'), side: H('2'), integration: H('3') }
  const multiState = projectState({
    projectId: multiId,
    nodes: Object.fromEntries(multiPlan.nodes.map((n) => [n.id, {
      status: 'done', issueId: n.id + '-issue', identifier: n.id.toUpperCase(), url: 'https://example.invalid/' + n.id, linearState: 'Done',
      runDir: 'runs/' + n.id, runStatus: 'complete', currentStep: 'complete', currentPass: 0, hasFinal: true, finalCommentId: n.id + '-comment',
      receipts: [receipts[n.id]], causalHolds: [], nodeRevision: 1, linearProjection: null, projectionStatus: 'none', updatedAt: '',
    }])),
    integration: { epoch: 2, lastKnownGood: { manifestDigest: M, inputDigest: I, publishedAt: '2026-01-01T00:00:00.000Z', runId: 'int-run' }, feedback: [] },
  })
  await fs.mkdir(path.join(multiDir, 'revision-requests'), { recursive: true })
  await fs.writeFile(path.join(multiDir, 'plan.json'), JSON.stringify(multiPlan, null, 2) + '\n')
  await fs.writeFile(path.join(multiDir, 'state.json'), JSON.stringify(multiState, null, 2) + '\n')

  const registered2 = new Map()
  const fileService2 = {
    async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
    async readText(target) { return await fs.readFile(target, 'utf8') },
    async writeText(target, content, options = {}) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined) },
    async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
    async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
  }
  const subprocess2 = {
    async resolveExecutable(name) { return name },
    spawn(options) {
      if (options.argv[0] === '/bin/mkdir') { fs.mkdir(options.argv.at(-1), { recursive: true }); return { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { async readFrom() { return { text: '' } } }, stderr: { async readFrom() { return { text: '' } } } } } }
      throw new Error('unexpected subprocess call: ' + options.argv.join(' '))
    },
  }
  orchestrator.apply({
    get(name) {
      if (name === 'fs') return fileService2
      if (name === 'subprocess') return subprocess2
      if (name === 'tools') return { register(definition) { registered2.set(definition.name, definition) } }
      return undefined
    },
  })
  const invoke2 = (name, args) => registered2.get(name).execute(args, exec)

  const sub = await invoke2('autoresearch_submit_feedback', {
    projectId: multiId, feedback: 'Both the input and the middle sections are wrong.', baseInputDigest: I, baseManifestDigest: M,
  })
  assert.equal(sub.ok, true)
  assert.equal(sub.userAuthority, 'granted')
  const items = [
    { id: 'f1', classification: 'substantive', ownerNodeIds: ['upstream'], affectedCriteria: ['UP-01'], affectedContributionIds: [], requiredChange: 'Fix the input.', acceptanceChecks: ['UP-01'] },
    { id: 'f2', classification: 'substantive', ownerNodeIds: ['mid'], affectedCriteria: ['MID-01'], affectedContributionIds: [], requiredChange: 'Fix the middle.', acceptanceChecks: ['MID-01'] },
    { id: 'f3', classification: 'editorial', ownerNodeIds: [], requiredChange: 'Polish.' },
  ]
  const triage = await invoke2('autoresearch_record_feedback_triage', {
    projectId: multiId, feedbackId: sub.record.digest, decision: 'reopen', items, targetNodeIds: ['mid', 'upstream'], rationale: 'Two owners.',
  })
  assert.equal(triage.ok, true)

  const multi = await invoke2('autoresearch_revision_request', {
    projectId: multiId, nodeId: 'integration', nodeIds: ['mid', 'upstream'], feedbackId: triage.feedback.digest,
  })
  assert.equal(multi.ok, true)
  assert.equal(multi.created, true)
  assert.deepEqual(multi.targets, ['mid', 'upstream'], 'targets are sorted')
  assert.deepEqual(multi.closure, ['consumer', 'integration', 'mid', 'upstream'], 'the side branch is outside the smallest closure')
  assert.deepEqual(multi.resetNodes, ['consumer', 'integration', 'mid', 'upstream'])
  assert.equal(multi.epochBefore, 2)
  assert.equal(multi.epochAfter, 3, 'the integration epoch bumped in the same transaction')
  assert.equal(multi.requests.length, 2)
  const byNode = Object.fromEntries(multi.requests.map((request) => [request.nodeId, request]))
  assert.equal(byNode.mid.supersedes[0], receipts.mid)
  assert.equal(byNode.upstream.supersedes[0], receipts.upstream)

  const multiAfter = JSON.parse(await fs.readFile(path.join(multiDir, 'state.json'), 'utf8'))
  assert.equal(multiAfter.integration.epoch, 3)
  assert.equal(multiAfter.nodes.mid.status, 'todo')
  assert.equal(multiAfter.nodes.upstream.status, 'todo')
  assert.equal(multiAfter.nodes.mid.nodeRevision, 2)
  assert.equal(multiAfter.nodes.upstream.nodeRevision, 2)
  assert.equal(multiAfter.nodes.consumer.nodeRevision, 1, 'dependents do not bump nodeRevision')
  assert.deepEqual(multiAfter.nodes.consumer.causalHolds.map((hold) => hold.blockedBy), [['mid', 'upstream']], 'dependents hold the full blocker set')
  assert.deepEqual(multiAfter.nodes.integration.causalHolds.map((hold) => hold.blockedBy), [['mid', 'upstream']])
  assert.equal(multiAfter.nodes.side.status, 'done', 'nodes outside the closure are preserved')
  assert.equal(multiAfter.nodes.side.receipts[0], receipts.side)

  // Minimal closure: the triage-derived set is the only accepted set.
  let rejected = ''
  try {
    await invoke2('autoresearch_revision_request', { projectId: multiId, nodeId: 'integration', nodeIds: ['mid'], feedbackId: triage.feedback.digest })
  } catch (error) {
    rejected = error.message
  }
  assert.match(rejected, /exactly/, 'an underset reopen set is refused')

  const multiReplay = await invoke2('autoresearch_revision_request', {
    projectId: multiId, nodeId: 'integration', nodeIds: ['mid', 'upstream'], feedbackId: triage.feedback.digest,
  })
  assert.equal(multiReplay.created, false, 'replay converges after the epoch advanced')
  assert.equal(multiReplay.epochAfter, 3, 'replay does not bump the epoch again')
  assert.deepEqual(multiReplay.resetNodes, [], 'replay does not reset state again')
  const multiAfterReplay = JSON.parse(await fs.readFile(path.join(multiDir, 'state.json'), 'utf8'))
  assert.equal(multiAfterReplay.nodes.mid.nodeRevision, 2, 'no double revision bump on replay')
  assert.equal(multiAfterReplay.nodes.side.status, 'done')
}

await fs.rm(baseDir, { recursive: true, force: true })
console.log('revision request wiring passed for generation ' + manifest.generation)
