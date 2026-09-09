// Phase 4 (Linear-first node context, plan §7.5) — pure core tests for the
// deterministic context reducer:
//   - the same prior state and updates always yield the same state;
//   - completed items move from Remaining Work to Completed with the event
//     digest as evidence; superseded revisions are replaced, not appended;
//   - exactly one next action is kept;
//   - bounded sections drop the oldest entries (older detail stays in the
//     milestone comments, never concatenated into the block);
//   - the watermark advances to the newest consumed event/comment and ignores
//     older input;
//   - re-reducing with the same updates is a fixed point (crash replay safe).
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { core } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))

const basePrior = {
  kind: 'node-context',
  nodeId: 'alpha',
  status: 'todo',
  objective: 'Deliver the analysis section',
  contract: { planRevision: 1, nodeRevision: 1, contractDigest: 'c'.repeat(64) },
  completed: [],
  findings: [],
  requiredRevisions: [],
  remaining: [
    { id: 'w1', text: 'Draft the outline' },
    { id: 'w2', text: 'Run the sensitivity analysis' },
  ],
  dependencies: [],
  nextAction: { text: 'Start with the outline', owner: 'research_author', expectedOutput: 'outline.md', acceptanceCheck: 'outline reviewed' },
  evidenceRefs: [],
  watermark: '2026-09-01T00:00:00.000Z',
  lastVerified: null,
}

function event(type, extra = {}) {
  return core.makeEvidenceEvent({ projectId: 'proj', nodeId: 'alpha', type, at: '2026-09-02T00:00:00.000Z', ...extra })
}

// ── 1. determinism ──────────────────────────────────────────────────────────
{
  const updates = {
    events: [event('node-claimed'), event('test-build-completed', { completes: 'w1', summary: 'Build passed', evidence: ['build-1.log'] })],
    userComments: [{ id: 'c1', body: 'Check the units on figure 2', createdAt: '2026-09-02T01:00:00.000Z' }],
    now: '2026-09-02T02:00:00.000Z',
  }
  const first = core.reduceNodeContext(basePrior, updates)
  const second = core.reduceNodeContext(basePrior, updates)
  assert.deepEqual(first.state, second.state, 'the reducer is deterministic')
  assert.deepEqual(first.changes, second.changes)
  assert.equal(first.changed, true)
  assert.ok(Object.isFrozen(first.state), 'the reduced state is frozen')
  // The prior is not mutated.
  assert.equal(basePrior.remaining.length, 2)
}

// ── 2. completed movement + status transitions ─────────────────────────────
{
  const reduced = core.reduceNodeContext(basePrior, {
    events: [event('node-claimed'), event('test-build-completed', { completes: 'w1', summary: 'Build passed' })],
    now: '2026-09-02T02:00:00.000Z',
  })
  assert.equal(reduced.state.status, 'in_progress', 'node-claimed moves todo → in_progress')
  assert.deepEqual(reduced.state.remaining, [{ id: 'w2', text: 'Run the sensitivity analysis' }], 'the completed item leaves Remaining Work')
  assert.equal(reduced.state.completed.length, 1)
  assert.equal(reduced.state.completed[0].id, 'w1')
  assert.equal(reduced.state.completed[0].text, 'Draft the outline')
  assert.match(reduced.state.completed[0].evidence, /^[0-9a-f]{12}$/, 'the event digest is the recorded evidence')
  assert.ok(reduced.changes.some((line) => line.includes('w1') && line.includes('Completed')))
  // Completing an unknown id is a no-op, not an error.
  const unknown = core.reduceNodeContext(basePrior, {
    events: [event('test-build-completed', { completes: 'w-nope' })],
    now: '2026-09-02T02:00:00.000Z',
  })
  assert.equal(unknown.state.remaining.length, 2)
  assert.equal(unknown.state.completed.length, 0)
}

