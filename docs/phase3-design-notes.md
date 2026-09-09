# Phase 3 Design Notes — Typed Handoffs and Promotion

Working notes for implementing plan §6 (One Typed Subagent Handoff Protocol) +
Phase 3 work list. Source authority:
`docs/autoresearch-canonical-linear-reliability-plan.md`. Gates 4 + 6 + the
§11 adversarial lines for this phase.

## Audit results (verified 2026-09-08, gen 3a3e9ff605ee)

Already in place (do not rebuild):

- `core.buildBlindPackets`: integer type errors BEFORE digest binding
  (zero-based exact pass/judgeCount), byte-identical `judgeContext` bound into
  `contextDigest` + `passDigest`, `SHARED_CANDIDATE_MATERIAL` fail-closed,
  provenance stripping, structural leading-heading normalization (blind copies
  only), token-bounded identity patterns, full-byte leak scan,
  `TAINTED_BLINDING` before any write.
- Judge dispatch side (`buildJudgePacketTask`): `core.validateJudgeDispatch`
  field-specific type errors, on-disk blind-packet map re-verification
  (pass/judge/judgeCount/runDigest/contextDigest), packet re-hash, all before
  spawn.
- `promoteArtifact`: single hash-checked path, run-confined (resolveInside),
  symlink rejection, hash mismatch / destination conflict / partial-output
  fail-closed, same-hash idempotent replay.
- Runner: durable bounded envelope, outputRef {path, hash, length, complete},
  requested/actual provider+model, outcomeClass classification, breaker,
  owner/claim/manifest idempotency.

Gaps this phase closes:

1. `role-task` / `role-attempt` / `role-result` record kinds are defined in
   core (closed catalog, 15 kinds) but NEVER written: runner attempt files are
   ad-hoc JSON without kind tags, digests, or closed shape. Canonical
   envelopes are the Phase 3 target.
2. No route-source recording: the runner steps a model chain but never records
   whether a used route was `configured` / `fallback` /
   `coordinator-degradation`; no degraded-route injection path exists
   (core.resolveRoleRoutes supports it, nothing feeds it).
3. Promotion takes split sourcePath/sourceHash/sourceComplete args; the plan
   wants a complete `outputRef` accepted + hash/completeness verified, and a
   contract-bound run may only promote to the contract-declared destination
   (gate 4).
4. No coordinator approval token shape and no path/operation guard
   classification (plan §11: guards reject plan/other-node/published-output/
   credential/dependency/Linear changes without a token).

## Decisions

1. **Records stay closed, 15 kinds, no new kind.**
   - `role-task` (one per logical group, `packets/role-attempts/<groupId>/task.json`):
     identity digests (runDigest, projectId, planDigest, contractDigest,
     contextDigest), role, pass, logicalGroupId, description, nextAction,
     optional judge/judgeCount/judgePacketHash, typed `inputs` objectArray
     ({name, path, hash, format, producer}), `tools` stringArray,
     `shellMode`, `readRoots`, `writeRoot` (nullable — read-only roles),
     `egress`, `attestationDigest` (nullable — null when unattested),
     `outputMode`, `outputContract` (nullable), `route` (nullable object).
     Written by the RUNNER at dispatch (create-if-absent; a conflicting
     digest fails closed as `role task packet conflict`).
   - `role-attempt` (`attempt-N.json`): identity fields + status + lifecycle
     timestamps required; attempt content fields nullable/optional. Gains
     `selectedModel`, `routeSource`, `guardFindings` (objectArray).
     Pending/running/terminal states share the closed shape (content fields
     null until terminal).
   - `role-result` (`result.json`, written once when a terminal is persisted):
     outcomeClass, outputRef (nullable), outputHash, bounded `output`,
     summary, limitations stringArray, requested/actual provider+model,
     `routeSource`, tools, nextAction, timestamps.
   - The group manifest/claim/owner files stay operational (no kind) — they
     are indices, not artifacts.
   - `contextDigest` = sha256 of the exact task context text the dispatch
     assembles (contract block + upstream context + acceptance + task), so the
     packet binds the material the role actually read.
2. **Route source is recorded per attempt.** `routeSourceFor(selectedModel,
   chain, degradedModel)`: chain[0] → `configured`; other chain entries →
   `fallback`; the coordinator-injected degraded model →
   `coordinator-degradation`; no selected model → null (harness default, no
   AutoResearch route). `run_role` gains a typed `degradedRoute`
   ({model, reason}) argument, appended to the chain (deduped) AFTER
   configured + fallbacks: a substitution never shadows the configured route
   and is always recorded (plan non-goal: no silent substitution).
