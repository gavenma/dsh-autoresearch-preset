// tests/helpers/canonical-fixtures.mjs
//
// Shared canonical-shape fixture builders for the AutoResearch test suite.
// These produce plans/state/records in the single canonical shape (no
// schemaVersion, kind-tagged, object-only acceptance, explicit budgets,
// per-node outputContract). They import the BUILT core so tests exercise the
// shipped artifact.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
export const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)

export const NOW = '2026-01-01T00:00:00.000Z'

// A budget reachable from a role set (scout/judge counts forced to zero when
// the roles omit those roles, per core.effectiveBudget strict rules).
export function budgetFor(roles, overrides = {}) {
  const list = Array.isArray(roles) ? roles : []
  const usesScouts = list.includes('research_scout')
  const usesJudges = list.includes('research_judge')
  return {
    numScouts: usesScouts ? 1 : 0,
    numJudges: usesJudges ? core.JUDGE_QUORUM : 0,
    maxPasses: 1,
    convergenceThreshold: 1,
    ...overrides,
  }
}

export function criterion(id, text, { required = true, check } = {}) {
  return check ? { id, text, required, check } : { id, text, required }
}

// A valid canonical node.
export function node({
  id,
  kind = 'research',
  roles = ['research_author'],
  artifactFormat,
  title,
  expectedOutcome,
  acceptance,
  test = '',
  budget,
  dependsOn = [],
  outputContract,
  ...extra
} = {}) {
  const rolesArr = Array.isArray(roles) && roles.length > 0 ? [...roles] : ['research_author']
  const fmt = artifactFormat ?? (kind === 'figure' ? 'image' : 'tex')
  const defaultPath = fmt === 'tex' ? 'output.tex' : fmt === 'markdown' ? 'final.md' : fmt === 'asset' ? 'output.asset' : 'output.png'
  const built = {
    id,
    title: title ?? id,
    expectedOutcome: expectedOutcome ?? 'Outcome for ' + id + '.',
    kind,
    artifactFormat: fmt,
    roles: rolesArr,
    acceptance: (Array.isArray(acceptance) && acceptance.length > 0 ? acceptance : [criterion(id + '-01', 'Node accepted.')])
      .map((entry) => (typeof entry === 'string' ? criterion('CRIT-' + id, entry) : entry)),
    test,
    budget: budget ?? budgetFor(rolesArr),
    dependsOn: [...dependsOn],
    outputContract: outputContract ?? { artifactPath: defaultPath },
    ...extra,
  }
  return built
}

// A valid canonical plan. Ensures the mandatory integration node exists.
export function plan({
  projectId = 'proj-test',
  projectName,
  revision = 1,
  approvedAt = NOW,
  integrationId = 'integration',
  projectContract,
  nodes,
  ...extra
} = {}) {
  const nodesArr = [...(Array.isArray(nodes) ? nodes : [])]
  if (!nodesArr.some((entry) => entry && entry.id === integrationId)) {
    const upstream = nodesArr.filter((entry) => entry && entry.id && entry.id !== integrationId).map((entry) => entry.id)
    nodesArr.push(node({
      id: integrationId,
      kind: 'integration',
      roles: ['research_integration_editor'],
      acceptance: [criterion(integrationId + '-01', 'Integrated.')],
      dependsOn: upstream,
    }))
  }
  const pc = projectContract ?? {
    goal: 'Goal for ' + projectId + '.',
    deliverables: [],
    acceptance: [criterion('PROJECT-01', 'Project goal met.')],
    test: '',
    wordBudget: null,
    rebuildable: false,
    diagnosticMappings: [],
  }
  return {
    kind: core.PLAN_KIND,
    projectId,
    projectName: projectName ?? projectId,
    revision,
    approvedAt,
    integrationId,
    projectContract: pc,
    nodes: nodesArr,
    ...extra,
  }
}

// A canonical project-state record matching the runtime journal shape
// (projectstate.emptyState). No schemaVersion; kind-tagged.
export function projectState({ projectId = 'proj-test', nodes = {}, createdAt = NOW, updatedAt = NOW, project = { linearProjectId: '', url: '', createdAt: '' }, integrationRevision = 1, commentCursors = {}, integration = { epoch: 1, inputDigest: null, lastKnownGood: null, feedback: [] }, lastError = '', ...extra } = {}) {
  return {
    kind: 'project-state',
    projectId,
    marker: 'autoresearch-project:' + projectId,
    createdAt,
    updatedAt,
    project,
    integrationRevision,
    nodes,
    commentCursors,
    integration,
    lastError,
    ...extra,
  }
}

// A canonical acceptance receipt (kind-tagged, no schemaVersion).
export function receipt({ projectId = 'proj-test', planRevision = 1, nodeId, nodeContractDigest, outputHash, artifactFormat = 'tex', artifactPath = 'output.tex', finalBuild = null, overall = 'PASS' } = {}) {
  const receiptBody = {
    kind: 'acceptance-receipt',
    projectId,
    planRevision,
    nodeId,
    nodeContractDigest,
    nodeRevision: 1,
    outputHash,
    artifact: { path: artifactPath, format: artifactFormat, sha256: outputHash },
    finalBuild,
    artifactFormat,
    issuedAt: NOW,
    issuedBy: 'autoresearch-acceptance',
    criteria: [],
    expectedCategories: [],
    commandChecks: [],
    warnings: [],
    overall,
    failedCriteria: [],
    waiverNotes: [],
  }
  return { ...receiptBody, receiptHash: core.sha256Text(core.stableStringify(receiptBody)) }
}
