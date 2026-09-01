import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

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

console.log('causal core and parser tests passed for generation ' + manifest.generation)
