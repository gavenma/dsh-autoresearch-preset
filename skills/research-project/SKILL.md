---
name: research-project
description: "Run the standard AutoResearch project workflow end-to-end from a vague or open-ended brief: plan-mode DAG → human approval → Linear project + one issue per node → dependency-ordered per-node AutoReason loops → integration and project final. A single work item is a one-node DAG plus its mandatory integration node."
whenToUse: "Use for vague or open-ended research, evidence-grounded analysis, or AutoResearch/AutoReason requests. When the user supplies a substantial outline, staged plan, table of contents, or work breakdown, load research-outline-project for Phase 1 planning; both modes share this execution workflow after approval."
---

# AutoResearch Project Mode Skill

Coordinate a whole research PROJECT: an approved plan DAG, one Linear issue per
node, one independent AutoReason loop per node, and a final integration loop
that merges and verifies every leaf deliverable. This is the standard planning
mode and the shared execution workflow. When a user supplies a substantial
outline, load `research-outline-project` for Phase 1; after approval it returns
to this same workflow. A single work item is a one-node DAG plus its mandatory
`integration` node.

## Runtime source of truth

The AutoResearch workflow and its role/tool instructions are provided by the
installed DSH research preset under `~/.dsh/.agent-presets/research`. Use the
registered `autoresearch_*` and `linear_*` tools and this installed preset as
the runtime source. Do not inspect, import, execute, or ask roles to rely on
workspace development checkouts; those directories are archival/build sources
only.

The workspace `.research-agent/` directory is the single runtime artifact root for run artifacts, approved project plans, mutable receipt journals, and project-local configuration. The bare `research-agent/` directory is migration-only input, never a runtime alternative. This directory is not the source of the AutoResearch skill or tool implementation.

## Runtime conventions (tool behavior)

- **Path relativity:** tools that take both a `runDir` and a user path
  (`coverage_validate`, `tex_final_check`, `redact_check`, `record_acceptance`
  evidence, `publish_accepted`, `candidate_eligibility`, anonymize candidate
  overrides) accept paths as absolute, runDir-relative, or
  workspace-relative — absolute wins, then runDir-relative if it exists, then
  workspace-relative. Run-internal artifact names are always confined to the
  run directory.
- **Declared needs:** the scanner-derived declared needs are the source of
  truth at TeX acceptance; a hand-filled declared-list mismatch is a recorded
  non-blocking drift warning, not a failure. When `declared` is omitted at
  acceptance, the node contract's `outputContract` fills it automatically.
- **Blind judging:** `autoresearch_anonymize_candidates` returns flat typed
  dispatch primitives per judge (`judgePacketPath`, `judgePacketHash`,
  `pass`, `judge`, `judgeCount`, `runDigest`, `contextDigest`) with integer
  zero-based passes; pass them verbatim to `autoresearch_run_role`. Never
  re-derive paths or maps.
- **Binary hashing:** `.pdf/.png/.jpg/.jpeg/.gif/.gz/.zip/.bin` artifacts are
  hashed as raw bytes; text is decoded only when text inspection is required.
  Publication copies every entry byte-exactly.
- **Revision routing:** `autoresearch_revision_request` resets the owning
  node(s) and the transitive downstream closure in one state transaction,
  projecting causal holds to Linear. It never rewrites the approved DAG, so
  integration cannot accept stale downstream artifacts.

## Prerequisites

- A session on the `research` preset: the `autoresearch_*` tools (including
  `autoresearch_plan_validate`, `autoresearch_record_acceptance`,
  `autoresearch_integration_preflight`, `autoresearch_coverage_validate`,
  `autoresearch_tex_final_check`, `autoresearch_render_preview`,
  `autoresearch_build_probe`, and `autoresearch_project_status`) and the
  `linear_*` tools (including
  `linear_create_project`, `linear_create_issue`, `linear_build_probe`,
  and the `projectId` filter on `linear_list_issues`). The preset must register
  exactly one usable search provider and one usable fetch provider when
  `externalResearch=true`; `autoresearch_dependency_check` and
  `autoresearch_dependency_preflight` report these as separate checks
  (multiple registered web-fetch providers is a named ambiguity blocker,
  never a silent degraded result). Backend preset edits require a preset
  remount/new session. After any preset edit, run `autoresearch_build_probe`
  and `linear_build_probe`: both must report the same candidate aggregate
  build ID and `graphMatches:true` (a mismatch means the session runs a stale
  generation — start a new blank research session).
- Linear credentials for the Linear path (`LINEAR_API_KEY`; `linear_whoami`
  verifies). Local-only projects work without Linear: skip Linear steps —
  `autoresearch_project_status` still drives the DAG.
- Artifact root: internal plans, receipts, packets, and runs live under hidden
  `.research-agent/`; user-facing deliverables are published only when the
  project contract exposes them, under `outputs/<projectId>/`. The visible
  output directory is created only when an integration run finalizes with a
  non-empty exposure.

## Canonical records — the only accepted shapes

AutoResearch owns one canonical, unversioned record family. Every record is
identified by a `kind` tag; `kind` is a record type, and no record carries
version or policy markers of any kind. There is also no runtime reader for
older shapes: a non-canonical plan fails validation with exactly one error
(`not canonical; run scripts/migrate-workspace.mjs`) and execution stays
blocked until the offline migrator produces a proposed canonical revision and
a human approves it. `autoresearch_migration_diagnostic` reports the
closed-catalog legacy fingerprint of an old shape; it never rewrites the
plan.

### plan.json

```json
{
  "kind": "autoresearch-plan",
  "projectId": "demo-proj",
  "projectName": "Demo research project",
  "revision": 1,
  "approvedAt": "2026-01-01T00:00:00.000Z",
  "integrationId": "integration",
  "projectContract": {
    "goal": "...",
    "deliverables": ["final.pdf"],
    "acceptance": [{ "id": "PROJECT-01", "text": "...", "required": true }],
    "test": "",
    "wordBudget": null,
    "rebuildable": false,
    "diagnosticMappings": []
  },
  "nodes": [
    {
      "id": "lit-review",
      "kind": "research",
      "title": "Literature review",
      "roles": ["research_scout", "evidence_verifier", "research_author", "research_judge"],
      "expectedOutcome": "...",
      "acceptance": [{ "id": "LR-01", "text": "...", "required": true }],
      "test": "",
      "budget": { "numScouts": 2, "numJudges": 3, "maxPasses": 2, "convergenceThreshold": 2 },
      "dependsOn": [],
      "artifactFormat": "tex",
      "outputContract": { "artifactPath": "output.tex", "texMode": "fragment" }
    }
  ]
}
```

