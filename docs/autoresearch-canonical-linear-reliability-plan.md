# AutoResearch Canonical Linear Reliability Plan

Status: implementation plan (revised after the requested Grok 4.6 and Qwen Max critique rounds)

Critique sequence applied:

1. DeepSeek v4 Pro
2. Grok 4.6
3. DeepSeek v4 Pro
4. Grok 4.6 (coherence and coverage re-check)
5. Qwen Max (final consistency pass)

The additional rounds are recorded in section 14. They reject point-wise patching and tighten three systemic controls: confinement attestation before broad role tooling, one generated tool-schema boundary, and one narrative context with no local mirror.

This plan supersedes the schema-versioning and local-first operational assumptions in the older hardening plan. It does not replace the approved-project invariants: approved scope remains explicit, evidence remains hash-bound, blind judging remains blind, and accepted outputs remain transactional.

## 1. Objective

Build one coherent AutoResearch execution system in which:

- every AutoResearch-owned record uses one canonical, unversioned shape;
- every role receives a typed task packet with the capabilities and inputs its contract requires, inside an attested read/write/egress scope;
- role output is concise, machine-readable, persisted through one coordinator-controlled path, and discoverable without chat memory;
- a completed project can be reopened from user feedback, repaired at the smallest responsible upstream closure, reintegrated, reverified, and republished;
- in Linear mode, Linear is the evolving operational source of truth that both agents and humans query before acting;
- local files hold artifacts, hashes, receipts, and crash-recovery data, but an agent does not need hidden local history to understand a Linear node;
- common process, tool, transport, permission, TeX, recovery, and publication defects are caught before or at their owning boundary.

## 2. Diagnosis From `reported_bugs_0908.md`

The project-specific content problems should not drive preset architecture. The common failures fall into seven reusable classes.

### 2.1 Contract and schema fragmentation

- Planner JSON can be malformed or extracted from the wrong heading.
- Runtime code accepts or discusses multiple plan shapes.
- Policy markers and legacy adapters create hidden schema branches beyond the explicit plan version field.
- Duplicate validators and string-or-object unions let tools, prompts, tests, and agents disagree.
- Tool schemas often use open objects, so nested fields can change type across transport boundaries.

### 2.2 Capability and permission mismatch

- Plans can assign roles that cannot compile, render, write, inspect images, or run acceptance commands.
- Many roles were configured with only `read`, so they could not independently search, inspect, run useful checks, or create scoped working artifacts; coordinator persistence was also manual and error-prone.
- `bash` and tool allowlists are not a run-directory chroot, so the preset must not claim stronger confinement than DSH provides.
- Figure preparation and image-aware review are not represented cleanly in node capability checks.

### 2.3 Scattered, verbose, or ambiguous role output

- Critics can emit deliberation before the usable result.
- Synthesizer and abstract outputs can remain buried in attempt files.
- Judges rely on brittle ranking text and ambiguous labels.
- The coordinator has to reconstruct artifact provenance and next actions from model responses and filenames.

### 2.4 Blind judging and routing defects

- Candidate identity can leak through comments, provenance text, or naive heading scans.
- Shared TeX content can trigger false positives.
- Judge task context can be discarded.
- Nested packet references can fail digest validation after type coercion.
- Judge-panel fallback can occur without a sufficiently visible route/source record.

### 2.5 Weak preflight, diagnostics, and recovery

- Fetch-provider ambiguity is reported too late or too vaguely.
- Bibliography styles, image tools, templates, rasterizers, and exact role capabilities are not fully preflighted.
- `/tmp` behavior wastes retries when scratch should be workspace-relative.
- TeX failures expose too little log context.
- Timeouts and provider failures can leave complete, recoverable artifacts that the workflow does not surface.

### 2.6 Acceptance and publication edge cases

- TeX marker and forbidden-token scans do not all use the same comment-aware source.
- Reproducible builds are not epoch-pinned.
- Word count can miss input fragments.
- `finalBuild` is not derived naturally from a clean accepted build.
- Non-UTF8 files, cross-root name collisions, and duplicate master aliases can block or confuse publication.

### 2.7 Linear context is too thin

- The issue description contains a contract block but not a reliable current work picture.
- Causal comments say that a node is blocked, but not enough about what was done, what evidence supports it, why it reopened, or what happens next.
- `linear_get_issue` does not include comments in the node context.
- Agents can query a node and still lack the history and current intent needed to resume correctly.
- An append-only comment stream would not solve this by itself; it would become long and difficult to interpret.

### 2.8 Issue traceability from `reported_bugs_0908.md`

This plan is not a one-fix-per-ticket patch list. The table below groups the preset-relevant reports by architectural cause and records the owning section. Every group must end in a regression fixture, not just a prompt note.

| Report(s) | Architectural cause | Owning section |
|---|---|---|
| P-001, P-002, P-003, P-004, P-028 | Preflight cannot distinguish provider ambiguity from absence; image/scratch/sandbox realities are undocumented and unprobed. | §5.3, §9, Phase 2 |
| P-005 | Figure/assets work has no canonical node kind and no image-aware judging option. | §4.1, §5.1, §5.2 |
| P-007, P-008, P-009, P-023 | Planner/critic/judge outputs are prose-first, ambiguous, or parsed by brittle text search. | §4.1, §6.2, §6.4 |
| P-010, P-020, P-020a | Role capability ceilings are not derived from node acceptance needs; coordinator manually persists role work. | §5.1, §5.2, §6.3, Phase 2 |
| P-011, P-012, P-013, P-014, P-021, P-022, P-029 | Blind transport mixes open objects, shared context, provenance text, label parsing, and hidden pass indexing. | §6.5, Phase 3 |
| P-015, P-032 | Route resolution can silently fall back or lose the actual provider record. | §5.3, §6.1, §6.2, §9 |
| P-024, P-025, P-026, P-027, P-030, P-033, P-034, P-035, P-036, P-037, P-038, P-039 | TeX scanning, build evidence, and publication calculation are not comment/byte/format/declaration-safe. | §9, Phase 6 |
| P-031 | Timeout recovery discards durable but unaccepted artifacts. | §9, Phase 6 |
| P-004, P-028, P-032 | Harness/external behavior. The preset must detect, document, and route it to the owner; it must not pretend to fix the host. | §5.3, §9, Non-Goals |

Reports that must not drive preset architecture: P-006 is a user format decision; P-016 is an outcome record rather than a defect; P-017, P-018, and P-019 are project-content accuracy events (the capability baseline still removes the read-only/search ceiling that made verification manual); P-040 is a project plan-revision event, not a preset defect. The recon facts in the bug file are workspace evidence and enter the system through normal evidence records.

