# AutoResearch Hardening and Linear Causal Execution Plan

Status: working implementation plan
Version: 1.0, reviewed through three critique rounds
Reviewers: DeepSeek V4 Pro, Qwen 3.8 Max, DeepSeek V4 Pro
Scope: DSH `0.1.2-rc.1`, source preset and installed runtime

## 1. Objectives and Boundaries

This plan delivers four related outcomes:

1. Preserve deterministic AutoResearch role routing while adding optional per-role `reasoningEffort` through native DSH `AgentOptions`.
2. Close the verified GRF v8 correctness, safety, temporary-file, ledger, and installation gaps.
3. Make Linear the operational graph for explicitly Linear-backed projects: visible node ownership, dependencies, state, causal triage, and recovery projection.
4. Prove source and installed behavior with deterministic tests, clean installation checks, and disposable live smoke projects.

The following are non-goals:

- Do not replace `roleProfiles` or direct `ctx.subagents.start('spawn', request)` with model-facing `modelSelectionSettings`.
- Do not treat Linear as an atomic database, immutable event log, or cryptographic source of facts.
- Do not rewrite approved `plan.json` or approved dependency edges during reconciliation.
- Do not silently convert local-only projects to Linear-backed projects.
- Do not auto-delete existing output trees or user-authored Linear content.
- Do not hand-edit generated `tools/*.mjs` files.

## 2. Authority and Operating Modes

The authority model is deliberately explicit:

- `plan.json` is the immutable contract and dependency-edge authority.
- `state.json` remains the local lifecycle journal and recovery source.
- `.research-agent/projects/<projectId>/linear-sync/` is the write-ahead log and outbox for Linear-facing mutations.
- Linear is the human-facing operational projection and scheduling surface when the project is explicitly Linear-backed and the service is healthy.
- Local WAL entries, receipts, ledgers, and hashes are the event-of-record. Linear comments and descriptions are projections, append-only by convention only.

A project is Linear-backed when `state.project.linearProjectId` is non-empty. That mode is sticky. Losing credentials or connectivity is an outage: local facts and receipts remain usable, pending projections are recoverable, and no silent mode downgrade occurs. Local-only projects never create `linear-sync/` or call Linear.

Readiness and `nextAction` must extend the existing local `readySet` and `integrationStatus` logic. Linear may add a verified machine hold, but it may never grant readiness or downgrade a locally accepted node. A manual Linear change without a matching WAL event is drift, not completion.

## 3. Linear Operational Graph

### 3.1 Project and issue identity

Preserve the existing markers:

- `autoresearch-project:<projectId>`
- `autoresearch-node:<projectId>:<nodeId>`

Create one Linear issue per approved plan node, including the integration node. Store opaque Linear UUIDs as canonical IDs; identifiers such as `ENG-123` are display-only.

Extend the existing generated issue specification block with `nodeRevision` only. Keep it compact, marker-delimited, and preserve user text outside the owned block. Do not put the changing outbox-head digest in a Linear description.

### 3.2 Dependencies and causal information

Map every approved `dependsOn` edge to exactly one directed Linear `blocks` relation from upstream issue to downstream issue. Linear's `blocked_by` representation is the mirror of that edge and must be normalized as the same edge. Never create both directions.

Causal information is separate from execution dependencies:

- Verified causal attribution reuses the existing `validUpstreamAttributionRequest` and revision-request fields: `upstreamNodeId`, `consumerNodeId`, `epoch`, `contextDigest`, evidence references, quorum, and reopen budgets.
- Causal event comments use a distinct marker such as `autoresearch-causal-event:<projectId>:<epoch>:<nodeId>:<requestDigest>`.
- Unverified hypotheses are bounded annotations with confidence, evidence references, supersession, and expiry. They cannot alter the plan DAG.
- At most one bounded `related` relation is created per verified attribution pair; it is never automatically deleted. The exact relation enum must be pinned against the deployed schema and tested.

### 3.3 State and machine holds

Linear has no first-class `blocked` workflow type. Preserve local `blocked` for its existing user-decision meaning. Machine-caused holds are a separate derived `causalHolds`/`blockedBy` overlay and are projected to an `autoresearch-blocked` label plus a structured event comment.

Resolve states within the selected team:

- `triage`, `backlog`, `unstarted` -> local todo
- `started` -> in progress
- `completed` -> done
- `canceled` -> canceled

