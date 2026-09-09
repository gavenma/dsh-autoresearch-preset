// Phase 4 (Linear-first node context, plan §7) — pure core tests:
//   - the owned Current Node Context block renders, parses, and round-trips
//     losslessly; the digest binds the owned content and stays stable across
//     re-verification (lastVerified is volatile);
//   - machine-line or visible-section tamper → digest-mismatch with the parsed
//     state returned for conflict inspection (never a silent overwrite);
//   - upsertContextBlock replaces only the owned block and preserves
//     user-authored text;
//   - NodeWorkContext is composed from Linear-only data (state.json absent)
//     and returns context-missing rather than guessing;
//   - evidence events are a closed, digest-bound shape with an idempotency
//     marker;
//   - normalization is closed-shape with field-specific errors.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { core } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))

const digest64 = (c) => c.repeat(64)

const richState = {
  kind: 'node-context',
  nodeId: 'alpha',
  status: 'in_progress',
  objective: 'Deliver the analysis section',
  contract: { planRevision: 1, nodeRevision: 2, contractDigest: digest64('c') },
  completed: [
    { id: 'w1', text: 'Draft outline', evidence: 'draft.md (run-1)' },
  ],
  findings: [{ id: 'f1', text: 'Source A disagrees on the rate', evidence: 'user:c-123' }],
  requiredRevisions: [{ id: 'rev-1', reason: 'Missing error bars', source: 'user', affectedCriteria: ['accuracy'], requiredChange: 'add confidence intervals' }],
  remaining: [{ id: 'w2', text: 'Run the sensitivity analysis' }],
  dependencies: [{ nodeId: 'beta', issueId: 'ISS-9', relation: 'blocks', why: 'needs the base rate' }],
  nextAction: { text: 'Finish sensitivity analysis', owner: 'research_author', expectedOutput: 'sensitivity.md', acceptanceCheck: 'table present' },
  evidenceRefs: [{ ref: 'out/draft.md', hash: digest64('a'), kind: 'file' }],
  watermark: '2026-09-01T00:00:00.000Z',
  lastVerified: { at: '2026-09-01T01:00:00.000Z', contextDigest: digest64('b') },
}

// ── 1. render → parse → render round-trip ───────────────────────────────────
{
  const rendered = core.renderContextBlock(richState)
  assert.ok(rendered.startsWith(core.CONTEXT_BLOCK_START))
  assert.ok(rendered.endsWith(core.CONTEXT_BLOCK_END))
  const digest = core.contextBlockDigest(richState)
  assert.match(rendered, new RegExp('context-digest: ' + digest))
  const parsed = core.parseContextBlock(rendered)
  assert.equal(parsed.ok, true, 'renderer output must parse back losslessly')
  assert.deepEqual(parsed.state, core.normalizeContextState(richState))
  assert.equal(core.contextBlockDigest(parsed.state), digest)
  assert.equal(core.renderContextBlock(parsed.state), rendered, 'the render is stable on the parsed state')
  // The block is human-readable point form (gate G10): visible sections, no
  // machine junk in the body.
  for (const heading of ['## AutoResearch Current Node Context', '### Completed', '### Current Findings', '### Required Revisions', '### Remaining Work', '### Dependencies and Holds', '### Next Action']) {
    assert.ok(parsed.blockText.includes(heading), 'visible section present: ' + heading)
  }
  assert.ok(parsed.blockText.includes('- [x] w1: Draft outline'), 'completed item is point-form')
  assert.ok(parsed.blockText.includes('- [ ] w2: Run the sensitivity analysis'), 'remaining item is point-form')
}

// ── 2. digest stability across lastVerified (idempotent re-verification) ───
{
  const digest1 = core.contextBlockDigest(richState)
  const digest2 = core.contextBlockDigest({ ...richState, lastVerified: { at: '2026-09-02T00:00:00.000Z', contextDigest: digest64('f') } })
  assert.equal(digest1, digest2, 're-verification without content change keeps the digest stable')
  const digest3 = core.contextBlockDigest({ ...richState, remaining: [{ id: 'w2', text: 'Run the sensitivity analysis (twice checked)' }] })
  assert.notEqual(digest3, digest1, 'a content change rotates the digest')
}

// ── 3. machine-line tamper → digest-mismatch with the parsed state ─────────
{
  const rendered = core.renderContextBlock(richState)
  const tampered = rendered.replace('watermark: 2026-09-01T00:00:00.000Z', 'watermark: 2026-08-01T00:00:00.000Z')
  const result = core.parseContextBlock(tampered)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'digest-mismatch')
  assert.ok(result.state, 'the parsed state is returned for conflict inspection')
  assert.equal(result.state.watermark, '2026-08-01T00:00:00.000Z')
  assert.match(result.actual, /^[0-9a-f]{64}$/)
  assert.match(result.expected, /^[0-9a-f]{64}$/)
  assert.notEqual(result.actual, result.expected)
}