## 3. System Invariants

These invariants are release-blocking.

1. **One canonical AutoResearch schema family.** Every AutoResearch-owned plan, contract, state, run, attempt, packet, receipt, ledger, revision request, feedback record, Linear projection record, and publish manifest has one shape identified by `kind`. `kind` is a record type, not a schema version.
2. **No schema versions in AutoResearch runtime data.** Remove `schemaVersion`, `PLAN_SCHEMA_VERSION_*`, `CORE_SCHEMA_VERSION`, `exposurePolicyVersion`, numbered policy gates, and runtime old-shape branches from AutoResearch-owned records. Build generation metadata may remain isolated because it describes deployed code, not research data.
3. **One validator per record type.** `src/autoresearch-core.mjs` owns constructors and validators. The duplicate plan validator in `src/research-orchestrator.mjs` is deleted.
4. **One artifact root.** New runtime work uses `.research-agent` only. Older roots are migration inputs, not runtime alternatives.
5. **One persistence path.** Accepted role output is persisted through the existing hash-checked, run-confined promotion authority. Compatibility wrappers that create a second promotion path are removed or folded into it.
6. **Approved scope is not silently mutated.** A completed or in-progress approved plan is changed only through an explicit new approved plan revision. Runtime migration never rewrites it.
7. **Broad role tooling is conditional on confinement attestation.** A role receives `read`, `grep`, `glob`, `bash`, `write`, and `edit` only after a preflight probe proves that read scope, write scope, and network egress are actually enforced for the shell, write, edit, and file-read adapters. `read_image` and `web_search` are added only when the node contract requires them. The baseline never grants arbitrary workspace, credentials, Linear, plan, or publication authority. If enforcement cannot be attested, the preset fails closed and keeps the narrower least-privilege profile for that run.
8. **Prompt guidance is not the permission boundary.** Role prompts must say not to make substantial or out-of-scope changes without confirmation, but the tool/adapter layer must enforce path, operation, read-scope, and egress policy even if a role ignores the prompt.
9. **Coordinator authority is explicit.** The coordinator may persist, promote, accept, reopen, and project to Linear. Role children may work inside their declared scope, but only the coordinator can approve cross-scope changes and commit lifecycle, acceptance, publication, or Linear mutations.
10. **Blind labels stay blind.** Judges rank anonymized labels only. Original candidate maps remain coordinator-side.
11. **Reopen preserves last-known-good output.** Reopening changes current state and invalidates acceptance for new work; it does not delete historical run directories or the currently published output.
12. **Linear mode stores current context in the Linear node.** The owned `Current Node Context` block in the Linear issue description is the canonical persistent operational record. A local mirror is forbidden while Linear storage is healthy.
13. **Every Linear action starts with a fresh node query.** A Linear-backed node is not claimed, resumed, reopened, or completed from hidden coordinator memory. The coordinator reads the issue's current context and binds the action to that context digest.
14. **Linear is concise current truth, not a raw transcript dump.** The mutable issue block is replaced as knowledge changes. Evidence events are supporting comments, not a substitute for the current block.
15. **Local context is fallback-only.** A local `linear-node-context` record is allowed only when a capability probe proves that the Linear issue cannot store or return the owned block, or during an explicit outage recovery path. It must not run concurrently as a second current truth.
16. **Local `project-state` is operational, not contextual.** It may hold lifecycle status, digests, ledgers, receipts, and last-known-good pointers, but never a narrative copy of the Linear `Current Node Context` block or an alternate task description an agent could mistake for current truth.
17. **No hand-maintained duplicate tool schemas.** Tool-boundary JSON schemas are generated from the core record definitions so transports, tools, and validators cannot disagree about nested field types.

## 4. Canonical Unversioned Record Model

### 4.1 Canonical plan

The sole plan shape is explicit and contains no compatibility defaults:

```json
{
  "kind": "autoresearch-plan",
  "projectId": "project-id",
  "projectName": "Project name",
  "revision": 1,
  "approvedAt": "timestamp",
  "integrationId": "integration",
  "projectContract": {
    "goal": "...",
    "deliverables": [],
    "acceptance": [],
    "test": "...",
    "wordBudget": null,
    "rebuildable": false,
    "diagnosticMappings": []
  },
  "nodes": []
}
```

Rules:

- `projectContract.deliverables` is always present; `[]` means publish nothing.
- Acceptance criteria are objects only: `id`, `text`, `required`, and optional typed check data.
- Every node has explicit `kind`, `artifactFormat`, `roles`, `acceptance`, `test`, `outputContract.artifactPath`, `budget`, and `dependsOn`.
- `kind` is a closed enum. Canonical node kinds include `research`, `literature`, `abstract`, `figure`, `code`, `experiment`, `assembly`, and `integration`. `figure`/asset nodes have image or asset artifact formats and may request image-aware judging.
- TeX-only fields are legal only for TeX nodes. Image/asset fields (for example `sourceAssets`, `imageTolerance`, and `judgeWithImages`) are legal only for `figure`/asset nodes.
- There is no universal `final.tex` or `final.pdf` default.
- There is no runtime legacy adapter.

### 4.2 Canonical record construction

Add one constructor and validator for each owned record in `src/autoresearch-core.mjs`:

- `autoresearch-plan`
- `project-state`
- `node-contract`
- `role-task`
- `role-attempt`
- `role-result`
- `blind-packet`
- `acceptance-receipt`
- `node-output`
- `revision-request`
- `user-feedback`
- `feedback-triage`
- `linear-node-context`
- `linear-evidence-event`
- `publish-manifest`

Closed objects use `additionalProperties: false` at every boundary. Tool parameter schemas are generated from these core definitions; no transport-specific hand copy may exist. Hashes are computed from normalized owned fields only.

### 4.3 Migration boundary

Add `scripts/migrate-workspace.mjs` as an offline command. It is not registered as a model tool and is never imported by runtime code.

The command:

- recognizes only a closed, named legacy-shape fingerprint catalog for conversion; unknown or ambiguous shapes fail with `unknown legacy shape` and are never guessed;
- reports every changed field, digest, receipt, run, Linear block, and output manifest;
- writes a migration report linking every old gating receipt to its proposed successor or an explicit `requires-reacceptance` status;
- writes a proposed canonical plan revision rather than overwriting approved `plan.json`;
- requires explicit user approval before the proposed plan becomes current;
- never automatically rebinds acceptance receipts whose contract digest changes;
- requires re-acceptance for contract-gating receipts;
- can preserve non-gating historical provenance only after hash and semantic-equality checks;
- refuses mutation while a project has active leases or in-flight node work;
- leaves historical published outputs untouched.

