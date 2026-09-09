# Phase 5 — User Feedback and Causal Rework: Design Notes

Plan §8 (User Feedback After Project Completion), §10 Phase 5, §13 gate 14,
and the feedback adversarial cases (§11: minimal closure, ambiguous opens
nothing, stale digest cannot claim bypass, last-known-good preserved until
successful republish).

## Authority model (plan §8.1)

- `autoresearch_submit_feedback` (coordinator-only) is the single intake path.
  `source` and `authority` are closed literals (`'user'`/`'user'`) inside the
  record — they are never tool arguments, so the coordinator cannot manufacture
  user authority from its own prose.
- The record is hash-addressed (`<projectDir>/feedback/<recordDigest>.json`)
  and carries an `idempotencyKey` = sha256(`projectId \u0000 feedback \u0000
  receivedAt`); exact retries converge to the existing record.
- `userAuthority` is computed at intake, never asserted:
  - `granted` — the supplied base input digest AND base publish-manifest digest
    both equal the current last-known-good (LKG) integration recorded in
    `state.integration.lastKnownGood`.
  - `stale` — an LKG exists but either base digest differs (the feedback was
    not given against the current last-known-good).
  - `not-recorded` — no LKG exists yet (project never published).
- The judge-quorum bypass is valid only while `userAuthority === 'granted'`; a
  stale digest can never claim it (adversarial case). The repair dispatch
  policy for granted feedback is recorded in the closure as
  `judgeQuorumBypass: 'applied' | 'not-applied'`.

## Canonical record shapes (15 closed kinds; field lists extended)

`user-feedback` (extended from the Phase 1 placeholder):

```
projectId, feedback (verbatim), receivedAt (ISO),
source: 'user', authority: 'user',          (closed literals, not arguments)
baseInputDigest: 64-hex, baseManifestDigest: 64-hex,
userAuthority: 'granted'|'stale'|'not-recorded',
nodeId: nullableString,
targetContributionIds: stringArray (default []),
targetCriterionIds: stringArray (default []),
idempotencyKey: 64-hex,
status: 'open'|'triaged'|'resolving'|'resolved',
triageDigest: nullableString,              (set on the 'triaged' version)
closure: nullableObject {
  resolvedAt, affectedNodeIds stringArray, receiptHashes stringArray,
  integrationInputDigest, publishManifestDigest,
  judgeQuorumBypass: 'applied'|'not-applied'
}
```

Records are immutable and content-addressed: a status change writes a NEW
version (new digest, new file); the old version stays on disk. The journal
pointer `state.integration.feedback[]` (digest + status only — operational,
never narrative) tracks the current version.

`feedback-triage` (extended):

```
projectId, feedbackId (digest of the 'open' feedback version),
decision: 'editorial-only'|'reopen'|'conflict-user-choice'|'scope-plan-revision'|'ambiguous',
items: [{
  id, classification: 'editorial'|'substantive'|'conflict'|'scope'|'ambiguous',
  affectedCriteria stringArray, affectedContributionIds stringArray,
  ownerNodeIds stringArray (sorted), requiredChange, acceptanceChecks stringArray
}] (non-empty),
rationale,
targetNodeIds: stringArray (sorted direct reopen targets; [] unless decision 'reopen'),
createdAt
```

Derivation rules (enforced by the tool, not trusted from the model):

- Decision precedence for mixed item sets: `ambiguous` > `scope` >
  `conflict-user-choice` > `reopen` > `editorial-only` (clarify before
  rescoping, choose before reopening, reopen before polishing).
- `derivedTargets` = sorted union of `ownerNodeIds` over `substantive` items,
  plus `ownerNodeIds[0]` for `conflict` items with exactly one owner.
- any `ambiguous` item ⇒ decision must be `ambiguous` (outranks all other
  classes in a mixed set), targetNodeIds = [].
- any `scope` item (with no `ambiguous` item) ⇒ decision must be
  `scope-plan-revision`, targetNodeIds = [].
- any `conflict` item with 0 or ≥2 owners ⇒ decision must be
  `conflict-user-choice`, targetNodeIds = [] (nothing reopens until the user
  chooses; a later triage with a single owner reopens).
- decision `reopen` ⇒ targetNodeIds must equal derivedTargets exactly and be
  non-empty; no ambiguous/scope items.
- decision `editorial-only` ⇒ every item `editorial`, targetNodeIds = [].
- every owner/target id must be a plan node id (integration included —
  `targetNodeIds: ['integration']` means "rerun integration only").

`revision-request` (request-file shape, extended for multi-target linkage):

```
projectId, nodeId (one direct target per file), epoch,
affectedContributionIds, projectCriteria, problem, requiredChange,
acceptanceChecks, upstreamAttribution? (causal path only),
feedbackDigest: nullableString, triageDigest: nullableString,
supersedes: stringArray (sorted acceptance receipt hashes being superseded),
requestDigest, marker, createdAt
```

