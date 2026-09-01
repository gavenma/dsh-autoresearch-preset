---
name: research-project
description: "Run the standard AutoResearch project workflow end-to-end from a vague or open-ended brief: plan-mode DAG → human approval → Linear project + one issue per node → dependency-ordered AutoReason loops → integration and project final. A single work item is a one-node DAG plus integration."
whenToUse: "Use for vague or open-ended research, evidence-grounded analysis, or AutoResearch/AutoReason requests. When the user supplies a substantial outline, staged plan, table of contents, or work breakdown, load research-outline-project for Phase 1 planning; both modes share this execution workflow after approval."
---

# AutoResearch Project Mode Skill

Coordinate a whole research PROJECT: an approved plan DAG, one Linear issue per
node, one independent AutoReason loop per issue, and a final integration loop
that merges and verifies every leaf deliverable. This is the standard planning
mode and the shared execution workflow. When a user supplies a substantial
outline, load `research-outline-project` for Phase 1; after approval it returns
to this same workflow. A single work item is a one-node DAG plus its mandatory
`integration` node.

## Runtime conventions (tool behavior)

- **Path relativity:** tools that take both a `runDir` and a user path
  (`coverage_validate`, `tex_final_check`, `redact_check`, `record_acceptance`
  evidence, `publish_accepted`, `candidate_eligibility`, anonymize candidate
  overrides) accept paths as absolute, runDir-relative, or
  workspace-relative — absolute wins, then runDir-relative if it exists, then
  workspace-relative. Run-internal artifact names are always confined to the
  run directory.
- **Declared needs:** TeX `declared` needs accept either the canonical
  plural keys (`packages`, `macros`, `inputs`, `graphics`, `bibliographies`)
  or the plan `outputContract` keys (`declaredPackageNeeds`,
  `declaredMacroNeeds`, `declaredInputNeeds`, `declaredGraphicsNeeds`,
  `declaredBibliographyNeeds`); canonical keys win on conflict. When
  `declared` is omitted at acceptance, the node contract's `outputContract`
  fills it automatically.
- **Blind judging:** packet refs self-describe their judge count and
  canonical candidate paths; `judgeIndex` selects the judge-panel model only,
  never the count. Legacy refs validate against the run's configured
  `numJudges` and the historical sparse candidate-path map.
- **Binary hashing:** `.pdf/.png/.jpg/.jpeg/.gif/.gz/.zip/.bin` artifacts are
  hashed as raw bytes (64 MiB cap); text artifacts keep UTF-8 text hashes.
- **Revision routing:** `autoresearch_revision_request` resets the owning
  node AND its transitive downstream dependents to `todo` in `state.json`, so
  `autoresearch_integration_preflight` (which reads the journal) cannot
  accept stale downstream artifacts.
- **Planning directories are not `validate_resume`-resumable** (planning
  scaffolds carry `planning: true` and are excluded with a clear message).

## Runtime Source Of Truth

The AutoResearch workflow and its role/tool instructions are provided by the
installed DSH research preset under `~/.dsh/.agent-presets/research`. Use the
registered `autoresearch_*` and `linear_*` tools and this installed preset as
the runtime source. Do not inspect, import, execute, or ask roles to rely on
workspace development checkouts; those directories are archival/build sources
only.

The workspace `.research-agent/` directory is for run artifacts, approved
project plans, mutable receipt journals, and project-local configuration. It is
not the source of the AutoResearch skill or tool implementation.

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
  `externalResearch=true`; `autoresearch_dependency_check` reports these as
  separate checks. Backend preset edits require a preset remount/new session.
  After any preset edit, run `autoresearch_build_probe` and `linear_build_probe`:
  both must report the same candidate aggregate build ID and `graphMatches:true`
  (a mismatch means the session runs a stale generation — start a new blank
  research session).
- Linear credentials for the Linear path (`LINEAR_API_KEY`; `linear_whoami`
  verifies). Local-only projects work without Linear: keep `plan.teamId`
  absent and skip Linear steps — `autoresearch_project_status` still drives
  the DAG.
- Artifact root: new workspaces keep internal plans, receipts, packets, and runs
  under hidden `.research-agent/`; completed user-facing deliverables are published
  under `outputs/<issueId>/`. Legacy `research-agent/` and `.research-agent/`
  projects remain readable. The selected internal root is recorded in run metadata
  and status; the visible output directory is created only when a run finalizes.

