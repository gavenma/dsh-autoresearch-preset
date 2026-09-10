// Phase 2 (dependency preflight, gate 5) — one concise closed-shape report:
//   - findings are exactly { severity, owner, blocked, missing, remediation };
//   - web provider ambiguity is a named blocker (each provider listed), never
//     collapsed into a generic degraded result — ambiguity ≠ missing;
//   - a missing judge panel is a typed blocker that fails closed (no silent
//     advisory downgrade at dispatch);
//   - coordinator-only authorities and the deterministic footer are always
//     present in the output.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { plan as canonicalPlan, node as canonicalNode, criterion, budgetFor, core } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

const FINDING_KEYS = ['blocked', 'missing', 'owner', 'remediation', 'severity']

// ── controllable fakes ──────────────────────────────────────────────────────
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-preflight-'))
const availableExes = new Set(['mkdir', 'rm', 'pdflatex', 'latexmk', 'pdftoppm'])
const web = {
  searchProviders: new Map([['search-a', { id: 'search-a', available: () => true }]]),
  fetchProviders: new Map([['fetch-a', { id: 'fetch-a', available: () => true }]]),
}
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}
const subprocess = {
  async resolveExecutable(name) {
    const bare = path.basename(name)
    if (availableExes.has(bare)) return '/usr/bin/' + bare
    throw new Error('Executable not resolvable: ' + name)
  },
  spawn() {
    return {
      done: Promise.resolve({ exitCode: 0 }),
      collected: {
        stdout: { readFrom: async () => ({ text: '' }) },
        stderr: { readFrom: async () => ({ text: '' }) },
      },
    }
  },
}
const registered = new Map()
orchestrator.apply({
  get(name) {
    if (name === 'fs') return fileService
    if (name === 'subprocess') return subprocess
    if (name === 'web') return web
    if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
    return undefined
  },
})
const preflight = registered.get('autoresearch_dependency_preflight')
assert.ok(preflight, 'dependency preflight tool registered')
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }

// ── fixtures: plan + availability + config ─────────────────────────────────
const plan = canonicalPlan({
  projectId: 'pf-proj',
  nodes: [
    canonicalNode({
      id: 'doc',
      kind: 'research',
      roles: ['research_author', 'research_judge'],
      artifactFormat: 'tex',
      budget: budgetFor(['research_author', 'research_judge']),
      acceptance: [criterion('DOC-01', 'Document accepted.')],
      outputContract: { artifactPath: 'output.tex' },
    }),
  ],
})
assert.equal(core.validatePlan(plan).ok, true, 'fixture plan validates')
await fs.mkdir(path.join(baseDir, '.research-agent', 'projects', 'pf-proj'), { recursive: true })
await fs.writeFile(path.join(baseDir, '.research-agent', 'projects', 'pf-proj', 'plan.json'), JSON.stringify(plan))

const roleProfiles = {
  research_author: { model: 'prov/author' },
  research_judge: { model: 'prov/judge' },
  research_integration_editor: { model: 'prov/editor' },
}
const availability = {
  models: [
    { provider: 'prov', model: 'author' },
    { provider: 'prov', model: 'judge', imageCapable: true },
    { provider: 'prov', model: 'editor' },
  ],
}
const cfg = { roleProfiles, externalResearch: true }
const argsBase = { baseDir, projectId: 'pf-proj', availability, config: cfg }

function findingsFor(result, missing) {
  return result.findings.filter((f) => f.missing === missing)
}
function assertClosedShape(result) {
  for (const finding of result.findings) {
    assert.deepEqual(Object.keys(finding).sort(), FINDING_KEYS, 'closed finding shape: ' + JSON.stringify(finding))
  }
}

