# Phase 4 — Linear-First Evolving Node Context: Design Notes

Plan §7 (Linear-First Evolving Node Context), §10 Phase 4, §13 gates 7–12, and the
non-context `project-state` invariant (adversarial case L871).

## Authority model (plan §7.1)

- The owned `Current Node Context` block physically inside each Linear issue
  description is the authoritative persistent record of current node state.
- Local files hold artifacts, receipts, and the minimum WAL/outbox + recovery
  cache; they never hold a narrative context copy. `state.json` may store
  `contextDigest` (pointer/checksum for reconciliation) only.
- A lifecycle transition is not committed until Linear read-back confirms the
  owned block + required evidence event (enforced at `linear_project_node`).
- Transient outages retain pending intent locally (recovery cache); state
  advancement pauses because the Linear-bound transitions require a fresh
  context digest and the Linear projection re-reads before committing.

## Owned block (core, pure)

Markers: `<!-- autoresearch-context-block:start -->` / `:end -->`
(mirrors the spec-block pattern at core L2868).

Closed owned state (`normalizeContextState` validates; field-specific errors):

```
{
  kind: 'node-context'                 (fixed)
  nodeId: string                       (required)
  status: 'todo'|'in_progress'|'blocked'|'done'|'failed'
  objective: string
  contract: { planRevision, nodeRevision, contractDigest }   (optional; from spec block)
  completed:        [{ id, text, evidence? }]     bound 20
  findings:         [{ id, text, evidence? }]     bound 15
  requiredRevisions:[{ id, reason, source?, affectedCriteria?, requiredChange? }] bound 10
  remaining:        [{ id, text }]                bound 25
  dependencies:     [{ nodeId, issueId?, relation?, why? }]  bound 20
  nextAction:       { text, owner?, expectedOutput?, acceptanceCheck? } | null   (one)
  evidenceRefs:     [{ ref, hash?, kind? }]       bound 30
  watermark: string ISO (last consumed comment/event time)
  lastVerified: { at, contextDigest } | null      (volatile; excluded from digest)
}
```

- `contextBlockDigest(state)` = sha256 over the normalized state **minus
  `lastVerified`**: re-verification without content change keeps the digest
  stable (idempotent CAS); any owned-content change rotates it.
- `renderContextBlock(state)`: machine field lines (`node:`, `context-digest:`,
  `watermark:`, `last-verified:`) then the human-readable point-form sections
  exactly as plan §7.2 (Status / Objective / Contract revision / Last verified,
  Completed, Current Findings, Required Revisions, Remaining Work, Dependencies
  and Holds, Next Action).
- `parseContextBlock(text)` → `{ ok, state, blockText }` or
  `{ ok:false, reason: 'block-missing'|'block-malformed'|'digest-mismatch'|'field-invalid', state?, actual?, expected? }`.
  The digest binds the whole block (machine lines + visible sections), so any
  human edit inside the block — machine line or visible item — yields a
  `digest-mismatch`. The parse still returns the parsed `state` (plus
  `actual`/`expected` digests) for conflict inspection: the CAS in
  `linear_update_node_context` surfaces that state/digest as
  `LINEAR_CONTEXT_CONCURRENT` instead of overwriting, and the block is
  re-validated only by a write that CASes against the edited digest
  (the coordinator reduces from the latest verified Linear input). Edits
  OUTSIDE the block (user text before/after it) never rotate the digest.
- `upsertContextBlock(description, blockText)` — replaces only the block,
  preserving all user-authored text outside it.

## Context reducer (core, pure, deterministic)

`reduceNodeContext(priorState, updates)`:
- `updates = { events: [evidenceEvent], userComments: [{id, body, createdAt}], issueState?, relations?, nextAction?, now }`
- event → transition table (all 11 `EVIDENCE_EVENT_TYPES`):
  - node-claimed → status todo→in_progress
  - evidence-packet-accepted / candidate-promoted / test-build-completed /
    acceptance-passed / revision-completed / integration-verified /
    project-republished → complete `event.completes` (remaining id) into
    `completed` with the event digest as evidence; optional finding
    (`event.finding`); acceptance-failed → finding + status failed
  - node-reopened → requiredRevisions entry (replaces open entry with same id)
    + status → in_progress
  - user-feedback-received → requiredRevisions entry, source 'user'
