# Phase 2 Design Notes — Capability Validation and Preflight

Working notes for implementing plan §5 (Capability-Safe Role Planning) + Phase 2 work list
(gates 4–5). Source authority: `docs/autoresearch-canonical-linear-reliability-plan.md`.
This note is a code-level plan; if it and the plan conflict, the plan wins.

## Current state (verified 2026-09-08, gen ba5e05da5934)

- `core.ROLE_MANIFEST` (src/autoresearch-core.mjs L98, frozen): per role `id, aliases,
  modelClass, promptBasename, defaultTools, toolCeiling, webPolicy, cardinality, phases,
  artifactContract`. Most review roles are `['read']` (or `['read','web_search']`).
- `core.roleToolsWithinCeiling(role, configuredTools)` (L335): config may narrow within the
  built-in ceiling; exceeding throws. Enforced at orchestrator profile resolution (L3440-3447)
  and exposed via `autoresearch_list_role_profiles`.
- `linear.preflightCapabilities` already exists (team states, blocked label,
  `mutationCapability` read-write/read-only/unverified, `capabilities.mutation`).
- Web-fetch selection: orchestrator resolves registered providers at mount; no ambiguity
  reporting yet (a generic degraded result is the current worst case).

## Decisions

1. **Manifest extension (core, machine-checked closed enums).** Add to each ROLE_MANIFEST
   entry:
   - `capabilities`: subset of `['read','search','inspect','write','execute','network','image']`
     (declared need, not enforcement);
   - `outputMode`: `'body' | 'structured'`;
   - `directFileMutation`: boolean (allowed inside the declared work root);
   - `shellMode`: `'scoped-mutate'` when `execute`/`write` declared, else `'none'`;
   - `approvalClasses`: subset of `['plan','cross-node','published-output','dependency',
     'credential','linear']`;
   - `egress`: `'none' | 'declared'` (destination allowlist comes from the node contract,
     never the manifest);
   - `persistence`: `'coordinator-owns'` default (expected coordinator persistence behavior).
   New core validator `validateRoleManifest()` (exported, used by `generateToolSchemas`
   build-time self-check and the capability-manifest test): closed enums, egress/capability
   consistency (network ⇒ egress 'declared' allowed; image ⇒ read_image in broad baseline),
   shellMode consistent with capabilities.