Rules:

- `kind` must be exactly `"autoresearch-plan"`.
- `projectContract.deliverables` is always an explicit array; `[]` means
  publish nothing. `wordBudget` is a positive integer or `null`;
  `rebuildable` is a boolean (TeX-only opt-in); `diagnosticMappings` is an
  array of exact `{ sourcePath, destinationPath }` pairs whose destination
  must be under `audit/`.
- Acceptance criteria are OBJECTS everywhere — `{ "id", "text", "required",
  "check"? }` — at both project and node level. String criteria are a legacy
  shape the runtime rejects. `check` is a closed typed descriptor
  (`word-budget`, `all-current-node-receipts`, `tex-compile`,
  `citation-coverage`, `image-asset`) and is legal only where its format
  applies (`tex-compile` on TeX nodes, `image-asset` on figure nodes).
- Node `kind` is a closed enum: `research | literature | abstract | figure |
  code | experiment | experiments | assembly | integration`.
- `artifactFormat` is `tex | markdown | image | asset`; `image`/`asset` are
  legal ONLY for figure nodes. A figure node may carry `sourceAssets`,
  `imageTolerance`, and `judgeWithImages` — those fields are legal only on
  figure nodes — and requires an image-capable judge route when visual
  quality is an acceptance criterion.
- `budget` is explicit `{ numScouts, numJudges, maxPasses,
  convergenceThreshold }` — no hidden defaults. `numScouts`/`numJudges` must
  be 0 when the node's roles omit `research_scout`/`research_judge`; a
  positive count for an omitted role is a plan validation ERROR (never
  warn-and-normalize).
- `outputContract.artifactPath` is required — the safe relative path of the
  promoted artifact. `texMode` (`standalone | fragment | assembly`) is a TeX
  field; assembly nodes merge complete documents and default to
  `standalone` — write it explicitly.
- The integration node: `kind: "integration"`, roles are the editor and
  verifier only (`research_integration_editor`,
  `research_integration_verifier`), no scouts/judges, no A/B/AB loop. Nothing
  may depend on it; it must cover every leaf.
- Document rewrites decompose at section level: one node per
  section/component, ONE assembly node that merges the drafts and runs the
  global preservation/compilation checks, and the integration node
  re-verifies the assembled whole.

### state.json

```json
{
  "kind": "project-state",
  "projectId": "demo-proj",
  "marker": "autoresearch-project:demo-proj",
  "createdAt": "...", "updatedAt": "...",
  "project": { "linearProjectId": "", "url": "", "createdAt": "" },
  "integrationRevision": 1,
  "nodes": {
    "lit-review": {
      "status": "todo | in_progress | blocked | done | failed",
      "issueId": "", "identifier": "", "url": "", "linearState": "",
      "runDir": "", "runStatus": "", "currentStep": "", "currentPass": 0,
      "hasFinal": false, "finalCommentId": "",
      "receipts": ["<receiptHash>", "<outputHash>", "<acceptance.json path>"],
      "causalHolds": [], "nodeRevision": 1,
      "contextDigest": null, "contextDigestAt": null,
      "linearProjection": null, "projectionStatus": "none",
      "updatedAt": ""
    }
  },
  "commentCursors": {},
  "integration": { "epoch": 1, "inputDigest": null, "lastKnownGood": null, "feedback": [] },
  "lastError": ""
}
```

`state.json` is OPERATIONAL-ONLY: lifecycle statuses, digests, ids, and
pointers. It NEVER carries narrative context copies or an alternate task
description. The narrative Current Node Context lives in the Linear issue
description (machine-owned block); `state.json` stores only the
`contextDigest`/`contextDigestAt` pointer for reconciliation.
`integration.lastKnownGood` records the last successful publish.

## Authority model (settled policy — never deviate)

1. **`plan.json` is the immutable approved DAG and contract authority.** It is
   written only after plan-mode approval and only as a new revision after an
   approved discovery. Never rewrite it silently; never let Linear or state
   edits flow back into it.
2. **`state.json` is the mutable operational journal** (node statuses, Linear
   ids, run dirs, receipts, causal holds, integration epoch/LKG). The
   coordinator persists transitions through `autoresearch_node_transition`;
   `autoresearch_project_status` reads it and its only mutation is the
   idempotent comment-cursor advance.
3. **Linear is the operational projection and scheduling surface, and — for
   Linear-backed projects — its `Current Node Context` is authoritative
   current-work context.** Mutations are recorded first in the local
   `linear-sync/` WAL/outbox and reconciled by
   marker, digest, and read-back. Use `linear_sync_plan_relations` for
   approved DAG edges and `linear_project_node` for focused transitions;
   `linear_sync_reconcile` dead-letters after its bounded retry ceiling.
4. **Local-only projects never call Linear.** Linear outages pause normal
   progression with a clear unavailable result — never silently downgraded to
   a different project mode.
5. **Work advances only while you (the coordinator) have an active turn.**
   Resuming after interruption: reconcile the outbox first, refresh the graph,
   then call `autoresearch_project_status` and follow each node's
   `nextAction`.

## Permissions (truthful — prompt text is never the boundary)

- Roles run ONLY through `autoresearch_run_role` with per-role tool-name
  allowlists; the coordinator never hands roles its own tools.
- The broad role baseline — `read`, `grep`, `glob`, `bash`, `write`, `edit`,
  plus conditional `read_image` / `web_search` — remains disabled in this
  preset because DSH does not expose a per-child preventive path/egress
  adapter seam. `autoresearch_capability_probe` records coordinator-adapter
  diagnostics only and cannot unlock broader child tooling.
- The path/operation guard is a post-attempt mutation audit. It fails an
  attempt that changed protected or out-of-scope files without a matching
  coordinator approval token, but it is not a read or egress sandbox. A role
  that needs a substantial or cross-scope change emits a structured approval
  request (paths, diff summary, reason, affected criteria, rollback plan);
  prompt guidance is never the security boundary.
- Acceptance, promotion, publication, and Linear mutations stay
  coordinator-only.

## Linear-first node context