// ── 3. acceptance failure, reopen, and superseded revision replacement ─────
{
  const failed = core.reduceNodeContext(basePrior, {
    events: [event('node-claimed'), event('acceptance-failed', { summary: 'Figure units inconsistent', finding: 'units inconsistent in figure 2' })],
    now: '2026-09-02T02:00:00.000Z',
  })
  assert.equal(failed.state.status, 'failed')
  assert.equal(failed.state.findings.length, 1)
  assert.match(failed.state.findings[0].text, /units inconsistent/)

  const reopened = core.reduceNodeContext(failed.state, {
    events: [event('node-reopened', { completes: 'rev-1', summary: 'Fix the units before rerunning', requiredChange: 'correct the units' })],
    now: '2026-09-03T02:00:00.000Z',
  })
  assert.equal(reopened.state.status, 'in_progress', 'reopen moves failed → in_progress')
  assert.equal(reopened.state.requiredRevisions.length, 1)
  assert.equal(reopened.state.requiredRevisions[0].id, 'rev-1')
  assert.equal(reopened.state.requiredRevisions[0].requiredChange, 'correct the units')

  // A second reopen with the same revision id replaces the entry in place.
  const reopenedAgain = core.reduceNodeContext(reopened.state, {
    events: [event('node-reopened', { completes: 'rev-1', summary: 'Also check the axis labels', requiredChange: 'correct units and axis labels' })],
    now: '2026-09-04T02:00:00.000Z',
  })
  assert.equal(reopenedAgain.state.requiredRevisions.length, 1, 'superseded revision is replaced, not appended')
  assert.match(reopenedAgain.state.requiredRevisions[0].reason, /axis labels/)
  assert.equal(reopenedAgain.state.requiredRevisions[0].requiredChange, 'correct units and axis labels')

  // revision-completed resolves it; `completes` on a revision event must not
  // touch Remaining Work.
  const resolved = core.reduceNodeContext(reopenedAgain.state, {
    events: [event('revision-completed', { completes: 'rev-1', summary: 'Units and labels fixed' })],
    now: '2026-09-05T02:00:00.000Z',
  })
  assert.equal(resolved.state.requiredRevisions.length, 0, 'the resolved revision leaves the block')
  assert.equal(resolved.state.remaining.length, 2, 'revision events never move Remaining Work items')

  // user-feedback-received defaults the source to user and reopens a done node.
  const doneState = { ...core.normalizeContextState(basePrior), status: 'done' }
  const feedback = core.reduceNodeContext(doneState, {
    events: [event('user-feedback-received', { completes: 'rev-2', summary: 'The conclusion overstates the effect' })],
    now: '2026-09-06T02:00:00.000Z',
  })
  assert.equal(feedback.state.status, 'in_progress')
  assert.equal(feedback.state.requiredRevisions[0].source, 'user')
}

// ── 4. exactly one next action ──────────────────────────────────────────────
{
  const withAction = core.reduceNodeContext(basePrior, {
    events: [],
    nextAction: { text: 'Rerun the analysis with corrected units', owner: 'research_coder', expectedOutput: 'analysis-v2.md', acceptanceCheck: 'units verified' },
    now: '2026-09-02T02:00:00.000Z',
  })
  assert.equal(withAction.state.nextAction.text, 'Rerun the analysis with corrected units')
  const cleared = core.reduceNodeContext(withAction.state, {
    nextAction: null,
    now: '2026-09-02T03:00:00.000Z',
  })
  assert.equal(cleared.state.nextAction, null)
  // Without an explicit update the prior next action survives.
  const untouched = core.reduceNodeContext(basePrior, { now: '2026-09-02T02:00:00.000Z' })
  assert.equal(untouched.state.nextAction.text, 'Start with the outline')
}

