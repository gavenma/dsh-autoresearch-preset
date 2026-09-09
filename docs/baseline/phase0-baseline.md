# Phase 0 Baseline Record

Date: 2026-09-08 (session of the canonical-linear-reliability implementation)

## 1. Test and snapshot baseline

- Full suite (`npm test`: build:preset, verify:snapshot, and every test:* entry)
  **passed** at generation `836c5e1f5fa7` before any plan change.
- Bundle and asset hashes are frozen in
  `docs/baseline/build-manifest-836c5e1f5fa7.json` (copy of
  `tools/build-manifest.json` at baseline).
- Aggregate build id: `1141e5056c8674e89ab8321832ce0fd19d4697c517d4b4ffadcf8b1278888dce`
- Key entry hashes (baseline):
  - `tools/autoresearch-core-836c5e1f5fa7.mjs` = `62d093a58913fc5edcefae086477f530a634dc62c7bfa8c49a669235ccf514b6`
  - `tools/research-orchestrator-836c5e1f5fa7.mjs` = `ccf1896eb8944842b4a44c3ddf7c1561d440a64eb66b5f039ff29b8abbae19b1`
  - `tools/linear-836c5e1f5fa7.mjs` = `f72ea2bd253b7c00ac8165c019c8686d8cd455558643d27f56ab56182ef3dc42`

## 2. Confinement attestation spike

Command: `node scripts/confinement-spike.mjs` (shell-adapter probes), plus manual
file-adapter probes through the session's own `read`/`write` tools.

Receipt: `docs/baseline/confinement-attestation.json`
(verbatim spike output: `docs/baseline/confinement-spike-raw.json`)

Probes on the running deployment (DSH 0.1.2-rc.1, file policy `workspace-write`,
approval policy `ask`):

| Scope | Shell adapter | File tools adapter | Enforced? |
|---|---|---|---|
| write | control ok; `$HOME` write blocked ("Read-only file system"); `/tmp` writable (platform temp area) | `write` outside workspace denied (`sandbox: file access denied under workspace-write mode`) | write scope enforced **except** the platform temp area |
| read | `/etc/hostname` readable; `$HOME/.dsh` listable | `read` of `/etc/hostname` succeeded | **not** enforced |
| egress | `curl http://example.com` → HTTP 200; node `fetch` ok | n/a | **not** enforced |

**Verdict: `confinement-unattested`** (digest
`sha256:e4ab2ea82b90fae2534616e6980b468a7c5372818670a7835c4a603cba4d4dea`).

Consequence per invariant 7 and Non-Goals: on this deployment the broad role
baseline does NOT ship. The Phase 2 capability gate re-runs the same probe at
run intake on every deployment; a deployment whose harness enforces all three
scopes unlocks the broad baseline automatically, and any deployment where a
scope is unattested fails closed to the narrow least-privilege profile with the
capability report recording `confinement-unattested`. No role manifest or prompt
claims confinement the adapter did not demonstrate.

## 3. Traceability

- `docs/traceability-matrix.md` classifies all 41 `P-*` reports
  (P-001…P-040 incl. P-020a) plus the §2.7 Linear-context class (LC-1).
- Gate: `node scripts/check-traceability.mjs` — passes (41 reports classified,
  16 fixtures referenced). The gate joins the `npm test` chain in Phase 7.

## 4. Classification summary

- common preset defects (drive architecture, need fixtures): P-001, P-002,
  P-003, P-005, P-007, P-008, P-009, P-010, P-011, P-012, P-013, P-015, P-020,
  P-020a, P-021, P-022, P-023, P-024, P-025, P-026, P-027, P-029, P-030, P-031,
  P-033, P-034, P-036, P-037, P-039.
- mixed (preset defect + external harness behavior; detect/route, don't fix
  host): P-004, P-014, P-028, P-032, P-038.
- benign behavior (record, document): P-035.
- project-specific (explicitly excluded): P-006, P-016, P-017, P-018, P-019,
  P-040.