## Authority model (settled policy — never deviate)

1. **`plan.json` is the immutable approved specification.** It is written only
   after plan-mode approval and only as a new revision after an approved
   discovery. Never rewrite it silently; never let Linear or state edits flow
   back into it.
2. **`state.json` is the mutable receipt journal** (node statuses, Linear ids,
   run dirs, comment cursor, integration revision). The coordinator writes it
   with the fs write tool after every side effect; `autoresearch_project_status`
   reads it and advances only the comment cursor.
3. **Linear is a derived view.** Any disagreement is DRIFT, surfaced per node
   by `autoresearch_project_status`; resolve drift through
   `ask_user_question`, never by rewriting `plan.json`.
4. **Work advances only while you (the coordinator) have an active turn.**
   The goal is lifecycle/status only. Resuming after interruption: call
   `autoresearch_project_status` and follow each node's `nextAction`.

## Phase 1 — Plan via the planning AutoReason loop → review → approve → create

The plan itself is a research artifact: it is produced by a dedicated
`research_planner` role and refined through its own AutoReason loop (blind
Borda judging) BEFORE it is ever presented for approval. The coordinator never
hand-writes the plan.

1. **Recon (coordinator, keep it light):** read the brief(s) and named source
   material, `web_search` for audience context (e.g. panel structure),
   `linear_workspace_metadata` when Linear is in scope. Do NOT draft the plan.
2. **Planner draft (`research_planner` role).** Run the confined
   `research_planner` role via `autoresearch_spawn_role` +
   `autoresearch_run_role` with the full brief context. It returns a PI-style
   rationale plus a plan JSON. Save both as
   `.research-agent/planning/<projectId>/plan_00/A.md` (plan A) and extract the
   JSON to `.research-agent/<projectId>.plan-draft.json`; validate it with
   `autoresearch_plan_validate` (by `path`). `research_planner` is a
   planning-phase role and must NEVER appear in a node's `roles`.
   Naming: `pass_N/` is canonical for execution artifacts; `plan_N/` under
   `.research-agent/planning/<projectId>/` is the planning-only compatibility
   alias. `autoresearch_anonymize_candidates` resolves `pass_N/<id>.<ext>`
   first and falls back to `plan_N/<id>.<ext>`, and auto-creates a minimal
   planning `run.json` scaffold (with `planning: true` and the current judge
   count) when the planning directory has none; real execution runs are never
   overwritten, and a scaffold whose judge count contradicts the invocation
   fails closed. Derive the anonymization judge count from the same planning
   budget every pass.
3. **Planning refinement loop (AutoReason-style, over the plan itself),** with
   the planning budget from `config.planning` (defaults `numJudges: 2,
   maxPasses: 2, convergenceThreshold: 2`). For each pass N up to `maxPasses`:
   - Copy the incumbent plan → `plan_N/A.md`.
   - `research_critic` critiques the plan as a plan (purpose per node, scope
     and length, mechanical acceptance/tests, dependency logic, budgets,
     feasibility, panel fit) → `plan_N/critic.md`.
   - `research_planner` produces plan B (a revision that addresses the
     critique) → `plan_N/B.md`.
   - `research_synthesizer` merges A + B → `plan_N/AB.md`.
   - `autoresearch_anonymize_candidates` (runDir = planning dir, pass N) →
     parallel blind `research_judge` (numJudges): pass each judge the typed `packetRef` returned in the anonymize result (`judges[j-1].packetRef`), spawn exactly the returned judge count, and never re-derive references → `autoresearch_parse_ranking`
     per judge → `autoresearch_score_borda` → write `plan_N/result.json`;
     update the incumbent and the consecutive-A-wins counter.
   - Stop when consecutive A wins ≥ convergenceThreshold or pass ≥ maxPasses.