// ── 5. bounds drop the oldest entries ───────────────────────────────────────
{
  const limit = core.CONTEXT_SECTION_LIMITS.findings
  const comments = Array.from({ length: limit + 3 }, (_, i) => ({
    id: 'c' + i,
    body: 'Human note ' + i,
    createdAt: '2026-09-03T00:' + String(i).padStart(2, '0') + ':00.000Z',
  }))
  const reduced = core.reduceNodeContext(basePrior, { userComments: comments, now: '2026-09-03T01:00:00.000Z' })
  assert.equal(reduced.state.findings.length, limit, 'findings stay bounded')
  assert.ok(!reduced.state.findings.some((item) => item.id === 'user-c0'), 'the oldest entry was dropped')
  assert.ok(reduced.state.findings.some((item) => item.id === 'user-c' + (limit + 2)), 'the newest entry is kept')
}

// ── 6. watermark advance; older input is ignored ────────────────────────────
{
  const reduced = core.reduceNodeContext(basePrior, {
    events: [event('node-claimed')],
    userComments: [
      { id: 'old', body: 'before the watermark', createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 'new', body: 'after the watermark', createdAt: '2026-09-02T01:30:00.000Z' },
    ],
    now: '2026-09-02T02:00:00.000Z',
  })
  assert.equal(reduced.state.watermark, '2026-09-02T01:30:00.000Z', 'the watermark advances to the newest consumed comment')
  assert.ok(!reduced.state.findings.some((item) => item.id === 'user-old'), 'a comment older than the watermark is not re-ingested')
  assert.ok(reduced.state.findings.some((item) => item.id === 'user-new'))
  // The event at (00:00) is older than the comment — it must not regress the watermark.
  const eventOnly = core.reduceNodeContext(basePrior, {
    events: [event('node-claimed')],
    now: '2026-09-02T02:00:00.000Z',
  })
  assert.equal(eventOnly.state.watermark, '2026-09-02T00:00:00.000Z')
}

// ── 7. idempotent re-reduce (crash replay is a fixed point) ─────────────────
{
  const updates = {
    events: [
      event('node-claimed'),
      event('test-build-completed', { completes: 'w1', summary: 'Build passed' }),
      event('node-reopened', { completes: 'rev-1', summary: 'Fix the units', requiredChange: 'correct the units' }),
    ],
    userComments: [{ id: 'c1', body: 'Check the units on figure 2', createdAt: '2026-09-02T01:00:00.000Z' }],
    nextAction: { text: 'Fix the units', owner: 'research_coder', expectedOutput: 'analysis-v2.md', acceptanceCheck: 'units verified' },
    now: '2026-09-02T02:00:00.000Z',
  }
  const once = core.reduceNodeContext(basePrior, updates)
  const twice = core.reduceNodeContext(once.state, updates)
  const thrice = core.reduceNodeContext(twice.state, updates)
  assert.deepEqual(twice.state, once.state, 're-reducing with the same updates is a fixed point')
  assert.deepEqual(thrice.state, once.state)
  assert.equal(twice.state.completed.length, 1)
  assert.equal(twice.state.requiredRevisions.length, 1)
  assert.equal(twice.state.findings.length, 1, 'no duplicate findings on replay')
}

// ── 8. drift is reported separately, never mixed into changes ───────────────
{
  const reduced = core.reduceNodeContext(basePrior, {
    issueState: { type: 'completed' },
    now: '2026-09-02T02:00:00.000Z',
  })
  assert.equal(reduced.state.status, 'todo', 'drift does not silently rewrite the owned status')
  assert.equal(reduced.drift.length, 1)
  assert.match(reduced.drift[0], /Linear state is completed/)
  assert.ok(!reduced.changes.some((line) => /completed/.test(line) && /drift/.test(line)))
}

// ── 9. the prior is closed-shape enforced ───────────────────────────────────
{
  assert.throws(() => core.reduceNodeContext({ ...basePrior, smuggled: 'narrative' }, {}), /invalid node context field smuggled/)
  assert.throws(() => core.reduceNodeContext(basePrior, { events: [{ ...event('node-claimed'), summary: 'tampered' }] }), /evidence event digest mismatch/)
}

console.log('linear context reducer tests passed for generation ' + manifest.generation)
