# AutoResearch — a research project agent for DeepSeek Harness

This repository is a preset for [DeepSeek Harness
(DSH)](https://github.com/deepseek-ai/DeepSeek-Harness) that turns DSH into a
research project team. Give it a research question — "write an
evidence-grounded review of X" — and it plans the project with you, does the
work step by step with a team of specialized AI roles, checks every piece of
work before accepting it, traces failures back to where they started, and
hands you a finished report. If you use Linear, the whole project is mirrored
there as issues you can watch move from *todo* to *done*.

## What it can do

- **Plan a research project from a short brief.** You write a few paragraphs
  describing the question (or hand over your own outline); the agent proposes
  a plan: every step, what it will produce, which steps it depends on, and a
  checklist of what "done" means for each one.
- **Execute the plan without you babysitting it.** Each step is done by fresh,
  single-purpose AI workers — evidence gatherers, drafters, critics, judges,
  editors — so no step inherits another step's mistakes or context.
- **Verify work at every level.** Drafts are critiqued and revised until they
  hold up, competing drafts are ranked blindly, evidence claims must carry
  real sources, and the final document is assembled and re-checked as a whole,
  figures included.
- **Explain what went wrong, causally.** When a step fails its checks, the
  agent looks for the responsible upstream step instead of papering over the
  symptom.
- **Mirror progress into Linear (optional).** Each plan step becomes an issue,
  so the project reads like a normal Linear board.

## How a project runs

**1. You set the goal; the agent proposes the plan.** The agent turns your
brief into a map of the work: "gather evidence for A", "write section B
(uses A's findings)", "draft the abstract (uses B)", and so on, ending in a
final assembly step. Each step carries a checklist of concrete acceptance
criteria — things like "every claim cites a real URL" or "stays within the
word budget". **Nothing executes before you approve the plan.** Once approved,
the plan is frozen: the agent will surface drift, never rewrite it behind your
back.

**2. Each step runs in dependency order, one role at a time.** A step like
"write section B" is not one monolithic model call. The agent first sends out
*scouts* that gather evidence in parallel (web pages, papers, PDFs); a
*writer* drafts from that evidence; a *critic* attacks the draft for real
problems rather than style nitpicks; *judges* compare the candidate versions
and rank them. Every worker is fresh and confined: it sees only the inputs
its role needs, writes only into its own step's folder, and returns when done.

**3. Draft → critique → revise, until the work converges.** Each step runs a
bounded refinement loop: draft, critique, revise, re-critique. The loop stops
when the critique finds nothing real left to fix (convergence) or when the
step's attempt budget is spent. When a step ends with several surviving
candidates, the judges rank them **blind** — they do not know which version is
the original, the revision, or who produced it — and the best one is promoted.
This is what keeps "more iterations" from silently degrading quality.

**4. Failures are traced to their cause.** If a later step can't meet its
checklist, the agent doesn't just retry or patch the symptom. It looks for
mechanically checkable traces pointing upstream — a requirement the upstream
step was allowed to skip, a piece of work the upstream step never delivered —
and attributes the problem to the step that plausibly caused it. These
attributions are always recorded as **bounded hypotheses, together with the
exact evidence behind them**, never as proof. The default `observe` mode only records them, so you
can see where your projects tend to break. The optional `enforce` mode lets
the agent reopen the responsible step for a bounded repair attempt — with hard
caps on how many times any step may be reopened — and re-verify the downstream
work afterwards.

**5. The final document is assembled, then re-verified as a whole.** When
every content step is done, an *integration* pass merges the pieces: it checks
that every planned contribution is present, fixes editorial issues in place
(shortening, formatting, moving material to an appendix), and — for
substantive problems or conflicts between pieces — bounces the problem back to
the step that owns it instead of silently rewriting someone's work. A visual
check inspects figures and tables in the assembled document, and the finished
deliverable is published to `outputs/`.

**6. Where things live.** All internal work — the approved plan, per-step
checklists, drafts, evidence, and a journal of what was verified when — stays
in a hidden `.research-agent/` folder in your project workspace. Only finished,
user-facing deliverables are published to `outputs/`. The plan is immutable
after approval and the journal is append-only, so you can always reconstruct
what happened and why.

**7. Linear is a window, not the engine.** If you connect Linear (see Quick
start), each plan step gets an issue that the agent updates as work
progresses, so a human can follow the project on a board like any other Linear
work. The mirror is one-directional by design: the files from step 6 are the
source of truth, and the project never blocks on or trusts a Linear state. If
the two disagree, the agent surfaces the drift instead of silently reconciling
it.

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
2. **Linear (optional).** If you want the preset to mirror project steps into
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

## What's in this repository

- `roles/` — the instructions for each worker role: planner, evidence scout,
  writer, critic, judge, reporter, coder, and the integration editor/verifier.
- `skills/` — the two entry points you would actually use: `research-project`
  (open brief) and `research-outline-project` (your own outline).
- `tools/` — the runtime the preset runs on: the project orchestrator, the
  core engine, the Linear adapter, and a bounded web/PDF fetcher.
- `src/` — the editable source of the runtime, with the build and test
  tooling in `scripts/` and `tests/`.
- `briefs/demo-brief.md` — a synthetic example brief you can point the agent at
  to see a project run end to end without any real material.

## Requirements

- A compatible DSH installation. The preset was recorded and tested with
  `@deepseek-ai/dsh` `0.1.1-rc.2`; pin and test the DSH version in your own
  deployment before production use.
- Node.js 20 or later for the verification and installation scripts.
- Optional: a Linear credential exposed to DSH as `LINEAR_API_KEY` for Linear
  workflows (`npm run init` stores it for you). Local-only projects do not
  require it.
- A model provider reachable from your DSH deployment. Every role ships on
  `deepseek-official/deepseek-v4-flash`; change any role with `npm run init`,
  a local `config.local.json`, or a per-workspace `.research-agent/config.json`.

## Install

First check the build locally:

```bash
npm run verify:snapshot
```

Install it into a user-owned DSH preset location, replacing the target with the
actual DSH home used by your deployment:

```bash
npm run install:preset -- "$HOME/.dsh/.agent-presets/research"
```

When replacing a preset that is already mounted, **restart the DSH process**
before starting a new research session: DSH keeps a mounted preset in memory
for the life of the process, so a running process will keep serving the old
version until it is restarted.

For safer evaluation, install into a distinct preset id and target directory
rather than overwriting a working preset; everything a preset needs lives
inside its own directory.

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

## Verify the build

```bash
npm run check
```

The check is offline: it re-hashes every runtime file against the build
manifest and verifies the preset's internal consistency. It calls nothing —
no models, no DSH server, no Linear, no network — and takes seconds.

A full runtime validation should also mount the installed preset in DSH and run
its built-in self-checks (`autoresearch_build_probe` and `linear_build_probe`);
both should report a healthy project graph before you start real work.

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
`research-outline-project` for a substantial user-provided outline. Both lead
to the same flow: approve the plan, execute the steps, integrate, finalize.

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
versioned generation (the initial public snapshot was generation
`73dba5793f85`), updates the composition and manifest, and records the current
generation, entry hashes, and aggregate build identity in
`tools/build-manifest.json`. Do not edit the generated entries in `tools/` by
hand. Run `npm test` before installation or deployment.

See `CONTRIBUTING.md` for test and data rules, `SECURITY.md` for reporting and
operational boundaries, and `NOTICE` for third-party attribution. The project is
MIT-licensed; vendored PDF.js remains subject to Apache-2.0 notices retained in
its source files.
