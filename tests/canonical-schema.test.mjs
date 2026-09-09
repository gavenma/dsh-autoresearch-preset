// Phase 1 (canonical schema cut) — runtime enforcement of the single
// canonical AutoResearch schema family (canonical plan §3 invariants 1-4, §4,
// §10.1):
//   - old shapes are rejected with exactly one NOT_CANONICAL_ERROR plus a
//     closed legacy-shape fingerprint (plan-v1 / plan-v2 / plan-v2-exposure /
//     unknown legacy shape);
//   - no schemaVersion / exposurePolicyVersion / policy markers in any
//     AutoResearch-owned record (plan, contract, state, receipt, manifest);
//   - one artifact root: .research-agent only — the bare research-agent/ tree
//     fails closed with a pointer to the offline migrator;
//   - tool parameter schemas come from exactly one generated boundary.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { plan as canonicalPlan, node as canonicalNode, criterion, projectState } from './helpers/canonical-fixtures.mjs'
import { core } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { default: orchestrator, createLibraries: lib } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const linearPlugin = (await import(pathToFileURL(path.join(root, manifest.entries.linear)).href)).default
const generatedSchemas = core.generateToolSchemas()

// ── minimal in-memory fops for the pure libraries ──────────────────────────
function memFops(files = {}) {
  const map = new Map(Object.entries(files))
  return {
    files: map,
    async exists(p) { return map.has(p) },
    async readJson(p) {
      if (!map.has(p)) return undefined
      return JSON.parse(map.get(p))
    },
    async writeJson(p, value) { map.set(p, JSON.stringify(value)) },
    async readText(p) { return map.get(p) },
  }
}

// ── 1. legacy shapes: exactly one error + closed fingerprint ───────────────
const validCanonical = canonicalPlan({ projectId: 'schema-proj' })
assert.equal(core.validatePlan(validCanonical).ok, true, 'fixture plan must validate')

const legacyShapes = [
  { name: 'plan-v1', make: () => ({ ...JSON.parse(JSON.stringify(validCanonical)), kind: undefined, schemaVersion: 1 }) },
  { name: 'plan-v2', make: () => ({ ...JSON.parse(JSON.stringify(validCanonical)), kind: undefined, schemaVersion: 2 }) },
  { name: 'plan-v2-exposure', make: () => ({ ...JSON.parse(JSON.stringify(validCanonical)), kind: undefined, schemaVersion: 2, projectContract: { ...validCanonical.projectContract, exposurePolicyVersion: 1 } }) },
  { name: 'unknown legacy shape', make: () => ({ projectId: 'x', schemaVersion: 99, nodes: [] }) },
]
for (const { name, make } of legacyShapes) {
  const legacy = make()
  delete legacy.kind
  assert.equal(core.detectLegacyShape(legacy), name, 'fingerprint for ' + name)
  const result = core.validatePlan(legacy)
  assert.equal(result.ok, false, name + ' must not validate')
  assert.equal(result.canonical, false, name + ' is not canonical')
  assert.deepEqual(result.errors, [core.NOT_CANONICAL_ERROR], name + ' must fail with exactly one canonical error')
  assert.equal(result.legacyFingerprint, name, name + ' fingerprint echoed in validation')
  assert.equal(result.projectContract, null, name + ' must not yield a contract')
  assert.equal(result.digest, null, name + ' must not yield a digest')
}
assert.equal(core.NOT_CANONICAL_ERROR, 'not canonical; run scripts/migrate-workspace.mjs')
assert.equal(core.detectLegacyShape(validCanonical), null, 'canonical plans have no legacy fingerprint')

// ── 2. no version/policy markers in owned records ───────────────────────────
{
  const pc = core.projectContract(validCanonical)
  assert.ok(!('schemaVersion' in pc), 'project contract carries no schemaVersion')
  assert.ok(!('exposurePolicyVersion' in pc), 'project contract carries no exposurePolicyVersion')
  assert.ok(!('deliverablesOmitted' in pc), 'project contract carries no omitted-flag')
  assert.deepEqual(pc.deliverables, [], 'explicit empty deliverables are never defaulted')
  assert.equal(pc.wordBudget, null, 'null wordBudget stays null')
  assert.equal(pc.rebuildable, false, 'rebuildable is a strict boolean')
  assert.equal(typeof pc.digest, 'string')
  assert.ok(pc.digest.length > 0)

  // An explicit deliverables list is honored verbatim (no implicit final.tex).
  const explicit = canonicalPlan({
    projectId: 'schema-explicit',
    projectContract: {
      goal: 'Explicit.',
      deliverables: ['final.tex'],
      acceptance: [criterion('P-01', 'Done.')],
      test: '',
      wordBudget: 1200,
      rebuildable: true,
      diagnosticMappings: [],
    },
  })
  const explicitPc = core.projectContract(explicit)
  assert.deepEqual(explicitPc.deliverables, ['final.tex'])
  assert.equal(explicitPc.wordBudget, 1200)
  assert.equal(explicitPc.rebuildable, true)

  const contract = core.nodeContract(validCanonical, validCanonical.nodes[0].id)
  assert.ok(!('schemaVersion' in contract), 'node contract carries no schemaVersion')
  assert.equal(typeof contract.digest, 'string')
  assert.ok(contract.digest.length > 0)
}

