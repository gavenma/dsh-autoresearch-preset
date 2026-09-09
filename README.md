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
  so the project reads like a normal Linear board — and each issue carries its
  own short, human-readable `Current Node Context` block, so the live state of
  the node is readable on the issue itself without opening the workspace.

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
and rank them. Every worker is fresh and confined: it sees only the inputs its
role needs, writes only into its own step's folder, and returns when done.

**3. Draft → critique → revise, until the work converges.** Each step runs a
bounded refinement loop: draft, critique, revise, re-critique. The loop stops
when the critique finds nothing real left to fix (convergence) or when the
step's attempt budget is spent. When a step ends with several surviving
candidates, the judges rank them **blind** — they do not know which version is
the original, the revision, or who produced it — and the best one is promoted.
If the judging panel itself degrades mechanically — unparsable rankings,
duplicated or missing labels, all-tie scores, or too few usable rankings — the
step is routed to the critic gate instead of being decided by a broken panel.
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
that every planned contribution is present — each accepted section is hashed
and anchored into a contribution ledger, so "is it actually in the final
document" is a mechanical check — fixes editorial issues in place
(shortening, formatting, moving material to an appendix), and — for
substantive problems or conflicts between pieces — bounces the problem back to
the step that owns it instead of silently rewriting someone's work. A visual
check inspects figures and tables in the assembled document, and the finished
deliverable is published to `outputs/`.

**6. Where things live.** All internal work — the approved plan, per-step
checklists, drafts, evidence, and a journal of what was verified when — stays
in a hidden `.research-agent/` folder in your project workspace. Finished,
user-facing deliverables are published to `outputs/`, and a project publishes
at most one folder: `outputs/<projectId>/`. What it holds is decided by the
plan's project contract, not by filename convention: the explicit
`deliverables` list (a compiled PDF or report, a TeX source if the project
asks for one, companions like `references.bib` or `process-issues.md`), the
minimal supporting files an exposed TeX source needs to stay usable, and —
only when the project opts into a reproducible source package — the full
rebuild closure; plus a `MANIFEST.json` that attributes every published file
with its source, rule, and hash. Nothing is published that the contract does
not name, and a project that declares no deliverables gets no folder at all.
The plan is immutable after approval and the journal is append-only, so you
can always reconstruct what happened and why.

**7. Linear is the operational project surface, not the fact authority.** If
you connect Linear (see Quick start), each plan step gets an issue with
dependency relations (the plan's `dependsOn` edges appear as *blocks* arrows on
the board), progress updates, and visible machine holds when an upstream step
fails. Every mutation is recorded first in a local write-ahead log and applied
to Linear with read-back confirmation, so an interrupted update can be replayed
and a Linear outage never loses local progress. The approved plan and local
journal remain authoritative for the DAG and immutable facts; local-only
projects never call Linear.

**8. Each Linear issue carries its own `Current Node Context`.** The node's
*current* state — what is complete, the current evidence and findings, why it
is open or was reopened, the exact remaining work, its dependencies, and the
single next action — is written as a short, human-readable block directly in
the issue description. A person opening the issue can answer "what does this
node deliver, what is done, what is left, what happens next" without any local
file or coordinator memory. The block is machine-owned: it is evolved by a
deterministic reducer that *replaces* superseded facts (it never grows by
gluing on every milestone — older detail stays in the idempotent evidence
comments), and it is digest-bound, so the agent must re-read the issue and
carry the current digest before it claims, reopens, or completes a node. A
comment or edit that lands in between invalidates the stale digest and the
action is refused until the fresh state is reduced in. The local project state
stores only the digest pointer — never a narrative copy — so there is one
current state, and it is the one on the Linear issue. If the Linear adapter
cannot read and update issue descriptions, or Linear is unreachable, normal
node progression **pauses** with a clear `context-missing` / unavailable
result instead of silently falling back to a local copy; a small local cache
may hold a pending write only as crash-recovery intent, is read back against
Linear on reconnect, and can never authorize a claim, completion, or publish
on its own.