// ── 1. green workspace: no blockers, explicit ok lines ──────────────────────
{
  const result = await preflight.execute(argsBase, exec)
  assert.equal(result.blocked, false, JSON.stringify(result.findings.filter((f) => f.blocked)))
  assert.equal(result.ok, true)
  assert.equal(result.planScope, 'artifact root')
  assert.equal(result.availabilitySource, 'injected')
  assertClosedShape(result)
  const routes = findingsFor(result, 'model routes')
  assert.equal(routes.length, 1)
  assert.equal(routes[0].severity, 'info')
  assert.match(routes[0].remediation, /3 node x role routes resolve/)
  const fetchLine = findingsFor(result, 'web-fetch provider')[0]
  assert.equal(fetchLine.severity, 'info')
  assert.match(fetchLine.remediation, /exactly one usable provider: fetch-a/)
  assert.equal(findingsFor(result, 'TeX tooling')[0].severity, 'info')
  assert.equal(findingsFor(result, 'PDF rasterizer')[0].severity, 'info')
  assert.equal(findingsFor(result, 'workspace scratch')[0].severity, 'info')
  // The deterministic footer and the coordinator-only list are always present.
  assert.equal(result.footer[0], core.PREFLIGHT_FOOTER[0])
  assert.match(result.footer[0], /\/tmp is not a portable handoff location/)
  assert.match(result.footer[1], /Dot-prefixed TeX job names are avoided/)
  for (const authority of ['plan approval', 'acceptance', 'promotion', 'publication', 'Linear mutation']) {
    assert.ok(result.coordinatorOnly.some((entry) => entry.includes(authority)), 'coordinator-only list covers ' + authority)
  }
}

// ── 2. web-fetch ambiguity: a named blocker, never a generic degraded ───────
{
  web.fetchProviders.set('fetch-b', { id: 'fetch-b', available: () => true })
  try {
    const result = await preflight.execute(argsBase, exec)
    assert.equal(result.blocked, true)
    const ambiguous = findingsFor(result, 'web-fetch provider')
    assert.equal(ambiguous.length, 1)
    assert.equal(ambiguous[0].severity, 'blocker')
    assert.equal(ambiguous[0].owner, 'workspace')
    assert.equal(ambiguous[0].blocked, true)
    assert.match(ambiguous[0].remediation, /fetch-a/)
    assert.match(ambiguous[0].remediation, /fetch-b/)
    assert.match(ambiguous[0].remediation, /pick one explicit default in config/)
    assert.doesNotMatch(ambiguous[0].remediation, /degraded/)
  } finally {
    web.fetchProviders.delete('fetch-b')
  }
}

// ── 3. missing provider: a different blocker (ambiguity ≠ missing) ──────────
{
  web.fetchProviders.clear()
  try {
    const result = await preflight.execute(argsBase, exec)
    assert.equal(result.blocked, true)
    const missing = findingsFor(result, 'web-fetch provider')[0]
    assert.equal(missing.severity, 'blocker')
    assert.equal(missing.owner, 'harness')
    assert.match(missing.remediation, /no usable web-fetch provider/)
    assert.doesNotMatch(missing.remediation, /multiple/)
  } finally {
    web.fetchProviders.set('fetch-a', { id: 'fetch-a', available: () => true })
  }
}

// ── 4. missing judge panel: typed blocker, fails closed ─────────────────────
{
  // 4a. The judge route is configured but the model is unavailable: a
  //     field-specific blocker (model named, availability named).
  const noJudge = { models: [availability.models[0], availability.models[2]] }
  const unavailable = await preflight.execute({ ...argsBase, availability: noJudge }, exec)
  assert.equal(unavailable.blocked, true)
  const unresolved = unavailable.findings.filter((f) => f.missing === 'model route' && /no resolvable route: prov\/judge \(not in availability\)$/.test(f.remediation))
  assert.equal(unresolved.length, 1, JSON.stringify(unavailable.findings.filter((f) => f.missing === 'model route')))
  assert.equal(unresolved[0].severity, 'blocker')
  assert.match(unresolved[0].remediation, /no resolvable route: prov\/judge \(not in availability\)/)
  // The node-level fail-closed panel blocker fires alongside: an
  // unresolvable judge route means no panel, full stop.
  assert.equal(unavailable.findings.filter((f) => f.missing === 'model route' && /judge panel is required/.test(f.remediation)).length, 1)
  // 4b. The judge route (and its fallback chain) is configured but nothing
  //     resolves: the judge panel is a hard requirement — fail closed,
  //     never advisory. (The base config keeps a default judge model, so
  //     the realistic shape is an unavailable configured route.)
  const deadJudgeConfig = {
    ...cfg,
    roleProfiles: {
      ...roleProfiles,
      research_judge: { model: 'prov/judge-x', modelFallbacks: ['prov/judge-y'] },
    },
  }
  const noPanel = await preflight.execute({ ...argsBase, config: deadJudgeConfig }, exec)
  assert.equal(noPanel.blocked, true)
  const judgeBlocker = noPanel.findings.filter((f) => f.missing === 'model route' && /judge panel is required/.test(f.remediation))
  assert.equal(judgeBlocker.length, 1, JSON.stringify(noPanel.findings.filter((f) => f.missing === 'model route')))
  assert.equal(judgeBlocker[0].severity, 'blocker')
  assert.match(judgeBlocker[0].remediation, /fails closed/)
  assert.match(judgeBlocker[0].remediation, /no silent advisory downgrade/)
  const exhausted = noPanel.findings.filter((f) => f.missing === 'model route' && /no resolvable route/.test(f.remediation))
  assert.equal(exhausted.length, 1, 'the per-role error names every exhausted candidate')
  assert.match(exhausted[0].remediation, /prov\/judge-x \(not in availability\), prov\/judge-y \(not in availability\)/)
}