// ── 4. user-visible tamper (extra completed line) → digest-mismatch ─────────
{
  const rendered = core.renderContextBlock(richState)
  const tampered = rendered.replace('- [x] w1: Draft outline - evidence: draft.md (run-1)', '- [x] w1: Draft outline - evidence: draft.md (run-1)\n- [x] zz: Added by someone else')
  assert.notEqual(tampered, rendered, 'fixture sanity: the replacement happened')
  const result = core.parseContextBlock(tampered)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'digest-mismatch')
  assert.ok(result.state.completed.some((item) => item.id === 'zz'), 'the conflicting item is visible in the parsed state')
}

// ── 5. structural malformation → block-malformed / field-invalid ───────────
{
  assert.equal(core.parseContextBlock('').reason, 'block-missing')
  assert.equal(core.parseContextBlock('# just an issue').reason, 'block-missing')
  assert.equal(core.parseContextBlock(core.CONTEXT_BLOCK_START + '\nnode: alpha\n' + core.CONTEXT_BLOCK_END).reason, 'block-malformed')
  const rendered = core.renderContextBlock(richState)
  const badStatus = rendered.replace('- Status: In progress', '- Status: Flying')
  const result = core.parseContextBlock(badStatus)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'field-invalid')
  assert.match(result.error, /invalid node context field status/)
}

// ── 6. upsert replaces only the owned block ─────────────────────────────────
{
  const userText = '# My issue\n\nSome user-authored notes.\n\n- a user bullet\n'
  const first = userText + core.renderContextBlock(richState)
  const nextBlock = core.renderContextBlock({ ...core.normalizeContextState(richState), status: 'done', remaining: [] })
  const second = core.upsertContextBlock(first, nextBlock)
  assert.equal(second.startsWith(userText), true, 'user text before the block is preserved')
  assert.equal(second.split('# My issue').length, 2, 'user text is not duplicated')
  const reparsed = core.parseContextBlock(second)
  assert.equal(reparsed.ok, true)
  assert.equal(reparsed.state.status, 'done')
  assert.equal(reparsed.state.remaining.length, 0)
  // Appending into a description that carries no block.
  const appended = core.upsertContextBlock('intro only', core.renderContextBlock(richState))
  assert.ok(appended.startsWith('intro only'))
  assert.equal(core.parseContextBlock(appended).ok, true)
  // Empty description becomes exactly the block.
  assert.equal(core.upsertContextBlock('', core.renderContextBlock(richState)), core.renderContextBlock(richState))
}

// ── 7. NodeWorkContext from Linear-only data (state.json absent) ────────────
{
  const specBlock = core.renderSpecBlock({
    projectId: 'proj', planRevision: 1, nodeRevision: 2, digest: digest64('c'), nodeId: 'alpha',
    kind: 'research', artifactFormat: 'tex', roles: ['research_author'], effectiveBudget: {},
  })
  const description = specBlock + '\n\n' + core.renderContextBlock(richState) + '\n\nUser notes stay here.'
  const issue = {
    id: 'ISS-7', identifier: 'AR-7', title: 'Alpha node', url: 'https://linear.invalid/AR-7',
    description, state: { id: 'ip', name: 'In Progress', type: 'started' },
  }
  const comments = [
    { id: 'c1', body: 'autoresearch-causal: AR-7 blocked by ISS-8 (upstream receipt invalid)', createdAt: '2026-09-02T00:00:00.000Z' },
    { id: 'c2', body: 'Please add error bars to the figure.\nMore detail.', createdAt: '2026-09-03T00:00:00.000Z' },
    { id: 'c3', body: 'old note from before the watermark', createdAt: '2026-08-01T00:00:00.000Z' },
  ]
  const relations = { relations: [{ id: 'r1', type: 'blocks' }], inverseRelations: [] }
  const composed = core.composeNodeWorkContext({
    issue,
    contextBlock: core.parseContextBlock(description),
    specBlock: core.parseSpecBlock(description),
    comments,
    relations,
    evidenceStatus: [{ ref: 'out/draft.md', status: 'verified' }],
    drift: [],
  })
  assert.equal(composed.status, 'ok')
  assert.equal(composed.nodeId, 'alpha')
  assert.equal(composed.freshness.contextDigest, core.contextBlockDigest(richState))
  assert.equal(composed.freshness.newComments, 2, 'marker and human comments newer than the watermark')
  assert.equal(composed.freshness.newHumanComments, 1, 'the autoresearch-causal marker is not human input')
  assert.equal(composed.contract.nodeId, 'alpha')
  assert.equal(composed.contract.contractDigest, digest64('c'))
  assert.deepEqual(composed.evidenceStatus, [{ ref: 'out/draft.md', status: 'verified' }])
  for (const heading of ['## Completed', '## Current Evidence and Findings', '## Why Open or Reopened', '## Unresolved Human Input', '## Exact Remaining Work', '## Dependencies and Holds', '## Exact Next Action', '## Evidence Integrity']) {
    assert.ok(composed.markdown.includes(heading), 'markdown section present: ' + heading)
  }
  assert.match(composed.markdown, /out\/draft\.md: verified/)
  assert.match(composed.markdown, /Please add error bars to the figure\./)
  assert.ok(!composed.markdown.includes(core.CONTEXT_BLOCK_START), 'the machine block is not dumped into the work context')
}