Configured state IDs must belong to the selected team. Missing or ambiguous mappings fail closed. A custom blocked-named state may be an optional optimization, never a requirement. Label updates must read, merge, and write the complete label set because Linear label updates replace existing labels.

## 4. Linear Adapter and Projection

Extend `src/linear.mjs` with fixed GraphQL templates. Callers and models provide variables only; they never provide GraphQL text.

Add or extend:

- paginated comments with `first`, `after`, and `pageInfo`;
- issue/project snapshots with UUIDs, `updatedAt`, archived/trashed indicators, team/project/state IDs and types, label IDs/names, and normalized relations;
- paginated relation and inverse-relation reads;
- `issueRelationCreate` and `issueRelationDelete`;
- label resolution and read-merge-write updates;
- bounded state and comment mutations;
- workspace metadata labels, not only team states.

Preflight must resolve the team, team-scoped state IDs, blocked label, and required permissions. Verify the supported schema through pinned templates and live capability probes; do not assume GraphQL introspection is available. Unexpected GraphQL field/type errors become typed schema-drift failures.

Use stored UUID `getIssue` probes before deciding that an archived or omitted issue is missing. Archived or trashed issues cause drift and human resolution; never auto-unarchive or recreate them.

Cache bounded project snapshots. Full relation collection is effectively N+1 by issue, so refresh on resume, claim, mutation, detected drift, or TTL rather than before every role attempt. Add a configurable project-node ceiling and fail closed when it is exceeded.

Preserve existing marker reconciliation, approval gates, team resolution, project-description limits, legacy marker migration, injected transport, and manual repair tools. Extend existing tools rather than creating competing paths.

## 5. WAL, Outbox, and Concurrency

Create `.research-agent/projects/<projectId>/linear-sync/` only for Linear-backed projects. It contains no secrets or transcripts.

Each WAL event records:

- schema version, sequence, previous digest, event ID, and status;
- project, node, plan revision, and node revision;
- expected precondition digest;
- intended mutation template and variables;
- affected node IDs and verified attribution;
- evidence/artifact hashes;
- retry classifications and response/applied receipt.

Write the local WAL intent before any remote mutation using DSH filesystem compare-and-swap writes. Mark it applied only after mutation-specific confirmation:

- comment: returned ID and marker receipt;
- state: read-back workflow type;
- relation: edge membership, with duplicate/already-exists treated as applied after confirmation;
- description: structural owned-block parse, not byte equality.

Extend the existing `locks/<issueId>.lock` node lease. Do not reuse role-attempt `claim.json`, which has different scope. The lock protects competing coordinators on one filesystem. Cross-workspace conflicts cannot be prevented by Linear and must instead be detected via marker, digest, revision, and timestamp checks; stop with drift and request human resolution.

The existing transport retry layer remains bounded. Adapter retries only classified GraphQL errors, with a total retry budget, recorded in the WAL, and no blind mutation replay. Replay always confirms an unknown result before deciding whether another action is necessary.

## 6. Per-Node Lifecycle

Every node query follows this sequence:

1. Load the approved plan, local state/WAL, and a current or valid cached Linear snapshot.
2. Resolve exactly one target issue by marker and verify plan revision, node revision, contract digest, lease, and outbox state.
3. Build a focused `NodeWorkContext` containing only the target contract/task, accepted upstream ledgers, direct blockers/dependents, causal holds/events, next action, and local/Linear references.
4. Claim the target using the node lock and WAL. The role call may not solve or mutate unrelated nodes.
5. Project `started` and one deduplicated claim comment when Linear is available; otherwise queue the projection while local work proceeds.
6. Execute the target's role work through the existing deterministic role runner.
7. Record acceptance, artifact, ledger, and receipt hashes locally.
8. Project the outcome and propagate only to affected nodes.

On success, complete the target, clear only resolved machine holds, and make only eligible direct descendants actionable. On retryable failure, record the attempt/model/error class and hold only non-done transitive downstream nodes. Do not auto-reopen upstream.

On verified acceptance/revision failure, use existing attribution validation and revision-request budgets. Reopen the attributed upstream node through the existing revision path, create the causal event projection, and hold the non-done downstream closure. Never rewrite the approved DAG.

