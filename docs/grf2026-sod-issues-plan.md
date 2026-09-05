# GRF-2026 SOD process issues — remediation plan for the AutoResearch preset

Status: draft v8 (makes publication exposure-driven and format-agnostic, with optional
rebuild closure and run-owned temporary files; incorporates one DeepSeek V4 Pro critique
of v7 and supersedes v7 after the user's request for less TeX-specific output handling).
Input:
`GRF_2026/outputs/grf2026-sod/process-issues.md` (25 issues) cross-checked against
current source (`src/autoresearch-core.mjs`, `src/research-orchestrator.mjs`,
`config.default.json`, `roles/*.md`, `skills/research-project/SKILL.md`) **and
against the real GRF-2026 `outputs/` folder**, which demonstrates the confusion:
thirteen per-issue folders (`GAV-71`…`GAV-83`) each holding an ambiguous
`output.tex`, and inside the integration one the audit certificate (`output.tex` /
`output.pdf`) sitting beside the actual product (`final.tex` / `final.pdf`).
Baseline: `npm test` passes at generation `85e3543270af`.

## 0. Approach

The 25 issues are symptoms of **four technical root causes plus one documentation
and protocol gap**. We fix them in five small workstreams. Simplicity constraints:

- **No new runtime tools, no schema version bumps, and no automatic migrations.** Every
  runtime change rides an existing code path or prompt/doc; the two small scripts are
  offline, opt-in wrappers only. Optional contract fields must remain backward-compatible.
- **Keep the change surface explicit:** edit `src/`, roles, skills, config, tests, and
  the package test script; add only thin opt-in wrappers and a focused output-policy
  test extension, including the existing thin `scripts/backfill-ledgers.mjs` and the new
  `scripts/republish-outputs.mjs` (all policy logic lives in `src/`). Generated
  `tools/*-<generation>.mjs` snapshots are produced by `npm run build:preset`, never
  hand-edited.
- **Legacy compatibility is explicit and tested:** every behavior change is gated on
  the presence of the data it needs (see *Legacy & compatibility policy*), and legacy
  shapes get dedicated tests.
- Each workstream = one commit, gated by the existing test suite.

Root causes (memo's own summary): (a) acceptance/TeX tooling stricter and more opaque
than roles are told; (b) contribution ledger never materialized; (c) judge degradation
undetected; (d) finalize/journal not self-consistent and under-publishing, with no
stable project-level output contract. The fifth workstream handles role-protocol
friction that is largely a documentation gap.

### Exposure and workspace vocabulary

- **Exposed/user-facing:** a file deliberately selected for the user-facing project
  folder. `projectContract.deliverables` is the explicit request; an omitted list does
  not justify guessing filenames.
- **Source-support/rebuild input:** a dependency needed to make an exposed source usable
  or reproducibly rebuildable. A minimal local source-support closure is selected whenever
  an exposed source requires it; the complete recorder/dependency closure is included
  only when the contract requests a reproducible package and a format-specific checker
  can establish the relationship.
- **Internal:** receipts, ledgers, logs, prompts, role packets, compiler byproducts,
  previews, caches, and audit diagnostics unless the contract explicitly asks for them.
  Internal files remain under `.research-agent/runs/` and never become deliverables just
  because they happen to exist.
- **Temporary:** scratch data owned by one run, attempt, validation pass, or publish
  transaction. Temporary paths are not eligible for exposure and have an owner marker,
  bounded cleanup, and failure-retention rules.

## WS1 — Make acceptance predictable and format-aware

Issues #1, #2, #4, #5, #6, #7, #17 (mechanical half), #19 (label check lives here, not
in the docs pass).

1. **Opaque blocker → recipe.** `record_acceptance` currently assumes a TeX
   `output.tex` and throws "No output artifact found" when it is missing. Make the
   diagnostic use the contract's expected artifact path/format: state the precondition,
   name the accepted/promoted path, and list the candidate files actually present in the
   run dir (for example `pass_*/*.tex` or `pass_*/*.md`). New v2 nodes carry a safe
   relative `outputContract.artifactPath`; only the legacy adapter may use the old
   format-based default. Do not mention LaTeX when the node is Markdown or another
   supported non-TeX format. Shares its error path with item 9 below. (orchestrator,
   ~15 lines)
2. **Comment-aware static scan (TeX only).** `texNeeds()` in core scans commented-out
   `\usepackage`/`\newcommand` lines → false "undeclared" violations. Fix: strip
   comments (cut each line at the first unescaped `%`) before scanning, with TeX
   awareness: content inside `\verb|…|` and `\begin{verbatim}…\end{verbatim}` is kept
   verbatim (no comment cutting), and `\%` is not a comment start. The validator dispatches
   to this scan only for `artifactFormat: tex`; Markdown/non-TeX acceptance never enters
   it. One helper used by the single `texNeeds()` entry point; limitations documented
   in-code. (core, ~25 lines)
3. **Derived `declared` is the source of truth (fixes #3, not just its error text).**
   `record_acceptance` computes `derivedDeclared` from the format-specific artifact scan
   when one exists and records it in the receipt and `node-output.json` (WS2). Validation
   compares the artifact's actual uses against `derivedDeclared` (tautologically clean)
   and against the contract's hand-filled `declared`: **mismatches with the contract are
   warnings in the receipt, not failures** — the scanner result, not hand-entry, decides
   pass/fail. Formats without a dependency scanner record `derivedDeclared: null` and pass/fail on
   the accepted artifact's existence, path safety, and hash plus any explicit deliverable
   checks; they do not require a hand-maintained dependency allowlist or TeX validation.
   Consequence, stated explicitly: the hand-filled contract `declared` stops acting as
   an allowlist, so "undeclared dependency" is no longer a failure mode — undeclared
   *relative to the artifact's own preamble* is what gets validated, and contract drift
   is surfaced as a recorded warning. This semantic change is intentional (memo #2/#3:
   the hand list was the source of false failures) and is locked in by a dedicated test
   (hand-contract mismatch → warning; scanner-derived uses decide pass/fail). The
   static-error message still appends the derived `declared` object for copy-paste
   fixes of other kinds of errors. (core + orchestrator, ~20 lines)
4. **texMode guardrail (TeX only).** In `validateNodeTex`: when mode is `fragment`,
   there is no `templatePath`, and the output contains `\documentclass` or `\begin{document}`, fail
   with an explicit "set texMode: standalone" message. `init_run` normalizes the node
   contract on write: an `assembly` node with no `texMode` gets `standalone`. Planner
   prompt gains one clause: a TeX assembly `outputContract` must carry
   `texMode: standalone`. Non-TeX nodes do not receive a synthetic TeX template or build
   requirement. (orchestrator + planner role, ~12 lines)
5. **`.fls` system-path whitelist (only when a TeX build is requested).** Extract the
   inline allowlist in `tex_final_check` into one shared helper and add the missing TeX
   system roots: `/etc/texmf`, `/usr/share/texmf`, `/var/lib/texmf`, `/usr/share/texlive`
   (keeping the existing `/texmf-dist/`, `/usr/local/texlive/`, `/Library/TeX/` entries).
   Clean TeX builds stop failing on `texmf.cnf`/`pdflatex.fmt`/`pdftex.map`; a Markdown or
   non-TeX artifact never requires an `.fls`. (orchestrator, ~15 lines)
6. **Shared TeX file resolver (conditional).** Resolve workspace-local `\input`/`\include`
   targets recursively with a bounded depth and a cycle guard when a TeX source is being
   validated, exposed, or packaged for reproducibility. Used by: (a) word/citation
   counting in `tex_final_check` (#6 — modular assemblies no longer undercounted); and
   (b) the new label cross-check below (#19). Markdown/non-TeX paths do not invoke it;
   no speculative consumers. (orchestrator, ~25 lines)
7. **Label contract check before judging (TeX only)** (#19): every `\ref`/`\eqref` in
   an exposed or validated TeX master must resolve to a `\label` defined in that master
   or in resolvable `\input` fragments (via the shared resolver). Unresolved references
   name the owning node when identifiable. **If the TeX master is exposed, missing local
   inputs or unresolved labels are failures even when `rebuildable` is false; otherwise
   the source handed to the user would be broken.** If the TeX source is internal and no
   source package was requested, unavailable fragments produce a warning only. Run the
   source-usability check as an acceptance prerequisite whenever the TeX source is
   exposed; use the fuller `tex_final_check` path when that criterion is selected. (orchestrator, ~20 lines)
8. **`\verb` standardization** for the audit certificate: one sentence in the
   integration editor guidance (WS5 docs), no code.
9. **Missing-source early-warning** (#17 mechanical half, moved here from WS5 so the
   docs pass stays pure): the format-specific validation/acceptance entry points already
   fail when their expected source/artifact is absent — today with unhelpful messages. Unify
   them on one diagnostic that names the expected path and format, lists what *is* present
   (for example build outputs without source), and, for TeX directories with orphaned
   build artifacts, points at `latexmk -C` as the sanctioned cleaner. A stray `rm` is then
   caught at the next gate with a recipe, not discovered as a confusing compile failure.
   A non-TeX project never receives a TeX cleanup instruction. (orchestrator, ~10 lines,
   shared with item 1's error path)
10. **Format-aware acceptance dispatch.** Select validation from the node's declared
    `artifactFormat` and requested acceptance criteria. The contract's safe relative
    `outputContract.artifactPath` identifies the artifact; Markdown uses
    text/existence/hash checks; TeX uses TeX checks only when a TeX artifact is being
    validated or a reproducible TeX package is requested; other supported non-TeX formats
    use the producer/contract's explicit artifact path and byte hash without synthetic
    `final.tex`, `final.pdf`, or `.fls` requirements. Pass an explicit
    `requiresBuild`/`rebuildable` decision into `record_acceptance` so the strict-TeX
    guard is not applied to unrelated artifacts; binary formats are hashed as bytes and
    never decoded as text just to satisfy the ledger.
    (core + orchestrator, ~20 lines)

## WS2 — Materialize the contribution ledger mechanically for every format

Issues #8, #9, #10, #21.

Root fix: **`record_acceptance` writes `node-output.json`** as part of producing the
receipt. Everything needed is already computed at acceptance time (`outputHash`, format,
accepted artifact path, optional `texMode`/`derivedDeclared`, contract digest,
`nodeRevision`, criteria results) — the ledger becomes an internal artifact of
acceptance instead of a manual step nobody performs or exposes by accident.

1. **Deterministic contribution derivation with stable ids.** For a TeX artifact,
   contribution units are the top-level sections of the accepted source artifact (first present level of
   `\chapter`/`\section`; `\section*` and `\section[short]{long}` forms supported).
   **Unit id = normalized slug of the heading text** (comments/macros stripped, lowercase,
   `-` joined; on collision or empty slug, fall back to `slug-<sha1(heading)[:6]>`).
   Slugs survive reordering and edits that keep the heading, so cross-node references
   like `GAV-83:methods` stay valid across revisions; a `ledgerVersion: 1` field records
   the format. `texAnchor` = first normalized text sentence of the section, validated
   (non-empty, ≥ 20 chars after normalization) before writing; sections without a
   usable sentence carry no anchor and are flagged. Sectionless outputs (fragments,
   abstracts) and non-TeX artifacts get a single unit `main`; binary/PDF artifacts are
   not decoded as text merely to build the ledger. Record the accepted artifact's
   relative path, format, and hash in the ledger so downstream publication never
   guesses filenames. Evidence = PASSed acceptance criterion ids; `importance:
   "required"`, `mutability: "editable"`. Same-hash replay is idempotent.
   (orchestrator, ~55 lines)
2. **Documented contribution id scheme.** `<nodeId>:<unitId>` where `unitId` is the
   ledger's `id` (heading slug) — specified once in `skills/research-project/SKILL.md`
   and referenced by the integration editor role. (docs)
3. **Tolerant anchor matching.** `validateCoverage` currently requires the anchor to be
   a substring of one ~80–90-char split sentence. New rule (core), whitespace-normalized
   and length-guarded: match counts if the anchor is contained in a sentence **or** a
   sentence is contained in an anchor of ≥ 20 normalized chars; a paragraph-level
   containment fallback applies only to anchors of ≥ 40 normalized chars. Tiny anchors
   (`the`, `e.g.`) can never validate. Per-sentence splitting remains for the
   *unsupported-span* report only. (core, ~20 lines)
4. **One-time backfill for the existing GRF-2026 run** (#8 completeness): an optional
   `scripts/backfill-ledgers.mjs` generates `node-output.json` for already-accepted
   runs from their `acceptance.json` plus the recorded accepted artifact using the exact
   derivation above (deterministic, read-then-write, never modifies receipts). Scoped as
   a one-shot script; no runtime semantics change and nothing migrates old plans. (~60
   lines)
5. **`\ref` bookkeeping** (in-text "Figure N" consistency, #21) joins the integration
   verifier's checklist (WS5 docs); the mechanical half is the WS1 label check.

## WS3 — Detect judge degradation early, route to the critic gate by mechanism

Issues #11, #12.

1. **Mechanical degradation criteria** (all concrete, all tested): a pass is `degraded`
   when any of — (a) a judge ranking fails parsing or label mapping; (b) parsed ranking
   has duplicate or missing labels; (c) fewer than 2 distinct candidates ranked;
   (d) all-tie ranking; or (e) usable consistent rankings below the configured
   `backtracking.quorumJudges`. Detection lives where every ranking is already visible:
   `score_borda` computes `degraded`, `degradedReasons[]`, and `routing: "critic-gate"`.
   Result fields are additive; existing consumers ignore unknown fields. (core, ~25 lines)
2. **Deterministic routing at the checkpoint boundary.** The orchestrator's scoring
   override (the place that already computes pass verdicts, fail-closed blinding) reads
   the degradation verdict and emits the checkpoint's `nextAction` directive as
   critic-gate with no further judge-spawn steps listed — the loop is driven by these
   directives, so degraded panels stop consuming judge budget mechanically. The prompt
   sentence in the loop guidance exists as documentation of the same rule, not as the
   enforcement. (orchestrator, ~12 lines)
3. **Default fallbacks for authoring roles.** `config.default.json` adds
   `modelFallbacks: ["deepseek-official/deepseek-v4-pro"]` to the content-authoring
   roles (`research_planner`, `research_author`, `research_synthesizer`,
   `research_abstract_writer`, `research_integration_editor`). The machinery already
   exists (breaker + cooldown); only the defaults were empty. (config, ~10 lines)

## WS4 — `finalize` is one self-consistent finish step with exposure-aware output

Issues #23, #24, #25, plus the user-reported output confusion (per-issue folders like
`GAV-83/`, `output.tex` vs `final.tex`, two unexplained PDFs) and the requirement to
publish the complete usable package when the project asks for it (bibliography, process
report, sources, and other companions), not to force a PDF/LaTeX package for every run.

### The output policy (v8, exposure first)

One principle: **publish only files the contract says the user needs, plus the minimal
source-support files required to keep an exposed source usable; keep other working data
internal, and apply format-specific validation only to the exposed artifact(s) that need
it.** A project may expose a PDF, Markdown report, source bundle, or another explicitly
supported artifact, or
nothing at all; no filename extension is a universal requirement. Keep safety strict for
path confinement, ownership, and hash verification; relax only assumptions about which
artifacts a project must produce.

### Exposure decision table

| Contract state | New v2 (`exposurePolicyVersion: 1`) | Legacy v2 (marker absent) |
|---|---|---|
| `deliverables` is a non-empty array | Expose exactly those paths, after validation | Same, with legacy parsing of notes |
| `deliverables` is an explicit empty array and no diagnostic mappings | Return `skipped`; create no project folder | Same |
| Empty `deliverables` + mappings | Publish only mapped `audit/` files | Same with reviewed mapping |
| `deliverables` absent | Reject with actionable error; never guess | Frozen adapter; `sourceRule: legacy-adapter`; no companions |

The planner writes `projectContract.exposurePolicyVersion: 1` and an explicit
`deliverables` array for every new v2 plan; `[]` is the valid no-product value when no diagnostic mappings are requested.
`init_run` copies that marker into `node-contract.json`, while the contract digest keeps
it with the project contract. Marker absence is the compatibility signal only for an
already-approved v2 record; the new planner always writes the marker. For that branch,
freeze the currently shipped v2 selector in a named compatibility helper: use the
normalized legacy default
`['final.tex', 'final.pdf']` for a TeX integration (and the shipped Markdown primary for
an old Markdown contract), resolve only the paths that selector names, and publish to
the existing bound-v2 project target. Do not add companions, recorder closure, audit
files, or new format inference. Snapshot-test the exact selected paths, destination,
and manifest provenance so “legacy” cannot become an excuse for fuzzy discovery.

- **`outputs/<projectId>/` is the only user-facing publish target for a v2 project when
  there is something to expose.** Per-issue folders are not publish targets: `GAV-71/`
  through `GAV-83/` are issue ids of nodes, not deliverable scopes. If the product and
  diagnostic exposure sets are empty, finalize records `skipped` and creates no project
  folder. Historical folders
  remain untouched, but new bound runs do not create them; the GRF run shows the
  duplication and ambiguity they cause.
- **Per-node publishing disappears for bound (v2) runs.** Intermediate node artifacts,
  receipts, and working files stay hidden in `.research-agent/runs/…` where they belong;
  a file reaches the user only when the exposure selector includes it. Legacy unbound
  runs keep today's `outputs/<issueId>/` behavior byte-for-byte (no contract ⇒ no
  projectId ⇒ policy does not apply).
- **Keep internal names separate from exposure names.** A run may keep its canonical
  node artifact (`output.tex`, `final.md`, or another format-specific path) and compiler
  scratch names internally. The integration contract records the exact product paths to
  expose; publication never invents `final.tex`, `final.pdf`, or an extension from a
  basename. Internal `output.*`, receipts, logs, previews, and caches are not exposed by
  default. For the current GRF layout, an explicitly requested audit certificate may be
  mapped to `audit/audit-certificate.tex`/`.pdf`, while a requested product source/PDF
  keeps its declared path. A newly managed project tree never introduces a bare internal
  `output.*`; pre-existing legacy files are preserved and marked in `MANIFEST.json`;
  removal or relocation requires an explicit operator action.
- **Constrain the project destination key.** Before joining paths, require `projectId`
  to match `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` as one path segment; reject empty values,
  `.`, `..`, slashes/backslashes, absolute paths, control characters, and encoded
  separators. The fixed `outputs/` root and the selected project directory must be
  regular in-workspace directories, never symlinks. The destination key comes only
  from the validated plan/contract and must match the run's bound `projectId`; never
  derive a bound destination from `issueId`.
- **The exposure set has one explicit request and an optional rebuild support set.**
  `projectContract.deliverables` is the sole user-authored declaration of files intended
  for the user, including requested companions. It accepts safe relative file paths only;
  no globs or directory expansion. A non-empty list is copied exactly (subject to path,
  type, and hash checks). New plans must include the list, even when it is empty; an
  explicitly empty list means no product files are exposed; finalize returns `skipped`
  without a project folder only when `diagnosticMappings` is also empty. An omitted list is
  accepted only for an
  already-approved legacy v2 contract through the bounded compatibility adapter; it
  never enables new companion discovery. A separate optional
  `projectContract.diagnosticMappings` array may explicitly expose selected internal
  evidence; each object has exact `sourcePath` and `destinationPath` (under `audit/`), and
  it is never inferred from `deliverables` or a filename pattern.

  An optional `projectContract.rebuildable: true` asks for a fully reproducible source
  package. A format-specific dependency checker may add derived support inputs: for TeX,
  accepted local `INPUT`/bibliography closure; for other formats, only a checker that
  understands that format. If `rebuildable: true` is set for a format with no checker or
  no exposed source, plan validation fails clearly instead of silently ignoring the flag. A PDF-only or Markdown-only exposure requires only
  its requested artifact and any explicitly requested companions; it does not require
  additional `final.tex`, `references.bib`, or `.fls` files merely because those names are
  familiar. A derived input is still internal unless it is needed to make an exposed
  source artifact usable or reproducible; audit evidence is likewise internal unless
  explicitly requested. Missing explicit files fail; absent optional/internal diagnostics
  warn.
- **Normalize existing contract entries without fuzzy guessing.** New plans write plain
  safe relative paths. For already-approved v2 plans, accept the current annotated
  string form such as `submission: final.tex` or `receipt: references.bib (updated)`
  through one `parseDeliverableSpec` helper: preserve the label/note in
  `MANIFEST.json`, but use only the parsed path as the destination. Never infer a
  missing extension, substitute a same-basename file, or search by filename alone.
  The accepted grammar is `path`, `path (note)`, or `label: path (note)`, where
  `label` is `[A-Za-z][A-Za-z0-9_-]*`, `path` has no whitespace or parentheses and is a
  safe relative file path, and the final parenthesized note is optional; parse to
  `{path, label, note}` and normalize the path before deduplication. A parenthesized
  suffix is treated as a note only when the remaining path is valid. A malformed/unsafe entry is reported
  before any write. The existing GRF contract must be explicitly corrected to list
  the actual `bib-verification-ledger.bib` and requested `process-issues.md` before a
  new finalize; the offline republish wrapper may supply that reviewed correction, but runtime
  publishing never edits `plan.json`.
- **Use build evidence only when the exposure request needs it.** Format-specific
  validation is selected from the accepted artifact and `projectContract.rebuildable`,
  not from a universal filename rule. Every acceptance receipt records the actual
  accepted artifact as `{ path, format, sha256 }` (with compatibility aliases for the
  current `outputHash` field); finalize verifies that record instead of deriving a path
  from `artifactFormat`. If a reproducible TeX source package is requested, read the
  recorder at `finalBuild.flsPath` (usually `final.fls`) from the strict
  `latexmk -recorder` build, normalize entries against the
  run directory, keep regular files under permitted roots, classify system TeX paths,
  and reject non-system outside-root inputs. Record and verify an additive TeX
  `finalBuild` record with `{ sourcePath, sourceHash, flsPath, flsHash }` and optional
  `{ pdfPath, pdfHash }` fields; the PDF pair is required only when the requested package
  or acceptance criterion includes that PDF. Consume every normalized local non-system
  `INPUT` from that trusted record, then add parsed bibliography sources that the
  recorder can omit. If only a compiled PDF is exposed, verify the accepted PDF/build
  result but do not require publishing `final.tex` or `.fls`; if Markdown or another
  non-TeX artifact is exposed, do not run TeX checks at all. A missing/stale recorder is
  fatal only when reproducible TeX closure was requested or the selected acceptance
  criterion explicitly requires it; otherwise it is a diagnostic, not a project-publish
  blocker.

  When TeX closure is requested, resolve `\bibliography{…}` and
  `\addbibresource{…}` across the master and resolved inputs because BibTeX may log
  `final.bbl` without logging `references.bib`. The parser accepts comma-separated
  `\bibliography{a,b}` entries, whitespace/comments around arguments, and
  `\addbibresource[options]{file.bib}`; it rejects macro-computed, URL, absolute, or
  traversing arguments. BibTeX's `a` → `a.bib` convention is allowed only for this
  parsed command, never for a declared deliverable path.
- **Source usability and full reproducibility are separate choices.** When a TeX source
  artifact is explicitly exposed, its local inputs/labels must resolve; publish the
  minimal required local closure as `source-support` entries (or require those paths
  explicitly when the producer cannot derive them), so the exposed source is not knowingly
  broken. An outside-root, absolute, or `..` dependency is a failure in that
  source-exposure branch. `projectContract.rebuildable: true` additionally requests the
  complete accepted `.fls` closure and a clean rebuild; when only a compiled/report
  artifact is exposed, neither source closure nor clean rebuild is required. Add all
  branches to the tests; never rewrite an accepted source as an implicit side effect.
- **Internal-file and path rules are deterministic and independent of format.** Compiler
  byproducts, previews, attempt packets, caches, transaction journals, and candidate
  trees are never exposed merely because they match a filename; a requested diagnostic
  may use an explicit audit destination. A declared path that is unsafe, a directory, a
  symlink, or outside the allowed roots is rejected with an actionable error; the
  publisher never recursively copies an arbitrary directory. Format-specific byproducts
  such as TeX `*.aux`/`*.fls` and image-renderer scratch files are excluded by their
  producer's validator, not imposed on unrelated formats. A diagnostic mapping is an
  explicit array of `{ sourcePath, destinationPath, label?, note? }` entries separate
  from ordinary path deliverables. Its source is resolved under the same approved roots,
  its destination must be below `audit/`, and its hash is recorded with `sourceRule:
  audit`; no mapping is accepted from a filename pattern or extension substitution.
- **Companion documents are ordinary exposure requests.** There is no `companions.json`
  and no filename-pattern discovery. When the brief calls for a companion such as
  `process-issues.md`, the planner/integration editor adds its exact path to
  `projectContract.deliverables`, writes or stages it in a node run directory before
  acceptance, and finalize resolves it using the same safe path rules as every other
  exposed file. Source lookup is always integration run dir -> node run dirs in plan
  order -> the approved workspace source root (`baseDir`, excluding `outputRoot` and
  `.research-agent` metadata); the destination tree is never searched. Missing explicit
  files are reported in the finalize result and diagnostic; optional diagnostics that
  are not requested remain internal. A companion is never made mandatory merely because
  another format or project happened to produce one.
- **Standard layout of `outputs/<projectId>/` when exposure is non-empty:**

  ```
  outputs/<projectId>/
    <declared user-facing files> <- exact paths from the exposure request
    <source-support/rebuild inputs> <- source usability or requested reproducibility only
    MANIFEST.json                <- exposed paths, provenance, hashes, warnings
  ```

  Audit certificates, acceptance receipts, ledgers, logs, previews, and compiler
  byproducts remain under `.research-agent/runs/` by default. A project may explicitly
  request a reviewed audit bundle, in which case it is placed under `audit/` and labeled
  as diagnostic rather than product content. For GRF-2026, the reviewed exposure request
  may include `final.pdf`, `final.tex`, `references.bib`, `process-issues.md`,
  `figure-dossier.tex`, and `bib-verification-ledger.bib`; that is a project choice, not
  a universal schema requirement. A Markdown project can expose `final.md` and selected
  companions without producing any TeX files.

  Every exposed path is attributable in `MANIFEST.json` to `declared`, `source-support`,
  `rebuild`, `audit`, or `preserved`, with a SHA-256 hash. Internal files do not appear
  in the user manifest unless explicitly requested; diagnostics can be recorded in
  `warnings`. For new marked plans, `projectContract.deliverables` is required and may
  be empty; an empty array with no diagnostic mappings means `skipped` with no project
  folder, while mappings create an audit-only folder. Neither omission nor emptiness
  permits companion discovery. Already-approved v2 plans with an omitted
  list use the explicitly bounded legacy adapter described above, without imposing that
  behavior on new plans. There is no automatic deletion of existing destination files.

  `computePublishSet` returns only owned exposure data, for example
  `{ destinationPath, sourcePath, rule, requiredBy, sha256 }` entries plus
  `{ exposure: "user" | "source-support" | "rebuild" | "audit" | "internal",
  warnings, errors }`. `requiredBy` distinguishes an intentional exposure request from
  source usability, full reproducibility, and diagnostic support. The
  copier consumes that result; it never discovers additional files while writing. Its
  inputs include the normalized contract mode, accepted-artifact record, exact
  deliverables, diagnostic mappings, approved source roots, and optional build evidence;
  it does not inspect a format-derived filename on its own. `MANIFEST.json` also records
  `policyVersion`, `projectId`, `planRevision`, the
  integration run, selected artifact format, rebuild mode, managed path set, and the
  `preservedExisting` inventory, so a later run can distinguish its files from
  historical/unmanaged ones. This keeps exposure selection, validation, and filesystem
  mutation separate and makes each format's output tree directly testable.

  | Run kind | Visible destination | Visible contents |
  |---|---|---|
  | Bound v2 integration with exposure | `outputs/<projectId>/` | Requested files plus justified support/diagnostics |
  | Bound v2 integration without exposure | none | Accepted artifact and all internal evidence remain under `.research-agent/runs/` |
  | Bound v2 non-integration | none | Accepted artifact, receipt, ledger, and scratch data remain under `.research-agent/runs/` |
  | Unbound/legacy | `outputs/<issueId>/` | Existing legacy publish behavior, unchanged |

### Temporary-file lifecycle

Keep temporary management orthogonal to exposure. Add one small run-scoped helper used by
preview rendering, format validators, role retries, and the publish transaction. Every
owned directory has a marker such as
`{ schema: 1, ownerId, runId, operation, createdAt, state, expiresAt }`; `ownerId` is
unpredictable and the marker is checked before every cleanup or recovery action. The
state machine is explicit: `owned` while an operation has the lease, `retained` while a
preview/diagnostic consumer may still read it, `consumed` after the caller releases its
handle (and eligible for immediate removal), and `expired` when an unreleased retention
or abandoned lease reaches `expiresAt`. A default `retentionTtl` (24 hours) and a
short lease grace period (15 minutes) are configuration constants with an upper bound;
there is no indefinite retention.

1. Create a unique directory under the run's hidden workspace area (or a configured
   workspace temp root) with the marker above. Publish-transaction staging may instead
   be a hidden, owner-marked sibling of `outputs/<projectId>` so atomic rename/rollback
   stays on the same filesystem; it is never inside the user destination. Never use the
   user output folder as scratch space, and never treat a filename suffix as proof that a
   file is temporary.
2. Run compilers, rasterizers, probes, and intermediate transforms there; where a tool
   cannot redirect its byproducts, run it in an isolated temporary working copy rather
   than a caller-owned source directory. Promote an artifact to its explicit accepted
   path only after validation and hashing. Keep generated `.aux`/`.log`/`.fls`, preview
   images, caches, and ephemeral retry output there; durable attempt records remain
   available for replay and are not casually deleted.
3. Use `try/finally` to transition successful scratch to `consumed` and remove it only
   after all declared consumers finish. Preview APIs return an internal owner handle;
   the consumer releases it explicitly, and a missing release is bounded by
   `retentionTtl` rather than an immortal `retained-until-consumed` directory. On failure,
   transition `owned` to `retained` and retain only a bounded diagnostic manifest/log
   reference (not a half-written user package), with `expiresAt`; cleanup then moves it
   to `expired` and removes it after the lease and retention checks pass.
4. Run owner-only cleanup at existing run start/finalize/recovery boundaries; no new
   background scheduler is required. An abandoned `owned` marker is recoverable only
   after its lease grace period and when no matching live run lock exists. Cleanup is
   idempotent and confinement-checked: unknown files, user-authored run files, and
   existing outputs are never recursively deleted. A cleanup failure is reported
   separately from the original validation error and does not make an unrelated artifact
   format require TeX tooling.

### Code items

Extend the existing `finalizeRun` v2 override (no new tool, no new lifecycle). All new
behavior is gated on data presence (see legacy policy):

1. **Sync the journal (merge/patch, never replace).** After the acceptance gate
   passes, resolve `node-contract.json` → plan → `state.json` and **merge** into the
   existing node entry: `status: "done"`, `runDir`, `runStatus: "complete"`,
   `receipts: [acceptance hash, output hash, receipt path]`, `updatedAt` — every other
   existing field of the entry is preserved untouched. Idempotent (write only on
   change); repeated invocation is a no-op. (#23, ~30 lines)
2. **Exposure-driven project publish.** Applies when the run's node is the integration
   node and the plan resolves a validated projectId. Reject an unsafe id before any
   filesystem operation, then derive an exposure plan from the exact deliverables list
   and accepted artifact metadata. For a new-policy contract with an empty explicit
   list and no diagnostic mappings, return `skipped` with no project folder; with mappings,
   publish only the requested `audit/` files. Never synthesize a TeX product or a
   companion list. Put selection in
   one pure, unit-testable `computePublishSet` and keep filesystem mutation in the
   hash-checked copier. Update contract normalization and plan validation to preserve
   whether `deliverables` was omitted, explicitly empty, or non-empty, and normalize
   optional boolean `rebuildable` (default `false`) without changing the plan schema
   version. A new v2 plan must carry `projectContract.exposurePolicyVersion: 1` and an
   explicit `deliverables` array; copy that marker into `node-contract.json`. Preserve
   the old normalized default/digest shape for an already-approved v2 plan without the
   marker, and route only that branch through the frozen compatibility adapter. For a new
   marked plan, include the exposure marker, explicit-list presence, normalized
   `rebuildable`, and any diagnostic mappings in the project-contract digest so every
   derivation site sees the same policy. Remove the universal TeX default for new plans;
   the adapter is the only place that can retain an older implicit primary, marks entries
   `legacy-adapter`, and never rewrites the plan.
   (a) parse each requested path and classify it as `user`; verify only those files are
   required and copied;
   (b) classify source support separately from full reproducibility. When an exposed TeX
   master has local `\input`/`\include`, graphics, or label dependencies, resolve the
   bounded local closure and emit required files as `source-support` entries even when
   `rebuildable` is false; missing inputs or labels fail before publication. This branch
   does not require a clean compiler rebuild or `.fls`. A PDF-only or Markdown artifact
   has no synthetic source closure. A missing explicit file fails; an absent
   optional/internal file is a warning. No branch assumes `final.tex`, `final.pdf`,
   `final.md`, or `.fls` exists for every project. Acceptance records the actual accepted
   artifact path, format, hash, and any available format-specific build evidence;
   publication consumes that metadata rather than deriving a filename from the format.

   (c) when `rebuildable: true` and the exposed source is TeX, require and verify the
   accepted `finalBuild` record (`sourcePath`, `sourceHash`, `flsPath`, `flsHash`, plus
   the conditional PDF pair), recomputing every supplied hash before selection. Consume
   every normalized local, non-system `finalBuild.flsPath` `INPUT` entry as a `rebuild`
  input, including fragments, graphics, styles, and other regular files, not only bibliography
   files. Resolve each entry only under approved roots; an outside-root source is a
   non-relocatable hard error. Then union `.bib` sources from
   `\bibliography`/`\addbibresource` in the master and every resolved TeX input. BibTeX
   can log `final.bbl` without logging `references.bib`, so this scan belongs to the
   optional full-rebuild path, not to every finalize.

   (d) parse and resolve every file in `projectContract.deliverables` through
   `parseDeliverableSpec` (plain paths, plain `path (note)`, and the legacy
   `label: path (note)` form), including requested companions such as
   `process-issues.md`, `figure-dossier.tex`, and `bib-verification-ledger.bib`.
   Resolve each parsed path in this fixed order: integration run dir -> node run dirs
   in plan order -> approved workspace source root. Do not search the destination; use
   no globs, directory recursion, extension substitution, or magic filename discovery.
   (e) Apply path safety and any format-specific denylist. Reserved internal names
   (`output.tex`, `output.pdf`, `acceptance.json`, `node-output.json`) are not exposed
   accidentally. Ordinary deliverable syntax maps a source path to the same relative
   destination path. A separate `diagnosticMappings` request is the only way to map an
   internal source such as `output.tex` to `audit/audit-certificate.tex`/`.pdf`; each
   mapping names exact `sourcePath` and `destinationPath`, requires an `audit/` destination,
   and verifies the source hash. It never substitutes an extension. A destination
   collision with different hashes is an error; an identical-hash duplicate is
   deduplicated and recorded. Missing explicit files fail before mutation, while missing
   optional rebuild inputs fail only when the relevant source/rebuild branch was requested.
   (f) Keep receipts, ledgers, logs, previews, and audit diagnostics internal by default;
   include them under `audit/` only through an explicit `diagnosticMappings` entry or an
   explicit audit-package request. Reuse the copier's hash checks and write `MANIFEST.json`
   last with each exposed entry's source rule (`declared`, `source-support`, `rebuild`,
   `audit`, or `preserved`), source path, `requiredBy`, SHA-256, and warnings. (#24, #25)
   Propagate any selection, safety, or copy error through the existing `finalize` error
   channel: a failed requested publish must not return a successful finalize result.
   Keep the accepted run and journal repairable, but do not claim a requested exposure
   completed or replace the prior destination until the selected package commits.
3. **Suppress per-issue publish for bound v2 runs.** `publishFinalDeliverables` keeps
   its current `outputs/<issueId>/` behavior only for unbound/legacy runs; a bound v2
   non-integration run returns `deliverables: []` and creates no visible output folder.
   Its accepted artifact, receipt, and ledger remain in the hidden run directory until
   integration consumes them. (#24 root cause, ~10 lines)
4. **Preflight, transactional copy, idempotence, and temporary-file ownership.** Compute
   and validate only the selected exposure set (plus requested rebuild inputs) and their
   source hashes before changing `outputs/<projectId>`; reject traversal,
   absolute/out-of-root paths, symlinks, directories, and destination symlinks. Stage
   new managed files and `MANIFEST.json` in a workspace-local sibling staging directory
   under the same `outputs/` parent (same filesystem), then commit with a small rollback
   journal: snapshot previous managed files/manifest, install staged files, write the
   manifest last, and restore the snapshot on any copy/commit failure. Existing paths
   not listed as managed are inventoried, preserved in place, and recorded under
   `preservedExisting`; this destination-only inventory never supplies publish sources
   and never prunes them. A same-hash re-finalize makes no content or timestamp changes.

   All scratch data (preview images, compiler byproducts, probe files, resolver caches,
   role-attempt scratch, and transaction staging/journals) gets a run/attempt-owned
   temporary directory created beneath the workspace or run directory with a unique
   token and the explicit marker state machine (`owned` -> `retained` or `consumed` ->
   removal; stale retained/owned entries -> `expired` -> removal). The
   `withTemporaryDir`/`finally` path releases consumer handles, removes successful
   scratch, and retains only bounded diagnostic metadata on failure. Use the
   default `retentionTtl` and lease grace period from the lifecycle section; inject the
   clock in tests. Cleanup is confinement-checked and removes only matching owned paths,
   never arbitrary user files or `outputs/`; cleanup failure is a warning unless it
   prevents safe commit. Use the existing run lock for serialization, recover only
   expired journals/markers with the matching owner id, and leave active or retained
   preview data alone until release/expiry. (~65 lines around the existing copier and
   temp helpers)
5. **Docs:** `finalize_run` tool description, `skills/research-project/SKILL.md`, the
   README, and the integration-editor/planner guidance get the same short exposure
   policy and layout diagram. They must state that the contract list names files to expose,
   full rebuild closure is opt-in, source-support is selected only for an exposed source,
   no TeX file is universal, no `companions.json` or
   filename-pattern discovery exists, and scratch files stay in owned temporary paths
   rather than the output folder. (~1 page total)
6. **Existing GRF output, handled opt-in.** Add a thin
   `scripts/republish-outputs.mjs` wrapper over the same exposure selector and copier;
   keep that core in one shared `src/` module used by runtime finalize and the script, so
   the wrapper only parses arguments and renders the dry-run report. It requires explicit
   `--project-id`, `--source-root`, and a reviewed `--deliverables-file` override when
   the historical plan is wrong. The override is a JSON object
   `{ projectId, deliverables, diagnosticMappings?, rebuildable? }` whose paths and
   mappings are exact exposure requests; it is never written back to `plan.json`. The
   wrapper is dry-run by default, requires `--write` to create/update
   `outputs/<projectId>/`, and has no prune flag in the first version.

   Historical GRF republish should set `rebuildable: true` only because the reviewed
   package intentionally exposes `final.tex` and its supporting sources. In that mode,
   require a reviewed `--final-build-file` containing safe relative paths and
   `{ sourcePath, flsPath, sourceHash, flsHash, pdfPath?, pdfHash? }`; recompute and
   compare every supplied hash, including old `tex.flsHash`/`tex.pdfHash` when present.
   Require the PDF pair only because this reviewed package exposes `final.pdf`, and mark
   the manifest as an explicit historical republish. A PDF-only historical republish
   verifies the accepted PDF and needs no `.fls` file. Never silently bypass a requested
   rebuild check. Before republishing `grf2026-sod`, use the override to correct the
   annotated entries to the exact files (`bib-verification-ledger.bib` and
   `process-issues.md` included), compare hashes, then publish. The reviewed override is
   equivalent to `{ "projectId": "grf2026-sod", "rebuildable": true,
   "deliverables": [ "submission: final.tex", "submission: final.pdf",
   "receipt: references.bib (updated)", "receipt: process-issues.md",
   "receipt: figure-dossier.tex", "receipt: bib-verification-ledger.bib" ] }`.
   Do not rewrite `plan.json`, delete `GAV-*`, or treat the old output folder as a normal
   runtime source automatically; any cleanup remains a separate, explicit operator action
   after the new manifest is verified.

## WS5 — One coordinated role/protocol documentation pass (docs only — no code)

Issues #13, #14, #15, #16, #17 (protocol half), #18, #20, #22 (+ doc halves of earlier
workstreams). Both code items that v1/v2 carried here (\ref check, missing-source
diagnostic) live in WS1 (items 7 and 9).

- **Critic/judge contracts** (`research_critic.md`, `research_judge.md`): state
  explicitly that they are read-only, receive **absolute resolved paths** (never
  guess), and receive pre-computed build/word-count evidence from the coordinator —
  they never compile or count. Coordinator spawn guidance mirrors this. (#13, #14)
- **`init_run` schema honesty:** `issueId` is documented and marked required for
  project runs in the tool description. (#15, ~2 lines in tool text)
- **Planner output is format- and exposure-aware:** allow the supported artifact formats
  (currently TeX and Markdown), and require every new v2 plan to write
  `projectContract.exposurePolicyVersion: 1` plus an explicit `deliverables` array;
  use `[]` for a legitimate no-exposure project. Permit optional `rebuildable: true`
  only when an exposed source package is wanted, and validate that the selected format
  has a dependency checker. Do not emit a universal `final.tex`/`final.pdf` default or
  force TeX fields on Markdown plans; integration and assembly prompts mention `texMode`
  only for TeX nodes. Every new node also states a safe relative
  `outputContract.artifactPath` (the promoted artifact); optional
  `diagnosticMappings` must name exact internal sources and `audit/` destinations, never
  filename patterns.
- **Temporary-file hygiene** in the skill: scratch files live in the owned run/attempt
  temporary directory, never in `outputs/` or an arbitrary shared path; cleanup is
  lifecycle-managed and failure-retention is bounded. For TeX, clean with `latexmk -C`
  through the validated run helper, never raw `rm` on build outputs; run the cleaner
  before re-compiling after stale-aux symptoms. Non-TeX roles use the same ownership
  and cleanup rule without TeX commands. (#16, #18)
- **`rm` source-deletion (#17): protocol rule only (code half is WS1 item 9).** Honest
  scoping: the preset cannot intercept host-shell `rm`, so there is no hard code
  guard. This workstream contributes only the protocol rule above
  (`latexmk -C`, never raw `rm` on build outputs); the mechanical early-warning
  diagnostic is WS1 item 9, owned and tested there. The coverage map lists #17 as
  protocol + detection, not a code guard.
- **Caption provenance** (#20): figure/authoring role prompts require rewriting
  asset-inherited captions into the project's frozen framing at authoring time; the
  integration verifier checklist gains a provenance-leak item.
- **Pre-acceptance text pass** (#22): integration verifier checklist gains a
  spell/expansion/undefined-token sweep over the assembled text before acceptance.
- **Companion documents and exposure** (output policy): planner and integration-editor
  guidance gains one rule — when the brief calls for user-facing companions (for example
  `process-issues.md`, limitations, methodology memos, `figure-dossier.tex`, or a
  verification ledger), list each safe relative path in
  `projectContract.deliverables` and ensure the integration run produces it before
  acceptance. `references.bib` should likewise be listed explicitly when users need it;
  it is not exposed merely because a tool generated it. Set optional
  `projectContract.rebuildable: true` only when the user needs a fully reproducible source
  package; an exposed TeX source still needs its minimal source-support closure even when
  that flag is false. Stage/check format-specific dependencies (including non-system TeX
  inputs) and make the published source relocatable when the relevant branch requests it.
  A PDF, Markdown report, or supported non-TeX artifact can
  be accepted without TeX files. No `companions.json`, wildcard, or filename convention
  is introduced; the exposure mechanic is WS4 item 2.
- **Audit certificate style** (#7, when a TeX audit certificate is requested):
  standardize on `\verb|\command|` forms.

## Coverage map (v8)

| Issues | Workstream |
|---|---|
| #1, #2, #4, #5, #6, #7 | WS1 |
| #3 | WS1 item 3 (derived `declared` authoritative; contract mismatches = warnings) |
| #8, #9, #10, #21 | WS2 (incl. backfill script for the existing run) |
| #11, #12 | WS3 |
| #13, #14, #15, #16, #18, #20, #22 | WS5 docs |
| #17 | WS1 item 9 (early-warning diagnostic) + WS5 protocol rule — not a hard guard, stated honestly |
| #19 | WS1 item 7 (label cross-check) |
| #23, #24, #25 | WS4 |
| Output-folder confusion (user review) | WS4 output policy and safe publish set |
| User-facing package (requested files, including PDF/bib/process report when needed) | WS4 exposure policy and WS5 deliverables guidance |
| Testing against output chaos (user review) | Validation Layers 1–4 and rollout gates |

All 25 issues covered, plus both user-requested output requirements. Blockers: #1 and
#8 are code fixes; #17 is protocol + detection (explicitly not a hard guard).

## Explicitly out of scope

- No new user-facing runtime tools or pipeline stages; no plan/state schema version
  bumps. The temporary helper attaches to existing `try/finally` and run-lock paths. The
  offline republish wrapper is explicitly opt-in and shares the tested publish core.
- No changes to Linear sync, backtracking/causal routing, or vendored modules.
- No spell-checker dependency: the pre-acceptance sweep is a role checklist item.
- No changes to `config.local.json` (deployment-private).
- Backfill (WS2 item 4) is opt-in for the GRF-2026 run; nothing runs against it
  without an explicit invocation.
- **No cleanup of existing `outputs/` folders** (the GRF-2026 `GAV-*` directories
  stay as historical artifacts of a completed run); the policy applies to runs
  finalized under the new code. If the user wants the existing GRF output folder
  tidied to the new layout, that is a one-shot manual step offered after rollout,
  never automatic.

## Validation plan — proving the preset gets better, not noisier (v8)

Testing is a release gate, not a checklist after implementation. The output contract
gets an exact-tree test, while the broader preset changes retain the existing suite and
an end-to-end acceptance run.

### Layer 0 — record the baseline and protect it

Before editing, capture the already-green `npm test`, `npm run verify:snapshot`, and
current visible-deliverables behavior, including the locations and cleanup state of run
scratch. No existing test may be deleted, weakened, or made conditional merely to
accommodate the new policy. For each new behavior, write its test first and confirm it
fails against the unpatched bundle, then implement it and confirm green. Every
workstream gets one build generation and a review of the generated snapshot diff;
`tools/*` is never hand-edited.

### Layer 1 — focused unit and contract tests

Extend the existing suites and keep pure publish-set logic independent of filesystem
side effects. Every changed behavior gets a deterministic assertion:

- core: comment stripping incl. `\verb`/verbatim/`\%` edge cases; derived `declared`
  semantics; stable heading-slug ids; tolerant coverage anchors; and each judge-
  degradation criterion;
- orchestrator (fake fops): promote-first and format-aware missing-source diagnostics;
  ledger emission/replay; TeX-only `texMode`/`.fls` checks; recursive `\input` counting;
  conditional label checks; journal merge-preservation/idempotence; and
  `computePublishSet` for explicit exposure selection, noted-path parsing, omitted versus
  empty deliverables, Markdown/non-TeX artifacts without TeX requirements, optional TeX
  rebuild closure/bibliography extraction, unsupported `rebuildable` rejection, denylist,
  path confinement, symlink rejection,
  duplicate hashes, conditional build-evidence checks, exposed-TeX source usability with
  missing input/label, missing-explicit-file failure, internal-file exclusion,
  owned temporary-directory cleanup/retention, rollback, and
  interrupted-transaction recovery;
- configuration: new fallback defaults and existing shape checks.

### Layer 2 — deterministic golden output-policy test

Extend the existing `tests/output-policy.test.mjs` using its mounted-bundle/fake-fops
pattern; replace its v5 resolver-fallback assertions with exposure-aware rules and keep
small fixtures for three cases: (1) a Markdown/report integration with no LaTeX files,
(2) a TeX-backed integration that exposes only its accepted PDF and keeps source/build
support internal, and (3) a TeX integration that exposes source with `rebuildable: true`.
The full TeX fixture may contain `final.tex`, `final.pdf`, `final.fls`, closure
fragments/graphics, `references.bib`, and the GRF companions; the Markdown fixture
contains no LaTeX files. Put receipts, previews, compiler byproducts, and decoy files in
internal run/temp paths.

Assert each complete relative file tree, not selected paths:

- a non-empty new-policy exposure set creates exactly one project target,
  `outputs/<projectId>/`; an explicit empty set with no mappings creates no project folder,
  while an audit-only mapping creates only the requested `audit/` files; the legacy
  omitted-list fixture follows only the frozen adapter rule; no top-level `GAV-*`/issue
  folders and no bare top-level internal `output.*`;
- every explicitly requested user file is present at its exact declared path; requested
  GRF files include `final.tex`, `final.pdf`, `references.bib`, and `process-issues.md`,
  while the Markdown fixture exposes only its own requested files;
- receipts, ledgers, audit certificates, and diagnostics remain hidden by default; when
  an audit bundle is explicitly requested, it appears only under `audit/` with source-
  hash equality and clear diagnostic attribution;
- a clean-copy/rebuild check runs only for a requested reproducible source package;
  an exposed TeX source with `rebuildable: false` still resolves its minimal local inputs
  and labels, but does not require `.fls` or a compiler rebuild; exposed source remains
  byte-identical and its support/dependency files resolve without consulting the original
  run directory; PDF-only and Markdown packages do not receive synthetic TeX checks;
- `MANIFEST.json` lists every exposed/managed path, source path, exposure rule, hash,
  selected format, rebuild mode, and policy warning; pre-existing files appear separately
  under `preservedExisting` with their hashes, so the manifest contract is exact without
  deleting user files;
- only the TeX/rebuildable fixture includes `.fls`-derived inputs and parsed bibliography
  sources; its fragment, graphic, and style inputs are asserted individually, while
  compiler byproducts, previews, and candidate trees stay internal; the Markdown fixture
  does not require or publish any `.fls`;
- a `.bib` referenced from an included fragment is included as a derived rebuild input
  only in the `rebuildable: true` TeX branch; an exposed TeX source with a missing
  fragment or unresolved label fails even when `rebuildable: false`; `process-issues.md`
  is exposed only when explicitly listed, and no companion is inferred from a filename or
  extension;
- missing explicit files or unsafe sources fail before any destination write and report an
  actionable diagnostic; missing/stale/mismatched TeX build evidence fails only in the
  requested `rebuildable`/build-acceptance branch, while a non-TeX or PDF-only branch can
  finalize without `finalBuild`/`.fls`; a failed requested publish propagates through
  `finalize` rather than returning `projectPublish.ok: false`;
- legacy and plain-noted entries such as `receipt: references.bib (updated)` and
  `references.bib (updated)` are parsed to the exact path and their label/note are
  retained in the manifest; a wrong extension is not silently substituted; internal
  receipt/build names are not exposed accidentally. A requested diagnostic mapping must
  name both its internal source and `audit/` destination, and `output.tex` is publishable
  only through that mapping; the mapping is tested separately;
- unsafe project ids (`../x`, `a/b`, absolute, empty, and overlong values), traversal,
  absolute/out-of-root, symlink, directory, missing explicit, and conflicting requested
  paths fail before modifying the existing destination; an identical-hash duplicate is
  deterministic;
- an injected copy or manifest-commit failure restores the prior managed tree and
  manifest byte-for-byte; a surviving journal is recovered before the next finalize;
  owned temp markers exercise `owned`, `retained`, `consumed`, and `expired` states with
  an injected clock, including an abandoned post-crash directory and an active-lock
  directory that must survive; success cleans scratch, failure retains bounded
  diagnostics, and cleanup never sweeps an unrelated path; a second finalize is content-
  and timestamp-idempotent and preserves an unrelated sentinel file already in the
  project folder;
- Markdown/report and PDF-only fixtures create only the files they explicitly expose,
  with no synthetic TeX requirements; a new-policy bound integration with `deliverables: []`
  creates no visible directory and returns `skipped`; a new-policy contract omitting the
  marker/list is rejected; a legacy v2 omitted-list fixture uses only the frozen adapter
  and records its exact selector provenance; a bound non-integration fixture returns an
  empty `deliverables` list; a legacy fixture without `node-contract.json` retains the old
  `outputs/<issueId>/` shape byte-for-byte;
- `scripts/republish-outputs.mjs` is dry-run by default, `--write` is explicit,
  `--deliverables-file` supplies the reviewed GRF correction without mutating
  `plan.json`; a historical republish verifies `--final-build-file` only when the
  reviewed request asks for a reproducible TeX source package; a project-id mismatch is
  rejected, and neither mode deletes an existing `GAV-*` directory.

This test is the non-negotiable output-policy contract and must fail on the current
implementation before the publish changes are made.

### Layer 3 — full-suite regression gate

After every workstream: `npm run build:preset` -> `npm run verify:snapshot` ->
`npm run test:output-policy` -> `npm test`. Keep `test:output-policy` in `package.json`
and include it in the aggregate `test` script; the suite must retain all existing
role-runner, baseline, causal, web-fetch, visible-deliverables, and revision coverage.
Review the generated bundle and manifest diff to ensure the mounted code is the code
that was tested.

### Layer 4 — live smoke and real-project acceptance

Use the existing cost-limited fallback smoke, then run small real projects from
`briefs/demo-brief.md` in at least two formats: one Markdown/report project with a
requested companion and one TeX project only when the brief requests a reproducible
source package. Include a PDF-only or other accepted artifact case where practical.
Collect each run log, `state.json`, the final `MANIFEST.json` when a project folder exists,
a sorted output-tree listing, and the hidden temp-retention summary. Sign off only when:

1. each requested file is present at its declared path; the Markdown project has no
   TeX artifacts or `.fls` requirement, and the PDF-only exposure publishes no TeX source
   or `.fls` even if its internal producer used a TeX build; the explicitly reproducible
   TeX project has verified source/dependency evidence and rebuilds from a clean workspace;
2. there is one project folder only when exposure is non-empty, no newly-created per-node
   `GAV-*` output folders, and no newly-created bare internal `output.*`; historical files
   remain untouched;
3. every accepted node has its internal receipt/ledger, and the journal is synchronized
   immediately after finalize without exposing those files by default;
4. a repeated finalize changes neither managed content nor unrelated files, and owned
   temporary directories are cleaned or retained only under the bounded failure policy;
5. missing explicit/conflicting files produce an actionable failure, while absent
   optional/internal files do not turn an unrelated format into a false failure; and
6. the original 25-issue memo is replayed as a traceability checklist with no manual
   coordinator workaround remaining.

### Rollout order

Edit `src`/roles/skills/config/tests/package script -> build -> snapshot verification
-> focused output test -> full suite. Order: WS1 -> WS2 -> WS4 (publish-set, migration
wrapper, and golden test) -> WS3 and WS5. Five focused workstream commits; the
real-project acceptance run is the final release gate.

## Legacy & compatibility policy (v8, explicit)

- `record_acceptance` on legacy contracts: derived-`declared` behavior is additive —
  contract mismatches become warnings, failures only shrink, never grow.
- `score_borda` output: additive fields only; existing consumers ignore them.
- Coverage validation: the tolerant anchor rule relaxes validation (failures shrink);
  unsupported-span reporting unchanged.
- `finalize`: journal sync activates for every bound v2 contract; the new exposure policy
  activates for contracts carrying `exposurePolicyVersion: 1`. A bound non-integration node
  creates no visible output. A new bound integration node publishes only its explicit
  exposure set; `[]` with no diagnostic mappings completes with `skipped` and no project
  folder, while an explicit audit mapping may create an audit-only folder. `rebuildable:
  true` adds a format-specific dependency/trust gate; it does not make TeX evidence mandatory for a
  Markdown or PDF-only exposure. Missing explicit files or unsafe paths fail before
  replacing the destination. Unbound runs keep `outputs/<issueId>/` byte-for-byte; all
  other legacy paths remain unchanged.
- An already-approved v2 plan whose `projectContract` lacks the additive exposure marker
  and deliverables field uses one frozen compatibility adapter. The adapter delegates to
  the shipped v2 implicit selector (TeX: normalized `final.tex`/`final.pdf`; Markdown:
  the shipped Markdown primary), publishes only selector-named files that pass the old
  existence/hash checks, and records `sourceRule: legacy-adapter`; it does not discover
  companions, add `.fls`/bibliography closure, or rewrite the plan. Its exact destination
  and tree are pinned by a dedicated golden fixture.
- Dedicated legacy-shape tests: old plan without `projectContract`, old v2 plan with
  omitted deliverables and no exposure marker, run without `node-contract.json`, journal
  already at `done`, and legacy finalize publish shape (Layer 2 includes these fixtures).

## Risks

- **Ledger derivation heuristic** (sections → units) is restricted to a tested TeX
  subset; sectionless/artificial structures fall back to the single `main` unit. The
  format is documented so `node-output.json` can be hand-corrected before integration.
  Remaining edge cases in heading parsing are the top implementation risk to watch.
- **Exposure selection can omit something the user expected.** Keep the contract list
  visible in the manifest and planner guidance; fail on missing explicit files, but do
  not turn optional build inputs or familiar filenames into hidden requirements. A
  requested reproducible source package remains bounded by format-specific closure and
  source-hash checks; a PDF/Markdown package stays small.
- **Source resolution ambiguity** is a correctness risk: two node runs may contain
  different files with the same declared path. Different hashes fail closed;
  identical hashes are deduplicated and recorded in `MANIFEST.json`. Path traversal,
  symlinks, directories, and destination symlinks are rejected rather than copied.
- **Judge degradation thresholds** (quorum, all-tie) are config-visible defaults; if
  they misfire on very small judge panels they only *route to the critic gate
  earlier*, never block completion. Watch: false positives with 2-judge panels.
- **Derived-`declared` semantics** intentionally retire "undeclared dependency" as a
  failure mode (contract drift becomes a warning); locked in by a dedicated test.
- **Output policy is a visible behavior change** (no more per-issue folders for v2
  runs); `MANIFEST.json` + docs make the new layout self-describing, and legacy runs
  are untouched. The golden Layer 2 tests pin the layout so it cannot drift silently.
- **Requested reproducibility can expose incomplete staging.** A fragment or figure
  left in another node run is a hard failure only when a source package was requested;
  otherwise it remains internal and does not block a PDF, Markdown, or other supported artifact.
  The integration editor stages dependencies only for the requested rebuild branch.
- **Transactional and temporary cleanup add filesystem edge cases.** Staging stays
  beside the destination on one filesystem, owned temp paths carry markers and bounded
  retention, the journal is hash-checked, and failure-injection plus recovery/cleanup
  tests are release gates; an interrupted transaction is repaired before a new publish
  proceeds.
- **Republishing historical output can select stale sources.** The wrapper is
  dry-run by default, requires explicit `--write`, records every source hash, and
  never deletes or reads the destination implicitly; an operator reviews the
  proposed manifest before changing the existing GRF folder.

## Revision log

- v1: initial draft.
- v2: applied critique round 1 (DeepSeek V4 Pro). Addressed: #3 promoted from
  error-message fix to derived-source-of-truth (WS1.3); stable slug contribution ids
  replacing sequential `sN` (WS2.1); #17 honestly re-scoped as protocol + early-warning
  (WS5, coverage map); degradation routing made mechanical at the checkpoint boundary
  (WS3.2) with concrete criteria (WS3.1); ledger + acceptance attached to project-level
  publish; section parser restricted to a tested subset with validated anchors
  (WS2.1); anchor-matching length guards against tiny anchors (WS2.3); shared TeX file
  resolver unifying `\input` expansion and label checks (WS1.6/7); explicit legacy
  gating + legacy-shape tests (§legacy policy); finalize path resolution against node
  run dirs with absent-list fallback (WS4.2); comment stripping made verbatim-aware
  with tests (WS1.2); test list expanded to every changed code path; opt-in backfill
  script for the existing GRF-2026 run (WS2.4); label check moved into WS1.
- v3: applied critique round 2 (DeepSeek V4 Pro), which marked 13/15 round-1 findings
  resolved and required three corrections: (1) WS5 made genuinely docs-only — the #17
  missing-source diagnostic is now WS1 item 9 with a test; (2) the backfill script's
  location reconciled with the edit-confinement rule (thin wrapper in `scripts/`, all
  logic in `src/`, explicit exception stated); (3) finalize publish spec unified —
  evidence attachment applies exactly when project-level publishing occurs; the later
  v5 contract/default-deliverable clarification superseded the draft's ambiguous
  empty-list rule, and v6 now distinguishes an omitted list from an explicit empty
  opt-out; journal sync is specified as merge/patch with a
  merge-preservation test; derived-`declared`
  semantics lock-in test added. Verifier's closing top risks (heading-parser edge
  cases, degradation false positives on small panels, same-name deliverable
  collisions) are now listed under Risks.
- v4: user review requested (a) a clear, consistent, elegant output policy — the real
  GRF-2026 `outputs/` folder (thirteen `GAV-*` per-issue folders, `output.tex` vs
  `final.tex`, two unexplained PDFs) is the motivating evidence; and (b) enough
  testing to prove the preset improves rather than adds chaos. Changes: WS4 rewritten
  around a single output policy — one `outputs/<projectId>/` folder per project, no
  per-issue folders for v2 runs, the audit certificate renamed under `audit/` so a
  bare `output.*` never reaches users, fragments/graphics resolved from `final.tex`
  (not copied blindly), and a self-describing manifest (the draft used a Markdown manifest; v5
  standardized on `MANIFEST.json`); the validation section
  replaced by a four-layer pyramid (unit → golden output-policy tests → full-suite
  regression gate → end-to-end acceptance run against `briefs/demo-brief.md`), with
  a pinned golden file-tree expectation as the layout's contract; existing GRF output
  folders explicitly left untouched (out of scope).
- v5: user clarified that the project output must include the complete usable package,
  not only `final.pdf`, specifically bibliography files and companions such as
  `process-issues.md`. Simplified the design by removing `companions.json`: the
  existing `projectContract.deliverables` is the sole explicit list, while accepted
  `.fls` inputs plus parsed bibliography sources form an automatic rebuild closure.
  Added file-only/path-safe resolution, trusted-`fls` fail-closed behavior, a
  rollback-backed publish transaction, `MANIFEST.json` provenance, receipt/ledger
  grouping under `audit/`, and golden assertions for bib, process companion, denylist,
  idempotence, destination preservation, copy-failure rollback, annotated legacy
  entries, and legacy shape. Added a dry-run-first
  `scripts/republish-outputs.mjs` wrapper for existing GRF artifacts and made the
  golden test a named `npm run test:output-policy` gate.
- v6: applied the targeted confirmation review. Clarified that the declared list is
  the sole intentional-companion declaration while trusted `.fls`/bib closure is
  mandatory derived support; required a relocatable integration-root source tree;
  validated `projectId`; formalized the noted deliverable grammar and reserved audit
  names; added the reviewed `--deliverables-file` republish override, final-build hash
  handoff, same-filesystem rollback recovery, and clean-copy/recovery tests.
- v7: applied the user's format-scope correction. Made exposure, not TeX, the primary
  decision: explicit deliverables are the only user-facing request, rebuild closure and
  `finalBuild` are conditional, and Markdown/non-TeX runs do not inherit LaTeX
  requirements. Added a run-owned temporary directory lifecycle with isolated build
  scratch, consumer-aware preview retention, bounded failure diagnostics, and owner-
  checked cleanup/recovery tests. Its initial omitted-list wording was superseded below.
- v8: applied one focused DeepSeek V4 Pro critique. Made the new/legacy boundary
  unambiguous with `exposurePolicyVersion: 1` and an explicit `deliverables` array for new
  plans; defined the frozen legacy selector and its provenance; made exposed-TeX source
  inputs/labels fail when missing even without full rebuildability; specified full TeX
  `.fls` closure for `rebuildable: true` (including non-bibliography inputs) and the
  accepted build-evidence shape; added explicit diagnostic source-to-`audit/` mappings;
  and defined temporary states, TTL/lease handling, consumer release, and post-crash
  cleanup tests. Non-TeX acceptance remains existence/path/hash based and does not invoke
  TeX validation.
