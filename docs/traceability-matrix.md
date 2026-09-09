# AutoResearch Common-Defect Traceability Matrix

Status: committed baseline (Phase 0), gated by `scripts/check-traceability.mjs` in CI.

This matrix classifies every report in `docs/reported_bugs_0908.md` by architectural
cause and records the owning plan section
(`docs/autoresearch-canonical-linear-reliability-plan.md`) and the regression fixture
that must pass for the report to stay closed. It follows plan §2.8: this is a
common-defect matrix, not a one-fix-per-ticket patch list, and project-specific
reports are explicitly excluded from architecture decisions.

Classification values:

- `common-preset-defect` — a reusable preset defect; drives architecture; requires a regression fixture.
- `external-harness-behavior` — the defect lives in the harness or an external
  provider. The preset must detect it, document it, and route it to the owner;
  it must not pretend to fix the host (plan Non-Goals).
- `benign-behavior` — behavior that is correct or by design; the preset documents or
  records it (never silently papers over it).
- `project-specific` — an event of one research project. Excluded from architecture
  decisions (plan §2.8 final paragraph).

The Linear-context thinness class of plan §2.7 has no `P-*` ticket; it is carried
as its own row (LC-*) with its own fixtures.

## Matrix

| Report(s) | Classification | Architectural cause | Owning section / phase | Regression fixture(s) |
|---|---|---|---|---|
| P-001 | common-preset-defect | Preflight collapses "usable but ambiguous" fetch providers into a generic `degraded`; the exact providers are not named. | §5.3, Phase 2 | `tests/dependency-preflight.test.mjs` (ambiguous providers produce a provider-specific ambiguity finding, never a generic degraded result) |
| P-002 | common-preset-defect | Bibliography styles referenced by workspace sources are not preflighted; missing `.bst` discovered at acceptance time. | §5.3, Phase 2 | `tests/dependency-preflight.test.mjs` (referenced styles probed; missing style blocks with remediation) |
| P-003 | common-preset-defect | No image tooling preflight, no hermetic stdlib fallback recipe, no role/prompt anticipates figure preparation. | §5.3, Phase 2; §5.1 | `tests/dependency-preflight.test.mjs` (image tooling probed; stdlib fallback declared); `tests/capability-manifest.test.mjs` |
| P-004 | common-preset-defect + external-harness-behavior | `/tmp` is per-invocation and invisible to file tools (harness fact — routed to harness owner, documented in preflight); workspace-relative scratch is not preflighted or documented as a rule. | §5.3, §9, Phase 2 | `tests/dependency-preflight.test.mjs` (scratch finding: `/tmp` is not a portable handoff location; dot-prefixed TeX job names avoided) |
| P-005 | common-preset-defect | Figure/asset work has no canonical node kind, no image artifact format, no image-aware judging option. | §4.1, §5.1, §5.2, Phase 1–2 | `tests/capability-manifest.test.mjs` (figure node kind, image fields, image-capable judge requirement) |
| P-006 | project-specific | User format decision (old layout vs 8-page budget). Not a defect. | excluded | n/a — explicitly excluded from architecture decisions |
| P-007 | common-preset-defect | Planner JSON can be malformed; runtime parses it by free-text heading search. | §4.1, §6.4, Phase 1–3 | `tests/canonical-schema.test.mjs` (planner output is a closed structured result; malformed object rejected with field-specific errors; no release-eligible path parses free-text plan JSON by heading search) |
| P-008 | common-preset-defect | Planner body contains duplicate heading mentions; extraction must anchor on line-start and the last real heading. | §6.4, Phase 3 | `tests/canonical-schema.test.mjs` (duplicate heading mentions never selected); `tests/role-runner.test.mjs` (structured output mode for planner) |
| P-009 | common-preset-defect | Critic emits deliberation before the usable result; consumers must extract a brittle tail. | §6.4, Phase 3 | `tests/role-runner.test.mjs` (output discipline: no visible deliberation, no file-operation narration, declared output only) |
| P-010 | common-preset-defect | Role capability ceilings are not derived from node acceptance needs; an assembly node requiring compilation can be planned without an executing role. | §5.1, §5.2, Phase 2 | `tests/capability-manifest.test.mjs` (impossible role/node plan rejected before execution, field-specific) |
| P-011 | common-preset-defect | Blinding scanner flags candidate-invariant shared TeX layout as an identity leak. | §6.5, Phase 3 | `tests/blinding-parser.test.mjs` (candidate-invariant shared material moves to `judgeContext`; never exempted inside candidate bodies) |
| P-012 | common-preset-defect | `packetRef.pass` string silently breaks digest binding with no field-specific type error. | §6.5, Phase 3 | `tests/packet-transport.test.mjs` (`pass: "1"` rejected with a field-specific type error before digest binding) |
| P-013 | common-preset-defect | Judge dispatch discards the caller task; no `judgeContext` channel exists. | §6.5, Phase 3 | `tests/packet-transport.test.mjs` (byte-identical `judgeContext` bound into every packet digest; context-digest mismatch fails field-specific) |
| P-014 | common-preset-defect + external-harness-behavior | Nested open `packetRef` object transport can re-encode nested numbers through a lossless-JSON boundary (suspected harness transport behavior — documented, not fixed by the preset); the preset-side fix is flat typed primitives. | §6.5, Phase 3 | `tests/packet-transport.test.mjs` (flat top-level typed primitives; closed schemas; no nested open objects on the judge path) |
| P-015 | common-preset-defect | Judge panel resolution can silently fall back to a local route; actual provider record not flagged. | §5.3, §6.1, §6.2, Phase 2 | `tests/dependency-preflight.test.mjs` (missing judge panel fails closed; fallback records `configured`/`fallback`/`coordinator-degradation`) |
| P-016 | project-specific | Outcome record (planning pass 01 winner). Not a defect. | excluded | n/a — explicitly excluded |
| P-017 | project-specific | Project-content accuracy event (bib corrections applied at evidence-node close). Excluded from architecture decisions; the read-only/search ceiling that made such verification manual is removed by the common capability baseline driven by P-010/P-020 (see §5.1). | excluded | n/a — explicitly excluded; ceiling removal covered by `tests/capability-manifest.test.mjs` under P-010 |
| P-018 | project-specific | Planning miscount record (19 rows vs "18"). Surfaced, not a preset defect. | excluded | n/a — explicitly excluded |
| P-019 | project-specific | Scout false negative caught by verifier (project content). Excluded from architecture decisions; verifier independent re-derivation stays on every evidence-gate node, and the verifier's broad baseline (when attested) is covered under P-010/P-020. | excluded | n/a — explicitly excluded; verifier baseline covered by `tests/capability-manifest.test.mjs` under P-010 |
| P-020 | common-preset-defect | Synthesizer is read-only; coordinator manually persists merged output. | §5.1, §5.2, §6.3, Phase 2–3 | `tests/capability-manifest.test.mjs`; `tests/promote-outputref.test.mjs` (prose persistence through `outputRef` promotion without coordinator text reconstruction) |
| P-020a | common-preset-defect | Abstract writer is read-only; draft exists only in attempt files. | §5.1, §5.2, §6.3, Phase 2–3 | `tests/capability-manifest.test.mjs`; `tests/promote-outputref.test.mjs` |
| P-021 | common-preset-defect | `anonymize_candidates` pass is 1-based while loop directories are 0-based; hidden offset between tools. | §6.5, Phase 3 | `tests/packet-transport.test.mjs` (zero-based canonical pass numbering; no hidden `+1`/`-1` conversion anywhere) |
| P-022 | common-preset-defect | Provenance comments embedded in candidate bodies survive the identity scrub. | §6.5, Phase 3 | `tests/blinding-parser.test.mjs` (provenance and comment blocks stripped before scanning; provenance comments do trigger sanitization) |
| P-023 | common-preset-defect | `parse_ranking` expects bare original labels and returns non-lossless JSON on success. | §4.1, §6.2, §6.5, Phase 3 | `tests/blinding-parser.test.mjs` (typed ranking parser over anonymized labels; closed result object) |
| P-024 | common-preset-defect | No default fragment template; fragment acceptance requires an explicit template with no deterministic generation path. | §9, Phase 6 | `tests/tex-acceptance.test.mjs` (explicit template or deterministically generated one) |
| P-025 | common-preset-defect | `buildPreviewTex` marker search is not comment-aware; a comment mentioning the marker truncates the preamble. | §9, Phase 6 | `tests/tex-acceptance.test.mjs` (comment-only TeX markers do not affect parsing) |
| P-026 | common-preset-defect | Forbidden-construct scan matches `\usepackage` inside a comment. | §9, Phase 6 | `tests/tex-acceptance.test.mjs` (one comment-aware normalized source for all scans) |
| P-027 | common-preset-defect | `strictTexBuild` failure evidence too thin to debug (tail-only log, scratch log deleted). | §9, Phase 6 | `tests/tex-acceptance.test.mjs` (failure evidence retains first error, line context, tail, command, cleanup state) |
| P-028 | external-harness-behavior + common-preset-defect | pdflatex cannot write dot-prefixed aux files under the bash sandbox (harness fact — routed, documented); the preset must never generate dot-prefixed compiler job names. | §9, Non-Goals, Phase 6 | `tests/tex-acceptance.test.mjs` (dot-prefixed job names never generated); preflight documents the harness routing |
| P-029 | common-preset-defect | Anonymizer tex-heading scan fails closed on legitimate `\section`-leading candidates. | §6.5, Phase 3 | `tests/blinding-parser.test.mjs` (structural heading normalized to a neutral token in blind copies only; originals and promoted artifacts unchanged) |
| P-030 | common-preset-defect | `publish_accepted` reports a PDF destination mismatch for a `.tex` deliverable. | §9, Phase 6 | `tests/output-policy.test.mjs` (`.tex` publication succeeds through the format-correct path) |
| P-031 | common-preset-defect | Timeout leaves complete, recoverable artifacts the workflow does not surface; they are discarded. | §9, Phase 6 | `tests/role-timeout-recovery.test.mjs` (timeout returns recoverable-but-unaccepted output references with completion and hash status; never auto-accepted) |
| P-032 | external-harness-behavior + common-preset-defect | All remote routes down (external provider failure); the preset must emit a typed `provider-failure` event naming every attempted route, and record any coordinator substitution as `coordinator-degradation`, never presented as the configured model. | §9, Non-Goals, Phase 2/6 | `tests/role-runner.test.mjs` (model fallback chain, breaker, typed route recording; `coordinator-degradation` route source) |
| P-033 | common-preset-defect | Reproducible double build is not epoch-pinned; wall-clock dates make every TeX build read as non-reproducible. | §9, Phase 6 | `tests/tex-acceptance.test.mjs` (`SOURCE_DATE_EPOCH` pinned and recorded) |
| P-034 | common-preset-defect | `texcount` on an `\input`-based master counts only the wrapper. | §9, Phase 6 | `tests/tex-acceptance.test.mjs` (word count over the resolved TeX input closure) |
| P-035 | benign-behavior | Scanner-derived declared-list drift is benign by design (the derived list is authoritative); the preset must record it as non-blocking receipt evidence, not a warning. | §9, Phase 6 | `tests/tex-acceptance.test.mjs` (drift recorded as non-blocking receipt evidence; wider observed set authoritative) |
| P-036 | common-preset-defect | `finalBuild` not auto-derived at acceptance; finalize blocks. | §9, Phase 6 | `tests/acceptance-v8.test.mjs` (finalBuild captured from the accepted clean source, recorder, and PDF); `tests/output-policy.test.mjs` (rebuild closure consumes the accepted record) |
| P-037 | common-preset-defect | Publish resolution fails closed on cross-root same-name collisions with different hashes. | §9, Phase 6 | `tests/output-policy.test.mjs` (same-hash aliases collapse; different-hash collisions reported with both paths and owners) |
| P-038 | common-preset-defect + external-harness-behavior | Non-UTF-8 files cannot be hashed through the text path (harness `readText` strictness — routed, documented); the preset must hash bytes first and decode text only when needed. | §9, Non-Goals, Phase 6 | `tests/output-policy.test.mjs` (non-UTF-8 closure files hash and publish correctly) |
| P-039 | common-preset-defect | Rebuild closure publishes the master under two names (alias not collapsed). | §9, Phase 6 | `tests/output-policy.test.mjs` (same-hash aliases collapse in the published set) |
| P-040 | project-specific | Project plan-revision event (revision 2 approved; 12 nodes reopened). Not a preset defect. | excluded | n/a — explicitly excluded |
| LC-1 (plan §2.7) | common-preset-defect | Linear node context is too thin: the issue description holds a contract block but not a reliable current work picture; agents querying a node lack history and current intent. | §7, Phase 4 | `tests/linear-node-context.test.mjs`; `tests/linear-context-reducer.test.mjs`; `tests/linear-context-reconcile-e2e.test.mjs`; `tests/linear-lifecycle-e2e.test.mjs` (golden readability: a human and an agent get the same current work from the issue alone) |

## Coverage rules enforced by `scripts/check-traceability.mjs`

1. Every `P-*` identifier present in `docs/reported_bugs_0908.md` appears in this
   matrix exactly once, with a classification.
2. Every `common-preset-defect` and `external-harness-behavior` row names at least
   one owning plan section and at least one regression fixture.
3. Every `project-specific` row is explicitly marked `excluded`.
4. Every regression fixture named here exists under `tests/`; a fixture file
   that does not exist fails the gate even when a plan section once proposed
   that name.
5. The matrix rows for P-004, P-014, P-028, P-032, and P-038 carry an
   `external-harness-behavior` component and must include a routing note (harness
   owner) — the preset detects and documents these; it does not claim to fix them.
