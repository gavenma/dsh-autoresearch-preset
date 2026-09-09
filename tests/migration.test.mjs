// Phase 1 (canonical schema cut) — the offline migration boundary
// (canonical plan §4.3, §10.1). scripts/migrate-workspace.mjs recognizes only
// the closed legacy-shape fingerprint catalog, proposes a canonical revision
// without touching the approved plan, and mutates only on explicit --apply.
// Unknown shapes are never guessed. Legacy roots are migration input: the
// migrator locates them via --artifact-root while the runtime refuses them.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { core, NOW } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATOR = path.join(root, 'scripts', 'migrate-workspace.mjs')

function runMigrator(...args) {
  const result = spawnSync(process.execPath, [MIGRATOR, ...args], { encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

async function writeJson(base, rel, value) {
  const abs = path.join(base, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, JSON.stringify(value, null, 2) + '\n')
  return abs
}
async function readJson(base, rel) {
  return JSON.parse(await fs.readFile(path.join(base, rel), 'utf8'))
}

// ── legacy fixtures (closed catalog inputs, NOT canonical) ─────────────────
function legacyPlanV1() {
  return {
    schemaVersion: 1,
    projectId: 'mig-v1',
    projectName: 'Mig V1',
    revision: 2,
    approvedAt: '2025-11-01T00:00:00.000Z',
    integrationId: 'integration',
    projectContract: {
      goal: 'Ship the v1 migration test.',
      acceptance: ['Project goal met.'], // string criteria: lifted + flagged
      test: '',
    },
    nodes: [
      {
        id: 'core',
        title: 'Core work',
        kind: 'research',
        format: 'markdown', // legacy format field -> artifactFormat markdown
        expectedOutcome: 'A markdown brief.',
        roles: ['research_author'],
        acceptance: ['Core brief complete.'],
        dependsOn: [],
        budget: { numScouts: 0, numJudges: 0, maxPasses: 2, convergenceThreshold: 1 },
      },
      {
        id: 'integration',
        title: 'Integration',
        kind: 'integration',
        expectedOutcome: 'Integrated.',
        roles: ['research_integration_editor'],
        acceptance: ['Integrated.'],
        dependsOn: ['core'],
        budget: { numScouts: 0, numJudges: 0, maxPasses: 1, convergenceThreshold: 1 },
      },
    ],
  }
}
function legacyPlanV2Exposure() {
  return {
    schemaVersion: 2,
    projectId: 'mig-v2x',
    projectName: 'Mig V2 Exposure',
    revision: 1,
    approvedAt: '2025-12-01T00:00:00.000Z',
    integrationId: 'integration',
    finalWordBudget: 900,
    projectContract: {
      exposurePolicyVersion: 1,
      goal: 'Ship the v2-exposure migration test.',
      deliverables: ['final.md'],
      acceptance: [{ id: 'P-01', text: 'Published.', required: true }],
    },
    nodes: [
      {
        id: 'integration',
        title: 'Integration',
        kind: 'integration',
        artifactFormat: 'markdown',
        expectedOutcome: 'Integrated.',
        roles: ['research_integration_editor'],
        acceptance: ['Integrated.'],
        dependsOn: [],
      },
    ],
  }
}

const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-migration-'))
try {
  // ── 1. plan-v1: propose only, never touch the approved plan ──────────────
  const v1Dir = path.join(ws, '.research-agent', 'projects', 'mig-v1')
  const v1Original = legacyPlanV1()
  await writeJson(ws, '.research-agent/projects/mig-v1/plan.json', v1Original)
  const v1OriginalBytes = await fs.readFile(path.join(v1Dir, 'plan.json'))

  let run = runMigrator('--workspace', ws, '--project', 'mig-v1')
  assert.equal(run.code, 0, 'plan-v1 proposal: ' + run.stderr)
  assert.match(run.stdout, /wrote proposal for fingerprint plan-v1/)

  // The approved plan is byte-identical: propose never overwrites.
  assert.ok(Buffer.from(await fs.readFile(path.join(v1Dir, 'plan.json'))).equals(v1OriginalBytes), 'approved plan untouched by propose')

  const v1Report = await readJson(ws, '.research-agent/projects/mig-v1/migration/migration-report.json')
  assert.equal(v1Report.fingerprint, 'plan-v1')
  assert.equal(v1Report.applied, false)
  const v1Proposal = await readJson(ws, '.research-agent/projects/mig-v1/migration/proposed-plan-revision.json')
  assert.equal(v1Proposal.kind, core.PLAN_KIND)
  assert.equal(core.detectLegacyShape(v1Proposal), null, 'proposal has no legacy markers')
  assert.equal(core.validatePlan(v1Proposal).ok, true, 'proposal validates: ' + JSON.stringify(core.validatePlan(v1Proposal).errors))
  assert.equal(v1Proposal.revision, 3, 'proposal bumps the revision')
  assert.deepEqual(v1Proposal.projectContract.deliverables, [], 'missing legacy deliverables -> explicit empty list (never a default)')
  assert.ok(v1Report.notes.some((note) => note.includes('no explicit projectContract.deliverables')), 'missing deliverables flagged in notes')
  const v1CoreAcceptance = v1Proposal.nodes.find((node) => node.id === 'core').acceptance
  assert.deepEqual(v1CoreAcceptance, [{ id: 'LEGACY-core-01', text: 'Core brief complete.', required: true }], 'string acceptance lifted to object criterion')
  assert.equal(v1Proposal.nodes.find((node) => node.id === 'core').outputContract.artifactPath, 'final.md', 'format-derived artifactPath, no universal default')

  // ── 2. active work refuses mutation (and --force overrides) ──────────────
  await writeJson(ws, '.research-agent/projects/mig-v1/state.json', {
    kind: 'project-state',
    projectId: 'mig-v1',
    marker: 'autoresearch-project:mig-v1',
    createdAt: NOW,
    updatedAt: NOW,
    project: { linearProjectId: '', url: '', createdAt: '' },
    integrationRevision: 1,
    nodes: { core: { status: 'in-progress', runDir: '.research-agent/runs/mig-v1/core-1' } },
    commentCursors: {},
    lastError: '',
  })
  run = runMigrator('--workspace', ws, '--project', 'mig-v1', '--apply')
  assert.equal(run.code, 1, 'active work must refuse --apply')
  assert.match(run.stderr, /refusing to migrate while the project has active work/)
  assert.ok(Buffer.from(await fs.readFile(path.join(v1Dir, 'plan.json'))).equals(v1OriginalBytes), 'refused apply leaves the plan untouched')

  run = runMigrator('--workspace', ws, '--project', 'mig-v1', '--apply', '--force')
  assert.equal(run.code, 0, 'forced apply: ' + run.stderr)
  const v1AppliedReport = await readJson(ws, '.research-agent/projects/mig-v1/migration/migration-report.json')
  assert.equal(v1AppliedReport.applied, true)
  const v1Applied = await readJson(ws, '.research-agent/projects/mig-v1/plan.json')
  assert.equal(v1Applied.kind, core.PLAN_KIND, '--apply made the canonical proposal current')
  assert.equal(core.validatePlan(v1Applied).ok, true)

  // Re-running on a canonical plan is a no-op.
  run = runMigrator('--workspace', ws, '--project', 'mig-v1')
  assert.equal(run.code, 0)
  assert.match(run.stdout, /plan is already canonical/)
  assert.match(run.stdout, /No migration needed/)

  // ── 3. plan-v2-exposure fingerprint + receipt re-acceptance analysis ─────
  await writeJson(ws, '.research-agent/projects/mig-v2x/plan.json', legacyPlanV2Exposure())
  const v2xRunDir = path.join(ws, '.research-agent', 'runs', 'mig-v2x', 'integration-1')
  await writeJson(ws, '.research-agent/runs/mig-v2x/integration-1/acceptance.json', {
    kind: 'acceptance-receipt',
    projectId: 'mig-v2x',
    planRevision: 1,
    nodeId: 'integration',
    nodeContractDigest: 'stale-contract-digest',
    nodeRevision: 1,
    outputHash: 'aa'.repeat(32),
    artifact: { path: 'output.tex', format: 'markdown', sha256: 'aa'.repeat(32) },
    finalBuild: null,
    artifactFormat: 'markdown',
    issuedAt: NOW,
    issuedBy: 'autoresearch-acceptance',
    criteria: [],
    expectedCategories: [],
    commandChecks: [],
    warnings: [],
    overall: 'PASS',
    failedCriteria: [],
    waiverNotes: [],
  })
  await writeJson(ws, '.research-agent/projects/mig-v2x/state.json', {
    kind: 'project-state',
    projectId: 'mig-v2x',
    marker: 'autoresearch-project:mig-v2x',
    createdAt: NOW,
    updatedAt: NOW,
    project: { linearProjectId: '', url: '', createdAt: '' },
    integrationRevision: 1,
    nodes: { integration: { status: 'done', runDir: '.research-agent/runs/mig-v2x/integration-1' } },
    commentCursors: {},
    lastError: '',
  })
  run = runMigrator('--workspace', ws, '--project', 'mig-v2x')
  assert.equal(run.code, 0, 'plan-v2-exposure proposal: ' + run.stderr)
  assert.match(run.stdout, /wrote proposal for fingerprint plan-v2-exposure/)
  const v2xReport = await readJson(ws, '.research-agent/projects/mig-v2x/migration/migration-report.json')
  assert.equal(v2xReport.fingerprint, 'plan-v2-exposure')
  const v2xReceipt = v2xReport.receipts.find((entry) => entry.nodeId === 'integration' && entry.path === 'acceptance.json')
  assert.ok(v2xReceipt, 'acceptance receipt analyzed')
  assert.equal(v2xReceipt.disposition, 'requires-reacceptance', 'stale contract digest must require re-acceptance')
  assert.equal(v2xReport.applied, false, 'propose does not rebind receipts')

  run = runMigrator('--workspace', ws, '--project', 'mig-v2x', '--apply')
  assert.equal(run.code, 0, 'apply v2-exposure: ' + run.stderr)
  const v2xAppliedReport = await readJson(ws, '.research-agent/projects/mig-v2x/migration/migration-report.json')
  assert.equal(v2xAppliedReport.applied, true)
  assert.ok(v2xAppliedReport.reacceptanceRequired.includes('integration/acceptance.json'), 'applied report names the receipts needing re-acceptance')
  const v2xApplied = await readJson(ws, '.research-agent/projects/mig-v2x/plan.json')
  assert.deepEqual(v2xApplied.projectContract.deliverables, ['final.md'], 'explicit legacy deliverables carried through')
  assert.equal(v2xApplied.projectContract.wordBudget, 900, 'legacy finalWordBudget lifted into the contract')
  assert.ok(!('exposurePolicyVersion' in v2xApplied.projectContract), 'exposurePolicyVersion removed by the cut')

  // ── 4. --apply refuses a proposal that does not validate ─────────────────
  await writeJson(ws, '.research-agent/projects/mig-incomplete/plan.json', {
    schemaVersion: 1,
    projectId: 'mig-incomplete',
    projectName: 'Mig Incomplete',
    revision: 1,
    approvedAt: '2025-09-01T00:00:00.000Z',
    integrationId: 'integration',
    projectContract: { goal: 'Incomplete legacy plan.', acceptance: [] },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', expectedOutcome: 'Integrated.', roles: ['research_integration_editor'], acceptance: ['Integrated.'], dependsOn: [] },
    ],
  })
  run = runMigrator('--workspace', ws, '--project', 'mig-incomplete')
  assert.equal(run.code, 0, 'incomplete proposal: ' + run.stderr)
  assert.match(run.stdout, /proposed plan does not yet fully validate/)
  const incompleteReport = await readJson(ws, '.research-agent/projects/mig-incomplete/migration/migration-report.json')
  assert.equal(incompleteReport.validation.ok, false, 'report records the failing validation')
  run = runMigrator('--workspace', ws, '--project', 'mig-incomplete', '--apply')
  assert.equal(run.code, 1, 'a non-validating proposal must not be applied')
  assert.match(run.stderr, /refusing --apply; the proposed plan does not validate/)
  assert.equal((await readJson(ws, '.research-agent/projects/mig-incomplete/plan.json')).kind, undefined, 'the plan was left untouched')

  // ── 5. unknown legacy shape: never guessed, nothing proposed ─────────────
  await writeJson(ws, '.research-agent/projects/mig-unknown/plan.json', {
    schemaVersion: 99,
    projectId: 'mig-unknown',
    nodes: [],
  })
  run = runMigrator('--workspace', ws, '--project', 'mig-unknown')
  assert.equal(run.code, 1, 'unknown shape must fail')
  assert.match(run.stderr, /unknown legacy shape/)
  assert.match(run.stderr, /never guessed/)
  const unknownProposal = await fs.readFile(path.join(ws, '.research-agent/projects/mig-unknown/migration/proposed-plan-revision.json'), 'utf8').catch(() => null)
  assert.equal(unknownProposal, null, 'unknown shape writes no proposal')

  // ── 6. a legacy BARE root is migration input via --artifact-root ─────────
  await writeJson(ws, 'research-agent/projects/mig-bare/plan.json', {
    schemaVersion: 1,
    projectId: 'mig-bare',
    projectName: 'Mig Bare',
    revision: 1,
    approvedAt: '2025-10-01T00:00:00.000Z',
    integrationId: 'integration',
    projectContract: { goal: 'Bare root migration.', acceptance: ['Project goal met.'] },
    nodes: [
      { id: 'integration', title: 'Integration', kind: 'integration', expectedOutcome: 'Integrated.', roles: ['research_integration_editor'], acceptance: ['Integrated.'], dependsOn: [] },
    ],
  })
  run = runMigrator('--workspace', ws, '--project', 'mig-bare', '--artifact-root', 'research-agent')
  assert.equal(run.code, 0, 'bare-root locate: ' + run.stderr)
  assert.match(run.stdout, /wrote proposal for fingerprint plan-v1/)
  const bareProposal = await readJson(ws, 'research-agent/projects/mig-bare/migration/proposed-plan-revision.json')
  assert.equal(core.validatePlan(bareProposal).ok, true, 'bare-root proposal validates')
  assert.equal(core.validatePlan(await readJson(ws, 'research-agent/projects/mig-bare/plan.json')).ok, false, 'bare-root plan still legacy until --apply')
} finally {
  await fs.rm(ws, { recursive: true, force: true })
}

console.log('migration tests passed')