// ── 8. context-missing rather than guess ────────────────────────────────────
{
  const issue = { id: 'ISS-8', identifier: 'AR-8', title: 'No block', description: '# Just a user description', state: { id: 'todo', name: 'Todo', type: 'unstarted' } }
  const missing = core.composeNodeWorkContext({
    issue,
    contextBlock: core.parseContextBlock(issue.description),
    specBlock: core.parseSpecBlock(core.renderSpecBlock({ projectId: 'p', planRevision: 1, nodeRevision: 1, digest: digest64('c'), nodeId: 'gamma', kind: 'research', artifactFormat: 'tex', roles: [], effectiveBudget: {} })),
    comments: [],
    relations: { relations: [], inverseRelations: [] },
    evidenceStatus: [],
    drift: ['the issue carries a node contract but no valid Current Node Context block; initialize it from the contract and latest comments'],
  })
  assert.equal(missing.status, 'context-missing')
  assert.equal(missing.context, null)
  assert.equal(missing.freshness.contextDigest, '')
  assert.match(missing.markdown, /CONTEXT MISSING/)
  assert.match(missing.markdown, /repair it from the latest verified Linear comments and contract/)
  assert.ok(missing.markdown.includes('initialize it from the contract and latest comments'))
}

// ── 9. evidence events: closed shape, digest binding, idempotency marker ───
{
  assert.equal(core.EVIDENCE_EVENT_TYPES.length, 11)
  const event = core.makeEvidenceEvent({
    projectId: 'proj', nodeId: 'alpha', type: 'acceptance-passed', summary: 'Acceptance loop passed',
    evidence: ['out/final.pdf', 'linear:AR-7'], at: '2026-09-04T00:00:00.000Z',
  })
  assert.match(event.digest, /^[0-9a-f]{64}$/)
  assert.deepEqual(core.normalizeEvidenceEvent(event), event, 'a well-formed event normalizes to itself')
  assert.throws(() => core.normalizeEvidenceEvent({ ...event, summary: 'tampered' }), /evidence event digest mismatch/)
  assert.throws(() => core.normalizeEvidenceEvent({ ...event, extra: 1 }), /not part of the event shape/)
  assert.throws(() => core.makeEvidenceEvent({ projectId: 'p', nodeId: 'n', type: 'not-a-type', summary: 'x' }), /unknown evidence event type/)
  const comment = core.renderEvidenceComment(event)
  assert.equal(comment.marker, core.EVIDENCE_COMMENT_MARKER_PREFIX + event.digest)
  assert.equal(comment.idempotencyMarker, comment.marker)
  assert.ok(comment.body.startsWith(core.EVIDENCE_COMMENT_MARKER_PREFIX + event.digest + '\n'), 'the marker is the first line')
  assert.match(comment.body, /## AutoResearch: /)
  assert.match(comment.body, /- Event digest: `/)
  assert.match(comment.body, /- Node: `alpha`/)
  // The marker is invisible to the human-input filter in the reducer.
  const reduced = core.reduceNodeContext(core.normalizeContextState(richState), {
    userComments: [{ id: 'c9', body: comment.body, createdAt: '2026-09-05T00:00:00.000Z' }],
    now: '2026-09-05T00:00:01.000Z',
  })
  assert.ok(!reduced.state.findings.some((item) => item.id === 'user-c9'), 'a marker comment is never unresolved human input')
}

// ── 10. closed-shape normalization with field-specific errors ───────────────
{
  assert.throws(() => core.normalizeContextState({ ...richState, extraField: 1 }), /invalid node context field extraField/)
  assert.throws(() => core.normalizeContextState({ ...richState, status: 'nope' }), /invalid node context field status/)
  assert.throws(() => core.normalizeContextState({ ...richState, nodeId: '' }), /invalid node context field nodeId/)
  assert.throws(() => core.normalizeContextState({ ...richState, contract: { planRevision: -1 } }), /invalid node context field contract\.planRevision/)
  assert.throws(() => core.normalizeContextState({ ...richState, remaining: [{ id: '', text: 'x' }] }), /invalid node context field remaining/)
  assert.throws(() => core.normalizeContextState({ ...richState, lastVerified: 'a string' }), /invalid node context field lastVerified/)
  const folded = core.normalizeContextState({ ...richState, completed: [{ id: 'w1', text: 'line one\nline two', evidence: '' }] })
  assert.equal(folded.completed[0].text, 'line one line two', 'bullet text folds newlines so the block stays single-line')
  assert.ok(core.isContextDigest(digest64('a')))
  assert.ok(!core.isContextDigest('abc'))
  assert.ok(!core.isContextDigest(digest64('a').slice(0, 63)))
}

console.log('linear node context core tests passed for generation ' + manifest.generation)
