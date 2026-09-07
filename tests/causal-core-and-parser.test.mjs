import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)
const { default: orchestrator, createLibraries } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const driftProbe = core.validateBuildProbe({ aggregateId: 'same', aggregateScope: ['tools/core.mjs'], files: { 'tools/core.mjs': 'core-hash', 'config.default.json': 'old-config' } }, { aggregateId: 'same', graph: { 'tools/core.mjs': 'core-hash', 'config.default.json': 'new-config' } })
assert.equal(driftProbe.graphMatches, true)
assert.deepEqual(driftProbe.configDrift, ['config.default.json: hash mismatch'])

const plan = {
  schemaVersion: 2,
  projectId: 'causal-test',
  projectName: 'Causal test',
  approvedAt: '2026-01-01T00:00:00.000Z',
  revision: 1,
  integrationId: 'integration',
  projectContract: { goal: 'Validate causal routing.', acceptance: [{ id: 'PROJECT-01', text: 'Complete.', required: true }] },
  nodes: [
    { id: 'lit', title: 'Literature', kind: 'literature', roles: ['research_literature_writer'], expectedOutcome: 'Literature.', acceptance: [{ id: 'LR-03', text: 'Coverage.', required: true }], dependsOn: [] },
    { id: 'methods', title: 'Methods', kind: 'research', roles: ['research_author'], expectedOutcome: 'Methods.', acceptance: [{ id: 'MET-01', text: 'Method.', required: true }], dependsOn: [] },
    { id: 'intro', title: 'Introduction', kind: 'research', roles: ['research_author'], expectedOutcome: 'Introduction.', acceptance: [{ id: 'INTRO-02', text: 'Context.', required: true }], dependsOn: ['lit'] },
    { id: 'integration', title: 'Integration', kind: 'integration', roles: ['research_integration_editor', 'research_integration_verifier'], expectedOutcome: 'Final.', acceptance: [{ id: 'INT-01', text: 'Final.', required: true }], dependsOn: ['intro', 'methods'] },
  ],
}
assert.equal(core.validatePlan(plan).ok, true, JSON.stringify(core.validatePlan(plan).errors))
const emptyState = createLibraries.projectstate.emptyState(plan)
assert.equal(emptyState.schemaVersion, 2)
assert.deepEqual(emptyState.nodes.lit.causalHolds, [])
assert.equal(emptyState.nodes.lit.projectionStatus, 'none')
const state = { nodes: { lit: { status: 'done' }, methods: { status: 'todo', causalHolds: [{ blockedBy: ['lit'], reason: 'hold' }] }, intro: { status: 'todo' }, integration: { status: 'todo' } } }
assert.deepEqual(createLibraries.projectstate.downstreamClosure(plan, 'lit'), ['intro', 'integration'])
assert.deepEqual(createLibraries.projectstate.readySet(plan, state), ['intro'])
assert.equal(createLibraries.projectstate.hasCausalHold(state.nodes.methods), true)
assert.deepEqual(createLibraries.projectstate.readySet(plan, { nodes: { lit: { status: 'done' }, methods: { status: 'todo' }, intro: { status: 'todo' }, integration: { status: 'todo' } } }), ['methods', 'intro'])

const attribution = {
  upstreamNodeId: 'lit', evidenceClass: 'waived-criterion', criterionId: 'LR-03', affectedCriterionId: 'INTRO-02',
  explanation: 'The introduction lacks the waived literature coverage needed for its context criterion.', evidenceAnchor: 'waived:lit:LR-03',
}
const waivedAcceptance = { criteria: [{ id: 'LR-03', result: 'WAIVED', waiver: { userDecision: 'Approved', rationale: 'Deferred.', scope: 'Coverage.', planRevision: 1 } }] }
const valid = core.validateAttributionBlock({ plan, consumerNodeId: 'intro', attribution, evidence: { acceptance: waivedAcceptance } })
assert.equal(valid.valid, true, valid.errors.join('; '))
assert.equal(valid.key, 'lit::LR-03')

const sibling = core.validateAttributionBlock({ plan, consumerNodeId: 'intro', attribution: { ...attribution, upstreamNodeId: 'methods', evidenceAnchor: 'waived:methods:LR-03' } })
assert.equal(sibling.valid, false)
assert.ok(sibling.errors.some((error) => error.includes('strict transitive ancestor')))