A revision request creates one idempotent event per project/node/epoch/request digest, bumps the node revision exactly once, resets owner/downstream local state according to revision semantics, and requires fresh acceptance. Existing user-decision blocks remain blocked; reset logic must not silently clear them.

Integration readiness is computed from all current accepted leaves. The integration issue remains visible and receives dependency relations, but Linear does not independently grant integration readiness.

Resume reconciles the outbox first, confirms unknown remote results, refreshes the graph, repairs only projection drift matching local facts, recomputes readiness, reclaims only valid expired leases with the existing human-gated recovery semantics, and selects one next actionable node.

## 7. Native Routing and Reasoning Effort

Keep `roleProfiles.<role>.model`, `modelFallbacks`, breakers, personas, tool ceilings, output schemas, and direct programmatic spawn routing.

Add canonical `roleProfiles.<role>.reasoningEffort`:

- validate it as a bounded non-empty provider-owned string;
- optionally warn when it is not advertised by `resolveModelInfo`; never hard-code a global enum;
- use `reasoningEffort` consistently; do not retain or interpret the old `profile.reasoning` field;
- thread it through profile resolution, `resolveAgentOptions`, initial attempts, fallback attempts, and same-child continuation;
- include it in logical route identity so changed effort cannot collide with a previous attempt;
- omit it when unset;
- never pass internal `modelSource` metadata to DSH.

`modelSelectionSettings` remains disabled for AutoResearch role dispatch. It may be considered separately for ordinary model-authored delegation, but it is not part of this migration.

## 8. GRF v8 and Runtime Hardening

1. Thread `outputContract.artifactPath` through `validateNodeTex`, `tex_check`, `record_acceptance`, `captureFinalBuild`, finalize, and ledger paths. The existing acceptance wrapper already reads the path; the validator must stop hardcoding `output.tex`.
2. Make TeX resolution relative to the including file, reject absolute/traversing/backslash paths, enforce run-root confinement, reject symlinks, retain cycle/depth bounds, and scan labels/references across all resolved fragments.
3. Add accepted artifact `{path, format, sha256}` to `node-output.json` while retaining compatibility aliases. Make `backfill-ledgers.mjs` consume `acceptance.json.artifact.path`.
4. Move compiler, preview, validator, and retry scratch into owner-marked temporary workspaces. Fix the out-of-scope `run` cleanup reference, confine removal through `processPath`, and retain only bounded diagnostics on failure.
5. Validate `finalBuild.sourcePath`, `flsPath`, and `pdfPath` as safe relative paths under approved roots before every read, hash, or copy in runtime publishing and `republish-outputs.mjs`.
6. Redefine build probes so `graphMatches` covers the immutable aggregate scope only. Report hashes for deployment-mutated config/composition as explicit non-fatal configuration drift. Add install receipts and clean-target verification.
7. Update README and skills for DSH `0.1.2-rc.1`, current generation behavior, Linear operational semantics, and the v8 output layout. Keep legacy and historical outputs readable and untouched.

## 9. Phase Ordering

### Phase 0: Baseline and contracts

- Capture the currently green full test and snapshot baseline.
- Add failing regression fixtures for custom TeX paths, traversal/nested TeX, fragment references, ledger paths, finalBuild traversal, temp ownership, and manifest/config drift.
- Define versioned WAL, event, causal-hold, capability, and node-revision schemas.
- Define effective-state/readiness rules and the Linear-backed mode flag.
- Extend exact-tree tests to ensure `linear-sync/` remains internal.

### Phase 1: GRF and routing hardening

- Implement reasoning-effort normalization and propagation.
- Fix artifact-path handling, TeX resolver confinement, closure-wide references, ledger/backfill metadata, finalBuild path checks, and temporary lifecycle.
- Fix the undefined cleanup variable and raw removal confinement.
- Implement immutable-graph versus deployment-config manifest semantics.
- Run generated build and all existing tests.

### Phase 2: Linear read model and capability preflight

- Add labels, paginated comments, relations, issue metadata, team-scoped state mapping, archived issue probing, and bounded snapshots.
- Add capability and permission results without remote mutations where possible.
- Preserve current marker reconciliation and legacy paths.

### Phase 3: WAL and outbox core

- Implement the pure event serializer, digest chain, CAS head, outbox state machine, mutation confirmation rules, causal-hold derivation, and capability receipt.
- Extend existing node locks with Linear claim metadata.
- Test crashes, replay, two-writer contention, and remote outages.

