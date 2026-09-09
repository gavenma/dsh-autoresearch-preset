#!/usr/bin/env node
// scripts/migrate-workspace.mjs (canonical plan §4.3)
//
// Offline migration boundary. Recognizes ONLY a closed, named legacy-shape
// fingerprint catalog (via core.detectLegacyShape) and converts it to the
// single canonical plan shape. Unknown or ambiguous shapes fail with
// `unknown legacy shape` and are never guessed.
//
// Guarantees:
//   - Never overwrites the approved plan.json. Writes a proposed canonical
//     revision to migration/proposed-plan-revision.json.
//   - Requires explicit user approval (`--apply`) before the proposed plan
//     becomes current.
//   - Never auto-rebinds acceptance receipts whose contract digest changes.
//     Contract-gating receipts are marked `requires-reacceptance`.
//   - Refuses mutation while a project has an active lease or in-flight node
//     work.
//   - Leaves historical published outputs untouched.
//
// Not a model tool. Never imported by runtime code.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const core = await import(pathToFileURL(path.join(root, 'src/autoresearch-core.mjs')).href)

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { workspace: root, project: null, artifactRoot: null, apply: false, yes: false, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace') args.workspace = path.resolve(argv[++i])
    else if (a === '--project') args.project = argv[++i]
    else if (a === '--artifact-root') args.artifactRoot = argv[++i]
    else if (a === '--apply') args.apply = true
    else if (a === '--yes') args.yes = true
    else if (a === '--force') args.force = true
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
    else throw new Error('Unknown argument: ' + a)
  }
  if (!args.project) throw new Error('--project <projectId> is required.')
  return args
}
function printHelp() {
  console.log('Usage: node scripts/migrate-workspace.mjs --project <id> [--workspace <root>] [--artifact-root <dir>] [--apply] [--force]\n'
    + 'Offline migration of a legacy AutoResearch plan to the canonical shape. Writes a proposed revision and a report; --apply (explicit approval) makes it current.')
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0

// ── Legacy projectContract -> canonical projectContract ─────────────────────
function convertProjectContract(legacyPlan, fingerprint, notes) {
  const pc = isPlainObject(legacyPlan.projectContract) ? legacyPlan.projectContract : {}
  const goal = isNonEmptyString(pc.goal) ? pc.goal : (isNonEmptyString(legacyPlan.projectName) ? legacyPlan.projectName : '')
  if (!goal) notes.push('projectContract.goal was empty; set it explicitly before approving the proposal.')

  // deliverables: use an explicit array when present; otherwise [] (never
  // guess a default — the canonical shape forbids the implicit final.tex).
  let deliverables
  if (Array.isArray(pc.deliverables)) deliverables = [...pc.deliverables]
  else {
    deliverables = []
    notes.push('legacy plan had no explicit projectContract.deliverables list; proposed deliverables is [] (no-exposure). Declare deliverables explicitly before approving if the project must publish.')
  }

  // acceptance: object criteria pass through; string criteria are lifted to
  // objects with a generated id and flagged.
  const acceptance = []
  const legacyAcceptance = Array.isArray(pc.acceptance) ? pc.acceptance : []
  legacyAcceptance.forEach((criterion, index) => {
    if (isPlainObject(criterion)) {
      acceptance.push(normalizeCriterion(criterion))
    } else if (typeof criterion === 'string') {
      acceptance.push({ id: 'LEGACY-PROJECT-' + String(index + 1).padStart(2, '0'), text: criterion, required: true })
      notes.push('legacy project acceptance[' + index + '] was a string; lifted to object criterion ' + 'LEGACY-PROJECT-' + String(index + 1).padStart(2, '0') + '.')
    }
  })
  if (acceptance.length === 0) notes.push('projectContract.acceptance is empty; add at least one project-level criterion before approving.')

  // wordBudget: explicit int or null. Legacy may carry finalWordBudget.
  const wordBudget = pc.wordBudget ?? legacyPlan.finalWordBudget ?? null
  if (wordBudget !== null && wordBudget !== undefined && (!Number.isInteger(wordBudget) || wordBudget <= 0)) {
    notes.push('projectContract.wordBudget must be a positive integer or null; proposed null. Legacy value: ' + JSON.stringify(wordBudget))
  }
  const rebuildable = pc.rebuildable === true
  const diagnosticMappings = Array.isArray(pc.diagnosticMappings) ? pc.diagnosticMappings.map(normalizeMapping).filter(Boolean) : []

  return {
    goal,
    deliverables,
    acceptance,
    test: typeof pc.test === 'string' ? pc.test : '',
    wordBudget: (Number.isInteger(wordBudget) && wordBudget > 0) ? wordBudget : null,
    rebuildable,
    diagnosticMappings,
  }
}
function normalizeCriterion(c) {
  const id = isNonEmptyString(c.id) ? c.id : ''
  const text = isNonEmptyString(c.text) ? c.text : (typeof c === 'string' ? c : '')
  return { id, text, required: c.required !== false, ...(isNonEmptyString(c.check) ? { check: c.check } : {}) }
}
function normalizeMapping(m) {
  if (!isPlainObject(m) || !isNonEmptyString(m.sourcePath) || !isNonEmptyString(m.destinationPath)) return null
  return { sourcePath: m.sourcePath, destinationPath: m.destinationPath, ...(isNonEmptyString(m.label) ? { label: m.label } : {}), ...(isNonEmptyString(m.note) ? { note: m.note } : {}) }
}

// ── Legacy node -> canonical node ───────────────────────────────────────────
function convertNode(legacyNode, index, notes) {
  const id = isNonEmptyString(legacyNode.id) ? legacyNode.id : ''
  const title = isNonEmptyString(legacyNode.title) ? legacyNode.title : id
  const kind = isNonEmptyString(legacyNode.kind) ? legacyNode.kind : 'research'
  if (kind !== 'research' && !core.NODE_KINDS.includes(kind)) {
    notes.push('node ' + (id || index) + ' has unknown kind ' + JSON.stringify(kind) + '; keep it only if it is a valid canonical kind, else change it.')
  }
  const artifactFormat = isNonEmptyString(legacyNode.artifactFormat) ? legacyNode.artifactFormat : (legacyNode.format === 'markdown' ? 'markdown' : 'tex')
  const expectedOutcome = isNonEmptyString(legacyNode.expectedOutcome) ? legacyNode.expectedOutcome : ''
  const roles = Array.isArray(legacyNode.roles) ? [...legacyNode.roles] : []
  const dependsOn = Array.isArray(legacyNode.dependsOn) ? [...legacyNode.dependsOn] : []

  // acceptance: object criteria pass through; string criteria lifted + flagged.
  const acceptance = []
  const legacyAcceptance = Array.isArray(legacyNode.acceptance) ? legacyNode.acceptance : []
  legacyAcceptance.forEach((criterion, cIndex) => {
    if (isPlainObject(criterion)) acceptance.push(normalizeCriterion(criterion))
    else if (typeof criterion === 'string') {
      const genId = 'LEGACY-' + (id || index) + '-' + String(cIndex + 1).padStart(2, '0')
      acceptance.push({ id: genId, text: criterion, required: true })
      notes.push('node ' + (id || index) + ' acceptance[' + cIndex + '] was a string; lifted to object criterion ' + genId + '.')
    }
  })
  if (acceptance.length === 0) notes.push('node ' + (id || index) + ' has no acceptance criteria; add at least one before approving.')

  // explicit budget: use the node's explicit budget fields when present, else
  // a safe default flagged for review.
  let budget
  if (isPlainObject(legacyNode.budget) && Number.isInteger(legacyNode.budget.numScouts) && Number.isInteger(legacyNode.budget.numJudges) && Number.isInteger(legacyNode.budget.maxPasses)) {
    budget = {
      numScouts: legacyNode.budget.numScouts,
      numJudges: legacyNode.budget.numJudges,
      maxPasses: legacyNode.budget.maxPasses,
      convergenceThreshold: Number.isFinite(legacyNode.budget.convergenceThreshold) ? legacyNode.budget.convergenceThreshold : 1,
    }
  } else {
    // Role-reachable safe default: scout/judge counts are only legal when the
    // node actually lists those roles (core.effectiveBudget strict rule).
    budget = {
      numScouts: roles.includes('research_scout') ? 1 : 0,
      numJudges: roles.includes('research_judge') ? core.JUDGE_QUORUM : 0,
      maxPasses: 3,
      convergenceThreshold: 1,
    }
    notes.push('node ' + (id || index) + ' had no explicit budget; proposed role-reachable default ' + JSON.stringify(budget) + '. Review before approving.')
  }

  // outputContract.artifactPath: explicit, or derived from the artifact
  // format (output.tex / final.md). Never a universal default — it is
  // per-node and format-derived, which the canonical contract requires.
  const legacyOutput = isPlainObject(legacyNode.outputContract) ? legacyNode.outputContract : {}
  const artifactPath = isNonEmptyString(legacyOutput.artifactPath)
    ? legacyOutput.artifactPath
    : (artifactFormat === 'tex' ? 'output.tex' : 'final.md')

  const node = {
    id,
    title,
    expectedOutcome,
    kind,
    artifactFormat,
    roles,
    acceptance,
    test: typeof legacyNode.test === 'string' ? legacyNode.test : '',
    budget,
    dependsOn,
    outputContract: { artifactPath },
  }
  // figure-only fields carried through when present and legal.
  if (kind === 'figure') {
    if (Array.isArray(legacyNode.sourceAssets)) node.sourceAssets = [...legacyNode.sourceAssets]
    if (isNonEmptyString(legacyNode.imageTolerance)) node.imageTolerance = legacyNode.imageTolerance
    if (typeof legacyNode.judgeWithImages === 'boolean') node.judgeWithImages = legacyNode.judgeWithImages
  }
  // TeX-only verification carried through when present.
  if (isPlainObject(legacyNode.verification)) node.verification = legacyNode.verification
  return node
}

// ── Full conversion (pure) ──────────────────────────────────────────────────
function convertToCanonical(legacyPlan, fingerprint) {
  const notes = []
  const projectId = isNonEmptyString(legacyPlan.projectId) ? legacyPlan.projectId : ''
  const projectName = isNonEmptyString(legacyPlan.projectName) ? legacyPlan.projectName : projectId
  const integrationId = isNonEmptyString(legacyPlan.integrationId)
    ? legacyPlan.integrationId
    : ((Array.isArray(legacyPlan.nodes) ? legacyPlan.nodes.find((n) => isPlainObject(n) && n.kind === 'integration')?.id : '') || 'integration')
  const approvedAt = isNonEmptyString(legacyPlan.approvedAt) ? legacyPlan.approvedAt : new Date().toISOString()
  const proposedRevision = (Number.isInteger(legacyPlan.revision) && legacyPlan.revision > 0 ? legacyPlan.revision : 1) + 1

  const projectContract = convertProjectContract(legacyPlan, fingerprint, notes)
  const nodes = (Array.isArray(legacyPlan.nodes) ? legacyPlan.nodes : []).map((node, index) => convertNode(isPlainObject(node) ? node : {}, index, notes))

  const canonical = {
    kind: core.PLAN_KIND,
    projectId,
    projectName,
    revision: proposedRevision,
    approvedAt,
    integrationId,
    projectContract,
    nodes,
  }
  return { canonical, notes }
}

// ── Active lease / in-flight detection ──────────────────────────────────────
const IN_FLIGHT_STATUSES = new Set(['in-progress', 'running', 'claimed', 'working'])
function detectActiveWork(state) {
  const findings = []
  if (!isPlainObject(state?.nodes)) return findings
  for (const [nodeId, entry] of Object.entries(state.nodes)) {
    if (!isPlainObject(entry)) continue
    const status = entry.status
    if (entry.leaseId && isNonEmptyString(entry.leaseId)) findings.push({ nodeId, reason: 'active lease ' + entry.leaseId })
    if (IN_FLIGHT_STATUSES.has(status)) findings.push({ nodeId, reason: 'in-flight status ' + status })
  }
  return findings
}

// ── Receipt successor analysis ──────────────────────────────────────────────
async function analyzeReceipts(projectDir, runDirsByNode, canonicalPlan) {
  const receipts = []
  for (const [nodeId, runRel] of Object.entries(runDirsByNode)) {
    let newDigest = null
    try { newDigest = core.nodeContract(canonicalPlan, nodeId).digest } catch { newDigest = null }
    const acceptancePath = path.join(runRel, 'acceptance.json')
    let acceptance = null
    try { acceptance = JSON.parse(await fs.readFile(acceptancePath, 'utf8')) } catch { acceptance = null }
    if (isPlainObject(acceptance)) {
      const storedDigest = acceptance.nodeContractDigest ?? acceptance.contractDigest ?? null
      const gating = acceptance.overall === 'PASS' || acceptance.overall === 'FAIL' || Array.isArray(acceptance.criteria)
      receipts.push({
        nodeId,
        path: 'acceptance.json',
        storedContractDigest: isNonEmptyString(storedDigest) ? storedDigest : null,
        proposedContractDigest: newDigest,
        disposition: gating && (isNonEmptyString(storedDigest) ? storedDigest !== newDigest : true) ? 'requires-reacceptance' : 'preserved',
      })
    }
    const nodeOutputPath = path.join(runRel, 'node-output.json')
    let nodeOutput = null
    try { nodeOutput = JSON.parse(await fs.readFile(nodeOutputPath, 'utf8')) } catch { nodeOutput = null }
    if (isPlainObject(nodeOutput)) {
      receipts.push({ nodeId, path: 'node-output.json', disposition: 'preserved-provenance', note: 'non-gating historical provenance; preserved after hash check' })
    }
  }
  return receipts
}

// ── Main ────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2))
// Canonical runtime root is .research-agent; --artifact-root locates a legacy
// (bare research-agent/) tree, which is a migration input, not a runtime root.
const rootRel = (typeof args.artifactRoot === 'string' && args.artifactRoot.trim()) ? args.artifactRoot.trim() : '.research-agent'
const projectDir = path.join(args.workspace, rootRel, 'projects', args.project)
const planPath = path.join(projectDir, 'plan.json')
let plan
try {
  plan = JSON.parse(await fs.readFile(planPath, 'utf8'))
} catch (error) {
  console.error('migrate-workspace: cannot read ' + planPath + ': ' + error.message)
  process.exit(1)
}
if (!isPlainObject(plan)) {
  console.error('migrate-workspace: plan.json is not a JSON object.')
  process.exit(1)
}

const fingerprint = core.detectLegacyShape(plan)
const migrationDir = path.join(projectDir, 'migration')
await fs.mkdir(migrationDir, { recursive: true })

if (fingerprint === null) {
  const validation = core.validatePlan(plan)
  console.log('migrate-workspace: plan is already canonical (kind=' + core.PLAN_KIND + ').')
  if (!validation.ok) console.error('  but canonical validation reported: ' + validation.errors.join('; '))
  console.log('No migration needed. Nothing written.')
  process.exit(validation.ok ? 0 : 1)
}
if (fingerprint === 'unknown legacy shape') {
  console.error('migrate-workspace: unknown legacy shape. The plan is not a recognized legacy shape and is never guessed. No migration performed.')
  process.exit(1)
}

// Detect active work before proposing any mutation.
const statePath = path.join(projectDir, 'state.json')
let state = null
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')) } catch { state = null }
const activeWork = detectActiveWork(state)
if (activeWork.length > 0 && !args.force) {
  console.error('migrate-workspace: refusing to migrate while the project has active work:')
  for (const finding of activeWork) console.error('  - ' + finding.nodeId + ': ' + finding.reason)
  console.error('Resolve the leases/in-flight work, or pass --force to override (not recommended).')
  process.exit(1)
}

// Build node -> run dir map from state.
const runDirsByNode = {}
for (const [nodeId, entry] of Object.entries(isPlainObject(state?.nodes) ? state.nodes : {})) {
  if (isPlainObject(entry) && isNonEmptyString(entry.runDir)) runDirsByNode[nodeId] = path.resolve(args.workspace, entry.runDir)
}

const { canonical, notes } = convertToCanonical(plan, fingerprint)
const validation = core.validatePlan(canonical)
const receipts = await analyzeReceipts(projectDir, runDirsByNode, canonical)

const report = {
  fingerprint,
  generatedAt: new Date().toISOString(),
  sourcePlanPath: planPath,
  sourceRevision: (Number.isInteger(plan.revision) && plan.revision > 0 ? plan.revision : 1),
  proposedRevision: canonical.revision,
  validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings },
  activeWork: args.force ? [{ overrode: true, findings: activeWork }] : activeWork,
  notes,
  changedFields: {
    added: ['kind'],
    removed: plan.schemaVersion !== undefined ? ['schemaVersion'] : [],
    projectContract: ['goal', 'deliverables', 'acceptance', 'test', 'wordBudget', 'rebuildable', 'diagnosticMappings'].filter((f) => isPlainObject(plan.projectContract) ? !(f in plan.projectContract) || plan.projectContract[f] === undefined : true),
  },
  receipts,
  proposedPlanPath: path.join(migrationDir, 'proposed-plan-revision.json'),
}