4. **Validate + present.** Extract the winner's JSON to
   `.research-agent/<projectId>.plan-draft.json` and run
   `autoresearch_plan_validate` (plan object or `path`/`projectId`) before
   EVERY presentation. Present through `exit_plan_mode`; iterate on feedback
   (further planner/critic passes are allowed); re-validate every revision.
   Never present an invalid plan. New plans use schemaVersion 2: node shape
   (enforced by the planner prompt and the validator) adds an explicit `kind`
   (research | literature | abstract | code | experiment | experiments |
   assembly | integration), `artifactFormat` (default "tex"), stable
   acceptance criterion IDs, `verification` (template path), and
   `outputContract` (texMode + declared needs); the plan carries a root
   `projectContract` (goal, deliverables, project acceptance with IDs, word
   budget). `numScouts`/`numJudges` are 0 when the roles omit scout/judge — a
   positive count for an omitted role is an ERROR in v2. The integration node
   has kind "integration" (editor + verifier only, no A/B/AB). v1 plans stay
   readable as legacy; new execution requires an approved v2 revision
   (`autoresearch_migration_diagnostic` reports the exact proposed diff and
   never rewrites the plan). **Document
   rewrites must be decomposed at the section level:** a node may never
   rewrite a whole multi-section document on its own; plan one node per
   section/component (abstract; objectives; research context / literature
   review; mathematical core; algorithmic or experimental components;
   impact and education; ...), each producing its own draft, followed by ONE
   assembly node that merges the drafts into the final artifact and runs the
   global preservation/compilation checks — the integration node then
   re-verifies the assembled whole. The planner role enforces this standard
   in its prompt.
5. Only after approval:
   a. Write `plan.json` (schema below) AND an empty `state.json`
      (`.research-agent/projects/<id>/`) — **before any Linear side effect**.
   b. `linear_create_project` (approval-gated) → record the receipt
      (`state.json.project`).
   c. One `linear_create_issue` per node (marker-reconciled; auto-approved by
      default — see the Linear approval note below). Pass both identities:
      `projectId` is the Linear project UUID returned by
      `linear_create_project`, while `autoresearchProjectId` is the stable
      approved `plan.projectId`. Embed in the description the node objective,
      acceptance criteria, roles, budget, and test approach; the tool appends
      the canonical marker
      `autoresearch-node:<autoresearchProjectId>:<nodeId>`.
      Existing issues carrying the pre-fix UUID-keyed marker are migrated in
      place by this same idempotent call; never create duplicates.
   d. After each receipt: update `state.json` immediately. A crash or retry
      must RECONCILE by marker (`linear_list_issues(projectId)` + status),
      never create duplicates. During migration, `autoresearch_project_status`
      recognizes the legacy marker through `state.project.linearProjectId` and
      reports `legacy-node-marker` until the issue receipt replay canonicalizes
      it.

### plan.json schema (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "projectId": "demo-proj",
  "projectName": "Demo research project",
  "teamId": "t1",
  "teamKey": "ENG",
  "approvedAt": "2025-01-01T00:00:00.000Z",
  "revision": 1,
  "integrationId": "integration",
  "nodes": [
    {
      "id": "lit-review",
      "title": "Literature review",
      "roles": ["research_scout", "evidence_verifier"],
      "expectedOutcome": "evidence/evidence_brief.md with a gap statement",
      "acceptance": [">= 15 sources", "explicit gap statement"],
      "test": "fact-check 5 random citations against URLs",
      "budget": { "numScouts": 2, "numJudges": 2, "maxPasses": 1 },
      "dependsOn": []
    }
  ]
}
```

### plan.json schema v2 (current standard)

A v2 plan adds `schemaVersion: 2`, a root `projectContract`, and per-node
`kind`/criterion IDs/verification. Every ordinary v2 node defaults to
`artifactFormat: "tex"` and produces `output.tex` (semantic TeX fragment or
standalone), `preview.tex` (generated wrapper for fragment mode — never
model-authored), `node-output.json` (hash, revision, texMode, declared
package/macro needs, contribution ledger), `acceptance.json` (the mechanical
receipt bound to the node-contract digest), and `final.md` (the audit
certificate, not the product). Strict TeX validation (static rules +
`latexmk -pdf -interaction=nonstopmode -halt-on-error -file-line-error
-recorder`, never `-f`) runs at node acceptance, not only at integration. A
nonzero compiler exit can never pass.

### state.json schema (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "projectId": "demo-proj",
  "createdAt": "...", "updatedAt": "...",
  "project": { "linearProjectId": "...", "url": "...", "createdAt": "..." },
  "integrationRevision": 1,
  "nodes": {
    "lit-review": {
      "status": "todo | in_progress | done | blocked",
      "issueId": "", "identifier": "", "url": "", "linearState": "",
      "runDir": "", "runStatus": "", "currentStep": "", "currentPass": null,
      "hasFinal": false, "finalCommentId": "", "receipts": [], "updatedAt": ""
    }
  },
  "commentCursors": { "lit-review": { "seen": ["<linear comment ids>"], "updatedAt": "..." } },
  "lastError": ""
}
```