For a Linear-backed project, the machine-owned `Current Node Context` block in
each issue description is the authoritative persistent record of current work:
what is complete, current evidence/findings, reopen reason, exact remaining
work, dependencies, and next action. It is updated in place by a deterministic
reducer that replaces superseded facts (never concatenates history) and is
human-readable on the issue itself. Local `state.json` holds only the digest
pointer.

- **Fresh intake is required.** Before claim/complete/reopen/acceptance of a
  Linear-backed node, call `linear_get_node_context` and carry the returned
  `contextDigest` into `autoresearch_node_transition` /
  `autoresearch_init_run` / `autoresearch_finalize_run`. A newer human
  comment or edit invalidates a stale digest (the tool fails with a
  field-specific context-digest mismatch): re-query and reduce.
- **Updates.** `linear_update_node_context` evolves the block through the
  write path: fresh read, expected-digest CAS (a concurrent change returns a
  conflict with the live state instead of being overwritten), user text
  outside the block preserved, crash-safe recovery cache + WAL/outbox intent,
  owned-block-only description update, structural read-back, digest
  confirmation.
- **Evidence events.** `linear_post_evidence_event` posts marker-deduped,
  WAL/outbox-backed idempotent comments for decision-relevant milestones:
  node-claimed, evidence-packet-accepted, candidate-promoted,
  test-build-completed, acceptance-passed, acceptance-failed, node-reopened,
  user-feedback-received, revision-completed, integration-verified,
  project-republished. Evidence comments support the current block; they are
  not a substitute for it.
- **Degraded mode.** When Linear cannot read/update descriptions or is
  unreachable, normal progression PAUSES with a clear
  context-missing/linear-unavailable result — no silent local fallback. The
  local outbox (`linear_sync_reconcile` replays it) holds pending writes as
  crash-recovery intent only; it can never authorize claim/completion/publish.
- `linear_get_node_context` reconstructs current work from Linear ALONE
  (local state may be missing); evidence references carry
  `verified`/`unverified`/`missing` status and never block reconstruction. A
  missing or invalid owned block returns `context-missing`: repair it with
  `linear_update_node_context` before any node work.

## Phase 1 — Plan via the planning loop → review → approve → create

The plan itself is a research artifact: it is produced by the dedicated
`research_planner` role and refined through its own AutoReason loop (blind
Borda judging) BEFORE it is ever presented for approval. The coordinator never
hand-writes the plan.

1. **Recon (coordinator, keep it light):** read the brief(s) and named source
   material, `web_search` for audience context (e.g. panel structure),
   `linear_workspace_metadata` when Linear is in scope. Do NOT draft the plan.
2. **Planner draft (`research_planner` role).** Run the confined
   `research_planner` role via `autoresearch_spawn_role` +
   `autoresearch_run_role` with the full brief context. It returns a
   `## Plan rationale` plus a `## Plan JSON` fenced block. Save both under
   `.research-agent/planning/<projectId>/pass_00/A.md` (plan A) and extract
   the JSON to `.research-agent/<projectId>.plan-draft.json`; validate it with
   `autoresearch_plan_validate` (by `path`). `research_planner` is a
   planning-phase role and must NEVER appear in a node's `roles`.
3. **Planning refinement loop (AutoReason-style, over the plan itself),** with
   the planning budget from `config.planning` (defaults `numJudges: 2,
   maxPasses: 2, convergenceThreshold: 2`). Planning artifacts live under
   `.research-agent/planning/<projectId>/` with `pass_N/` canonical naming.
   For each pass N up to `maxPasses`:
   - Copy the incumbent plan → `pass_N/A.md`.
   - `research_critic` critiques the plan as a plan (purpose per node, scope
     and length, mechanical acceptance/tests, dependency logic, budgets,
     feasibility, panel fit) → `pass_N/critic.md`.
   - `research_planner` produces plan B (a revision that addresses the
     critique) → `pass_N/B.md`.
   - `research_synthesizer` merges A + B → `pass_N/AB.md`.
   - `autoresearch_anonymize_candidates` (runDir = planning dir, pass N) →
     parallel blind `research_judge` runs (`numJudges`): pass each judge the
     returned flat typed primitives, spawn exactly the returned judge count,
     and never re-derive references → `autoresearch_parse_ranking` per judge
     → `autoresearch_score_borda` → write `pass_N/result.json`; update the
     incumbent and the consecutive-A-wins counter. Derive the anonymization
     judge count from the same planning budget every pass; the minimal
     planning `run.json` scaffold is created automatically when the planning
     directory has none (`planning: true`), a judge-count contradiction fails
     closed, and real execution runs are never overwritten.
   - Stop when consecutive A wins ≥ convergenceThreshold or pass ≥ maxPasses.
4. **Validate + present.** Extract the winner's JSON to
   `.research-agent/<projectId>.plan-draft.json` and run
   `autoresearch_plan_validate` (plan object or `path`/`projectId`) before
   EVERY presentation. Present through `exit_plan_mode`; iterate on feedback
   (further planner/critic passes are allowed); re-validate every revision.
   Never present an invalid plan.
5. Only after approval:
   a. Write `plan.json` (canonical shape above) AND an empty `state.json`
      (`.research-agent/projects/<id>/`) — **before any Linear side effect**.
   b. `linear_create_project` (approval-gated) → record the receipt
      (`state.json.project`).
   c. One `linear_create_issue` per node (marker-reconciled; auto-approved by
      default — see the Linear approval note below). Pass both identities:
      `projectId` is the Linear project UUID returned by
      `linear_create_project`, while `autoresearchProjectId` is the stable
      approved `plan.projectId`. The issue's generated specification block is
      rendered from the approved plan (node contract digest, kind, artifact
      format, roles, budget, plan revision) — never from caller prose; the
      tool appends the canonical marker
      `autoresearch-node:<autoresearchProjectId>:<nodeId>` and preserves
      user-authored text outside the block. Replaying synchronizes only the
      generated block; never create duplicates.
   d. After each receipt: update `state.json` immediately. A crash or retry
      must RECONCILE by marker (`linear_list_issues(projectId)` + status),
      never create duplicates.

## Phase 2 — Sequential execution (active-coordinator model)

1. `create_goal` (objective = the project; round cap = node count + 2). The
   goal tracks lifecycle/status only — never per-node checkpoints.
2. Once per active turn, deterministically recompute the ready set:
   `linear_list_issues(projectId)` → `autoresearch_project_status(projectId,
   linearIssues)` — the ready set is exactly the nodes whose `dependsOn` are
   all `done` per the state journal, identical on every replay.