- new user comments (createdAt > watermark, no autoresearch-* marker) →
  findings with evidence `user:<commentId>` (unresolved human input)
- exactly one nextAction (updates.nextAction ?? prior.nextAction)
- bounds drop the OLDEST items (older detail remains in milestone comments)
- watermark = max(prior, consumed comments, event times)
- returns `{ state, changed, changes: [string] }` — fresh frozen objects.

## Evidence events (core, pure)

- `makeEvidenceEvent({projectId, nodeId, type, summary, evidence, completes?, finding?, at})`
  → closed object + `digest` (sha256 of stableStringify of the body).
- `renderEvidenceComment(event)` → body starting with the idempotency marker
  `autoresearch-evidence:<digest>` (same pattern as `causalComment`), then the
  concise §7.3 template (Reason/Source/Affected criteria/Evidence/Required
  change/Acceptance checks/Next action as applicable).
- Idempotency: replay dedupes on the marker before any comment creation
  (existing `linear_create_comment` dedupe + the new tool's own check).

## NodeWorkContext (core, pure)

`composeNodeWorkContext({ issue, contextBlock, specBlock, comments, relations, artifactChecks })`:
- `status: 'ok' | 'context-missing' | 'drift'`
- `context`: the owned state + `contract` summary from the spec block
- `freshness: { contextDigest, watermark, newComments, newHumanComments, drift[] }`
- `evidenceStatus`: each evidenceRef → `verified` (local file exists + hash
  matches) / `unverified` (no hash binding or unreadable) / `missing` (absent)
  — **never blocks** reconstruction (plan §14, Qwen round 5)
- `markdown`: the readable rendering for agents
- Usable when local `state.json` is unavailable: the query reads only Linear +
  (optionally) local artifact bytes for integrity checks.

## linearCore (src/linear.mjs)

- `core.updateIssueDescription(issueId, description, transport)` (mutation
  already in QUERIES: `updateIssueDescription`).
- `SUPPORTED_OUTBOX_OPERATIONS` += `'node.context.update'`.
- `makeOutboxRecord` default confirms for `node.context.update`:
  `{ kind: 'context-block', issueId, contextDigest }`;
  `confirmationMatches` += `context-block` case (parse the read-back issue
  description, require the owned digest).
- Recovery cache (plan §7.7): `.research-agent/projects/<pid>/linear-sync/
  recovery/<nodeId>.json` =
  `{ kind:'linear-node-context-recovery', nodeId, projectId, issueId,
  expectedContextDigest, contextDigest, description, state, createdAt,
  status:'pending' }`.
  - written BEFORE the remote description update (crash-safe intent)
  - deleted after read-back confirmation
  - `reconcileRecoveryCache`: on next Linear contact, read Linear FIRST;
    live digest === intent digest → confirm+delete; live digest ===
    expectedContextDigest → replay through the outbox (existing record);
    anything else → `conflict` (human changed the block; never overwritten,
    surfaced to coordinator/user).
  - the cache is non-authoritative: nothing in claim/reopen/acceptance/
    completion/publication reads it as truth.
- Capability: `preflightCapabilities` result gains
  `capabilities.contextDescription: 'available'|'unavailable'` (read-write
  mutation + description field readable); unavailable → `linear-context-
  unavailable` (normal node progression pauses).

## Tools (linear.mjs glue tail)

1. `linear_get_node_context` (coordinator-only) — REQUIRED intake for
   Linear-backed work:
   getIssue (latest description/state/labels) + listIssueRelations +
   listComments (paginated) → parse spec+context blocks → artifact integrity
   checks (fops, verified/unverified/missing) → `composeNodeWorkContext`.
   No valid owned block → `context-missing` (+ repair hint from the spec
   block contract), never a guess. Transport outage →
   `{ ok:false, status:'linear-unavailable', error }` (pause signal,
   structured, not a throw). Reports a pending recovery cache when present.
2. `linear_update_node_context` (coordinator-only) — the §7.6 write path:
   (1) read latest issue; (2) compute expected prior digest from the live
   block; (3) validate + normalize the new state; (4) CAS: if a live block
   exists and `expectedContextDigest !== live digest` →
   `LINEAR_CONTEXT_CONCURRENT` (field-specific, returns the live state for a
   fresh reduce — never overwrite); (5) render block, upsert into the current
   description (user text outside preserved); (6) write recovery cache + WAL
   event + outbox record (`node.context.update`) + attempt; (7)
   `updateIssueDescription`; (8) read back + structural parse + digest
   confirm; (9) confirm outbox, clear recovery cache. Failure → outbox
   retry transition, cache retained.
3. `linear_post_evidence_event` (coordinator-only): WAL `comment` operation
   with the `autoresearch-evidence:<digest>` marker; dedupe by marker;
   idempotent replay.
4. `linear_project_node` (extended): when the live issue carries a valid
   context block, `args.contextDigest` is REQUIRED and must equal the live
   block digest (the fresh read at projection time) —
   `LINEAR_CONTEXT_STALE` otherwise; a Linear node without a context block
   cannot be projected — `LINEAR_CONTEXT_MISSING` (repair the block first).
   Read-back confirmation also covers the context digest.

## Orchestrator integration

- `projectstate.transitionNode(..., patch)`: linear-bound projects
  (`state.project.linearProjectId` non-empty) require a well-formed 64-hex
  `contextDigest` in the patch for `claim`, `complete`, and `retry`
  (claim/resume/reopen/complete, plan §7.4); `fail`/`hold` record it when
  present. The digest is stored on the state entry as `contextDigest` +
  `contextDigestAt` — a pointer/checksum only (the §7.1 invariant: state.json
  never carries a narrative copy).
  Field-specific error names `linear_get_node_context` as the intake.
- `autoresearch_init_run` + `autoresearch_node_transition` +
  `autoresearch_finalize_run`: new optional `contextDigest` string param
  (closed generated schema; 55 tools unchanged). `finalize_run` requires it
  for contract-bound projects that are linear-bound (well-formed; the live
  freshness check happens at the completion projection).
- Freshness is enforced where the live data is: `linear_project_node` re-reads
  the issue and rejects stale digests. The orchestrator records the digest it
  was given as the intake anchor.

## Tests

New:
- `tests/linear-node-context.test.mjs` — block render/parse/upsert round-trip;
  digest stability across lastVerified; machine-line tamper → digest-mismatch;
  upsert preserves user text; reducer-free NodeWorkContext from Linear-only
  data (state.json absent); context-missing; evidence verified/unverified/
  missing; event idempotency marker; capability unavailable.
- `tests/linear-context-reducer.test.mjs` — determinism; completed movement;
  superseded revision replacement; one next action; bounds; watermark
  advance; idempotent re-reduce.
- `tests/linear-context-reconcile-e2e.test.mjs` — mounted plugin with the
  fake Linear harness: init block → evidence events → reduce+update; stale
  digest rejected at projection; concurrent human edit → conflict surfaced,
  user text preserved; crash-after-write → outbox replay confirms from
  read-back (no duplicate comments, no duplicate description mutation);
  outage → structured unavailable, lifecycle paused; recovery cache
  reconciled + deleted; context-missing repair path.
Extended:
- `tests/linear-core.test.mjs` — `context-block` confirmation,
  `node.context.update` outbox record shape, recovery cache helpers,
  capability flag.
- `tests/linear-lifecycle-e2e.test.mjs` + `tests/causal-core-and-parser.test.mjs`
  — linear-bound transitions now carry `contextDigest`.
- `tests/linear-reconcile-e2e.test.mjs` — the fake issue now carries a
  context block; projections pass the live digest.

## Gate mapping

- G7 block stored in the Linear issue; healthy operation needs no local
  context file (recovery cache is intent-only and never consulted as truth)
- G8 Linear-only reconstruction; clear `context-missing`
- G9 every query returns point-form current state
- G10 human-readable block (visible sections, no machine junk in the body)
- G11 reducer replaces superseded facts; no log concatenation
- G12 new comments/edits rotate the digest; stale digest rejected at
  projection
- G13 capability failure pauses; recovery cache cannot authorize
- L871 state.json carries digests only, never narrative context

## Work order

1. core: block constants/digest/render/parse/upsert + tests (pure)
2. core: reducer + evidence events + NodeWorkContext + tests (pure)
3. core: tool param definitions (init_run, node_transition, finalize_run)
4. linearCore: updateIssueDescription, confirmation, outbox op, recovery
   cache, capability flag
5. linear tools: get_node_context, update_node_context, post_evidence_event,
   project_node binding
6. orchestrator: transitionNode binding, tool wiring, finalize gate
7. e2e tests + extend existing linear tests
8. rebuild, verify-snapshot, full chain, commit

## Implementation deltas (final)

- **Tool count 55 → 58.** The canonical cut's 55-tool boundary grows by the
  three coordinator-only Linear tools above; the generated tool-schema
  boundary (`core.generateToolSchemas()`) now covers all 58, and
  `linear_project_node` gains the optional `contextDigest` parameter. The
  "55" in `tests/canonical-schema.test.mjs` is a per-phase snapshot, updated
  atomically with the source (plan §4.4).
- **Freshness digest is always the live content digest.**
  `composeNodeWorkContext.freshness.contextDigest` is computed from the
  parsed state (`contextBlockDigest(state)`), never from the volatile
  `lastVerified.contextDigest`; the `- Context digest:` markdown line matches.
- **CAS surfaces the tampered state.** When the live block parses to a
  `digest-mismatch`, the update path reports `liveState` (the parsed content)
  and `liveDigest` (the computed `actual` digest) on `LINEAR_CONTEXT_CONCURRENT`
  so the coordinator can reduce against the real current content.
- **`expectedContextDigest` may be empty** in the recovery cache
  (`linear-node-context-recovery`) for the initialize-a-missing-block intent;
  `validateRecoveryCache` allows the empty string for that field only.
- **Replay of `node.project` also requires the block.** The `node.project`
  outbox replay read-back confirms a valid `Current Node Context` block in
  addition to state/labels/marker, so a replay can never commit a node whose
  issue no longer carries the block.
- **Outage enqueues stay replayable.** `linear_project_node` persists the WAL
  event + outbox record *before* the first transport call, so a
  during-outage projection leaves a replayable record and no remote mutation;
  `linear_get_node_context` returns a structured
  `{ ok:false, status:'linear-unavailable', error }` pause result rather than
  throwing.

## Tests (Phase 4)

- New: `tests/linear-node-context.test.mjs` (block round-trip, digest
  stability, machine/visible tamper → digest-mismatch, upsert preserves user
  text, NodeWorkContext from Linear-only data, context-missing, evidence
  event shape + idempotency marker, closed-shape normalization).
- New: `tests/linear-context-reducer.test.mjs` (determinism, completed
  movement, superseded-revision replacement, one next action, section bounds,
  watermark advance, idempotent re-reduce fixed point, drift separation).
- New: `tests/linear-context-reconcile-e2e.test.mjs` (mounted plugin,
  **no state.json at all**: context-missing repair, init, idempotent evidence
  events, reduce + update with digest rotation, stale digest rejected at
  projection and CAS, in-block human edit → conflict surfaced + CAS repair,
  out-of-block edit does not rotate the digest, crash-after-write → outbox
  replay confirms from read-back with no duplicate mutation + recovery cache
  settled, outage → structured unavailable + replayable enqueue,
  context-missing without a contract, evidence verified/unverified/missing).
- Extended: `tests/linear-core.test.mjs` (`context-block` confirmation,
  `node.context.update` outbox shape, recovery-cache helpers incl.
  read-Linear-first classification, `capabilities.contextDescription` flag).
- Extended: `tests/linear-reconcile-e2e.test.mjs` (fake issue now carries a
  context block; projection passes the live digest; block asserted preserved),
  `tests/linear-lifecycle-e2e.test.mjs` + `tests/causal-core-and-parser.test.mjs`
  (linear-bound transitions carry `contextDigest`).