## Phase 2 — Sequential execution (active-coordinator model)

1. `create_goal` (objective = the project; round cap = node count + 2). The
   goal tracks lifecycle/status only — never per-node checkpoints.
2. Once per active turn, deterministically recompute the ready set:
   `linear_list_issues(projectId)` → `autoresearch_project_status(projectId,
   linearIssues)` — the ready set is exactly the nodes whose `dependsOn` are
   all `done` per state, identical on every replay.
3. For each ready node, while the turn is active:
   `linear_get_issue` + `linear_list_comments` → `autoresearch_init_run`
   (sourceType "linear", sourceUrl, node budget, and — for v2 Project Mode —
   `projectId` + `nodeId` so the run binds to `node-contract.json` and every
   role task, acceptance, and finalization binds to the contract digest) →
   the FULL per-node AutoReason loop (section below) →
   `autoresearch_record_acceptance` (mechanical receipt: every criterion
   accounted for, waivers need a recorded user decision, non-vacuity
   categories with counts/bytes/SHA-256, strict TeX for tex nodes) →
   `autoresearch_finalize_run` (rejects v2 runs without a current receipt) →
   `autoresearch_redact_check` → posting intent.
   **Execution-spec guard:** every role task and every coordinator acceptance
   check MUST include and be derived from the matching immutable `plan.json`
   node's `expectedOutcome`, `acceptance[]`, and `test`. The Linear issue body is
   provenance and user-feedback input only; it may never narrow, rename, or
   override approved requirements. Compare the issue body to the plan node at
   intake and record `linear-spec-drift` in `state.json.lastError` and the pilot
   log when they disagree; continue against `plan.json` unless the user approves
   a new plan revision. (Local-only projects: `autoresearch_init_run` with
   `sourceType "local"` and the complete node spec as the brief; skip the Linear
   intake steps.)
4. **Role semantics:** a node's `roles` is the ordered pipeline. Scouts run
   `budget.numScouts` parallel slices, judges run `budget.numJudges` parallel
   blind judges, every other listed role runs once in list order. Roles not
   listed are skipped (no judges listed → the incumbent wins at maxPasses).
   New plans must set the corresponding count to `0` when `research_scout` or
   `research_judge` is omitted. For backward compatibility, validation warns on
   an unreachable positive count and normalizes its executable value to `0`.
   Never invent the omitted role: report both the immutable configured count
   and executable count `0` at Step 0 and record the plan inconsistency in the
   pilot log.
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

## Phase 3 — Integration & verification (provenance-constrained)

The integration node (kind "integration") is an authoring workflow, not a
regular AutoReason loop: no A/B/AB, no Borda. States: waiting_for_nodes →
analyzing → blocked_on_revisions → analyzing → drafting → verifying → done.

### Decision rule — editorial fix vs. kick back (integration editor)

The integration editor classifies every change into one of two actions; when
uncertain, kick back rather than weaken provenance.

- **Editorial (fix in place):** shorten/combine prose, adjust formatting, or
  move parts of a node's output to an appendix — always preserving each
  contribution's material meaning and adding/dropping no real content, and
  keeping every required contribution's disposition resolvable.
- **Kick back (reopen the owning node):** a contribution's material meaning must
  change; a required contribution needs a substantive rewrite; two node outputs
  conflict on substance; the node is so far over budget that trimming would
  remove required substance; or a criterion is missing/failed/reinterpreted.
  Route with `autoresearch_revision_request`.

Visual findings are recorded in `integration-coverage.json` (`visualFindings`
with action shorten|reformat|appendix|kickback and decision
editorial|substantive|conflict) and kick-backs are listed in
`integration-notes.json` for coordinator routing.