3. For each ready node, while the turn is active:
   a. Fresh context intake: `linear_get_node_context` (Linear-backed nodes) —
      keep the returned `contextDigest`.
   b. Claim: `autoresearch_node_transition` (`claim`, with the
      `contextDigest`) → `linear_project_node` projects In Progress through
      the WAL/outbox.
   c. `autoresearch_init_run` (sourceType "linear", sourceUrl, node budget,
      and `projectId` + `nodeId` so the run binds to `node-contract.json` and
      every role task, acceptance, and finalization binds to the contract
      digest; pass the `contextDigest`).
   d. The FULL per-node AutoReason loop (section below).
   e. `autoresearch_record_acceptance` (mechanical receipt: every criterion
      accounted for, waivers need a recorded user decision, non-vacuity
      categories with counts/bytes/SHA-256, strict TeX for tex nodes).
   f. `autoresearch_finalize_run` (rejects contract-bound runs without a
      current acceptance receipt bound to the node-contract digest;
      Linear-backed projects additionally require the fresh `contextDigest`).
   g. `autoresearch_redact_check` → posting intent.
   **Execution-spec guard:** every role task and every coordinator acceptance
   check MUST include and be derived from the matching immutable `plan.json`
   node's `expectedOutcome`, `acceptance[]`, and `test`. The Linear issue body
   is provenance and user-feedback input only; it may never narrow, rename, or
   override approved requirements. Compare the issue body to the plan node at
   intake and record drift when they disagree; continue against `plan.json`
   unless the user approves a new plan revision. (Local-only projects:
   `autoresearch_init_run` with `sourceType "local"` and the complete node
   spec as the brief; skip the Linear intake steps.)
4. **Role semantics:** a node's `roles` is the ordered pipeline. Scouts run
   `budget.numScouts` parallel slices, judges run `budget.numJudges` parallel
   blind judges, every other listed role runs once in list order. Roles not
   listed are skipped (no judges listed → the incumbent wins at maxPasses).
   The canonical plan must set the corresponding count to `0` when
   `research_scout` or `research_judge` is omitted — a positive count for an
   omitted role is a plan validation ERROR, reported before execution. Never
   invent the omitted role.
5. **Mid-run comments re-pull (dedupe by id):** before each pass and before
   final posting, re-run `linear_list_comments`, keep only ids not in
   `state.json.commentCursors[<node>].seen`, append those comments to the
   run's `comments.md`, then advance the cursor:
   `autoresearch_project_status(projectId, cursor: { "<node>": [ids] })`.
   Feedback reaches the critic and judges exactly once.
6. **Finalization is receipt-driven, in this order:** post the final with
   `linear_create_comment` only when `state.json.finalCommentId` is empty, then
   immediately record its returned id; transition Linear to the configured
   final state and immediately record `linearState`; call
   `autoresearch_finalize_run`; only after it succeeds mark the node `done`,
   `runStatus: complete`, and `currentStep: complete`. On crash-retry, reconcile
   the recorded comment id, Linear state, and run status before replaying the
   next missing side effect — never double-post or mark a node done before the
   run is complete.

## The per-node AutoReason loop

This is the per-node AutoReason loop; it runs once per node. The integration
node instead runs the Phase 3 authoring workflow (editor + verifier only, no
A/B/AB). The coordinator orchestrates; every role runs in a fresh confined
subagent via `autoresearch_run_role`.

### Step 0 — per-node budget confirmation (always)

Before the first role of a node runs, report and pause for explicit user
confirmation:

- The IMMUTABLE plan-configured budget (`numScouts`, `numJudges`, `maxPasses`,
  `convergenceThreshold`) from the node;
- the EFFECTIVE (merged) budget: after `autoresearch_init_run` with
  projectId+nodeId, the contract budget is authoritative in `run.json`
  (caller overrides lose) — report any difference and log it in the pilot log;
- the EXECUTABLE scout/judge counts after applying the role list (omitted
  roles always execute zero times — the plan is invalid if it disagrees);
- for the planning loop, the planning budget (`config.planning`) separately;
- effective per-role models via `autoresearch_list_role_profiles`;
- `autoresearch_dependency_check` first (report any warnings), then
  `autoresearch_dependency_preflight` before dispatch: model routes and judge
  panels typed fail-closed (a missing judge panel is a blocker, never a
  silent local route), web provider ambiguity is a named blocker, TeX tooling
  + frozen templates + PDF rasterizer + bibliography styles
  (kpsewhich-resolved; missing/ambiguous styles are named warning findings
  before acceptance) + image tooling for figure nodes + confinement
  attestation status.

Do not spawn any role until the user confirms.

### Evidence phase → initial report → refinement loop

1. Parallel `research_scout` (numScouts slices) → save each under `evidence/`.
2. `evidence_verifier` → lock `evidence/evidence_brief.md`.
3. The kind's logical author (research_author, research_literature_writer,
   research_abstract_writer, or research_experiments_commentator) →
   `pass_00/A.<ext>` (`A.tex` for tex nodes, `A.md` for markdown); set the
   incumbent.
