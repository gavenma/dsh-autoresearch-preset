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

```bash
git clone https://github.com/gavenma/dsh-autoresearch-preset.git
cd dsh-autoresearch-preset
npm run init
```

`npm run init` is the first-run initializer: it checks your Node.js and DSH
installation, walks through model setup (every research role ships on
`deepseek-official/deepseek-v4-flash`), and optionally sets up your Linear
account — verifying the API key against Linear and storing it in the DSH
credentials store (`$DSH_HOME/.credentials.yaml`), never in this repository.
Model choices that differ from the shipped defaults are written to a
git-ignored `config.local.json`. It also prints the exact manual steps when
run from a non-interactive terminal.

Then verify and install:

```bash
npm run verify:snapshot
npm run install:preset
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

### Re-installing never rewrites your config

Updating the code and installing again must not change a working deployment.
The installer therefore treats `config.default.json` as layered configuration,
merged into the installed preset — later layers win:

1. the shipped defaults in this repository (new keys and roles appear here),
2. the deployment's existing installed config (everything you already set is
   preserved, never silently replaced),
3. `config.local.json` — the git-ignored local overrides `npm run init` writes.

Model choices are never auto-migrated: a model outside the shipped
recognized-model list is preserved as-is and reported. The repository itself is
never rewritten by the installer. Pass `--fresh-config` to skip both local
layers and install the shipped defaults verbatim.

## What ships vs what stays local

- **Ships with this repository** (portable, deployment-free): the composition,
  preset metadata, `config.default.json` with its `deepseek-official/deepseek-v4-flash`
  role defaults, role prompts, skills, generated tools, and the build/test
  tooling. No API keys, no personal provider catalogs, no runtime state.
- **Stays local, never committed**: `config.local.json` (per-deployment model
  choices and overrides, git-ignored), `$DSH_HOME/.credentials.yaml` (API keys,
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
config (shipped defaults + `config.local.json`) > built-in defaults. Review the
shipped defaults before use:

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