Note: visual inspection requires the integration editor to run on a multimodal
model. The shipped default runs it on `deepseek-official/deepseek-v4-flash`,
and the built-in role manifest grants it `read_image`; if your deployment's
default model is text-only, point `research_integration_editor` at a multimodal
model via the workspace config or `config.local.json`. Existing workspaces with
their own `.research-agent/config.json` may still pin a text-only model or a
narrowed tool list for `research_integration_editor`; update that entry (or
delete it to fall back to the preset default) and re-run
`autoresearch_list_role_profiles` to confirm.

1. The `integration` node runs only when derived state confirms ALL approved
   leaves are `done` (a missing or in-flight leaf blocks it regardless of what
   Linear alone shows). Check `autoresearch_project_status` →
   `integration.ready`.
2. **Preflight.** `autoresearch_integration_preflight(projectId, nodeStates,
   findings)` computes the input digest over the project contract and every
   current node contract/output/acceptance hash and classifies findings:
   editorial (stays local), substantive/conflict (reopen the owning node),
   scope (block for user review). Any revised node input invalidates an older
   draft even when the plan revision is unchanged.
3. **Revision routing.** For a substantive/conflict finding:
   `autoresearch_revision_request` creates one idempotent request file and
   returns the marker
   `autoresearch-revision-request:<projectId>:<epoch>:<nodeId>:<digest>` and
   comment body; post it with `linear_create_comment(id, body,
   idempotencyMarker: marker)` (exactly one comment under replay), move the
   issue to In Progress, rerun the node in targeted revision mode, preserve
   output revision N and produce N+1 with a new hash and acceptance receipt,
   then recompute the preflight digest. Default limits: two revision rounds
   per node, three integration epochs.
4. **Authoring + visual inspection.** With no blocking finding, spawn
   `research_integration_editor` (read + read_image): it designs the final TeX
   outline, writes only connective/synthesis prose, and applies the decision
   rule above. Loop until clean:
   a. Editor drafts or revises `final.tex` and its coverage map.
   b. `autoresearch_render_preview(runDir, pageBudget=…)` builds (if needed)
      and renders the PDF to per-page PNGs, returning the page count.
   c. Re-spawn the editor with the rendered page-image paths; it inspects every
      page for page-limit overflow and formatting defects, classifies each
      (editorial vs substantive/conflict), applies editorial fixes, and returns
      kick-back findings for anything substantive.
   d. Route: editorial fixes are written back and re-rendered; substantive/
      conflict findings → `autoresearch_revision_request` (owning node) → rerun
      the node → recompute the preflight digest → re-author.
   The editor may not invent evidence, change locked units, silently choose
   between conflicting claims, omit a required contribution without a
   disposition, or patch a substantive finding itself.
5. **Verification.** `research_integration_verifier` (read-only, exactly
   `read`) audits coverage/fidelity/contradictions and returns findings only.
   `autoresearch_coverage_validate` enforces the claim map (an unsupported
   sentence inside an otherwise sourced paragraph fails);
   `autoresearch_tex_final_check` runs strict TeX verification: citation keys
   resolve, labels unique, no forbidden paths, missing graphics fail,
   texcount enforces the project word budget, a strict latexmk build passes,
   .fls inputs stay workspace-local, and hashes are recorded. Re-run
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

## Byte-accurate document assembly (preservation-first merges)

When an assembly/integration node reconstructs a document from components, every
byte outside the designated regions must be provably untouched. Import the
reference helpers in `tools/byte-utils.mjs` (`sha256`, `lineNo`,
`terminatorLength`, `regionExtent`, `extractBetweenMarkers`) instead of
re-implementing them inline. Observe these invariants — they reproduce in ANY
workspace and session, not just the one where they were first hit:

1. **Hash raw bytes, never decoded text.** `sha256(Buffer)` only. Decode strictly
   (UTF-8, fatal) for inspection AFTER hashing. Never strip a BOM, normalize
   Unicode or newlines, or trim before hashing.
2. **Full-line inclusive regions include the complete native line terminator.**
   A region that replaces a whole line spans from the start anchor's first byte
   through the end anchor PLUS its actual terminator (`\r\n` or `\n`, whichever
   is present). Mixed line endings are common in real documents: detect the
   terminator per region, never assume LF, and never include it conditionally on
   the next byte (that yields internally inconsistent region hashes).