4. For each pass N (up to the node's maxPasses):
   - Copy incumbent → `pass_N/A.md`; checkpoint.
   - `research_critic` → `pass_N/critic.md`.
   - `research_author` (B) → `pass_N/B.md`.
   - `research_synthesizer` → `pass_N/AB.md`.
   - `autoresearch_anonymize_candidates`; every packet is built in memory and
     scanned before any file is written — a Candidate/Report A/B/AB identity
     leak fails closed with zero dispatchable files. Pass the returned flat
     typed primitives (never free-form paths) to `autoresearch_run_role` for
     judges; a mismatched pass/candidate set/run digest is rejected before
     spawn, and a judge context digest mismatch fails with a field-specific
     error. Judges see only anonymized packets, never maps or original IDs.
     A missing judge panel fails closed — no silent local route.
   - Parallel blind `research_judge` (numJudges) → `pass_N/judge_N.md`.
   - `autoresearch_parse_ranking` per judge → `autoresearch_score_borda`
     (records the tied set, configured priority, selected entry/index, and
     fallback status) → write `pass_N/result.json`.
   - Parse critic and judge responses with `autoresearch_parse_attribution`.
     Preserve only a strict fenced block with its run-relative transcript
     path, SHA-256, pass, judge index, valid-ranking result, and shared task
     context digest. Do not infer attribution from prose.
   - When a same-pass quorum names one strict upstream ancestor with current
     receipt/ledger evidence, call `autoresearch_revision_request` with the
     consumer `nodeId`, `pass`, and verified `attributions` (mode is read from
     project configuration).
   - Update `history.json` + incumbent + consecutive-A-wins; checkpoint.
5. Stop when stop criteria are met (consecutive-A-wins ≥ convergenceThreshold,
   or pass ≥ maxPasses).

### Lifecycle projection (Linear-backed projects)

Before role work, call `autoresearch_node_transition` with `claim` and a
lease/run reference (plus the fresh `contextDigest`), then call
`linear_project_node` with the same focused node and the team-scoped In
Progress state. On successful finalization, persist `complete` locally first,
then project `done`; on retryable failure, persist `retry` or `hold` locally
with structured `causalHolds`, then project the matching Linear state/hold.
Run `linear_sync_reconcile` after any remote error and before resuming. Never
mark a node done remotely before its local acceptance, artifact, ledger, and
finalize receipts are durable.

### Final reporting

1. `research_reporter` → `final.md`.
2. `autoresearch_redact_check` on `final.md` (no posting with blocking
   findings).
3. Post the final (Linear nodes) or save it (local nodes), then
   `autoresearch_finalize_run`.

### Runtime rules

1. Coordinator only orchestrates; all roles run through `autoresearch_run_role`.
2. `plan.json` remains immutable DAG/contract authority, `state.json` remains
   the operational journal, and Linear-backed `Current Node Context` remains
   authoritative current-work context. After compaction, re-read `run.json`,
   `history.json`, `resume.md`, `autoreason_loop_checklist.md`, then
   `autoresearch_validate_resume(runDir)` before touching artifacts.
3. Before role work: `autoresearch_dependency_check`, then
   `autoresearch_dependency_preflight`, then
   `autoresearch_list_role_profiles` once per node.
4. Before each role, construct a stable `logicalGroupKey` from run/step/pass,
   role, packet hash, contract digest, and selected route. Call
   `autoresearch_spawn_role(role, task)` for the profile-aware spawn
   plan/audit — it returns the recommended `autoresearch_run_role` call and
   does not spawn — then call `autoresearch_run_role` exactly once. The
   runner owns fresh spawn, the role's tool ceiling/persona, same-route
   bounded retry, complete attempt persistence, cancellation, and disposal.
   It returns a bounded preview plus `outputRef {path, hash, length,
   complete}`; the coordinator must verify `outputRef.complete === true` and
   promote it with `autoresearch_promote_artifact` (hash-checked,
   run-confined, same-hash replay idempotent) instead of copying reply text.
   On timeout the runner returns the recoverable but UNACCEPTED output
   reference (`complete: false`) and persists the terminal attempt; never
   auto-accept timeout artifacts.
5. Parallel scouts and judges: emit all N `autoresearch_run_role` calls in ONE
   message; collect all N results in the next step. Never background scoring.
6. After every promoted artifact, call `autoresearch_checkpoint`.
7. Never manually invent Borda scores, anonymization maps, or stop conditions
   when tools exist.
8. The runner owns bounded retry. Do not launch a second coordinator-level
   role call for the same `logicalGroupKey`. For judges, stop if fewer than 2
   valid rankings remain; otherwise surface the runner failure and never
   accept partial output.
9. Never fabricate sources; `autoresearch_redact_check` before posting.
10. Scratch ownership: build scratch and temp files live under the run
    directory or in owned run/attempt temporary paths — never in `outputs/`,
    in `/tmp`, or in an arbitrary shared path. Pipeline-owned scratch
    (preview rendering, format validators, role retries, publish
    staging/journals) is lifecycle-managed: every owned directory carries an
    owner marker with bounded retention (24h default TTL, 15-minute lease
    grace); successful scratch is removed after its consumers finish, and a
    failure retains only a bounded diagnostic reference before expiry.
    Non-TeX roles follow the same ownership and cleanup rule without TeX
    commands.
11. TeX hygiene: clean build outputs only with `latexmk -C`; never use raw
    `rm` on `.aux`/`.log`/`.pdf`/`pass_*` build artifacts. When a compile
    shows stale-aux symptoms (references resolved from a previous pass,
    phantom inputs, `Rerun to cross-reference` loops), run `latexmk -C` in the
    run directory before re-compiling.

### Config and role tuning

- Node budget comes from the plan node; workspace `.research-agent/config.json`
  supplies role models/prompts; `autoresearch_list_role_profiles` verifies
  (and `autoresearch_get_role_profile` resolves one role in detail).
- Roles: contentProducing = planner/author/synthesizer/reporter; supporting =
  scout/verifier/critic/judge. Model precedence: `roleProfiles.<role>.model` >
  `judgePanel[judgeIndex]` > bucket > harness default. `autoresearch_list_models`
  shows the live model registry to pick valid model strings from.
- `research_planner` (alias `planner`) is a planning-phase role only: it runs
  in Phase 1 (draft + revision passes) and is never listed in a node's
  `roles`. It ships with the preset (prompt `roles/research_planner.md`,
  planning budget in `config.planning`) — planning runs out of the box with
  no workspace configuration. Planning artifacts live under
  `.research-agent/planning/<projectId>/` with `pass_N/` naming.

## Phase 3 — Integration & verification (provenance-constrained)

The integration node (kind "integration") is an authoring workflow, not a
regular AutoReason loop: roles are the editor + verifier only, no A/B/AB, no
Borda, no scouts/judges. Integration states: `waiting_for_nodes` →
`analyzing` → `blocked_on_revisions` → `analyzing` → `drafting` →
`verifying` → `done`.

### Decision rule — editorial fix vs. kick back (integration editor)

The integration editor classifies every change into one of two actions; when
uncertain, kick back rather than weaken provenance.

- **Editorial (fix in place):** shorten/combine prose, adjust formatting, or
  move parts of a node's output to an appendix — always preserving each
  contribution's material meaning and adding/dropping no real content, and
  keeping every required contribution's disposition resolvable.
- **Kick back (reopen the owning node):** a contribution's material meaning
  must change; a required contribution needs a substantive rewrite; two node
  outputs conflict on substance; the node is so far over budget that trimming
  would remove required substance; or a criterion is
  missing/failed/reinterpreted. Route with `autoresearch_revision_request`.

Visual findings are recorded in `integration-coverage.json` (`visualFindings`
with action shorten|reformat|appendix|kickback and decision
editorial|substantive|conflict) and kick-backs are listed in
`integration-notes.json` for coordinator routing.

Note: visual inspection requires the integration editor to run on an
image-capable model (the role receives `read_image`). If your deployment's
configured route is text-only, point `research_integration_editor` at an
image-capable model in the deployment config, then re-run
`autoresearch_list_role_profiles` to confirm.

1. The `integration` node runs only when derived state confirms ALL approved
   leaves are `done` (a missing or in-flight leaf blocks it regardless of what
   Linear alone shows). Check `autoresearch_project_status` →
   `integration.ready`.
2. **Preflight.** `autoresearch_integration_preflight(projectId, nodeStates,
   findings)` computes the integration input digest over the project contract
   and every current node contract/output/acceptance hash and classifies
   findings: editorial (stays local), substantive/conflict (reopen the owning
   node), scope (block for user review). Any revised node input invalidates an
   older draft even when the plan revision is unchanged.
3. **Revision routing.** For a substantive/conflict finding:
   `autoresearch_revision_request` creates one idempotent request file and
   returns the marker
   `autoresearch-causal-event:<projectId>:<epoch>:<nodeId>:<digest>` and
   comment body; post it with `linear_create_comment(id, body,
   idempotencyMarker: marker)` (exactly one comment under replay), move the
   issue to In Progress, rerun the node in targeted revision mode, preserve
   output revision N and produce N+1 with a new hash and acceptance receipt,
   then recompute the preflight digest. Default limits: two revision rounds
   per node, three integration epochs.
4. **Authoring + visual inspection.** With no blocking finding, spawn
   `research_integration_editor`: it designs the final TeX outline, writes
   only connective/synthesis prose, and applies the decision rule above.
   Loop until clean:
   a. Editor drafts or revises `final.tex` and its coverage map.
   b. `autoresearch_render_preview(runDir, pageBudget=…)` builds (if needed)
      and renders the PDF to per-page PNGs under `<runDir>/preview/`,
      returning the page count.
   c. Re-spawn the editor with the rendered page-image paths; it inspects
      every page for page-limit overflow and formatting defects, classifies
      each (editorial vs substantive/conflict), applies editorial fixes, and
      returns kick-back findings for anything substantive.
   d. Route: editorial fixes are written back and re-rendered; substantive/
      conflict findings → `autoresearch_revision_request` (owning node) →
      rerun the node → recompute the preflight digest → re-author.
   The editor may not invent evidence, change locked units, silently choose
   between conflicting claims, omit a required contribution without a
   disposition, or patch a substantive finding itself.
5. **Verification.** `research_integration_verifier` audits
   coverage/fidelity/contradictions and returns findings only.
   `autoresearch_coverage_validate` enforces the claim map (an unsupported
   sentence inside an otherwise sourced paragraph fails);
   `autoresearch_tex_final_check` runs strict TeX verification: citation keys
   resolve, labels unique, no forbidden paths, missing graphics fail,
   texcount enforces the project word budget, a strict latexmk build passes,
   `.fls` inputs stay workspace-local, and hashes are recorded. Re-run
   `autoresearch_render_preview` once more and confirm the final page count is
   within budget and no page-limit/formatting defect remains.
6. **Project acceptance.** Record the integration node acceptance receipt
   (project criteria PASS or explicitly WAIVED) with
   `autoresearch_record_acceptance`, then finalize. **The project final is
   posted as a comment on the integration node's Linear issue** (settled
   policy: no project-update mutation exists). Then mark the integration
   node `done` with its `finalCommentId`, `checkpoint` receipts, and
   complete the goal (`update_goal complete`) — all while the coordinator
   turn is active.