Runtime behavior for an old shape is one clear error: `not canonical; run scripts/migrate-workspace.mjs`.

### 4.4 Future schema discipline in README

Add a prominent `Schema Discipline` section to `README.md`:

- AutoResearch has one canonical shape, not numbered generations of plan or receipt schemas.
- Change the core constructor/validator and all consumers atomically.
- Never add `schemaVersion`, `v1`/`v2` branches, legacy readers, alternate field unions, policy-version markers, or a second validator.
- Tool JSON Schemas are generated from the core validator source; transport declarations are build artifacts, not second opinions.
- Old persisted data belongs behind the offline migration boundary, never in role prompts or normal runtime paths.
- Update canonical fixtures, migration fixtures, docs, generated bundles, snapshot checks, and the full test suite in the same change.
- A change that needs two live shapes is incomplete and must not ship.

Add `scripts/assert-canonical-schema.mjs` to enforce this rule in source and generated runtime artifacts, including a check that every registered tool parameter schema equals the schema generated from `autoresearch-core.mjs`. Deployment build metadata is explicitly excluded from this research-record check.

## 5. Capability-Safe Role Planning

### 5.1 Machine-readable role contract

Extend `ROLE_MANIFEST` and node-kind descriptors with:

- exact tool allowlist;
- capabilities: `read`, `search`, `inspect`, `write`, `execute`, `network`, `image`;
- output mode: `body` or `structured`;
- artifact contract;
- whether direct file mutation is allowed;
- expected coordinator persistence behavior;
- a separate `shellMode`: `scoped-mutate` for normal role work, with the same declared read/write roots enforced for shell, write, edit, grep, glob, and read operations;
- `approvalClasses` identifying path and operation categories that require coordinator/user approval before mutation;
- `writeRoot` and `readRoots` for every role attempt;
- `egress`: `none` unless the node contract declares a network capability, plus the narrow allowed network destinations;
- `confinementAttestation`: the capability-probe receipt that must match the declared roots and egress before dispatch.

The current `['read']` default is too narrow for evidence-grounded work. The intended broad baseline is:

- `read` for declared files and run artifacts;
- `grep` for content search;
- `glob` for file discovery;
- `bash` for command execution;
- `write` and `edit` for files within the role's declared work root;
- `read_image` when the node contract includes visual evidence;
- `web_search` when the role's web policy permits it.

The broad baseline is gated, not assumed. Phase 0 must prove, with an adversarial capability probe, that the deployed harness can enforce (a) write scope for shell/write/edit, (b) read scope for read/grep/glob/bash, and (c) network egress policy for shell commands. If any of the three cannot be attested, the preset must fail closed for that run: roles keep the current narrow allowlist and the capability report records `confinement-unattested`. No role manifest or prompt may claim confinement the adapter did not demonstrate.

The broad baseline is paired with three independent controls:

1. **Read/write-root policy.** Each role task packet names the exact read roots, work roots, and declared artifact paths the role may touch. The read, grep, glob, shell, write, and edit adapters reject paths outside those roots. Plan files, other node roots, published outputs, credentials, generated bundles, and Linear-owned data are coordinator-only unless the coordinator issues a narrow approval token. Shell network egress is disabled unless the node contract declares a network capability and a narrow destination allowlist.
2. **Substantive-change approval.** Role prompts instruct the role to stop before changing approved scope, another node, tests or dependencies outside its task, user-authored files, published output, or Linear state. The role returns a structured approval request containing the proposed paths, diff summary, reason, affected acceptance criteria, and rollback plan. The coordinator asks the user or authorizes the change; prompt compliance is helpful, but the path and operation guard remains authoritative.
3. **Confinement attestation.** Every role attempt carries a capability-probe receipt for filesystem, shell, and egress behavior. Dispatch refuses to start if the probe and the declared scope disagree.

Role-specific differences are now about policy and declared scope, not whether a role can inspect basic evidence:

- **Evidence and review roles:** judges, critics, verifiers, synthesizers, authors, reporters, literature writers, abstract writers, experiment commentators, and the integration verifier get the broad baseline when confinement is attested. Their default write root is a disposable role-attempt/work area plus explicitly declared output paths. They may create notes, probes, derived evidence, and candidate artifacts there, but cannot mutate another node or commit acceptance/publication/Linear state.
- **Figure/assets roles:** a `figure` node may use `research_coder` or a declared asset role with image tooling and `read_image`. Judges on a `figure` node receive `read_image` and typed candidate asset references, never original provenance. The preset documents a hermetic stdlib fallback for simple image manipulation (for example crop and panel split) and preflights PIL/ImageMagick/pip before claiming image capability.
- **Research roles:** planners and scouts get the broad baseline plus `web_search` when permitted. Direct fetch remains on the audited presearch/coordinator path unless explicitly declared.
- **Implementation roles:** coders and unit testers get the broad baseline with an execution/write root appropriate to code, tests, experiments, and receipts. They may modify the approved node's artifacts, but a material scope expansion still requires approval. Test-generated files are confined to the run/test root and recorded as receipts.
- **Integration roles:** the integration editor gets the broad baseline plus `read_image` for visual review and may edit only the declared integration work root. It returns the declared integration body and structured coverage/actions; coordinator promotion remains required before acceptance and publication. The integration verifier may write only bounded findings and inspection notes in its own work root, never the final artifact or acceptance receipt.

`bash` is intentionally available to every role only after confinement attestation. It must execute under the same read/write-root and egress policy as the file tools; it is not a second path around `read`, `write`, or `edit` restrictions. Linear mutation, plan approval, acceptance, promotion, and publication remain coordinator-only tools. A tool allowlist alone is not a filesystem chroot, so the policy must be enforced in the shell/filesystem adapter, tested adversarially, and attested by the capability probe before any role is dispatched.

### 5.2 Plan capability validation

Before approval and before execution, derive required capabilities from node contracts:

- repository or run-wide evidence review requires search/discovery access, not only a single-file read tool;
- compile, test, measure, or execute requires an execution-capable role or coordinator adapter;
- shell inspection and shell mutation are different capabilities and must validate separately;
- artifact mutation requires an approved write-capable role or coordinator promotion;
- web evidence requires network capability;
- rasterization or image inspection requires image tooling and an image-capable model;
- a `figure`/asset node requires an image-capable judge when visual quality is an acceptance criterion, plus either installed image tooling or the declared stdlib fallback;
- strict TeX acceptance requires compiler and template support;
- declared publication requirements must be satisfiable from the node outputs.

