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

// ── 11. Linear storage normalization: stored `* ` bullets still parse ───────
// Linear normalizes list bullets to `* ` in stored issue descriptions while
// GFM task-list items (`- [ ]` / `- [x]`) survive. A block read back from
// Linear is therefore a MIX of both tokens. Accepting only `- ` made every
// stored block block-malformed, which failed the read-back/digest
// confirmation and left linear_get_node_context reporting context-missing
// even though the issue carried a well-formed block. The bullet token is not
// owned content, so both forms must rebuild the same state and digest — and
// that tolerance must not weaken the tamper gates.
{
  const rendered = core.renderContextBlock(richState)
  // Exactly what Linear does: list bullets become `* `, task-list items stay.
  const stored = rendered.replace(/^- (?!\[[ x]\])/gm, '* ')
  assert.notEqual(stored, rendered, 'fixture sanity: the stored form uses `* ` bullets')
  assert.ok(stored.includes('* Status: In progress'), 'visible headers arrive with `* `')
  assert.ok(stored.includes('- [ ] w2: Run the sensitivity analysis'), 'GFM task-list items survive verbatim')

  const parsed = core.parseContextBlock(stored)
  assert.equal(parsed.ok, true, 'a block stored by Linear must parse: ' + (parsed.reason ?? ''))
  assert.deepEqual(parsed.state, core.normalizeContextState(richState), 'the bullet token is not owned content')
  assert.equal(core.contextBlockDigest(parsed.state), core.contextBlockDigest(richState), 'the digest is unchanged by the bullet token')
  assert.equal(core.renderContextBlock(parsed.state), rendered, 're-rendering restores the canonical `- ` form')

  // Mixed tokens inside one block parse the same way: the gate is per line.
  const mixed = rendered.replace('- Status: In progress', '* Status: In progress').replace('- beta (meta: issue: ISS-9; relation: blocks): needs the base rate', '* beta (meta: issue: ISS-9; relation: blocks): needs the base rate')
  assert.notEqual(mixed, rendered, 'fixture sanity: two stored-form lines were rewritten')
  assert.equal(core.parseContextBlock(mixed).ok, true, 'mixed `- `/`* ` tokens parse')
  assert.equal(core.contextBlockDigest(core.parseContextBlock(mixed).state), core.contextBlockDigest(richState))

  // Placeholder and next-action sentinels are recognized in the stored form.
  const emptyState = core.normalizeContextState({
    ...richState, completed: [], findings: [], requiredRevisions: [], remaining: [], dependencies: [], nextAction: null,
  })
  const storedEmpty = core.renderContextBlock(emptyState).replace(/^- /gm, '* ')
  assert.ok(storedEmpty.includes('* (none yet)') && storedEmpty.includes('* (none)') && storedEmpty.includes('* (none recorded)'))
  const parsedEmpty = core.parseContextBlock(storedEmpty)
  assert.equal(parsedEmpty.ok, true, 'an empty stored block parses')
  assert.equal(parsedEmpty.state.nextAction, null, '`* (none recorded)` is the empty next action, not an item')
  assert.deepEqual(parsedEmpty.state.completed, [], '`* (none yet)` is the empty placeholder, not an item')

  // The tolerance must not weaken the gates: tamper is still rejected in the
  // stored form as well.
  const tamperedVisible = stored.replace('* Objective: Deliver the analysis section', '* Objective: Deliver a different analysis section')
  assert.notEqual(tamperedVisible, stored, 'fixture sanity: the objective was rewritten')
  assert.equal(core.parseContextBlock(tamperedVisible).reason, 'digest-mismatch', 'stored-form tamper is not absorbed by the tolerance')
  const tamperedItem = stored.replace('* f1: Source A disagrees on the rate', '* f1: Source A disagrees on the rate\n* zz: added by someone else')
  const itemResult = core.parseContextBlock(tamperedItem)
  assert.equal(itemResult.reason, 'digest-mismatch', 'an added stored-form bullet rotates the digest')
  assert.ok(itemResult.state.findings.some((item) => item.id === 'zz'), 'the conflicting item is visible for inspection')
  assert.equal(core.parseContextBlock(stored.replace('* beta (meta: issue: ISS-9; relation: blocks): needs the base rate', 'beta without a bullet')).reason, 'block-malformed', 'a non-bullet section line stays malformed')
  assert.equal(core.parseContextBlock(storedEmpty.replace('* (none yet)', 'a stray prose line')).reason, 'block-malformed', 'a non-bullet line in a placeholder section stays malformed')
  assert.equal(core.parseContextBlock(stored.replace('* Status: In progress', 'Status: In progress')).reason, 'block-malformed', 'a header without its bullet stays malformed')
  assert.equal(core.parseContextBlock(stored.replace('- [ ] w2: Run the sensitivity analysis', '* [x] w2: Run the sensitivity analysis')).reason, 'block-malformed', 'a stored checkbox toggle still invalidates the block')
}