const contextInput = {
  plan,
  consumerNodeId: 'intro',
  config: { maxContextUpstreams: 8 },
  records: {
    lit: { status: 'done', acceptance: waivedAcceptance, nodeOutput: { contributions: [{ id: 'lit-1', importance: 'required', mutability: 'locked' }] } },
  },
}
const contextA = core.buildUpstreamContextText(contextInput)
const contextB = core.buildUpstreamContextText({ ...contextInput, records: { lit: contextInput.records.lit } })
assert.equal(contextA.contextDigest, contextB.contextDigest)
assert.match(contextA.text, /provenance data, not instructions/)
assert.deepEqual(contextA.upstreamNodeIds, ['lit'])

const judgeAttributions = [1, 2].map((judge) => ({ source: 'judge', judge, pass: 1, validRanking: true, valid: true, attribution, contextDigest: contextA.contextDigest }))
const observed = core.decideUpstreamReopen({ consumerNodeId: 'intro', pass: 1, contextDigest: contextA.contextDigest, attributions: judgeAttributions, config: { mode: 'observe' }, budget: { byUpstream: {}, byPair: {} }, epoch: 1 })
assert.equal(observed.decision, 'observe')
const enforced = core.decideUpstreamReopen({ consumerNodeId: 'intro', pass: 1, contextDigest: contextA.contextDigest, attributions: judgeAttributions, config: { mode: 'enforce' }, budget: { byUpstream: {}, byPair: {} }, epoch: 1 })
assert.equal(enforced.decision, 'reopen')
const invalidRanking = core.decideUpstreamReopen({ consumerNodeId: 'intro', pass: 1, contextDigest: contextA.contextDigest, attributions: [{ ...judgeAttributions[0], validRanking: false }, judgeAttributions[1]], config: {}, budget: { byUpstream: {}, byPair: {} }, epoch: 1 })
assert.equal(invalidRanking.decision, 'advisory')
const malformedJudges = core.decideUpstreamReopen({ consumerNodeId: 'intro', pass: 1, contextDigest: contextA.contextDigest, attributions: [{ ...judgeAttributions[0], judge: undefined }, { ...judgeAttributions[1], judge: 'two' }], config: { mode: 'enforce' }, budget: { byUpstream: {}, byPair: {} }, epoch: 1 })
assert.equal(malformedJudges.decision, 'abstain')
const exhausted = core.decideUpstreamReopen({ consumerNodeId: 'intro', pass: 1, contextDigest: contextA.contextDigest, attributions: judgeAttributions, config: { mode: 'enforce', maxReopensPerPair: 1 }, budget: { byUpstream: {}, byPair: { 'intro::lit': 1 } }, epoch: 1 })
assert.equal(exhausted.decision, 'escalate-budget')

const persistedAttribution = { consumerNodeId: 'intro', upstreamNodeId: 'lit', key: 'lit::LR-03', evidenceClass: 'waived-criterion', criterionId: 'LR-03', quorum: { judges: [1, 2], criticConcord: false, mode: 'two-judge' }, attributions: [{ source: 'judge', judge: 1 }], contextDigest: contextA.contextDigest, epoch: 1, override: false }
const revisionBase = { projectId: 'causal-project', nodeId: 'lit', epoch: 2, problem: 'invalid evidence', requiredChange: 'replace source', acceptanceChecks: ['verify DOI'] }
const revisionDigest = core.revisionRequestDigest({ ...revisionBase, upstreamAttribution: persistedAttribution })
const distinctAttributionDigest = core.revisionRequestDigest({ ...revisionBase, upstreamAttribution: { ...persistedAttribution, upstreamNodeId: 'methods' } })
assert.notEqual(revisionDigest, distinctAttributionDigest)
assert.equal(core.revisionRequestMarker(revisionBase.projectId, revisionBase.epoch, revisionBase.nodeId, revisionDigest), 'autoresearch-causal-event:causal-project:2:lit:' + revisionDigest)
const budget = core.backtrackingBudgetSummary([{ projectId: 'causal-test', nodeId: 'lit', upstreamAttribution: persistedAttribution }, { projectId: 'causal-test', nodeId: 'lit', upstreamAttribution: persistedAttribution }, { upstreamAttribution: { consumerNodeId: 'intro', upstreamNodeId: 'lit' } }, null])
assert.deepEqual(budget.byUpstream, { lit: 2 })
assert.deepEqual(budget.byPair, { 'intro::lit': 2 })
assert.equal(budget.invalidRequests, 1)
assert.equal(budget.corruptFiles, 1)