3. **Line numbers are LF-byte counts, not decoded-string slices.** Count `0x0a`
   bytes in the raw buffer up to a BYTE offset. Slicing a decoded UTF-8 string
   with a byte offset breaks the moment a multi-byte character (smart quote,
   em/en dash, math symbol) precedes the offset — byte and character offsets
   diverge.
4. **Match anchors as bytes.** Store boundaries so they round-trip to exact file
   bytes (UTF-8 JSON strings for UTF-8 sources). Require exactly one whole-file
   occurrence of each anchor; use a unique multi-line anchor when one line is not
   unique.
5. **Prove preservation by byte equality + SHA-256**, plus an independent byte
   diff with forward/reverse replay to prove there is no out-of-region change.
6. **Pre-existing compile defects (duplicate bibliography keys, missing figures,
   stray warnings) are findings, not assembly failures.** Prove the identical
   defect reproduces on the untouched baseline, record it as a pre-existing
   condition, and never silently edit a protected file to "fix" it — surface it
   for explicit authorization.

## Per-node AutoReason loop (the loop every node runs)

This is the per-node AutoReason loop; it runs once per node, and once more over the merged deliverable in the integration node. The coordinator orchestrates; every role runs in a fresh confined subagent via `autoresearch_run_role` — never hand roles your own tools.

### Step 0 — per-node budget confirmation (always)

Before the first role of a node runs, report and pause for explicit user
confirmation:

- The IMMUTABLE plan-configured budget (`numScouts`, `numJudges`, `maxPasses`,
  `convergenceThreshold`) from the node;
- the EFFECTIVE (merged) budget: after `autoresearch_init_run` with
  projectId+nodeId, the contract budget is authoritative in `run.json`
  (caller overrides lose) — report any difference and log it in the pilot log;
- the EXECUTABLE scout/judge counts after applying the role list (omitted
  roles always execute zero times);
- for the planning loop, the planning budget (`config.planning`) separately.
- Effective per-role models via `autoresearch_list_role_profiles`.
- Run `autoresearch_dependency_check` first and report any warnings.

Do not spawn any role until the user confirms.

### Evidence phase → initial report → refinement loop

1. Parallel `research_scout` (numScouts slices) → save each under `evidence/`.
2. `evidence_verifier` → lock `evidence/evidence_brief.md`.
3. The kind's logical author (research_author, research_literature_writer,
   research_abstract_writer, or research_experiments_commentator) →
   `pass_00/A.<ext>` (`A.tex` for tex nodes, `A.md` for legacy/markdown);
   set the incumbent.