### Phase 4: Lifecycle integration

- Add coordinator-only graph sync, node claim, event projection, and causal reconciliation operations using existing `assertCoordinator` checks.
- Extend `readySet`, `integrationStatus`, revision handling, `nextAction`, and `resetDownstreamState` without creating a second readiness system.
- Update skills so each active turn is snapshot/reconcile -> select one node -> claim -> solve -> accept -> project -> propagate -> recompute.
- Run fake-Linear branching/converging lifecycle tests.

### Phase 5: Installation and documentation

- Add clean-target installer and effective-manifest tests, install receipts, and explicit stale-residue documentation.
- Update README, skills, role guidance, and generated metadata through normal build scripts.

### Phase 6: Release and live rollout

- Install to a disposable clean DSH target with local overrides.
- Restart DSH and begin a blank session.
- Require both build probes to agree on the immutable aggregate and report configuration drift separately.
- Run disposable Linear and local-only smoke projects before release.

## 10. Test Matrix and Release Gates

### Core and configuration

- reasoning effort omitted, valid, invalid-shape, fallback, continuation, route identity, and provider-advertisement warning;
- effective-state/readiness state machine and causal-hold derivation;
- node-revision increment/replay and preservation of user-decision blocks;
- relation mirror normalization and state mapping including triage/backlog;
- causal event serialization, digest, marker uniqueness, and attribution budgets.

### Linear adapter

- exact fixed GraphQL templates and variables;
- issue/project/comment/relation pagination;
- duplicate project/node markers and legacy marker migration;
- relation duplicate/already-exists behavior;
- UUID and archived/trashed issue handling;
- team-scoped state IDs and cross-team rejection;
- label read-merge-write preserving unrelated labels;
- comment deduplication over all pages;
- Markdown-normalization-safe description updates;
- read-only permission and schema-drift failures;
- bounded retry and rate-limit handling.

### Outbox and concurrency

- CAS two-writer claim contention;
- crash before and after each remote mutation;
- unknown mutation result confirmation;
- local acceptance followed by Linear outage and later replay;
- stale lease, foreign writer, manual Linear drift, deleted/archived issue;
- no duplicate issue, relation, comment, or plan mutation.

### Lifecycle end-to-end

Use fake Linear and fake filesystem services for a branching/converging DAG. Assert one issue per node, directed blocks edges, exactly one deterministic ready claim, completion unblocks only eligible descendants, failure holds only affected non-done descendants, verified revision reopens the attributed owner, integration waits for leaves, and interruption/resume repairs the projection.

### GRF and installation

- custom TeX and Markdown artifact paths;
- nested importer-relative TeX, traversal, absolute, backslash, symlink, missing input, and fragment-reference cases;
- accepted artifact ledger and custom-path backfill;
- temporary ownership, cleanup, retention, active lock, rollback, and crash recovery;
- finalBuild traversal and symlink rejection;
- exact output trees including internal `linear-sync` data;
- clean installation with `--apply-local`, immutable graph verification, explicit config drift, installed bundle imports, and both probes.

### Live release smoke

Against a disposable Linear team/project, run at least three nodes with a branch, convergence, induced failure, verified revision, blocked label, causal comments, relation inspection, outbox replay, and forced interruption/resume. Separately run local-only Markdown, PDF-only, and reproducible-TeX projects and verify receipts, ledgers, exact output trees, temporary cleanup, idempotent finalization, and recovery.

Release is blocked until all correctness/security tests pass, both probes report a healthy immutable graph, the Linear smoke passes, the outage behavior is documented, and legacy/local-only behavior remains covered.

## 11. Implementation Rules

- Add tests before fixes where practical, especially for security and data-integrity defects.
- Run `npm run build:preset`, inspect generated changes, `npm run verify:snapshot`, and the full `npm test` suite after each phase.
- Generated files under `tools/` are build outputs only.
- Use DSH filesystem CAS and existing locks rather than inventing unbounded local mutation paths.
- Keep Linear-facing actions coordinator-only.
- Never let a role child choose the next node from Linear issue titles or stale states.
- Never overwrite user-authored Linear description text or labels without conflict detection.
- Never use Linear state alone as proof of completion.
- Preserve existing user outputs, historical plans, legacy markers, and local-only projects.