// ── 5. figure judge without an image-capable route: typed blocker ───────────
{
  const figurePlan = canonicalPlan({
    projectId: 'pf-figure',
    nodes: [
      canonicalNode({
        id: 'fig',
        kind: 'figure',
        roles: ['research_coder', 'research_judge'],
        artifactFormat: 'image',
        budget: budgetFor(['research_coder', 'research_judge']),
        acceptance: [criterion('FIG-01', 'Figure accepted.')],
        outputContract: { artifactPath: 'output.png' },
        judgeWithImages: true,
      }),
    ],
  })
  assert.equal(core.validatePlan(figurePlan).ok, true, 'figure plan validates')
  await fs.mkdir(path.join(baseDir, '.research-agent', 'projects', 'pf-figure'), { recursive: true })
  await fs.writeFile(path.join(baseDir, '.research-agent', 'projects', 'pf-figure', 'plan.json'), JSON.stringify(figurePlan))
  const figureConfig = {
    ...cfg,
    roleProfiles: {
      ...roleProfiles,
      research_coder: { model: 'prov/coder' },
    },
  }
  const figureAvailability = {
    models: [
      { provider: 'prov', model: 'coder' },
      { provider: 'prov', model: 'judge', imageCapable: false },
      { provider: 'prov', model: 'editor' },
    ],
  }
  const result = await preflight.execute({ ...argsBase, projectId: 'pf-figure', availability: figureAvailability, config: figureConfig }, exec)
  assert.equal(result.blocked, true)
  const imageBlocker = result.findings.filter((f) => f.missing === 'model route' && /declared text-only/.test(f.remediation))
  assert.equal(imageBlocker.length, 1, JSON.stringify(result.findings.filter((f) => f.missing === 'model route')))
  assert.equal(imageBlocker[0].severity, 'blocker')
  assert.match(imageBlocker[0].remediation, /image-capable route is required/)
  assert.equal(findingsFor(result, 'image tooling').length, 1, 'figure nodes report the image tooling line')
}

// ── 6. missing TeX tooling: blocker + rasterizer warning ────────────────────
{
  availableExes.delete('pdflatex')
  availableExes.delete('latexmk')
  availableExes.delete('pdftoppm')
  try {
    const result = await preflight.execute(argsBase, exec)
    const texBlocker = findingsFor(result, 'TeX tooling')[0]
    assert.equal(texBlocker.severity, 'blocker')
    assert.equal(texBlocker.owner, 'harness')
    assert.match(texBlocker.remediation, /pdflatex or xelatex/)
    const raster = findingsFor(result, 'PDF rasterizer')[0]
    assert.equal(raster.severity, 'warning')
  } finally {
    availableExes.add('pdflatex')
    availableExes.add('latexmk')
    availableExes.add('pdftoppm')
  }
}

// ── 7. confinement attestation status lines ─────────────────────────────────
{
  const runDir = path.join(baseDir, '.research-agent', 'runs', 'pf-proj', 'run-1')
  await fs.mkdir(runDir, { recursive: true })
  // No role-child receipt: warn truthfully that this preset cannot attest the
  // preventive boundary; coordinator diagnostics cannot widen child tooling.
  const unattested = await preflight.execute({ ...argsBase, runDir: '.research-agent/runs/pf-proj/run-1' }, exec)
  const unline = findingsFor(unattested, 'role-child confinement')[0]
  assert.equal(unline.severity, 'warning')
  assert.match(unline.remediation, /unavailable in this preset/)
  assert.match(unline.remediation, /coordinator diagnostics only/)
  // A fresh, fully-enforced receipt flips the line to ok.
  const now = new Date().toISOString()
  await fs.mkdir(path.join(runDir, 'capability'), { recursive: true })
  await fs.writeFile(path.join(runDir, 'capability', 'confinement-attestation.json'), JSON.stringify({
    kind: 'confinement-attestation',
    probedBoundary: 'role-child-adapters',
    workspace: baseDir,
    runDir: '.research-agent/runs/pf-proj/run-1',
    workRoot: '.research-agent/runs/pf-proj/run-1',
    readRoots: ['.research-agent/runs/pf-proj/run-1'],
    probedAt: now,
    ttlMs: 3600000,
    checks: { writeScope: 'enforced', readScope: 'enforced', egress: 'enforced' },
    passed: true,
    notes: [],
  }))
  const attested = await preflight.execute({ ...argsBase, runDir: '.research-agent/runs/pf-proj/run-1' }, exec)
  const aline = findingsFor(attested, 'confinement attestation')[0]
  assert.equal(aline.severity, 'info')
  assert.match(aline.remediation, /broad baseline is active/)
}