Reject impossible role/node combinations with field-specific errors. Do not let an assembly node that requires compilation proceed without an executing role. A judge or critic may receive `bash`, `write`, and `edit`, but only inside its disposable attempt/work root; the capability check must verify that these tools cannot read or write another node, the approved plan, published outputs, credentials, or Linear-owned data, and that shell egress is off unless declared.

### 5.3 Dependency preflight

Produce one concise report with findings containing:

- severity;
- owner: `preset`, `harness`, or `workspace`;
- blocked status;
- exact missing capability or dependency;
- remediation.

Cover model routes, judge panels, web-fetch provider selection, bibliography styles used by sources, TeX tools, rasterizers, image tooling and stdlib fallback, templates, Linear description/comment capabilities, and workspace-relative scratch. State explicitly that `/tmp` is not a portable handoff location and that dot-prefixed TeX job names are avoided. Multiple registered web-fetch providers must be reported as an ambiguity finding with the exact providers, never collapsed into a generic `degraded` result; the preset picks one explicit default or blocks with remediation.

## 6. One Typed Subagent Handoff Protocol

### 6.1 Role task packet

Every role receives a canonical `role-task` packet containing:

- project, node, contract, and current context digests;
- exact task and acceptance criteria;
- typed input artifact references: logical name, path, hash, format, and producer;
- effective role tools and capability limitations;
- shell mode, read roots, write root, and egress restrictions;
- a capability probe receipt proving which search, image, filesystem, shell, and egress operations are actually available;
- write destination when applicable;
- route request and fallback policy;
- output mode and output contract;
- concise `nextAction`.

Evidence content is marked as data, not instructions. Large source material is referenced rather than copied into every prompt.

### 6.2 Role result envelope

Every attempt produces a small `role-result` envelope:

- outcome class and completion state;
- output reference and hash;
- concise summary of work performed;
- evidence/receipt references;
- limitations or unresolved findings;
- requested and actual provider/model/effort, plus route source: `configured`, `fallback`, or `coordinator-degradation`;
- effective tools;
- next action.

The envelope is allowlisted. It does not spread live agent objects or arbitrary provider output into tool results.

### 6.3 Persistence

Extend the existing coordinator promotion operation to accept a complete `outputRef`, verify its hash and completeness, and promote it only to the contract-declared destination under the run directory.

This makes role-created work and prose persistence predictable:

- a role may create or edit only within its declared work root;
- the role runner stores the attempt output and returns its reference;
- the coordinator promotes the declared artifact through one hash-checked path without manually reconstructing the body;
- downstream roles find accepted artifacts through receipts and the current Linear node context;
- a role that needs a broader or cross-node change returns a structured approval request instead of editing around the boundary.

Do not add a mutable shared file index. Derive discovery from accepted receipts and the current Linear node context.

### 6.4 Output discipline

Use structured output for planners, critics, verifiers, judges, triage roles, and control decisions. Use body-only text for prose artifacts.

Centralize suffixes that require:

- no visible deliberation or chain-of-thought;
- no file-operation narration;
- no duplicate heading mentions before the real output;
- only the declared body or structured object.

Planner output uses a closed structured result. No release-eligible runtime path may parse free-text plan JSON by heading search. During implementation, any migration-time parser is a test-only helper outside the generated bundle and must be deleted before the Phase 1 gate; the acceptance gate rejects a shipped parser as a legacy adapter.

### 6.5 Blind judge transport

Replace nested open `packetRef` transport with top-level typed primitives:

- `judgePacketPath`
- `judgePacketHash`
- `pass`
- `judge`
- `judgeCount`
- `runDigest`
- `contextDigest`

Every field has a closed schema type. `pass` and `judgeCount` are integers, never strings. Canonical loop passes are zero-based and the dispatch tool accepts the same number the loop used; hidden `+1`/`-1` conversions are forbidden. Field-specific type errors are emitted before any digest binding and name the mismatched field.

Bind an explicit, byte-identical `judgeContext` into every packet digest. Judges return `{ "ranking": ["X", "Y", "Z"] }` over anonymized labels only, and the parser is a typed ranking parser rather than a text extractor.

Candidate-invariant shared material (for example a layout specification quoted by every candidate) is moved into `judgeContext` before packet construction. It is not silently exempted from identity scans while it remains inside candidate bodies.

Blinding sanitization must:

- strip provenance and comment blocks before scanning;
- use token-bounded labels rather than matching letters inside ordinary words;
- keep shared context outside candidate bodies;
- never exempt identity-bearing content merely because it appears in every candidate;
- normalize a legitimate leading structural heading to a neutral token in the blind copies; originals and promoted artifacts are unchanged, and a candidate is not rejected merely because it starts with `\section`;
- preserve original candidates and coordinator-side maps unchanged.

## 7. Linear-First Evolving Node Context

This is the central operational change for Linear-backed projects.

### 7.1 Authority model in Linear mode

For a Linear-backed project:

- The owned block in the Linear issue description is the authoritative persistent record for current node state, current understanding, reopen reason, unresolved feedback, and next action.
- The approved node contract is rendered into that Linear issue and hash-bound to the canonical plan.
- The preset does not maintain a second local copy of current node context while Linear storage is healthy.
- Local files hold artifacts, hashes, acceptance receipts, and the minimum WAL/outbox needed for crash-safe Linear writes. They do not hold an alternate task description that an agent must reconcile against the issue.
- Local `project-state` remains operational only: statuses, digests, ledgers, receipts, and last-known-good pointers. It may never contain narrative current work; any context digest stored there is a pointer/checksum for Linear reconciliation, not a local copy of the block.
- Every decision-relevant artifact or receipt fact is reduced into the Linear issue block before the node advances to the next lifecycle stage.
- A lifecycle transition is not committed until Linear read-back confirms the owned context block and required evidence event.
- A transient outage may retain pending write intent and artifacts locally, but normal state advancement pauses by default until the context is confirmed in Linear.
- Manual Linear edits outside owned blocks are treated as new human input or drift, never silently overwritten.

### 7.2 One mutable `Current Node Context` block stored in Linear

Use the Linear issue description as the primary storage feature because the current adapter already supports description reads, owned-block updates, and structural read-back. The `Current Node Context` block is physically stored in the Linear node itself; it is not generated from a separately maintained local context file. Comments carry evidence history, but the description block carries the current operational truth.