// ── 12. a verbatim stored block (mix of both bullet tokens) ─────────────────
// Test 11 derives the stored form from the renderer, so it would keep passing
// if the tolerance regressed together with the renderer. This block is written
// out literally in the shape Linear stores — `* ` bullets, GFM `- [ ]`
// task-list items that survive normalization, `* (none)` placeholders — and is
// SELF-VALIDATING: the signed digest is checked against the rebuilt state and
// the block is checked against its canonical render, so a fixture that stopped
// matching the grammar (or a parser that stopped accepting `* `) fails loudly
// instead of quietly testing nothing.
{
  const storedText = [
    '<!-- autoresearch-context-block:start -->',
    'node: alpha',
    'context-digest: 78261b0116c7171d32e97f9cdfd8dad7a242425e82df4946ee6c5b4949ae84ab',
    'watermark: 2026-09-01T00:00:00.000Z',
    'last-verified: 2026-09-01T01:00:00.000Z ' + digest64('b'),
    'contract-plan-revision: 1',
    'contract-node-revision: 2',
    'contract-digest: ' + digest64('c'),
    'evidence-refs: [{"hash":"' + digest64('a') + '","kind":"file","ref":"out/draft.md"}]',
    '',
    '## AutoResearch Current Node Context',
    '',
    '* Status: In progress',
    '* Objective: Deliver the analysis section',
    '* Contract revision: plan 1 / node 2 (digest ' + digest64('c').slice(0, 12) + '...)',
    '* Last verified: 2026-09-01T01:00:00.000Z',
    '',
    '### Completed',
    '',
    '* [x] w1: Draft outline - evidence: draft.md (run-1)',
    '',
    '### Current Findings',
    '',
    '* f1: Source A disagrees on the rate - evidence: user:c-123',
    '',
    '### Required Revisions',
    '',
    '* rev-1: Missing error bars (meta: source: user; affected: accuracy; change: add confidence intervals)',
    '',
    '### Remaining Work',
    '',
    '- [ ] w2: Run the sensitivity analysis',
    '',
    '### Dependencies and Holds',
    '',
    '* beta (meta: issue: ISS-9; relation: blocks): needs the base rate',
    '',
    '### Next Action',
    '',
    '* Finish sensitivity analysis (meta: owner: research_author; expected output: sensitivity.md; acceptance: table present)',
    '<!-- autoresearch-context-block:end -->',
  ].join('\n')
  const result = core.parseContextBlock(storedText)
  assert.equal(result.ok, true, 'the stored fixture must parse: ' + (result.reason ?? ''))
  // Self-validation, two ways: the digest that was signed is the digest of the
  // rebuilt state, and the block is the canonical render of that state modulo
  // the bullet token. A hand-edited fixture cannot satisfy both.
  assert.equal(core.contextBlockDigest(result.state), '78261b0116c7171d32e97f9cdfd8dad7a242425e82df4946ee6c5b4949ae84ab', 'the fixture digest must match the rebuilt state')
  const structural = (text) => text.split('\n').map((line) => line.trim().replace(/^\* /, '- ')).filter((line) => line !== '').join('\n')
  assert.equal(structural(storedText), structural(core.renderContextBlock(result.state)), 'the fixture is the canonical block rendered with `* ` bullets')
  // Both tokens are one grammar: `* [x]` completed items and the interleaved
  // GFM `- [ ]` remaining items both contribute real items.
  assert.equal(result.state.completed[0].id, 'w1', 'a `* [x]` completed item parses')
  assert.equal(result.state.remaining[0].id, 'w2', 'a `- [ ]` remaining item parses')
  assert.equal(result.state.findings[0].evidence, 'user:c-123', 'evidence survives the stored form')
  assert.deepEqual(result.state.requiredRevisions[0].affectedCriteria, ['accuracy'], 'the meta group survives the stored form')
  assert.equal(result.state.dependencies[0].relation, 'blocks', 'a dependency with a meta group parses')
  assert.equal(result.state.nextAction.expectedOutput, 'sensitivity.md', 'the next-action meta group parses')
  // A write → store → read cycle keeps signing the same digest.
  assert.ok(core.renderContextBlock(result.state).includes('context-digest: 78261b0116c7171d32e97f9cdfd8dad7a242425e82df4946ee6c5b4949ae84ab'))
}

console.log('linear node context core tests passed for generation ' + manifest.generation)
