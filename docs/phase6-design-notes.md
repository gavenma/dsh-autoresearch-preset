# Phase 6 — TeX, Recovery, and Publisher Hardening: Design Notes

Plan §9, §10 Phase 6, §13 gate 15, and the §11 adversarial cases
("comment-only TeX markers do not affect parsing", "missing or ambiguous
bibliography styles are reported by dependency preflight before acceptance",
"fragment acceptance requires an explicit template or a deterministically
generated one", "TeX failure evidence retains first error, line context,
tail, command, and cleanup state", "dot-prefixed compiler job names are never
generated", "reproducible builds pin and record `SOURCE_DATE_EPOCH`",
"`finalBuild` is auto-derived from a clean accepted build", "scanner-derived
declared-list drift is recorded as non-blocking receipt evidence", "`.tex`
publication succeeds through the format-correct path and never reports a PDF
destination mismatch", "non-UTF8 closure files hash and publish correctly",
"input-based masters receive correct word counts", "same-hash aliases
collapse and different-hash collisions are explicit", "timeout returns
recoverable but unaccepted output references", "provider failure records
every attempted route and any `coordinator-degradation` route source").

## What already existed before this phase

- Comment-aware normalized scanning (`core.stripTexComments` /
  `core.texNeeds`), used by marker/forbidden/needs/blinding scans (WS1 §8).
- Strict latexmk build (`strictTexBuild`): `-pdf -interaction=nonstopmode
  -halt-on-error -file-line-error -recorder`, never `-f`, owner-marked
  scratch dir, scratch cleanup recorded.
- Scanner-derived declared needs are the source of truth; a hand-filled
  declared-list mismatch is a recorded warning, not a failure.
- `captureFinalBuild` derives `finalBuild` from the accepted clean source,
  recorder (`.fls`), and PDF.
- Word counts via `texcount -inc -sum` with an assembled-text fallback.
- Same-hash duplicate publish entries collapse (published once, warning);
  different-hash duplicates are explicit errors naming both paths.
- `hashFile` hashes bytes first (non-UTF8-safe), text decode only when text
  inspection is required.
- Durable role-attempt records with crash/terminal recovery; timeout and
  provider-error classifications with per-attempt route recording.

## What this phase adds

### 1. `SOURCE_DATE_EPOCH` pinning + recording

- `core.nodeContract` gains `approvedAt` (the canonical plan's approval
  timestamp — immutable once approved).
- `strictTexBuild` accepts `{ sourceDateEpoch }`: when present, the latexmk
  spawn env carries `SOURCE_DATE_EPOCH = String(epoch)`, and the build record
  returns `sourceDateEpoch`.
- The epoch derives from `Date.parse(plan.approvedAt) / 1000` at every
  recorded build: node acceptance (via `validateNodeTex` / the node
  contract), the integration final check (via the loaded plan), and the
  reproducible-profile double build (same pinned epoch for both passes, so
  PDF bytes compare deterministically).

### 2. Typed build-failure evidence

`strictTexBuild` now extracts, from the combined compiler output:

- `firstError` — the first `! ` message line;
- `errorLine` / `errorContext` — the `l.<N> <context>` line following it;
- `command` — the exact compiler argv;
- `logTail` — the bounded output tail (existing);
- `scratchCleaned` / `cleanupError` — cleanup state (existing, now paired
  with a string cleanup error instead of an attached Error object).

The acceptance and final-check records surface these fields.

### 3. Dot-prefixed compiler job names

The strict build never passes `-jobname`: the job name is always the source
basename (`mainFile`), and the only dot-prefixed artifact is the
owner-marked `.autoresearch-compiler` scratch directory (a directory, not a
job name). The new test asserts the spawned argv carries no `-jobname` and
no dot-prefixed stem.

### 4. Bibliography-style preflight

`autoresearch_dependency_preflight` resolves every `\bibliographystyle{…}`
declaration in the run's TeX sources via `kpsewhich <style>.bst` (when the
subprocess service supports spawn):

- one hit → ok line with the resolved path;
- no hit → a warning finding "style file <style>.bst was not found by
  kpsewhich; the build may fail at \bibliographystyle";
- multiple hits → a warning finding naming every candidate (ambiguity is
  reported, never silently resolved).

The build itself remains the authority; preflight reports before acceptance.

### 5. Timeout recovery test (`tests/role-timeout-recovery.test.mjs`)

Unit-level against `makeRoleRunner`:

- a hanging child times out → `outcomeClass: 'timeout'`, `partialOutput:
  true`, and an `outputRef { path, hash, length, complete: false }` — the
  durable artifact reference with completion and hash status;
- the attempt record persists as terminal with the same `outputRef`; a
  crash-recovery relaunch returns the cached terminal attempt with the same
  hash — recoverable, never auto-accepted (`complete` stays false, no
  acceptance receipt is ever written by the runner);
- a retry path (non-timeout provider error) does not fabricate acceptance.

### 6. Publisher tests (`tests/output-policy.test.mjs` extensions)

- a `.tex`-only deliverable publishes through the format-correct source
  path with its source-support closure and never reports a PDF destination
  mismatch;
- a Latin-1 (non-UTF8) closure file hashes and publishes byte-identically —
  this case exposed a real bug: the staging/install transaction routed
  non-binary files through `readText`/`writeText`, which re-encoded invalid
  UTF-8 bytes. The transaction now copies EVERY entry byte-exactly
  (`fops.copy` for all files, hash-verified after staging and after
  install); publication never needs text inspection (plan §9);
- two same-hash sources for one destination collapse with a "published
  once" warning; two different-hash sources fail the finalize with an
  explicit collision error naming both paths.

### 7. TeX tests (`tests/tex-acceptance.test.mjs` extensions)

- comment-only markers (identity markers, commented `\input`s and
  `\bibliographystyle`s) do not affect scanning or build decisions;
- fragment mode with no template is refused (existing guardrail test) — the
  deterministic template generation (`core.buildPreviewTex`) remains the
  only allowed fragment assembly;
- failure evidence: a failing fake latexmk yields `firstError`, `errorLine`,
  `errorContext`, `command`, `logTail`, `scratchCleaned` on the record;
- the strict build argv has no `-jobname` and no dot-prefixed stem;
- `SOURCE_DATE_EPOCH` appears in the spawn env and on the record;
- texcount runs with `-inc -sum` so input-based masters are counted, not
  just the wrapper file.

## Non-goals (unchanged)

- No auto-acceptance of timeout artifacts (receipts remain coordinator-only).
- No `-f` compilation, no raw `rm` of build outputs.
- No hand-maintained schema forks; the tool count stays 61.