4. For each pass N (up to the node's maxPasses):
   - Copy incumbent → `pass_N/A.md`; checkpoint.
   - `research_critic` → `pass_N/critic.md`.
   - `research_author` (B) → `pass_N/B.md`.
   - `research_synthesizer` → `pass_N/AB.md`.
   - `autoresearch_anonymize_candidates`; every packet is built in memory and
     scanned before any file is written — a Candidate/Report A/B/AB identity
     leak fails closed with zero dispatchable files. Pass the returned typed
     `packetRef` (never free-form paths) to `autoresearch_run_role` for
     judges; a mismatched pass/candidate set/run digest is rejected before
     spawn. Judges see only anonymized packets, never maps or original IDs.
   - Parallel blind `research_judge` (numJudges) → `pass_N/judge_N.md`.
   - `autoresearch_parse_ranking` per judge → `autoresearch_score_borda`
     (records the tied set, configured priority, selected entry/index, and
     fallback status) → write `pass_N/result.json`.
   - Parse critic and judge responses with `autoresearch_parse_attribution`.
     Preserve only a strict fenced block with its run-relative transcript path,
     SHA-256, pass, judge index, valid-ranking result, and shared task context
     digest. Do not infer attribution from prose.
   - When a same-pass quorum names one strict upstream ancestor with current
     receipt/ledger evidence, call `autoresearch_revision_request` with the
     consumer `nodeId`, `pass`, and verified `attributions`. The tool reads
     `backtracking.mode` from config: `observe` records without resetting nodes;
     `enforce` retargets through canonical revision routing.
   - Update `history.json` + incumbent + consecutive-A-wins; checkpoint.
5. Stop when stop criteria are met (consecutive-A-wins ≥ convergenceThreshold,
   or pass ≥ maxPasses).

### Final reporting

1. `research_reporter` → `final.md`.
2. `autoresearch_redact_check` on `final.md` (no posting with blocking findings).
3. Post the final (Linear nodes) or save it (local nodes), then
   `autoresearch_finalize_run`.

### Runtime rules

1. Coordinator only orchestrates; all roles run through `autoresearch_run_role`.
2. Artifacts on disk are the source of truth. After compaction, re-read
   `run.json`, `history.json`, `resume.md`, `autoreason_loop_checklist.md`,
   then `autoresearch_validate_resume(runDir)` before touching artifacts.
3. Before role work: `autoresearch_dependency_check`, then
   `autoresearch_list_role_profiles` once per node.
4. Before each role, construct a stable `logicalGroupKey` from run/step/pass,
   role, packet hash, contract digest, and selected route. Call
   `autoresearch_spawn_role(role, task)` for the audit, then call
   `autoresearch_run_role` exactly once. The runner owns fresh spawn, the role's
   read-only tool ceiling/persona, same-route bounded retry, complete attempt
   persistence, cancellation, and disposal. It returns a bounded preview plus
   `outputRef`; the coordinator must verify `outputRef.complete === true` and
   promote it with `autoresearch_promote_artifact` instead of copying reply text.
   Both tools inject the workspace root and absolute run artifact root; paths
   beginning `evidence/`, `pass_*`, `packets/`, or run metadata names resolve
   under the run root, not the workspace root.
5. Parallel scouts and judges: emit all N `autoresearch_run_role` calls in ONE
   message; collect all N results in the next step. Never background scoring.
6. After every promoted artifact, call `autoresearch_checkpoint`.
7. Never manually invent Borda scores, anonymization maps, or stop conditions
   when tools exist.
8. The runner owns bounded retry. Do not launch a second coordinator-level role call for the same `logicalGroupKey`. for judges, stop
   if fewer than 2 valid rankings remain; otherwise surface the runner failure and never accept partial output.
9. Never fabricate sources; `autoresearch_redact_check` before posting.

### Config and role tuning

- Node budget comes from the plan node; workspace `.research-agent/config.json`
  supplies role models/prompts; `autoresearch_list_role_profiles` verifies.
- Roles: contentProducing = planner/author/synthesizer/reporter; supporting =
  scout/verifier/critic/judge. Model precedence: `roleProfiles.<role>.model` >
  `judgePanel[judgeIndex]` > bucket > harness default.
- `research_planner` (alias `planner`) is a planning-phase role only: it runs
  in Phase 1 (draft + revision passes) and is never listed in a node's
  `roles`. It ships with the preset (prompt `roles/research_planner.md`,
  tools read+web_search, model and `planning` budget in
  `config.default.json`) — planning runs out of the box with no workspace
  configuration. The planning loop budget comes from `config.planning`
  (defaults `numJudges: 2, maxPasses: 2, convergenceThreshold: 2`); planning
  artifacts live under `.research-agent/planning/<projectId>/`.

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
  bump `state.json.integrationRevision` (it re-runs before the goal completes).
- **Role failures** (`stopReason != completed`): retry once; surface partial
  output.

## Resume prompt

"Resume the AutoResearch project <projectId>" — then run
`autoresearch_dependency_check`, `autoresearch_project_status`, and follow
each node's `nextAction`. Never re-derive a ready set from Linear alone.

## Failure handling

- Plan invalid: fix and re-validate before any Linear side effect.
- Drift (state/Linear/run mismatch): surface it; never auto-repair `plan.json`.
- Linear auth failure: stop and ask for `LINEAR_API_KEY`.
- Linear approval: Linear creation/addition/query tools are AUTO-APPROVED by
  default (`linear.approval: "auto"` in the preset/workspace config). Set
  `linear.approval: "ask"` (workspace `.research-agent/config.json`, or env
  `DSH_LINEAR_APPROVAL=ask`) to restore approval prompts; with `ask`,
  unavailable/rejected approval fails closed and you must surface and retry
  after the user approves.
- Comment cursor: repulling the same page twice appends nothing new.
- Weak evidence: keep "Things Not Found"; do not invent sources.