3. **Approval tokens: typed, digest-bound, fresh.**
   `core.makeApprovalToken({approvalClass, contractDigest, nodeId, issuedAt,
   ttlMs})` → frozen {kind:'coordinator-approval', approvalClass,
   contractDigest, nodeId, issuedAt, ttlMs, digest}.
   `core.approvalTokenValid(token, {approvalClass, contractDigest, nodeId,
   now})` checks kind, closed class, binding, and TTL. `run_role` accepts
   `approvalTokens` (objectArray); tokens validate against the bound contract
   before dispatch.
4. **Path guard: pure classifier + bounded post-attempt scan.**
   `core.classifyPathOperation(path, guardCtx)` → {allowed, approvalClass?,
   reason?}. Protected classes: plan files (`plan`), other nodes' run dirs
   (`cross-node`), published outputs (`published-output`), credential-looking
   paths (`credential`), generated bundles/config (`dependency`),
   Linear-owned data (`linear`). Inside the declared writeRoot → allowed.
   The runner scans runDir + (bound) project dir for files created/modified
   during the attempt; each violation needs a valid token for its class or
   the attempt becomes terminal `approval-violation` (not retryable) with
   `guardFindings`. Prompt guidance is NOT the security boundary (plan §11);
   the allowlist is not a chroot (non-goal) — the guard is a fail-closed
   audit over observable paths.
5. **outputRef promotion (gate 4).** `promote_artifact` accepts `outputRef`
   {path, hash, complete} (verified: hash match, complete===true); for
   contract-bound runs the destination must be the contract-declared
   `outputContract.artifactPath` or a `packets/` companion — anything else
   fails with the declared path named. Split args keep working (internal
   callers), outputRef is the coordinator-facing shape.
6. **Tests** (new files per §11):
   - `tests/packet-transport.test.mjs`: pass:"1" field-specific rejection
     before digest binding; zero-based exactness (dispatch integers == loop
     integers, directory pass_NN); context-digest mismatch field-specific;
     flat primitives round-trip; route-source recording (configured /
     fallback / coordinator-degradation / null).
   - `tests/blinding-parser.test.mjs`: ordinary words + TeX headings no
     false leak; provenance comment triggers sanitization; section-leading
     candidate normalized in blind copy only (original byte-identical);
     token-bounded labels; SHARED_CANDIDATE_MATERIAL; typed ranking parser
     rejects free text and non-labels.
   - `tests/promote-outputref.test.mjs`: complete+hash-matched outputRef to
     the declared destination succeeds; hash mismatch; partial
     (complete:false); undeclared destination rejected with the declared
     path named; symlink source; idempotent same-hash replay.
   - `tests/role-runner.test.mjs` extended: canonical task/attempt/result
     records on disk (kind, digest, closed shape, conflict detection),
     guard violation without token → approval-violation; with valid token →
     allowed.

## Gate mapping (plan §13)

- Gate 4 (outputRef promotion only with complete hash match + run-confined
  declared destination; unattested → narrow allowlist): decisions 3–5.
- Gate 6 (generated closed schemas, integer zero-based pass primitives, blind
  labels, byte-identical shared judgeContext, structural-heading
  normalization, fully recorded actual routes): audit-verified existing
  blinding/dispatch + decision 2 (route source) + tests.
- §11 lines: L836–837 (guard + token + structured approval request — the
  Phase 2 prompt stop line covers the request side), L839–840, L843–845,
  L869 (coordinator-degradation recording).

## Order of work

1. core: record spec extensions + `routeSourceFor` + approval token
   (make/validate) + `classifyPathOperation`.
2. runner: canonical task/attempt/result persistence, degraded route +
   tokens args, post-attempt guard scan, route source in envelopes.
3. tool: run_role new typed args (degradedRoute, approvalTokens) + roleTask
   construction + result route fields; promote_artifact outputRef + declared
   destination check.
4. Tool schema definitions in core (new args) → rebuild (55 tools unchanged,
   schemas regenerated).
5. Tests: three new files + role-runner extension.
6. Rebuild → verify:snapshot → full npm test → commit Phase 3 boundary.