// ── 3. state journal: canonical boundary + drift healing ────────────────────
{
  const ps = lib.projectstate
  const fops = memFops()
  const baseDir = '/ws'

  // A legacy state carrying a schemaVersion is rejected at the boundary.
  const legacyState = projectState({ projectId: 'schema-proj' })
  legacyState.schemaVersion = 2
  await fops.writeJson(baseDir + '/.research-agent/projects/schema-proj/state.json', legacyState)
  const rejected = await ps.loadState(fops, baseDir, 'schema-proj', validCanonical)
  assert.equal(rejected.missing, false)
  assert.equal(rejected.invalid, true, 'legacy state must be flagged invalid')
  assert.equal(rejected.error, core.NOT_CANONICAL_ERROR, 'legacy state fails with the single canonical error')

  // A canonical state loads; a plan node missing from the journal is healed
  // from the empty-state defaults (replay-safe drift).
  const healedPlan = canonicalPlan({
    projectId: 'schema-proj',
    nodes: [canonicalNode({ id: 'alpha', kind: 'research' })],
  })
  const state = projectState({ projectId: 'schema-proj', nodes: { integration: { status: 'done' } } })
  await fops.writeJson(baseDir + '/.research-agent/projects/schema-proj/state.json', state)
  const loaded = await ps.loadState(fops, baseDir, 'schema-proj', healedPlan)
  assert.equal(loaded.invalid, false, 'canonical state must load')
  assert.equal(loaded.missing, false)
  assert.equal(loaded.state.nodes.integration.status, 'done', 'existing entries preserved')
  assert.equal(loaded.state.nodes.alpha.status, 'todo', 'drifted node healed from defaults')
  assert.ok(Array.isArray(loaded.state.nodes.alpha.receipts))

  // A missing journal is replayable: empty template + missing flag.
  const absent = await ps.loadState(fops, baseDir, 'schema-proj', healedPlan, 'other-root')
  assert.equal(absent.missing, true, 'missing journal -> empty template')
  assert.equal(absent.invalid, false)
  assert.equal(absent.state.kind, 'project-state')
}