Replace the narrow specification block with one owned, readable Markdown block in the issue description. Preserve all user-authored text outside it. Use another native Linear field only if capability preflight proves that it is more suitable, readable in the Linear website, and available through stable read/write APIs; never split the context across several Linear features.

The block is updated in place, not appended forever:

```markdown
## AutoResearch Current Node Context

- Status: In progress
- Objective: <one sentence>
- Contract revision: <plan revision / node revision>
- Last verified: <timestamp and context digest>

### Completed
- [x] <completed work item> - evidence: <event/comment/receipt reference>

### Current Findings
- <decision-relevant fact with evidence reference>

### Required Revisions
- <why the node was reopened, source, affected criteria, required change>

### Remaining Work
- [ ] <specific uncompleted item>

### Dependencies and Holds
- <upstream/downstream issue references and why they matter>

### Next Action
- <one concrete action, owner, expected output, and acceptance check>
```

The machine-owned block also carries stable markers and a digest for reconciliation, but its visible content remains point-form and human-readable. The digest binds the current Linear description block to the latest accepted evidence references; it is not a pointer to a local source of truth.

### 7.3 Evidence-backed milestone events

Post idempotent `linear-evidence-event` comments only for decision-relevant milestones, not every model thought or tool call.

Event types include:

- node claimed;
- evidence packet accepted;
- candidate promoted;
- test/build completed;
- acceptance passed or failed;
- node reopened;
- user feedback received;
- revision completed;
- integration verified;
- project republished.

Every event comment uses a concise Markdown template:

```markdown
## AutoResearch: Node Reopened

- Reason: <specific problem>
- Source: <user feedback / verifier / integration editor / judge evidence>
- Affected criteria: <ids>
- Affected contributions: <ids>
- Evidence:
  - <artifact path or URL> - SHA-256 `<hash>`
  - <receipt or command result> - `<reference>`
- Required change:
  - <point-form change>
- Acceptance checks:
  - [ ] <check>
- Next action: <owner and exact step>
```

Evidence references should include the useful subset of artifact paths, output hashes, receipt hashes, source URLs, command exits, and related Linear issue identifiers. Raw transcripts stay out of Linear unless explicitly required.

### 7.4 Fresh context query

Add coordinator-only `linear_get_node_context` and make it the required intake path for Linear-backed work.

It fetches and combines, in sequence:

1. the current issue, including the latest description, state, labels, and relations;
2. the `Current Node Context` block directly from that Linear issue description;
3. all comments newer than the block's watermark;
4. referenced milestone evidence comments needed by the block;
5. new unprocessed human comments;
6. current dependency and hold state;
7. local artifact/receipt hash confirmation for references named in Linear, used only to verify evidence integrity rather than to reconstruct missing context; absent local files make the reference `unverified`, never block context reconstruction.

The returned context must be usable when local `state.json` is unavailable. If the Linear issue has no valid owned block, the query returns `context-missing` and the coordinator repairs the block from the latest verified Linear comments and contract before any node work starts.

It returns a compact structured `NodeWorkContext` plus readable Markdown containing:

- current contract summary;
- what is complete;
- current evidence;
- what changed since the last context update;
- unresolved human input;
- why the node is open or reopened;
- exact remaining work;
- exact next action;
- drift or missing evidence; each evidence reference carries integrity status `verified`, `unverified`, or `missing`.

`autoresearch_init_run`, claim, resume, revision, and completion require this context digest. The coordinator may not act on an older digest after new Linear comments arrive.

### 7.5 Context reducer, not log concatenation

Add a deterministic reducer that evolves the current block from:

- the prior block;
- newly confirmed evidence events;
- new user comments;
- current relations and issue state;
- current acceptance and artifact receipts.

The reducer removes superseded facts, moves completed items from `Remaining Work` to `Completed`, updates reopen reasons, and keeps one next action. It preserves links to the evidence events that justify each current statement.

The current block has bounded sections and item counts. Older detail remains in milestone comments, but the agent sees only referenced evidence and recent unprocessed input. This keeps the source of truth editable, clear, and compact.

### 7.6 Linear write path and conflict handling

Extend the existing WAL/outbox with owned operations for:

- node context update;
- evidence event comment;
- lifecycle state/label projection;
- dependency relation projection.

For every context update:

1. read the latest issue and comments;
2. compute the expected prior context digest;
3. write local intent;
4. update only the owned context block;
5. read back and structurally parse it;
6. confirm the digest and evidence markers;
7. acknowledge the projection.

If the issue changed concurrently, re-read and reduce again. Never overwrite user-authored text outside the block. If user edits conflict with owned facts, surface a conflict for coordinator or user resolution.

### 7.7 Degraded-mode and fallback boundary

The normal Linear path must not depend on a local context file. Capability preflight must verify that the selected Linear adapter can read and update the issue description, preserve user-authored text, paginate comments, and perform structural read-back. If that capability is unavailable, mark the project `linear-context-unavailable` and pause normal node progression.

A local `linear-node-context` record may be written only as a temporary recovery cache containing the last successfully read Linear block, its digest, and pending write intent. It is not authoritative, must not be presented to a role as current truth, and must not permit claim, reopen, acceptance, completion, or publication while Linear mode is active. On reconnection, the adapter must read Linear first, reconcile the cached intent against the current issue, update the owned block through the WAL/outbox, read it back, and then delete or mark the cache superseded. If the issue was changed by a human, surface a conflict and require resolution; never overwrite the change.

This is not a silent local-mode downgrade. Switching a project to local-only execution requires an explicit user decision and a separately recorded mode change; it is outside ordinary resume behavior.

### 7.8 Linear readability tests

Golden tests must assert that a human opening an issue can answer, without local files:

- What is this node supposed to deliver?
- What has been completed?
- What evidence supports completion?
- What failed or changed?
- Why was it reopened?
- What feedback is unresolved?
- What must happen next?
- Which nodes block or depend on it?

An agent calling `linear_get_node_context` must receive the same answers in structured form.

## 8. User Feedback After Project Completion

### 8.1 Feedback intake

Add coordinator-only `autoresearch_submit_feedback` with:

- project ID;
- verbatim user feedback;
- optional target node, contribution, or criterion identifiers;
- current integration and publish manifest digest.

Persist a hash-addressed `user-feedback` record and project it to the Linear integration issue immediately. The record contains `source: user`, `authority: user`, base input digest, timestamp, and an idempotency key.

The coordinator cannot manufacture user authority from its own prose. User-authorized feedback bypasses judge quorum only when the base digest matches the current last-known-good integration.