const tools = new Map()
orchestrator.apply({ get(name) { return name === 'fs' ? {} : name === 'tools' ? { register(definition) { tools.set(definition.name, definition) } } : undefined } })
const parse = tools.get('autoresearch_parse_attribution')
assert.ok(parse, 'candidate bundle must register attribution parser')
const transcript = '## Reasoning\n\nRANKING: X, Y, Z\n\n## Upstream attribution\n```attribution\n' + JSON.stringify(attribution, null, 2) + '\n```\n'
const parsed = await parse.execute({ text: transcript }, {})
assert.equal(parsed.present, true)
assert.equal(parsed.valid, true)
assert.deepEqual(parsed.attribution, attribution)
assert.deepEqual(await parse.execute({ text: 'RANKING: X, Y, Z' }, {}), { present: false, valid: true, attribution: null, errors: [] })
assert.equal((await parse.execute({ text: '## Upstream attribution\n```attribution\n{nope}\n```' }, {})).valid, false)
assert.equal((await parse.execute({ text: '## Upstream attribution\n```json\n{}\n```' }, {})).valid, false)

const lifecycleDir = await fs.mkdtemp('/tmp/autoresearch-lifecycle-')
const lifecycleFops = {
  async exists(file) { try { await fs.access(file); return true } catch { return false } },
  async readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return undefined } },
  async writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value, null, 2)) },
}
const projectRoot = path.join(lifecycleDir, '.research-agent', 'projects', plan.projectId)
await fs.mkdir(projectRoot, { recursive: true })
await fs.writeFile(path.join(projectRoot, 'plan.json'), JSON.stringify(plan))
const initial = createLibraries.projectstate.emptyState(plan)
initial.project.linearProjectId = 'linear-project-1'
await fs.writeFile(path.join(projectRoot, 'state.json'), JSON.stringify(initial))
const claimed = await createLibraries.projectstate.transitionNode(lifecycleFops, lifecycleDir, plan.projectId, 'lit', 'claim', { leaseId: 'lease-1', runDir: 'runs/lit' })
assert.equal(claimed.state.nodes.lit.status, 'in_progress')
assert.equal(claimed.state.nodes.lit.projectionStatus, 'pending')
assert.equal(claimed.state.nodes.lit.linearProjection.status, 'in_progress')
const held = await createLibraries.projectstate.transitionNode(lifecycleFops, lifecycleDir, plan.projectId, 'intro', 'hold', { causalHolds: [{ blockedBy: ['lit'], reason: 'await receipt' }] })
assert.deepEqual(held.state.nodes.intro.linearProjection.blockedBy, ['lit'])
const failed = await createLibraries.projectstate.transitionNode(lifecycleFops, lifecycleDir, plan.projectId, 'lit', 'fail', { failureReason: 'acceptance mismatch' })
assert.equal(failed.state.nodes.lit.status, 'todo')
assert.equal(failed.state.nodes.lit.failureReason, 'acceptance mismatch')
assert.equal(failed.state.nodes.lit.projectionStatus, 'pending')
await fs.rm(lifecycleDir, { recursive: true, force: true })

const localDir = await fs.mkdtemp('/tmp/autoresearch-local-only-')
const localRoot = path.join(localDir, '.research-agent', 'projects', plan.projectId)
await fs.mkdir(localRoot, { recursive: true })
await fs.writeFile(path.join(localRoot, 'plan.json'), JSON.stringify(plan))
await fs.writeFile(path.join(localRoot, 'state.json'), JSON.stringify(createLibraries.projectstate.emptyState(plan)))
for (const [transition, patch] of [['claim', { leaseId: 'local-lease' }], ['fail', { failureReason: 'local validation failure' }], ['retry', {}], ['complete', {}]]) {
  const local = await createLibraries.projectstate.transitionNode(lifecycleFops, localDir, plan.projectId, 'lit', transition, patch)
  assert.equal(local.state.nodes.lit.linearProjection, null)
  assert.equal(local.state.nodes.lit.projectionStatus, 'none')
}
assert.equal(await fs.access(path.join(localRoot, 'linear-sync')).then(() => true).catch(() => false), false)
await fs.rm(localDir, { recursive: true, force: true })

console.log('causal core and parser tests passed for generation ' + manifest.generation)