**9. User feedback after publication reopens only the smallest responsible
closure.** A finished project can be corrected without starting over. The
coordinator submits your feedback through one intake path
(`autoresearch_submit_feedback`), which stores it verbatim as a hash-addressed
record whose source is always the user — the record's authority is *computed*:
your feedback is `granted` only when the supplied base digests match the
project's last-known-good publication (the one recorded at the last successful
integration publish), `stale` when they don't, and `not-recorded` when the
project never published. A stale digest can never claim the judge-quorum
bypass. Feedback is triaged item by item (editorial, substantive, conflict,
scope, ambiguous); ambiguous feedback opens nothing, and a substantive finding
reopens exactly the triage-derived closure — the owning nodes plus their
transitive dependents, reset in one transaction, with unrelated completed
nodes, their receipts, and the last-known-good output preserved until the
replacement actually verifies. Closing a feedback requires a mechanical
resolution gate (fresh, non-superseded, hash-bound acceptance receipts that
PASS every triage acceptance check, a changed integration input, and a
publish-manifest digest equal to the current last-known-good), after which a
new resolved record and a republish event are written. If a repair or
republish fails, the previous publication remains the last-known-good output,
untouched.

**10. Role authority is narrow and explicit.** Every role runs as a fresh
subagent with a per-role tool-name allowlist. DSH does not currently expose a
per-child preventive path/egress adapter seam to this preset, so the broad
role baseline is disabled; `autoresearch_capability_probe` records
coordinator-adapter diagnostics and cannot widen child tooling. The
path/operation guard is a post-attempt mutation audit: it can fail an attempt
that changed protected or out-of-scope files without a coordinator approval
token, but it is not a read or egress sandbox. A role proposing a substantial
or cross-scope change emits a structured approval request, and prompt guidance
is never treated as the security boundary. Acceptance, promotion,
publication, and Linear mutations stay coordinator-only.

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

1. **Models.** The role model assignment lives in `roleProfiles` inside
   `config.default.json` — the single source of truth for deployment model
   routing. Accept it, or pick a different model per role from your
   deployment's catalog.
2. **Linear (optional).** If you want the preset to mirror project steps into
   Linear, paste your API key. It is verified against Linear right away, and on
   success stored in the DSH credentials store (`$DSH_HOME/.credentials.yaml`,
   mode 0600) — never in this repository.

Model choices are written straight into `config.default.json`; there is no
separate `config.local.json` overlay to maintain. In a non-interactive terminal
the script prints the same information as manual steps instead of prompting.

Then verify and install:

```bash
npm run verify:snapshot
npm run install:preset -- "$HOME/.dsh/.agent-presets/research"
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
  `@deepseek-ai/dsh` `0.1.2-rc.1`; pin and test the DSH version in your own
  deployment before production use.
- Node.js 20 or later for the verification and installation scripts.
- Optional: a Linear credential exposed to DSH as `LINEAR_API_KEY` for Linear
  workflows (`npm run init` stores it for you). Local-only projects do not
  require it.
- A model provider reachable from your DSH deployment. The role model
  assignment ships in `roleProfiles` inside `config.default.json`; change any
  role there or with `npm run init`. A per-workspace
  `.research-agent/config.json` can further override role models for a single
  workspace.

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

Two explicit command-line flags can write that file, and only because you told
the installer to:

- `--replace-config` — reset the target config to this checkout's
  `config.default.json` (the single source of truth for role model routing).
  Use it after editing `config.default.json` or running `npm run init` so the
  installed preset adopts the change.
- `--clean-target` — remove the destination preset tree before reinstalling,
  which eliminates stale unmanaged residue and old bundles. If the target
  already has a `config.default.json`, that file is preserved byte-for-byte
  across the clean unless `--replace-config` explicitly resets it. Unsafe clean
  targets such as `/`, the home directory, or a parent of the source checkout
  are rejected.

The one exception that needs no instruction: a first install into a target
that has no config yet receives the shipped `config.default.json`, because a
mounted preset cannot run without one. If a future release adds new
configuration keys, they stay out of your file until you deliberately pick them
up (for example `--replace-config`, or by hand). The installer also *reports*
— without changing anything — any role model that is no longer in the shipped
recognized-model list.

## What ships vs what stays local

- **Ships with this repository** (portable, deployment-free): the composition,
  preset metadata, `config.default.json` with its `roleProfiles` role model
  assignment, role prompts, skills, generated tools, and the build/test
  tooling. No API keys, no personal provider catalogs, no runtime state.
- **Stays local, never committed**: `$DSH_HOME/.credentials.yaml` (API keys,
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
CI runs the full test suite (`npm test`), not snapshot verification alone
(gate 16).

Run the complete local release gate with `npm run release:verify`. It executes
the full test suite, local-only Markdown/PDF/reproducible-TeX smoke, installs the
preset into a clean target with this checkout's `config.default.json`, and
imports the installed orchestrator and Linear bundles for both build probes. A
live rollout should additionally restart DSH, start a blank session, and run
`autoresearch_build_probe` and `linear_build_probe`; both must report a healthy
immutable graph, with mutable configuration differences listed separately as
`configDrift`.

## Configuration and operation

`config.default.json` seeds configuration for new project workspaces. The
precedence is: workspace `.research-agent/config.json` > installed preset
config (this checkout's `config.default.json`) > built-in defaults. Review the
shipped defaults before use:

- The baseline includes `linear.approval: "auto"`; set a stricter approval mode
  in your deployment if side effects should require confirmation.
- Model identifiers are deployment-specific. Configure accessible providers and
  models, particularly for the integration editor when image inspection is
  needed.
- Each role may set `reasoningEffort` to a provider-supported identifier for
  deeper (or shallower) reasoning; unset roles use the provider default, and an
  effort the provider does not advertise is reported as a warning.
- The five writing roles ship with a `modelFallbacks` chain to
  `deepseek-official/deepseek-v4-pro`: when a role's model fails with a
  provider or rate-limit error, the role steps to the next model in the chain,
  and a per-workspace breaker skips a rate-limited model until its cooldown
  expires.
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

## Schema discipline

AutoResearch has **one canonical record shape**, not numbered generations of
plan or receipt schemas. Every AutoResearch-owned record (plan, contract,
state, run, attempt, packet, receipt, ledger, revision request, feedback
record, Linear projection record, publish manifest) has one shape identified by
its `kind`; `kind` is a record type, never a schema version. Keep it that way:

- Change the core constructor/validator (`src/autoresearch-core.mjs`) and all
  of its consumers atomically. There is one validator per record type; do not
  add a second validator in the orchestrator.
- Never add `schemaVersion` fields, `v1`/`v2` branches, legacy readers,
  alternate field unions, policy-version markers, or numbered policy gates to
  AutoResearch-owned records. Deployment build metadata (generation ids, build
  manifests, install receipts) is separate and stays allowed.
- Tool JSON Schemas are generated from the core validator source; transport
  declarations are build artifacts, not second opinions. Never hand-maintain a
  tool parameter schema.
- Old persisted data belongs behind the offline migration boundary
  (`scripts/migrate-workspace.mjs`), never in role prompts or normal runtime
  paths. Runtime rejects an old shape with exactly one error:
  `not canonical; run scripts/migrate-workspace.mjs`.
- Update canonical fixtures, migration fixtures, docs, generated bundles,
  snapshot checks, and the full test suite in the same change. A change that
  needs two live shapes is incomplete and must not ship.
- `scripts/assert-canonical-schema.mjs` enforces this in source and generated
  runtime artifacts, including that every registered tool parameter schema
  equals the schema generated from `autoresearch-core.mjs`.

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