`revisionRequestDigest` covers the problem identity — `projectId`, `nodeId`,
`affectedContributionIds`, `projectCriteria`, `problem`, `requiredChange`,
`acceptanceChecks`, `upstreamAttribution`, `feedbackDigest`, `triageDigest` —
and deliberately EXCLUDES `supersedes` (a link to receipts that legitimately
changes between attempts) and `epoch` (a routing counter in the file name):
a replay must converge even after receipts rotated or the integration epoch
advanced, and can never re-reset an already re-accepted node. Creation scans
the request directory for `<target>-<anyEpoch>-<requestDigest>.json`, so the
replay finds the existing file and skips the state reset.

## Multi-target reopen (plan §8.3)

`core.detectDependencyCycles(plan)` — DFS over `dependsOn`; refuses with a
cycle report (sorted cycles) BEFORE any closure is computed.

`core.computeReopenClosure(plan, targetIds)` — sorted targets; union of each
target and all transitive downstream dependents; per-node blocker set = the
direct targets that are ancestors of that node.

`autoresearch_revision_request` gains `nodeIds` (sorted unique set) plus
`feedbackId`/`triageDigest` linkage. One state transaction:

1. cycle check (refuse before closure);
2. closure + blocker sets;
3. minimal-closure rule: when `triageDigest` is supplied, `nodeIds` must equal
   the triage's `targetNodeIds` exactly (superset/other sets are rejected —
   "route the smallest responsible closure");
4. new integration epoch = current + 1 (bump only when at least one new
   request file is created; replay converges);
5. one request file per direct target (sorted), `supersedes` = that target's
   current acceptance receipt hash (journal `receipts[0]`) when present;
6. single batched reset: closure nodes → `todo` (user-`blocked` stays
   `blocked`), run fields cleared, `receipts: []` (historical run files are
   never deleted), `nodeRevision + 1` on direct targets only, dependents get a
   causal hold with the FULL blocker set, unrelated completed nodes preserved;
7. Linear-bound projects mark closure nodes `projectionStatus: 'pending'`
   (re-projection happens on re-claim through `linear_project_node`).

If only `integration` is in the target set, only integration reruns; an
upstream target reruns its closure + integration in dependency order (the
ready set already encodes dependency order via the holds).

## Last-known-good, resolution, republish (plan §8.4)

- `autoresearch_finalize_run` (integration node publish success) records
  `state.integration.lastKnownGood = { manifestDigest, inputDigest (nullable),
  publishedAt, runId }` — `manifestDigest` = sha256 of the published
  `MANIFEST.json` bytes; optional new argument `integrationInputDigest`
  supplies the current input digest (else null). Operational digests only.
- The transactional publish already leaves the prior output in place until the
  replacement commits (MANIFEST last, rollback on failure) — LKG preservation
  is the existing publish behavior plus the recorded pointer.
- `autoresearch_close_feedback` runs the mechanical feedback-resolution check:
  1. every triage target is journal-`done` with fresh receipts — a fresh
     receipt must differ from the `supersedes` hash of that target's request
     (superseded receipts never count);
  2. every triage `acceptanceCheck` (a criterion ID of the item's owner node)
     appears with result `PASS` in a fresh owner receipt whose hash equals the
     journal receipt hash (hash-bound; a re-acceptance is only as good as its
     bound acceptance record);
  3. the supplied integration input digest differs from the feedback's
     `baseInputDigest` (something actually changed);
  4. the supplied publish manifest digest equals the CURRENT
     `state.integration.lastKnownGood.manifestDigest` (the replacement
     publication actually happened and is current).
- On success: a NEW feedback record version with `status: 'resolved'` and the
  `closure` object (affected nodes, fresh receipt hashes, both digests,
  `judgeQuorumBypass` from the intake `userAuthority`), the journal pointer
  advances, and the tool returns one concise `project-republished` evidence
  event payload for `linear_post_evidence_event` on the integration node
  (marker-deduped, WAL/outbox-backed, fail-closed on outage).

## Linear projection (no new Linear tools)

- intake → `linear_post_evidence_event` on the integration node,
  type `user-feedback-received` (existing closed type), evidence
  `[<feedbackDigest>]`;
- triage → `linear_create_comment` on the integration issue with marker
  `autoresearch-feedback-triage:<triageDigest>` (idempotent) + a suggested
  integration context patch for `linear_update_node_context` (CAS against a
  fresh `contextDigest`);
- reopen → per-target revision-request markers through the existing
  `linear_create_comment` idempotency; reopened issues re-project on re-claim;
- close → one `project-republished` event + integration context
  `nextAction` update.

The integration issue id is read from the journal
(`state.nodes[integrationId].issueId`) and returned by the tools; when empty,
the tools return a resolution instruction instead of guessing.

## Tool surface (58 → 61)

New: `autoresearch_submit_feedback`, `autoresearch_record_feedback_triage`,
`autoresearch_close_feedback` (all coordinator-only).
Extended: `autoresearch_revision_request` (+`nodeIds`, `feedbackId`,
`triageDigest`), `autoresearch_finalize_run` (+`integrationInputDigest`).
Every schema stays generated from `TOOL_PARAMETER_DEFINITIONS` (gate 1);
`tests/canonical-schema.test.mjs` count updates atomically 58 → 61.