### 8.2 Senior integration triage

Reuse the integration editor and synthesizer logic to evaluate the current final artifact, coverage map, node ledgers, acceptance receipts, and user feedback.

The triage result classifies each item as:

- `editorial`: fix in a new integration pass;
- `substantive`: reopen the owning node;
- `conflict`: reopen the responsible nodes or ask the user to choose;
- `scope`: require a new approved plan revision;
- `ambiguous`: ask the user for clarification and do not reopen anything yet.

The result names affected criteria, contributions, owner nodes, required changes, and acceptance checks. It is projected into the integration issue's current context and evidence comments.

### 8.3 Minimal atomic reopen

Extend revision routing to accept a sorted set of targets.

In one state transaction:

- detect dependency cycles and refuse with a cycle report before computing any closure;
- compute the union of each target and all transitive downstream dependents;
- bump the node revision only on direct targets;
- clear current acceptance for affected nodes without deleting historical runs;
- record full blocker sets on dependent nodes;
- preserve unrelated completed nodes;
- increment the integration epoch;
- create revision-request records with `supersedes` links to the prior receipts and never mutate old receipts in place;
- link feedback, triage, revision requests, and Linear events by digest.

If only integration is affected, rerun integration only. If an upstream node is affected, rerun that node, affected descendants, and integration in dependency order.

### 8.4 Reintegrate and republish

A feedback repair must pass the normal gates:

- fresh node acceptance;
- current contribution ledgers;
- integration coverage validation;
- strict build and visual verification;
- feedback-resolution check;
- transactional publication.

The existing published output remains visible as last-known-good until replacement publication succeeds. Then close the feedback record with affected nodes, new run/receipt hashes, integration input digest, and publish manifest hash. Update all affected Linear contexts and add one concise project-republished event.

## 9. TeX, Build, Recovery, and Publication Hardening

Implement the remaining common adapter fixes as part of the same canonical contracts:

- use one comment-aware normalized TeX source for marker, forbidden-construct, dependency, and blinding scans;
- require an explicit fragment template or generate one deterministically from declared needs;
- preflight bibliography styles referenced by source;
- retain owned compiler logs with first error, line context, tail, command, and cleanup state;
- avoid unsafe dot-prefixed compiler job names;
- pin and record `SOURCE_DATE_EPOCH` for reproducible profiles;
- derive `finalBuild` from the accepted clean source, recorder, and PDF;
- count the resolved TeX input closure rather than only a wrapper file;
- record scanner-derived declared-list drift as non-blocking receipt evidence; a wider observed set is authoritative, not a failure;
- hash files as bytes first and decode text only when text inspection is required;
- prefer the accepted integration artifact as the canonical publication source;
- accept the declared deliverable format on the correct promote/publish path; a `.tex` destination must never fail as a PDF-format mismatch;
- collapse same-hash aliases and report different-hash collisions with both paths and owners;
- publish only explicit current deliverables and current receipts.

On timeout or provider failure, inspect durable attempt references and declared artifact hashes. Return recoverable candidates with completion and hash status. Never auto-accept them. On provider failure, emit a typed `provider-failure` event naming every attempted route and the actual route used; any coordinator execution fallback is recorded as a distinct `coordinator-degradation` route source and is never presented as the configured role model.

## 10. Implementation Phases

### Phase 0: Baseline and traceability

Targets:

- `docs/reported_bugs_0908.md`
- new common-defect traceability matrix
- current full test and snapshot baseline

Deliverables:

- classify every report item as common preset defect, external harness behavior, already fixed, benign behavior, or project-specific;
- write the section 2.8 traceability table into the repo matrix and gate on it;
- attach one regression fixture to each open common defect;
- run a confinement-attestation spike on the installed harness for read scope, write scope, and shell egress; record the result because Phase 2 either ships the broad baseline or fails closed on this evidence;
- record current runtime and generated bundle hashes.

### Phase 1: Canonical schema cut

Targets:

- `src/autoresearch-core.mjs`
- `src/research-orchestrator.mjs`
- `src/linear.mjs`
- canonical fixtures and migration fixtures

Work:

- define canonical constructors/validators;
- generate every registered tool parameter schema from the core definitions and delete hand-maintained transport schemas;
- delete duplicate validators and all AutoResearch schema-version branches;
- make acceptance objects and deliverables explicit;
- add the canonical `figure`/asset node kind and image-aware judge fields;
- remove runtime legacy adapters and dual roots;
- add the offline migrator with a closed legacy-shape fingerprint catalog and canonical-schema assertion.

Gate: old shapes are rejected by runtime and recognized only by the offline migrator.

### Phase 2: Capability validation and preflight

Targets:

- role manifest and node-kind descriptors;
- planner prompt;
- dependency check;
- model/judge route resolver.

Work:

- replace the current `['read']` ceilings with the common baseline `read`, `grep`, `glob`, `bash`, `write`, and `edit`, plus conditional `read_image` and `web_search`, only when the Phase 0 confinement attestation proves read scope, write scope, and egress enforcement; otherwise fail closed with the narrow profiles;
- enforce one declared read/write root and egress policy across shell, write, edit, read, grep, and glob operations for every role;
- add approval classes and structured approval requests for plan, cross-node, published-output, dependency, credential, and Linear mutations;
- keep Linear mutations, acceptance, promotion, and publication coordinator-only;
- machine-check node needs against role tools and coordinator services, including figure/image requirements;
- distinguish ambiguous providers from missing providers in dependency findings;
- add a typed route-failure policy: missing judge panel fails closed; provider fallback records `configured` vs `fallback` vs `coordinator-degradation`;
- record actual route, effective tools, read roots, write root, approval classes, egress, and capability-probe receipts;
- fail closed on missing judge panel or incompatible image/model requirements.

### Phase 3: Typed handoffs and promotion

Targets:

- role runner;
- `autoresearch_run_role` and spawn schemas;
- promotion tool;
- planner/critic/judge parsing;
- blinding core.

Work:

- canonical task/result envelopes with route-source recording;
- closed, generated schemas and flat judge packet primitives with integer zero-based pass numbering;
- body-only prose persistence through `outputRef` promotion;
- structured judge rankings, byte-identical shared `judgeContext`, and context binding;
- comment-aware identity scrub and scan, including structural-heading normalization for blind copies.

### Phase 4: Linear-first node context

Targets:

- `src/linear.mjs` queries, shaping, WAL/outbox, and description updates;
- orchestration intake and resume;
- Linear projection templates;
- Linear documentation.

Work:

- store the mutable `Current Node Context` block physically in each Linear issue description;
- keep local `project-state` operational-only; never allow a narrative context copy there;
- make `linear_get_node_context` reconstruct context from Linear alone when local state is absent;
- add evidence event comments as supporting references, not a substitute for the current block;
- add the deterministic context reducer that replaces superseded block items;
- bind claim/resume/reopen/complete to the freshly queried Linear context digest;
- pause on missing write/read capability or outage instead of silently using a local operational copy;
- support only a non-authoritative local recovery cache for pending intent, reconciled back into Linear before work resumes;
- handle concurrent edits and drift without overwriting user text;
- add readable point-form golden tests for both agents and humans.

### Phase 5: User feedback and causal rework

Targets:

- feedback intake tool;
- integration triage schema;
- multi-target revision routing;
- integration state machine and input digest;
- Linear feedback projection.

Work:

- user-authority records;
- ambiguity/scope handling;
- minimal atomic reopen closure with cycle detection and `supersedes` receipt links;
- last-known-good preservation;
- feedback-resolution acceptance and republish.

### Phase 6: TeX, recovery, and publisher correctness

Targets:

- TeX scanners and builders;
- acceptance receipt construction;
- timeout recovery;
- publish set calculation and transaction.

Work:

- normalized scans, templates, logs, epoch pinning, closure word count, derived final build, byte hashing, benign drift recording, format-correct `.tex` publication, alias/collision handling, recoverable artifact reporting, and typed provider-failure/coordinator-degradation recording.

### Phase 7: Documentation and release

Targets:

- `README.md`
- both research skills;
- role prompts;
- `agent.cordis.yml` persona;
- CI workflow and package scripts.

Work:

- remove all agent-facing old-schema language;
- add schema discipline, Linear-first context, feedback lifecycle, and truthful permission documentation;
- reduce duplicated prompt/checklist prose;
- build generated bundles;
- verify snapshot;
- run full tests;
- clean-install the preset;
- run installed probes and a blank-session multi-node smoke project.

## 11. Test Plan

Add or rewrite:

- `tests/role-capability.test.mjs`
- `tests/inspection-shell-policy.test.mjs`
- `tests/tool-schema-generation.test.mjs`
- `tests/figure-node-capability.test.mjs`
- `tests/provider-route-policy.test.mjs`
- `tests/canonical-schema.test.mjs`
- `tests/migration.test.mjs`
- `tests/capability-preflight.test.mjs`
- `tests/packet-transport.test.mjs`
- `tests/blinding-parser.test.mjs`
- `tests/promote-outputref.test.mjs`
- `tests/linear-node-context.test.mjs`
- `tests/linear-context-reducer.test.mjs`
- `tests/linear-context-reconcile-e2e.test.mjs`
- `tests/feedback-closure.test.mjs`
- `tests/role-timeout-recovery.test.mjs`

Extend:

- `tests/role-runner.test.mjs`
- `tests/linear-core.test.mjs`
- `tests/linear-lifecycle-e2e.test.mjs`
- `tests/linear-reconcile-e2e.test.mjs`
- `tests/revision-request-wiring.test.mjs`
- `tests/causal-routing-e2e.test.mjs`
- `tests/tex-acceptance.test.mjs`
- `tests/output-policy.test.mjs`
- the existing numbered acceptance-policy test should be renamed to a capability-neutral name and kept in the same full-suite gate.

Required adversarial cases:

- malformed planner output and duplicate heading mentions;
- old plan fields and string acceptance rejected by runtime;
- impossible role/tool plan rejected before execution;
- when confinement is attested, every role receives `read` + `grep` + `glob` + `bash` + `write` + `edit`, and receives `read_image` or `web_search` when its node contract requires them;
- when confinement cannot be attested, dispatch fails closed to the narrow allowlist and never claims broad capability;
- every role's `read`, `grep`, `glob`, `bash`, `write`, and `edit` operations are confined to the same declared read/write roots, and shell egress is off unless declared;
- path and operation guards reject changes to plans, other nodes, published outputs, credentials, generated bundles, or Linear-owned data unless a coordinator approval token is present;
- a role that proposes a substantial or cross-scope change emits a structured approval request, and prompt guidance is not treated as the security boundary;
- every registered tool parameter schema equals the schema generated from `autoresearch-core.mjs`;
- nested-number packet transport cannot occur because fields are typed primitives; `pass: "1"` is rejected with a field-specific type error and canonical pass numbering is zero-based with no hidden offset;
- judge context digest mismatch fails with a field-specific error;
- a figure node requires image tooling or the declared stdlib fallback and an image-capable judge;
- candidate-invariant shared material is moved into `judgeContext` rather than exempted from scans inside candidate bodies;
- ordinary words and legitimate TeX headings do not trigger identity leaks, and section-leading blind candidates are normalized without changing promoted artifacts;
- provenance comments do trigger sanitization;
- role-produced prose or structured output promotes without coordinator text reconstruction;
- missing judge panel cannot silently use a local route;
- timeout returns recoverable but unaccepted output references;
- Linear query reconstructs current work after coordinator context loss;
- new human comment invalidates an older context digest;
- context reducer removes superseded tasks instead of concatenating history;
- repeated Linear projection and outage recovery create no duplicate comments;
- user feedback reopens only the minimal closure;
- ambiguous feedback opens nothing;
- stale feedback digest cannot claim user-authority bypass;
- last-known-good output remains until successful republish;
- comment-only TeX markers do not affect parsing;
- missing or ambiguous bibliography styles are reported by dependency preflight before acceptance;
- fragment acceptance requires an explicit template or a deterministically generated one;
- TeX failure evidence retains first error, line context, tail, command, and cleanup state;
- dot-prefixed compiler job names are never generated;
- reproducible builds pin and record `SOURCE_DATE_EPOCH`;
- `finalBuild` is auto-derived from a clean accepted build;
- scanner-derived declared-list drift is recorded as non-blocking receipt evidence;
- `.tex` publication succeeds through the format-correct path and never reports a PDF destination mismatch;
- non-UTF8 closure files hash and publish correctly;
- input-based masters receive correct word counts;
- same-hash aliases collapse and different-hash collisions are explicit;
- ambiguous web-fetch providers produce a provider-specific ambiguity finding, while a missing provider blocks with remediation;
- provider failure records every attempted route and any `coordinator-degradation` route source; it is never presented as the configured model;
- offline migration rejects unknown legacy shapes instead of guessing, and old gating receipts carry an explicit successor or `requires-reacceptance` status;
- local `project-state` never contains a narrative Linear context copy that could be mistaken for current truth.