// ── 8. no plan scope: explicit info line, still a complete report ───────────
{
  const result = await preflight.execute({ baseDir, availability, config: cfg }, exec)
  const routes = findingsFor(result, 'model routes')[0]
  assert.equal(routes.severity, 'info')
  assert.match(routes.remediation, /no plan scope/)
  assert.equal(result.planScope, null)
  assertClosedShape(result)
  assert.equal(result.footer.length, 2)
}

// ── 9. bibliography styles: missing vs ambiguous vs resolved (plan §11) ────
{
  const runDir = path.join(baseDir, '.research-agent', 'runs', 'pf-proj', 'bib-run')
  await fs.mkdir(runDir, { recursive: true })
  await fs.writeFile(path.join(runDir, 'final.tex'), '\\documentclass{article}\n\\bibliographystyle{mycustom}\n\\begin{document}\nText.\n\\end{document}\n')
  availableExes.add('kpsewhich')
  const kpse = new Map() // style name -> { exitCode, stdout }
  const originalSpawn = subprocess.spawn.bind(subprocess)
  subprocess.spawn = (options = {}) => {
    const styleArg = String(options.argv?.[1] ?? '')
    if (styleArg.endsWith('.bst') && kpse.has(styleArg.replace(/\.bst$/, ''))) {
      const reply = kpse.get(styleArg.replace(/\.bst$/, ''))
      return {
        done: Promise.resolve({ exitCode: reply.exitCode }),
        collected: {
          stdout: { readFrom: async () => ({ text: reply.stdout }) },
          stderr: { readFrom: async () => ({ text: '' }) },
        },
      }
    }
    return originalSpawn(options)
  }
  const rel = '.research-agent/runs/pf-proj/bib-run'
  try {
    // Missing style: a named warning before acceptance, never silent.
    kpse.set('mycustom', { exitCode: 1, stdout: '' })
    const missing = await preflight.execute({ ...argsBase, runDir: rel }, exec)
    const missingLine = findingsFor(missing, 'bibliography style mycustom')[0]
    assert.equal(missingLine.severity, 'warning')
    assert.equal(missingLine.blocked, false, 'a missing style is reported, not a blocker: the build is the authority')
    assert.match(missingLine.remediation, /was not found by kpsewhich/)
    assert.match(missingLine.remediation, /mycustom\.bst/)

    // Ambiguous style: every candidate is named.
    kpse.set('mycustom', { exitCode: 0, stdout: '/opt/texmf/my.bst\n/usr/share/texmf/my.bst\n' })
    const ambiguous = await preflight.execute({ ...argsBase, runDir: rel }, exec)
    const ambiguousLine = findingsFor(ambiguous, 'bibliography style mycustom')[0]
    assert.equal(ambiguousLine.severity, 'warning')
    assert.match(ambiguousLine.remediation, /multiple candidates/)
    assert.match(ambiguousLine.remediation, /\/opt\/texmf\/my\.bst/)
    assert.match(ambiguousLine.remediation, /\/usr\/share\/texmf\/my\.bst/)

    // Exactly one hit: resolved deterministically.
    kpse.set('mycustom', { exitCode: 0, stdout: '/usr/share/texmf/my.bst\n' })
    const resolved = await preflight.execute({ ...argsBase, runDir: rel }, exec)
    const resolvedLine = findingsFor(resolved, 'bibliography style mycustom')[0]
    assert.equal(resolvedLine.severity, 'info')
    assert.match(resolvedLine.remediation, /resolved \/usr\/share\/texmf\/my\.bst/)
  } finally {
    subprocess.spawn = originalSpawn
    availableExes.delete('kpsewhich')
  }
}

await fs.rm(baseDir, { recursive: true, force: true })
console.log('dependency preflight tests passed for generation ' + manifest.generation)
