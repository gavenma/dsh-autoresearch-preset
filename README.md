# AutoResearch DSH Preset

A source-controlled **AutoResearch Project Mode** preset for [DeepSeek Harness
(DSH)](https://github.com/deepseek-ai/DeepSeek-Harness). It coordinates
structured, evidence-grounded research through an approved DAG, independent
role subagents, an AutoReason-style A/B/AB refinement loop, blind Borda judging,
acceptance receipts, and final integration.

This repository starts from the installed, runnable preset snapshot currently
identified by generation `73dba5793f85`. The generation, entry hashes, and
aggregate build identity are retained in `tools/build-manifest.json` so the
initial commit is traceable. The checked-in entries are generated runtime
artifacts, not a claim that their original build source has been recovered.

## Status

The runtime snapshot is usable with a compatible DSH installation. The proposed
causal upstream-backtracking extension is **design only**, not part of the
implemented baseline. See `docs/causal-backtracking-plan.zh-CN.md`; its v1 design
defaults to observation and treats a reopen as a bounded repair experiment, not
proof that an upstream node caused a defect.

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
  workflows. Local-only projects do not require it.
- Configured model providers for the role profiles in `config.default.json`.
  Those identifiers are deployment defaults, not an endorsement or portability
  guarantee. Copy/override the configuration for your own provider catalog.

## Install

First inspect the snapshot locally:

```bash
npm run verify:snapshot
```

Install it into a user-owned DSH preset location, replacing the target with the
actual DSH home used by your deployment:

```bash
node scripts/install-preset.mjs "$HOME/.dsh/.agent-presets/research"
```

Start a **new DSH research session** after installation. Preset composition is
mounted per process/session generation, so an already-running session can retain
an earlier generation.

For safer evaluation, use a distinct preset id and target directory rather than
overwriting a working preset. The composition and its runtime entries are
self-contained relative to the preset root.

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

`config.default.json` seeds configuration for new project workspaces. Existing
workspace configuration can override it. Review it before use:

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

This repository preserves the current runtime snapshot so work can continue with
normal Git history. Do not edit the generated entry files casually: any change
to manifest-covered content must update the manifest and the embedded aggregate
build identifiers together. Run `npm run verify:snapshot` after every such
change.

See `CONTRIBUTING.md` for test and data rules, `SECURITY.md` for reporting and
operational boundaries, and `NOTICE` for third-party attribution. The project is
MIT-licensed; vendored PDF.js remains subject to Apache-2.0 notices retained in
its source files.