## TeX acceptance rules (nodes and integration)

- `autoresearch_record_acceptance` writes the mechanical acceptance receipt
  bound to the node-contract digest and derives `node-output.json` (the
  contribution ledger) idempotently. Every plan criterion is
  PASS/FAIL/WAIVED/NOT_APPLICABLE; waivers need a recorded user decision,
  rationale, scope, and plan revision.
- TeX nodes run strict validation at node acceptance, not only at
  integration: comment-aware static rules + `latexmk -pdf
  -interaction=nonstopmode -halt-on-error -file-line-error -recorder`, never
  `-f`, never `-jobname`, with `SOURCE_DATE_EPOCH` pinned to the plan
  approval instant. A nonzero compiler exit cannot pass. Build-failure
  evidence records first error, line context, tail, command, and cleanup
  state.
- The scanner-derived declared needs are the source of truth; a hand-filled
  declared-list mismatch is a recorded non-blocking drift warning, not a
  failure.
- `node-output.json`: each top-level TeX section becomes a contribution unit
  with a slug `id`; cross-node contribution ids are `<nodeId>:<unitId>` —
  what `integration-coverage.json` (`sourceContributionIds`,
  `dispositions`) and revision requests reference. Re-accepting an unchanged
  artifact is idempotent (same `outputHash` + `nodeRevision` keeps the
  existing ledger).
- `autoresearch_finalize_run` on a contract-bound run requires a current
  acceptance receipt bound to the node-contract digest (and, for
  Linear-backed projects, the fresh `contextDigest`).

## Output policy (finalize — single source of truth)

`autoresearch_finalize_run` is one self-consistent finish step. The policy is
**exposure-driven and format-agnostic**: publish only the files the contract
says the user needs, plus the minimal source-support files that keep an
exposed source usable; everything else stays internal, and format-specific
validation applies only to the exposed artifacts that need it. No filename
extension is universal: a project may expose a PDF, a Markdown report, a TeX
source bundle, or nothing at all.

- **`projectContract.deliverables` is the sole exposure request.** Safe
  relative file paths only — no globs, no directory expansion, no
  filename-pattern discovery, no extension substitution. A requested
  companion (`references.bib`, `process-issues.md`, …) is just another entry
  in this list — stage it in a node run directory before acceptance; it is
  resolved in the fixed order integration run dir → node run dirs in plan
  order → workspace root. `[]` with no `diagnosticMappings` → finalize
  records `skipped` and creates no folder.
- **One user-facing folder: `outputs/<projectId>/`.** Contract-bound runs
  never create per-issue folders, and a bound non-integration node finalizes
  with no visible output at all.