// ── 4. one artifact root: bare research-agent/ is migration input only ─────
{
  const cfg = lib.config
  const base = '/ws2'
  // Empty workspace -> default-hidden canonical root.
  const empty = await cfg.resolveArtifactRoot(memFops(), base)
  assert.equal(empty.relativeRoot, '.research-agent', 'default root is the hidden canonical root')
  assert.equal(empty.source, 'default-hidden')

  // Evidenced canonical root -> evidence.
  const evidenced = await cfg.resolveArtifactRoot(memFops({ [base + '/.research-agent/projects']: '{}' }), base)
  assert.equal(evidenced.relativeRoot, '.research-agent')
  assert.equal(evidenced.source, 'evidence')

  // Evidenced BARE root -> fail closed with the migrator pointer.
  const bare = memFops({ [base + '/research-agent/projects']: '{}' })
  await assert.rejects(
    async () => cfg.resolveArtifactRoot(bare, base),
    (error) => {
      assert.match(error.message, /legacy-artifact-root/)
      assert.match(error.message, /research-agent\//)
      assert.match(error.message, /scripts\/migrate-workspace\.mjs/)
      return true
    },
    'bare-root evidence must throw with a migrator pointer',
  )

  // Explicit override stays authoritative.
  const explicit = await cfg.resolveArtifactRoot(memFops(), base, { artifactRoot: 'custom-root' })
  assert.equal(explicit.relativeRoot, 'custom-root')
  assert.equal(explicit.source, 'explicit')

  // The bootstrap file stays authoritative.
  const bootstrap = memFops({ [base + '/autoresearch.config.json']: JSON.stringify({ artifactRoot: 'bootstrap-root' }) })
  const fromBootstrap = await cfg.resolveArtifactRoot(bootstrap, base)
  assert.equal(fromBootstrap.relativeRoot, 'bootstrap-root')
  assert.equal(fromBootstrap.source, 'bootstrap')

  // loadPlan has no bare-root candidate: a plan under the bare root is not
  // found; the same plan under the canonical root is.
  const ps = lib.projectstate
  const planFile = '/ws3/.research-agent/projects/root-proj/plan.json'
  const planJson = JSON.stringify(validCanonical)
  const found = await ps.loadPlan(memFops({ [planFile]: planJson }), '/ws3', 'root-proj')
  assert.equal(found.ok, true, 'canonical-root plan must load')
  assert.equal(found.artifactRoot, '.research-agent')
  const notFound = await ps.loadPlan(memFops({ ['/ws3/research-agent/projects/root-proj/plan.json']: planJson }), '/ws3', 'root-proj')
  assert.equal(notFound.ok, false, 'bare-root plan must NOT be a runtime candidate')
  assert.match(notFound.error, /\.research-agent/)
}

// ── 5. closed record kinds: no policy markers, digests bound ────────────────
{
  assert.ok(core.RECORD_KINDS.includes('publish-manifest'))
  assert.ok(!core.RECORD_KINDS.includes('project-publish-manifest'), 'manifest kind is publish-manifest')
  const manifest = core.makeRecord('publish-manifest', {
    projectId: 'schema-proj',
    planRevision: 1,
    integrationRun: 'run-1',
    artifactFormat: 'tex',
    rebuildable: false,
    entries: [{ path: 'final.tex', sourcePath: 'final.tex', sourceRule: 'deliverable', requiredBy: ['final.tex'], hash: 'ab' }],
    preservedExisting: [],
    warnings: [],
  })
  assert.equal(manifest.digest, core.recordDigest(manifest), 'manifest digest is bound to its fields')
  assert.ok(!('policyVersion' in manifest))
  assert.ok(!('mode' in manifest))

  assert.throws(
    () => core.makeRecord('publish-manifest', {
      projectId: 'schema-proj', planRevision: 1, integrationRun: null, artifactFormat: null,
      rebuildable: false, entries: [], preservedExisting: [], warnings: [], mode: 'new',
    }),
    /unknown field/,
    'a policy/mode marker on the manifest is an unknown field and must be rejected',
  )

  assert.throws(
    () => core.makeRecord('not-a-record', { a: 1 }),
    /unknown record kind/,
    'unknown record kinds are rejected against the closed set',
  )
}

// ── 6. one generated tool-schema boundary (mounted) ─────────────────────────
{
  const tmpRoot = path.join(root, '.tmp-canonical-schema')
  await fs.rm(tmpRoot, { recursive: true, force: true })
  await fs.mkdir(tmpRoot, { recursive: true })
  const fileService = {
    async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? tmpRoot, target) },
    async readText(target) { return await fs.readFile(target, 'utf8') },
    async writeText(target, content) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
    },
    async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
    async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
  }
  const registered = new Map()
  orchestrator.apply({
    get(name) {
      if (name === 'fs') return fileService
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      return undefined
    },
  })
  linearPlugin.apply({
    get(name) {
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      return undefined
    },
  })
  await fs.rm(tmpRoot, { recursive: true, force: true })
  // 55 tools from the canonical cut + 3 Phase 4 coordinator-only Linear
  // tools (linear_get_node_context, linear_update_node_context,
  // linear_post_evidence_event; plan §7.3-7.6) + 3 Phase 5 feedback tools
  // (autoresearch_submit_feedback, autoresearch_record_feedback_triage,
  // autoresearch_close_feedback; plan §8.1/§8.2/§8.4).
  assert.equal(registered.size, 61, 'all 61 model tools are registered')
  assert.equal(Object.keys(generatedSchemas).length, 61, 'the generated boundary covers all 61 tools')
  for (const [name, definition] of registered) {
    assert.ok(generatedSchemas[name] !== undefined, 'generated schema exists for ' + name)
    assert.deepEqual(definition.parameters, generatedSchemas[name], 'tool ' + name + ' parameter schema equals the generated schema')
  }

  const openPaths = []
  function collectOpen(schema, location) {
    if (!schema || typeof schema !== 'object') return
    if (schema.type === 'object' && schema.additionalProperties === true) openPaths.push(location)
    for (const [key, child] of Object.entries(schema.properties ?? {})) collectOpen(child, location + '.' + key)
    if (schema.type === 'array') collectOpen(schema.items, location + '[]')
    for (const [index, child] of (schema.oneOf ?? []).entries()) collectOpen(child, location + '.oneOf[' + index + ']')
  }
  for (const [name, schema] of Object.entries(generatedSchemas)) collectOpen(schema, name)
  assert.deepEqual(openPaths.sort(), Object.keys(core.TOOL_SCHEMA_OPEN_PATH_ALLOWLIST).sort(), 'every remaining open object has exactly one reviewed allowlist entry')
  assert.equal(generatedSchemas.autoresearch_record_acceptance.properties.criteria.items.additionalProperties, false)
  assert.equal(generatedSchemas.autoresearch_record_feedback_triage.properties.items.items.additionalProperties, false)
  assert.equal(generatedSchemas.linear_update_node_context.properties.state.additionalProperties, false)
  assert.deepEqual(generatedSchemas.autoresearch_candidate_eligibility.properties.candidatePaths.additionalProperties, { type: 'string' })
}

console.log('canonical schema tests passed for generation ' + manifest.generation)