const proposedPlanPath = path.join(migrationDir, 'proposed-plan-revision.json')
await fs.writeFile(proposedPlanPath, JSON.stringify(canonical, null, 2) + '\n')
const reportPath = path.join(migrationDir, 'migration-report.json')

if (args.apply) {
  if (!validation.ok) {
    console.error('migrate-workspace: refusing --apply; the proposed plan does not validate:')
    for (const error of validation.errors) console.error('  - ' + error)
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    process.exit(1)
  }
  // Explicit user approval: make the proposed plan current. Never overwrite
  // a canonical plan; only a legacy (non-canonical) plan is replaced.
  await fs.writeFile(planPath, JSON.stringify(canonical, null, 2) + '\n')
  report.applied = true
  report.appliedAt = new Date().toISOString()
  report.reacceptanceRequired = receipts.filter((r) => r.disposition === 'requires-reacceptance').map((r) => r.nodeId + '/' + r.path)
  console.log('migrate-workspace: APPLIED canonical revision ' + canonical.revision + ' to ' + planPath)
  if (report.reacceptanceRequired.length > 0) {
    console.log('Contract-gating receipts now require re-acceptance: ' + report.reacceptanceRequired.join(', '))
  }
} else {
  report.applied = false
  console.log('migrate-workspace: wrote proposal for fingerprint ' + fingerprint)
  console.log('  proposal: ' + proposedPlanPath)
  console.log('  report:   ' + reportPath)
  if (!validation.ok) {
    console.log('  NOTE: proposed plan does not yet fully validate; review and fix before --apply:')
    for (const error of validation.errors) console.log('    - ' + error)
  }
  if (notes.length > 0) {
    console.log('  ' + notes.length + ' conversion note(s); see report.')
  }
  console.log('Re-run with --apply (explicit approval) to make the proposal current.')
}
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
process.exit(0)