- **Source support follows an exposed source, not a format.** When an exposed
  TeX master references local `\input`/`\include` targets or graphics, the
  minimal local closure is published as `source-support` entries even when
  `rebuildable` is false — and a missing input or an unresolved
  `\ref`/`\eqref` target FAILS publication, because the user's source must
  not be knowingly broken. A PDF-only or Markdown exposure gets no synthetic
  source closure and no TeX checks at all.
- **Full rebuild closure is opt-in.** `projectContract.rebuildable: true`
  (TeX only; requires an exposed `.tex` deliverable) additionally publishes
  the accepted `finalBuild` recorder closure plus the parsed
  `\bibliography`/`\addbibresource` union, with every recorded hash
  re-verified. Outside-root inputs are a non-relocatable failure.
- **Internal evidence is exposed only by explicit mapping.**
  `projectContract.diagnosticMappings` is an array of exact
  `{ sourcePath, destinationPath }` pairs whose destination must be under
  `audit/`. Receipts, ledgers, logs, previews, and compiler byproducts remain
  under `.research-agent/runs/` by default.
- **Standard layout when exposure is non-empty:**

  ```
  outputs/<projectId>/
    <declared deliverables>  <- exact paths from projectContract.deliverables
    <source-support files>   <- only when a TeX source is exposed
    <rebuild inputs>         <- only when rebuildable: true
    audit/                   <- only via explicit diagnosticMappings
    MANIFEST.json            <- every path: source, rule, SHA-256, requiredBy
  ```

- **`MANIFEST.json` makes the tree self-describing.** Every exposed path is
  attributed to its `sourceRule` (`declared`, `source-support`, `rebuild`,
  `audit`) with `requiredBy` and a SHA-256 hash. Pre-existing destination
  files that are not managed are inventoried under `preservedExisting` with
  their hashes — they are never deleted, pruned, or silently clobbered.
- **Fail closed, transactional, byte-exact, idempotent.** An unsafe project
  id, an unsafe or missing explicit file, a conflicting hash, a symlink, a
  directory, or an unmanaged destination file with different content fails
  BEFORE anything is written, and a failed requested publish propagates as a
  finalize error (never a soft success). Publication stages in a hidden
  owner-marked sibling under `outputs/` (same filesystem), installs through a
  rollback journal (back up → install → MANIFEST last → restore on failure),
  copies every entry byte-exactly (no text re-encoding), and recovers an
  interrupted transaction before the next finalize. A re-finalize with
  unchanged content changes neither managed content nor timestamps, and
  leaves unrelated sentinel files alone.
- **Scratch never lives in `outputs/`.** Compiler byproducts, preview images,
  candidate trees, caches, retry output, and the publish staging itself live
  in run-owned temporary paths with owner markers and bounded retention
  (default 24h TTL, 15-minute lease grace); cleanup runs at run
  start/finalize/recovery boundaries, is owner- and confinement-checked, and
  never sweeps an unrelated path.

## User feedback lifecycle (reopen → repair → reintegrate → republish)

A completed project can be reopened from user feedback, repaired at the
smallest responsible upstream closure, reintegrated, reverified, and
republished. The currently published output stays visible as last-known-good
until a replacement publication succeeds.

1. **Intake.** `autoresearch_submit_feedback` (coordinator-only) is the single
   intake. It persists a hash-addressed, idempotent `user-feedback` record
   whose `source`/`authority` are closed literals (`'user'`) — never tool
   arguments — so the coordinator cannot manufacture user authority from its
   own prose. `userAuthority` is computed from the last-known-good (LKG)
   integration recorded in `state.integration.lastKnownGood`:
   - `granted` — both supplied base digests (input + publish manifest) equal
     LKG;
   - `stale` — an LKG exists but a base digest mismatches (the feedback was
     not given against the current last-known-good); a stale digest can never
     claim a judge-quorum bypass;
   - `not-recorded` — no LKG exists yet (the project was never published).
2. **Triage.** `autoresearch_record_feedback_triage` (coordinator-only)
   classifies each item `editorial | substantive | conflict | scope |
   ambiguous` and derives the smallest responsible reopen closure from the
   substantive owners plus single-owner conflicts. Decision precedence for
   mixed item sets: `ambiguous` > `scope` > `conflict-user-choice` > `reopen`
   > `editorial-only` (clarify before rescoping, choose before reopening,
   reopen before polishing). `targetNodeIds` must equal the derived targets
   exactly.
