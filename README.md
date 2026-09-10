# AutoResearch — a research project agent for DeepSeek Harness

A preset for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/DeepSeek-Harness)
that turns DSH into a research project team. You write a brief; the agent
plans the project with you, executes it step by step with specialized AI
roles, verifies every piece before accepting it, traces failures to their
cause, and publishes a finished deliverable — mirrored into Linear if you
connect it.

## What it can do

- **Plan from a brief.** A few paragraphs in, a structured, immutable plan
  out: every node, its deliverable, its dependencies, and a mechanical
  "done" checklist per node. Nothing runs before you approve it.
- **Execute without babysitting.** Nodes run in dependency order as fresh,
  single-purpose roles — scouts, verifiers, writers, critics, judges,
  coders, and an integration editor — each with a declared read/write
  scope, so no step inherits another step's context.
- **Verify at every level.** Draft → critique → revise until convergence;
  competing drafts are ranked by **blind** judges (zero-based `pass_NN/judge_NN`
  packets, digest-bound `judgeContext`); mechanical judge degradation routes
  to the critic gate instead of deciding with a broken panel.
- **Trace failures causally.** A downstream failure attributes to the
  responsible upstream node as a bounded, evidence-backed hypothesis —
  `observe` mode records it, `enforce` mode reopens the owning node within
  hard caps and re-verifies downstream.
- **Assemble and re-verify whole.** The integration pass checks every
  accepted contribution against a hash-anchored ledger, fixes only editorial
  issues in place, bounces substantive conflicts back to their owning node,
  and visually inspects figures before publishing.
- **Publish exactly what the plan names.** One folder, `outputs/<projectId>/`,
  driven solely by the plan's explicit `deliverables` list — plus a
  `MANIFEST.json` attributing every file by source, rule, and hash.
  Publication is transactional: the previous output stays last-known-good
  until a replacement commits.
- **TeX done right.** Reproducible builds are `SOURCE_DATE_EPOCH`-pinned,
  word counts cover the resolved input closure, compiler failures keep
  first-error/line/tail evidence, and a missing toolchain blocks with a
  clear remediation diagnostic — never a bare error, never a silent pass.
- **Linear as the live operational surface.** Each plan step is an issue
  with dependency arrows, and every issue carries a short, human-readable
  `Current Node Context` block — what is done, what failed, why it was
  reopened, what is next — readable on the issue itself, digest-bound so
  every lifecycle action re-reads it first.
- **Reopen finished work from feedback.** `autoresearch_submit_feedback`
  stores verbatim user feedback; triage reopens only the smallest
  responsible closure (cycle-checked, receipt-`supersedes`-linked,
  last-known-good preserved), and a repair republishes through the normal
  gates.
- **One canonical, unversioned schema.** Every record has exactly one
  shape identified by `kind`; tool schemas are generated from the core
  definitions; no version markers, no legacy readers at runtime (see
  Schema discipline).
- **Honest role confinement.** Broad role tooling (`read/grep/glob/bash/
  write/edit`) unlocks only behind a fresh, run-bound confinement
  attestation; on deployments that cannot attest it, roles stay on narrow
  allowlists and the preset says so.

## How a project runs

1. **Propose and approve.** The planner proposes the DAG; you approve it.
   The plan is frozen after approval — the agent surfaces drift, never
   rewrites it.
2. **Execute in dependency order.** Each node: evidence preparation →
   author loop (A/B/AB) → critique → blind judging → promotion, bounded by
   the node's budget.
3. **Accept mechanically.** Every criterion is accounted for
   (PASS/FAIL/WAIVED/NOT_APPLICABLE); TeX nodes run the strict build;
   acceptance receipts are hash-bound to the node contract and its journal
   revision.
4. **Integrate.** The editor merges accepted contributions, the verifier
   checks coverage, and the publish transaction lands the deliverable.
5. **Iterate from feedback.** Completed projects reopen minimally from
   user feedback and republish a verified replacement.

## Quick start

```bash
git clone https://github.com/gavenma/dsh-autoresearch-preset.git
cd dsh-autoresearch-preset
npm run init            # guided setup: role models + optional Linear key
npm run verify:snapshot # offline integrity check
npm run install:preset -- "$HOME/.dsh/.agent-presets/research"
```

- `npm run init` writes model choices straight into `config.default.json` —
  the single source of truth for role routing. It is **local-only and
  gitignored**: a fresh clone seeds it from the committed public template
  `config.example.json` on first `npm run init` (or copy the template by
  hand). No `config.local.json` overlay exists.
- The Linear key is stored in the DSH credentials store, never in this repo.
- **Restart the DSH process** after installing so the preset remounts.

## What's in this repository