2. **Broad baseline is gated, not assumed.**
   - `BROAD_BASELINE = ['read','grep','glob','bash','write','edit']`; plus `read_image` when the
     node contract declares visual evidence (figure fields / image artifactFormat /
     `judgeWithImages`), plus `web_search` when `webPolicy === 'enabled'`.
   - Resolution (new core function `resolveRoleToolGrant(role, nodeContract, attestation)`):
     - attestation present, matches workspace, fresh (TTL), and all three checks passed ⇒
       broad baseline (still narrowable by config via `roleToolsWithinCeiling` — the ceiling
       for gated roles is raised to the broad baseline BEFORE narrowing, so config can only
       narrow, never expand, exactly as today);
     - otherwise ⇒ current narrow `defaultTools` (today's behavior) and the capability report
       records `confinement-unattested`.
   - This deployment is unattested ⇒ effective tooling must not change at all; only the
     mechanism + the report entry appear.

3. **Confinement attestation = one probe, three checks.** Coordinator-only, host-side,
   run-scoped. Probe runs inside the session workspace sandbox with three controlled,
   hermetic operations:
   - `writeScope`: attempt a create+write via the harness fops just OUTSIDE the declared
     work root (sibling dir) ⇒ must be denied;
   - `readScope`: attempt a read of a known-existing file OUTSIDE the declared read roots ⇒
     must be denied;
   - `egress`: attempt a network call from shell (e.g. `fetch` to 127.0.0.1 on a closed
     port / DNS lookup) ⇒ must be denied or time out without data.
   Receipt record (kind-tagged, NO schemaVersion):
   `{ kind: 'confinement-attestation', workspace, probedAt, ttlMs, checks: { writeScope:
   'enforced'|'not-enforced', readScope: ..., egress: ... }, passed: bool, notes: [] }`.
   Stored under `.research-agent/runs/<runId>/capability/confinement-attestation.json` and
   referenced by role attempts (Phase 3 embeds the digest in the role-attempt packet).
   Honest expectation for THIS deployment: DSH sandbox is workspace-scoped, not sub-root
   scoped ⇒ readScope/writeScope inside-workspace probes will show `not-enforced` ⇒
   attestation fails closed ⇒ narrow profiles + `confinement-unattested`. That is the
   correct, plan-mandated outcome — the gate must work both ways, and the test suite must
   cover the attested path with a fake attestation.

4. **Route resolver (model/judge), typed failure policy.** New core function
   `resolveRoleRoutes(plan, config, availability)`:
   - per node × role: route source `'configured' | 'fallback' | 'coordinator-degradation'`;
   - missing judge panel (node budget `numJudges > 0` but no judge route resolvable) ⇒
     field-specific error, fail closed (no silent advisory downgrade at dispatch);
   - incompatible image/model requirement (figure judge without image-capable route) ⇒
     field-specific error;
   - returns `{ ok, routes: [{nodeId, role, provider, model, source}], errors: [] }`.
   Availability is injected (testable); the orchestrator passes live mount/provider state.

5. **Dependency preflight: one concise report.** New coordinator-only read-only tool
   `autoresearch_dependency_preflight` (generated schema, like all tools). Findings shape
   (closed): `{ severity: 'blocker'|'warning'|'info', owner: 'preset'|'harness'|'workspace',
   blocked: bool, missing, remediation }`. Coverage (each an explicit finding or explicit
   ok line): model routes (via resolver), judge panels, web-fetch provider selection
   (**ambiguity ≠ missing**: multiple registered providers ⇒ one `blocker` finding naming
   each provider + remediation "pick one explicit default in config", never a generic
   degraded), bibliography styles used by sources, TeX tools (pdflatex/xelatex + template),
   rasterizers, image tooling + declared stdlib fallback, templates, Linear capabilities
   (delegates to `linear.preflightCapabilities` result when Linear configured), workspace
   scratch. Footer constants: `/tmp` is not a portable handoff location; dot-prefixed TeX
   job names are avoided.
   Preflight report is a TOOL OUTPUT, not a persisted record — the 15-kind RECORD_KINDS
   catalog stays closed. Probe receipts ride in run capability state (decision 3).

6. **Approval classes.** `approvalClasses` on the manifest drives two things:
   - role prompts (Phase 2 target "planner prompt" + role prompts generally) gain one
     deterministic line listing the classes where the role must STOP and return a
     structured approval request (paths, diff summary, reason, affected criteria, rollback
     plan);
   - the path/operation guard (role runner dispatch) remains authoritative and rejects
     mutations matching an approval class without a coordinator-issued token (token shape
     is Phase 3's typed handoff; Phase 2 only records the classes and the stop instruction).

7. **Coordinator-only stays coordinator-only.** Linear mutation, plan approval, acceptance,
   promotion, publication: no change to tool registration; the capability report must
   list them as coordinator-only in its output (asserted by test).

## Files touched (planned)

- `src/autoresearch-core.mjs`: manifest fields + `validateRoleManifest()`,
  `resolveRoleToolGrant`, `resolveRoleRoutes`, prefinding finding helpers, generated schema
  entries for the new tool(s). Manifest self-check at module load (dev-time guard).
- `src/research-orchestrator.mjs`: `autoresearch_capability_probe` +
  `autoresearch_dependency_preflight` tools (flat dispatch, generated schemas), capability
  report assembly in role dispatch path (records `confinement-unattested` when failing
  closed), web-fetch ambiguity detection at provider selection.
- `roles/research_planner.md` (+ role prompts): approval-class stop instruction line.
- `tests/capability-manifest.test.mjs` (NEW): closed enums, gating matrix (attested ⇒
  broad, unattested ⇒ narrow + flag), ceiling-narrowing still applies on top.
- `tests/dependency-preflight.test.mjs` (NEW): report shape, ambiguity vs missing provider,
  fail-closed judge panel, coordinator-only listing, /tmp + dot-job footer.
- `tests/role-runner.test.mjs` (EXTEND after subagent migration lands): dispatch with a
  fake valid attestation grants broad baseline; without it, narrow + report flag.

## Gate mapping (plan §13)

- Gate 4 (capability manifest machine-checked, broad baseline gated by attestation):
  decisions 1–3 + capability-manifest test.
- Gate 5 (dependency preflight: ambiguity vs missing, typed route failures, fail-closed):
  decisions 4–5 + dependency-preflight test.

## Order of work

1. Core: manifest fields + validator + `resolveRoleToolGrant` + `resolveRoleRoutes`
   (pure, testable first).
2. Core: preflight finding helpers; generated schemas for the two new tools.
3. Orchestrator: probe tool (hermetic, three checks), preflight tool, dispatch reporting.
4. Prompts: approval-class line.
5. Tests: two new files + role-runner extension.
6. Rebuild → full `npm test` → commit Phase 2 boundary.