3. **Reopen.** `autoresearch_revision_request` with `nodeIds` + `feedbackId`
   executes the multi-target reopen: cycle detection runs before any closure
   is computed; one request file is created per direct target (`supersedes` =
   that target's prior acceptance receipt); a single batched transaction
   resets targets → `todo` with `nodeRevision + 1`, gives dependents causal
   holds with the full blocker set, preserves unrelated completed nodes,
   clears receipts but never deletes historical runs, and bumps the
   integration epoch. Replays converge (request identity excludes
   `supersedes`/epoch).
4. **Close.** `autoresearch_close_feedback` runs the mechanical resolution
   gate: every triage target is journal-done with a fresh receipt that
   differs from the superseded one and is hash-bound to its `acceptance.json`;
   every triage `acceptanceCheck` (an owner criterion id) is PASS in a fresh
   owner receipt; the supplied `integrationInputDigest` differs from the
   feedback's `baseInputDigest`; the supplied `publishManifestDigest` equals
   the CURRENT LKG `manifestDigest`. On success a NEW resolved feedback
   version records the closure (`affectedNodeIds`, `receiptHashes`,
   `judgeQuorumBypass` applied only when `userAuthority` was `granted`), and
   the tool returns the one project-republished evidence event to project to
   the Linear integration issue.
5. **Last-known-good.** `autoresearch_finalize_run` on a successful
   integration publish records `state.integration.lastKnownGood = {
   manifestDigest (sha256 of the published MANIFEST.json bytes), inputDigest
   (nullable, from the optional integrationInputDigest argument), publishedAt,
   runId }`. A failed close/republish leaves LKG and the old publication
   intact.

## Byte-accurate document assembly (assembly nodes)

When an assembly/integration node reconstructs a document from components,
every byte outside the designated regions must be provably untouched. Import
the reference helpers in `tools/byte-utils.mjs` (`sha256`, `lineNo`,
`terminatorLength`, `regionExtent`, `extractBetweenMarkers`) instead of
re-implementing them inline.

1. **Hash raw bytes, never decoded text.** Decode strictly (UTF-8, fatal) for
   inspection AFTER hashing. Never strip a BOM, normalize Unicode or
   newlines, or trim before hashing.
2. **Full-line inclusive regions include the complete native line
   terminator** (`\r\n` or `\n`, whichever is present). Detect the terminator
   per region, never assume LF.
3. **Line numbers are LF-byte counts, not decoded-string slices.** Count
   `0x0a` bytes in the raw buffer up to a BYTE offset.
4. **Match anchors as bytes.** Require exactly one whole-file occurrence of
   each anchor; use a unique multi-line anchor when one line is not unique.
5. **Prove preservation by byte equality + SHA-256**, plus an independent byte
   diff with forward/reverse replay to prove there is no out-of-region
   change.
6. **Pre-existing compile defects (duplicate bibliography keys, missing
   figures, stray warnings) are findings, not assembly failures.** Prove the
   identical defect reproduces on the untouched baseline, record it as a
   pre-existing condition, and never silently edit a protected file to "fix"
   it — surface it for explicit authorization.

## Escalation protocol (ask_user_question, never self-blocking)

Never pause or mark the goal blocked on your own. Surface a condition and
request a decision; only the user's chosen option mutates state.

- **Non-convergence** (maxPasses without A-wins, or fewer than 2 valid judge
  rankings): options — accept incumbent and close / raise budget and rerun /
  change judges and rerun / edit the issue spec and rerun.
- **New discovery:** propose the node via `ask_user_question`. On approval,
  write a NEW approved `plan.json` revision (re-validate!), extend the
  integration node's `dependsOn`, create/reconcile the issue by marker, and —
  if integration started or completed — set integration back to not-done and
  bump `state.json.integrationRevision` (it re-runs before the goal
  completes).
- **Role failures** (`stopReason != completed`): retry once; surface partial
  output.
- **Feedback scope items:** require a new approved plan revision — never
  reopen around a scope change.

## Resume prompt

"Resume the AutoResearch project <projectId>" — then run
`linear_sync_reconcile` first for the project, refresh the focused Linear
graph, run `autoresearch_dependency_check` and `autoresearch_project_status`,
and follow each node's `nextAction`. Before a node turn, call
`linear_get_node_context` and claim only that node with the fresh digest;
after acceptance or failure, append the local WAL event, reconcile the
outbox, project status/causal holds and relations, then recompute readiness.
Never re-derive a ready set from Linear alone.

## Failure handling

- Plan invalid: fix and re-validate before any Linear side effect.
- Non-canonical plan on disk: run `autoresearch_migration_diagnostic`
  (closed-catalog legacy fingerprint); execution stays blocked until the
  offline migrator (`scripts/migrate-workspace.mjs`) proposes a canonical
  revision and a human approves it. The migrator never silently rewrites an
  approved plan.
- Drift (state/Linear/run mismatch): surface it; never auto-repair `plan.json`.
- Linear context missing/unavailable: `linear_get_node_context` returns
  `context-missing` (repair the owned block with
  `linear_update_node_context` before node work) or `linear-unavailable`
  (pause normal progression; the outbox holds pending writes as replayable
  intent only — it never authorizes claim/completion/publish).
- Linear auth failure: stop and ask for `LINEAR_API_KEY`.
- Linear approval: Linear creation/addition/query tools are AUTO-APPROVED by
  default (`linear.approval: "auto"` in the preset/workspace config). Set
  `linear.approval: "ask"` (workspace `.research-agent/config.json`, or env
  `DSH_LINEAR_APPROVAL=ask`) to restore approval prompts; with `ask`,
  unavailable/rejected approval fails closed and you must surface and retry
  after the user approves.
- Comment cursor: repulling the same page twice appends nothing new.
- Weak evidence: keep "Things Not Found"; do not invent sources.

## Tool reference (61 tools — the complete surface)

Only these names exist; do not invent or rename tools.

`autoresearch_*` (38):

- Run lifecycle: `autoresearch_init_run`, `autoresearch_checkpoint`,
  `autoresearch_validate_resume`, `autoresearch_regenerate_checklist`,
  `autoresearch_status`, `autoresearch_finalize_run`.
- Roles: `autoresearch_spawn_role`, `autoresearch_run_role`,
  `autoresearch_promote_artifact`, `autoresearch_publish_accepted`,
  `autoresearch_list_role_profiles`, `autoresearch_get_role_profile`,
  `autoresearch_list_models`.
- Judging: `autoresearch_anonymize_candidates`,
  `autoresearch_candidate_eligibility`, `autoresearch_parse_ranking`,
  `autoresearch_parse_attribution`, `autoresearch_score_borda`.
- Evidence: `autoresearch_presearch`, `autoresearch_redact_check`.
- Plan/state: `autoresearch_plan_validate`,
  `autoresearch_migration_diagnostic`, `autoresearch_node_transition`,
  `autoresearch_project_status`, `autoresearch_revision_request`,
  `autoresearch_integration_preflight`.
- Acceptance/TeX/publish: `autoresearch_record_acceptance`,
  `autoresearch_tex_check`, `autoresearch_tex_final_check`,
  `autoresearch_coverage_validate`, `autoresearch_render_preview`.
- Feedback: `autoresearch_submit_feedback`,
  `autoresearch_record_feedback_triage`, `autoresearch_close_feedback`.
- Preflight/probes: `autoresearch_dependency_check`,
  `autoresearch_dependency_preflight`, `autoresearch_capability_probe`,
  `autoresearch_build_probe`.

`linear_*` (23):

- Auth/context: `linear_whoami`, `linear_workspace_metadata`,
  `linear_capability_preflight`, `linear_build_probe`.
- Issues: `linear_create_project`, `linear_create_issue`, `linear_get_issue`,
  `linear_list_issues`, `linear_search_issues`, `linear_update_issue`,
  `linear_update_labels`.
- Comments/relations: `linear_create_comment`, `linear_list_comments`,
  `linear_create_relation`, `linear_list_relations`, `linear_plan_relations`.
- Node context: `linear_get_node_context`, `linear_update_node_context`,
  `linear_post_evidence_event`.
- Projection/sync: `linear_project_node`, `linear_sync_enqueue`,
  `linear_sync_plan_relations`, `linear_sync_reconcile`.
