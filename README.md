# AutoResearch DSH Preset

A source-controlled **AutoResearch Project Mode** preset for [DeepSeek Harness
(DSH)](https://github.com/deepseek-ai/DeepSeek-Harness). It coordinates
structured, evidence-grounded research through an approved DAG, independent
role subagents, an AutoReason-style A/B/AB refinement loop, blind Borda judging,
acceptance receipts, and final integration.

The repository started as a snapshot of the installed, runnable preset
(generation `73dba5793f85`, kept traceable in `tools/build-manifest.json`).
It now carries the editable build source under `src/`: every runtime
generation is rebuilt from it with `npm run build:preset`, and the current
generation, entry hashes, and aggregate build identity are recorded in
`tools/build-manifest.json`.

## Status

The runtime snapshot is usable with a compatible DSH installation. Causal
upstream backtracking v1 is implemented and defaults to `backtracking.mode:
"observe"`: it records only strict, disk-verified, same-pass quorum hypotheses.
`"enforce"` must be explicitly configured and treats a reopen as a bounded repair
experiment, not proof that an upstream node caused a defect. See
`docs/causal-backtracking-plan.zh-CN.md` for the protocol and test requirements.

## Quick start

When you clone this repository, **the first thing to run is the initialization
script**:

```bash
git clone https://github.com/gavenma/dsh-autoresearch-preset.git
cd dsh-autoresearch-preset
npm run init
```

`npm run init` is a guided setup that walks you through the two decisions
every fresh deployment has to make:

1. **Models.** Every research role ships on `deepseek-official/deepseek-v4-flash`
   — the right default for DeepSeek Harness users. Accept it, or pick a
   different model per role from your deployment's catalog.
2. **Linear (optional).** If you want the preset to mirror research nodes into
   Linear, paste your API key. It is verified against Linear right away, and on
   success stored in the DSH credentials store (`$DSH_HOME/.credentials.yaml`,
   mode 0600) — never in this repository.

Anything personal stays out of the repository: model choices that differ from
the shipped defaults are written to a git-ignored `config.local.json`. In a
non-interactive terminal the script prints the same information as manual
steps instead of prompting.

Then verify and install:

```bash
npm run verify:snapshot
npm run install:preset -- "$HOME/.dsh/.agent-presets/research"
```

If `npm run init` wrote overrides to `config.local.json`, add `--apply-local`
to the install command so they are layered into the installed preset:

```bash
npm run install:preset -- "$HOME/.dsh/.agent-presets/research" --apply-local
```

Start a new DSH session afterwards (see Install below for the restart rule).

## What it provides

- `preset.yml` and `agent.cordis.yml`: the DSH preset metadata and composition.
- `roles/`: confined role prompts for planning, evidence, authoring, critique,
  judging, reporting, implementation, and integration.
- `skills/`: standard and outline-led project workflows.
- `tools/`: the versioned AutoResearch core, orchestrator, Linear adapter,
  bounded web/PDF fetch provider, and build manifest.
- `briefs/demo-brief.md`: synthetic local example input.

The workflow uses an immutable approved `plan.json`, a mutable receipt-journal
`state.json`, and Linear only as a derived view. It does not treat Linear as the
source of truth for dependency completion.

## Requirements

- A compatible DSH installation. This snapshot was recorded with
  `@deepseek-ai/dsh` `0.1.1-rc.2` available locally; pin and test the DSH version
  in your own deployment before production use.
- Node.js 20 or later for the verification and installation scripts.
- Optional: a Linear credential exposed to DSH as `LINEAR_API_KEY` for Linear
  workflows (`npm run init` stores it for you). Local-only projects do not
  require it.
- A model provider reachable from your DSH deployment. Every role ships on
  `deepseek-official/deepseek-v4-flash`; change any role with `npm run init`,
  a local `config.local.json`, or a per-workspace `.research-agent/config.json`.

## Install

First inspect the snapshot locally:

```bash
npm run verify:snapshot
```

Install it into a user-owned DSH preset location, replacing the target with the
actual DSH home used by your deployment:

```bash
npm run install:preset -- "$HOME/.dsh/.agent-presets/research"
```

When replacing a preset that is already mounted, **restart the DSH process**
before starting a new research session. Standing preset mounts are retained for
the process lifetime; otherwise an old provider can collide with the replacement
generation during remount.

For safer evaluation, use a distinct preset id and target directory rather than
overwriting a working preset. The composition and its runtime entries are
self-contained relative to the preset root.

### The installer's promise about your config

The installer copies the preset's runtime code — the composition, role prompts,
skills, and generated tools — into the target directory. For configuration it
makes one simple promise:

> **A `config.default.json` that already exists at the target is never
> touched.** No merging, no overwriting, no backfilling of new keys.
> Re-installing after a code update leaves your working deployment's
> configuration byte-for-byte identical, so an update can never silently change
> how your deployment behaves.

Two explicit command-line flags are the only way the installer writes that
file, and only because you told it to:

- `--apply-local` — layer your git-ignored `config.local.json` overrides
  (created by `npm run init`) into the target config. Without the flag,
  `config.local.json` is simply ignored.
- `--replace-config` — reset the target config to the shipped defaults. Combine
  with `--apply-local` to reset and then re-apply your overrides.

The one exception that needs no instruction: a first install into a target
that has no config yet receives the shipped `config.default.json`, because a
mounted preset cannot run without one. If a future release adds new
configuration keys, they stay out of your file until you deliberately pick them
up (for example `--replace-config` + `--apply-local`, or by hand). The
installer also *reports* — without changing anything — any role model that is
no longer in the shipped recognized-model list.

## What ships vs what stays local

- **Ships with this repository** (portable, deployment-free): the composition,
  preset metadata, `config.default.json` with its `deepseek-official/deepseek-v4-flash`
  role defaults, role prompts, skills, generated tools, and the build/test
  tooling. No API keys, no personal provider catalogs, no runtime state.
- **Stays local, never committed**: `config.local.json` (per-deployment model
  choices and overrides, git-ignored; applied only when you explicitly pass
  `--apply-local` to the installer), `$DSH_HOME/.credentials.yaml` (API keys,
  DSH-owned, mode 0600), `.research-agent/` runtime state, and any
  deployment-specific tuning applied to the installed preset under
  `~/.dsh/.agent-presets/` after installation.

## Validate the baseline

```bash
npm run check
```

The check is offline. It confirms every manifest-listed file hash, recomputes
the aggregate build ID, verifies the embedded entry identities, and checks the
required preset assets. It does not invoke a model, DSH server, Linear, or web
fetch.

A full DSH runtime validation should also mount the copied preset and invoke its
`autoresearch_build_probe` and `linear_build_probe`; both must report the same
aggregate ID and `graphMatches: true`.

## Configuration and operation

`config.default.json` seeds configuration for new project workspaces. The
precedence is: workspace `.research-agent/config.json` > installed preset
config (the shipped defaults, optionally layered with `config.local.json` via
the installer's `--apply-local`) > built-in defaults. Review the shipped
defaults before use:

- The baseline includes `linear.approval: "auto"`; set a stricter approval mode
  in your deployment if side effects should require confirmation.
- Model identifiers are deployment-specific. Configure accessible providers and
  models, particularly for the integration editor when image inspection is
  needed.
- External research performs outbound HTTP(S) fetches and may send context to
  configured model providers. Disable it when the research material is not
  authorized for those services.
- The web/PDF fetch provider accepts only HTTP(S), rejects URL credentials,
  bounds URL/response/body sizes and time, retries transient failures, and
  refuses cross-origin redirects. Remote sources remain untrusted input.

Use the `research-project` skill for an open research brief and
`research-outline-project` for a substantial user-provided outline. Both lead to
the same approved plan, node execution, integration, and finalization flow.

## Data handling

Never commit `.research-agent/`. It can contain research briefs, source
excerpts, model transcripts, state receipts, Linear metadata, and generated
artifacts. Credentials, local configuration, logs, and private input material
are also ignored by default. Inspect `git status` before every commit and use a
secret scanner in CI.

The preset redaction checks final reports, but that is not a substitute for
reviewing what external systems receive. Web pages, PDFs, Linear comments, and
model output may contain prompt injection or sensitive data.

## Development

This repository is the editable source and build authority for the preset. Make
runtime changes in `src/`, then run `npm run build:preset`; it emits a new
versioned generation, updates the composition and manifest, and retains the
baseline generation only for regression tests. Do not edit generated entries in
`tools/` by hand. Run `npm test` before installation or deployment.

See `CONTRIBUTING.md` for test and data rules, `SECURITY.md` for reporting and
operational boundaries, and `NOTICE` for third-party attribution. The project is
MIT-licensed; vendored PDF.js remains subject to Apache-2.0 notices retained in
its source files.