- `roles/` — instructions for every worker role.
- `skills/` — the two entry points: `research-project` (open brief) and
  `research-outline-project` (your outline).
- `tools/` — the generated runtime: orchestrator, core engine, Linear
  adapter, bounded web/PDF fetcher.
- `src/` — editable source; `scripts/` builds/verifies/installs; `tests/`
  holds the regression suite (`npm test`).
- `briefs/demo-brief.md` — a synthetic brief for an end-to-end demo.

## Requirements

- A compatible DSH installation (recorded and tested with
  `@deepseek-ai/dsh` `0.1.5-rc.1`; the composition uses the split
  `prefix`+`suffix` persona shape introduced in 0.1.5).
- Node.js 20 or later for build/verify/install scripts (CI runs Node 24).
- Optional: `LINEAR_API_KEY` in the DSH credentials store for Linear
  workflows; local-only projects never call Linear.
- A model provider reachable from your deployment; role assignment lives in
  `roleProfiles` in `config.default.json` (local-only; seeded from
  `config.example.json`). A per-workspace `.research-agent/config.json` can
  override roles for one workspace.

## Install

```bash
npm run verify:snapshot
npm run install:preset -- "$HOME/.dsh/.agent-presets/research"
```

The installer copies runtime assets (composition, roles, skills, tools)
into the target. **A `config.default.json` that already exists at the target
is never touched** — re-installing after a code update cannot change your
working configuration. Two explicit flags can write it:

- `--replace-config` — reset the target config to this checkout's
  `config.default.json` (use after editing it or running `npm run init`).
- `--clean-target` — remove the destination tree first (stale bundles and
  residue); an existing target config is still preserved unless
  `--replace-config` is also passed.

First installs receive the config: the checkout's local `config.default.json`
when present, otherwise seeded from the public `config.example.json` template
(a mounted preset cannot run without one). The installer also *reports* —
never changes — role models outside the recognized list. Run
`tests/installed-build-probes.mjs <target>` after installing to confirm the
installed runtime.

## Verify the build

- `npm run check` — offline snapshot verification (hashes every runtime
  file against the build manifest; no network, seconds).
- `npm test` — the full suite (build, snapshot, schema, migration,
  capabilities, preflight, transport, blinding, promotion, Linear core/
  reducer/reconcile/lifecycle, feedback, causal routing, TeX acceptance,
  output policy, hardening). CI runs it on Node 24 on
  GitHub-hosted runners, which have no TeX toolchain — toolchain-dependent
  paths degrade to structured diagnostics.
- `npm run release:verify` — full suite + local smoke + clean install +
  installed probes.

## Configuration and operation

Precedence: workspace `.research-agent/config.json` > installed
`config.default.json` > built-in defaults.

- `linear.approval: "auto"` by default; set a stricter mode if side
  effects should require confirmation.
- Each role may set a provider-supported `reasoningEffort`; writing roles
  ship a `modelFallbacks` chain with a per-workspace rate-limit breaker.
- External research performs bounded outbound HTTP(S) fetches and may send
  context to providers; disable it for unauthorized material. The fetch
  provider rejects URL credentials, bounds sizes/time, retries transient
  failures, and refuses cross-origin redirects.

## Data handling

Never commit `.research-agent/` — it holds plans, drafts, evidence,
transcripts, receipts, and Linear metadata. Credentials, logs, and private
input material are ignored by default; inspect `git status` before every
commit. Redaction checks on final reports are not a substitute for
reviewing what external systems receive.

## Schema discipline

- One canonical, unversioned record shape per kind, defined and validated
  in `src/autoresearch-core.mjs`; `kind` is a record type, never a version.
- No `schemaVersion` fields, `v1/v2` branches, legacy readers, alternate
  unions, or policy-version markers. Runtime rejects old shapes with
  exactly one error: `not canonical; run scripts/migrate-workspace.mjs`.
- Tool parameter schemas are generated from the core definitions; never
  hand-maintain one.
- Change a core constructor/validator and all consumers atomically —
  fixtures, docs, bundles, snapshots, and tests in the same change.
- `scripts/assert-canonical-schema.mjs` enforces all of the above in source
  and generated artifacts.

## Development

Make runtime changes in `src/`, then `npm run build:preset` (it regenerates
the `tools/` bundles, pins `agent.cordis.yml`, and bumps the generation id).
Never edit generated bundles by hand. Run `npm test` before installation or
deployment. Maintainer-only helper files — `AGENTS.md` (agent change
discipline) and `docs/` (exactly two files: `capabilities.md`, `plans.md`) —
are kept locally in the working checkout and intentionally not published.
See `CONTRIBUTING.md`, `SECURITY.md`, and `NOTICE` for the remaining rules.