## 12. Non-Goals

- No runtime old-schema readers or numbered replacement schema.
- No automatic rewrite of approved plans.
- No automatic acceptance of timeout artifacts.
- No claim that tool allowlists are filesystem chroots.
- No broad role tool baseline unless a confinement probe attests read/write-root and egress enforcement.
- No blanket exemption for candidate-invariant text inside candidate bodies; shared material moves to `judgeContext`.
- No silent coordinator substitution for a failed configured role route; any substitution is a recorded `coordinator-degradation` action.
- No mutable shared artifact index separate from receipts and Linear context.
- No judge access to original candidate identities.
- No broad whole-DAG rerun for vague feedback.
- No raw transcript dump into Linear.
- No use of Linear state alone as evidence of completion.
- No hidden local operational history required to resume a Linear node.
- No direct fix to DSH `/tmp` isolation or host provider registration in this preset; detect, explain, and route those findings to the correct owner.

## 13. Acceptance Gates

The work is complete only when all gates pass.

1. Source and generated runtime contain no AutoResearch schema-version constants, fields, policy forks, duplicate validators, hand-maintained transport schemas that disagree with core, or role-facing old-shape language.
2. Runtime accepts one canonical fixture family and rejects all old-shape fixtures with one migration instruction.
3. Offline migration never overwrites approved `plan.json`, never auto-rebinds gating receipts, rejects unknown legacy shapes, and refuses active projects.
4. When broad tooling ships, the confinement probe proves `read`, `grep`, `glob`, `bash`, `write`, and `edit` stay inside declared read/write roots with declared egress; outputRef promotion succeeds only with a complete hash match and a run-confined declared destination. When the probe cannot attest confinement, runtime fails closed to the narrow allowlist.
5. Every executable plan passes capability validation before approval and dependency preflight before execution, including figure/asset image tooling and image-capable judge requirements.
6. Judge transport uses generated closed schemas, integer zero-based pass primitives, blind labels, byte-identical shared `judgeContext`, structural-heading normalization, and fully recorded actual routes.
7. The canonical `Current Node Context` is stored in the Linear issue itself; healthy Linear-mode operation does not require local context files.
8. `linear_get_node_context` can reconstruct a node's current work from Linear alone when `state.json` is missing, and returns a clear `context-missing` result rather than guessing when the owned block is absent or invalid.
9. Every Linear-backed node query returns a current, point-form context that states completed work, evidence, reopen reason, remaining work, dependencies, and next action.
10. A human viewing the Linear issue can understand the same current state without access to coordinator memory or local state files.
11. Context updates replace superseded facts and preserve evidence links; they do not grow by concatenating all history.
12. New Linear comments or edits invalidate stale context digests and force a fresh query before action.
13. Linear capability failure pauses normal progression; a local recovery cache cannot authorize claim, reopen, acceptance, completion, or publication.
14. User feedback can reopen a completed project, route the smallest responsible closure, retain last-known-good output, and publish a verified replacement.
15. TeX, recovery, hashing, and publication adversarial tests pass.
16. CI runs the full test suite, not snapshot verification alone.
17. `npm run build:preset`, snapshot verification, full tests, clean installation, installed probes, and a blank-session Linear smoke project all pass.
18. The section 2.8 traceability matrix is committed to the repo and every preset-relevant `P-*` report maps to at least one passing regression test; project-specific reports are explicitly classified and excluded from architecture decisions.

## 14. Critique Decisions Incorporated

### DeepSeek v4 Pro, round 1

- The initial critique correctly kept coordinator promotion as the persistence boundary and derived output discovery from receipts rather than a new mutable index.
- The later user requirement broadens role tools and scoped write access; the final plan keeps the promotion boundary while allowing role-local artifacts and requiring approval for cross-scope changes.
- Keep judge rankings over blind labels and bind shared context into packet hashes.

### Grok 4.6, round 2

- Remove hidden schema forks such as policy markers, legacy adapters, duplicate validators, union field shapes, and dual roots.
- Treat migration as digest-changing and approval-requiring.
- Do not pretend role tool filters enforce a filesystem jail.
- Flatten packet transport fields and fail closed on missing judge panels.

### DeepSeek v4 Pro, round 3

- Remove remaining AutoResearch-owned schema markers across receipts, state, backtracking, holds, and publish records.
- Fold compatibility persistence wrappers into one promotion path.
- Add an explicit ambiguous feedback class and digest-gated user authority.
- Make multi-target reopen atomic and preserve last-known-good outputs.
- Require measurable source, test, documentation, and release gates.

### Grok 4.6, round 4 (coherence and coverage re-check)

Verdict: the plan is architecturally coherent and not a point-wise patch set, but it overclaimed two things it could not prove—broad role tooling and a single hand-maintained validator as a transport boundary—and it omitted figure-node and pass-indexing defects.

Decisions incorporated:

- Broad `bash`/`write`/`edit` is conditional on an adversarial confinement attestation for read scope, write scope, and shell egress; unattested runs fail closed to narrow profiles.
- Tool-boundary JSON schemas are generated from `autoresearch-core.mjs`; no hand-maintained transport schema may exist.
- Local `project-state` is operational-only and may never contain a narrative Linear context copy.
- Added canonical `figure`/asset node kind, image-aware judging, and hermetic image-tooling fallback preflight.
- Blind transport now fixes zero-based pass numbering, field-specific type errors, candidate-invariant shared `judgeContext`, and section-leading candidate normalization.
- Migration recognizes a closed legacy-shape fingerprint catalog and records explicit receipt successor/`requires-reacceptance` status.
- Added the section 2.8 traceability matrix so every preset-relevant `P-*` report has an owning architecture section and a regression test.

### Qwen Max, round 5 (final consistency pass)

Verdict: after the Grok round the plan is coherent end-to-end. Remaining work is lifecycle consistency, not new architecture.

Decisions incorporated:

- Dependency preflight now distinguishes ambiguous web-fetch providers from missing ones instead of returning a generic degraded result.
- `linear_get_node_context` never blocks on absent local artifacts; evidence references carry `verified`/`unverified`/`missing` status.
- Multi-target reopen detects dependency cycles and creates `supersedes` links without mutating old receipts.
- TeX/publication hardening records benign declared-list drift, accepts `.tex` on the format-correct path, and records typed provider-failure plus any `coordinator-degradation` route source.
- Tests and acceptance gates now include confinement failure, generated tool schemas, figure/image capability, pass-type indexing, provider ambiguity/failure, migration unknown shapes, and the non-context `project-state` invariant.
