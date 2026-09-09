// Phase 2 (capability validation, gate 4) — the machine-checked role
// capability manifest and the gated broad baseline (canonical plan §3.7, §5.1):
//   - closed enums and consistency rules on ROLE_MANIFEST (validateRoleManifest);
//   - the broad baseline is granted ONLY behind a fresh, workspace-matched,
//     all-enforced confinement attestation; anything else fails closed to the
//     narrow defaultTools with the confinement flag recorded;
//   - config may narrow within the raised ceiling, never expand;
//   - the hermetic capability probe fails closed in a sandbox without
//     sub-root confinement (this deployment's honest outcome).
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { core } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

// ── 1. closed enums + consistency on the shipped manifest ──────────────────
{
  const check = core.validateRoleManifest()
  assert.equal(check.ok, true, 'shipped manifest must validate: ' + check.errors.join('; '))

  for (const [roleId, entry] of Object.entries(core.ROLE_MANIFEST)) {
    for (const cap of entry.capabilities) assert.ok(core.ROLE_CAPABILITIES.includes(cap), roleId + ': capability ' + cap)
    assert.ok(core.ROLE_OUTPUT_MODES.includes(entry.outputMode), roleId + ': outputMode')
    assert.ok(core.ROLE_SHELL_MODES.includes(entry.shellMode), roleId + ': shellMode')
    assert.ok(core.ROLE_EGRESS_MODES.includes(entry.egress), roleId + ': egress')
    assert.ok(core.ROLE_PERSISTENCE_MODES.includes(entry.persistence), roleId + ': persistence')
    for (const cls of entry.approvalClasses) assert.ok(core.APPROVAL_CLASSES.includes(cls), roleId + ': approval class ' + cls)
    // shellMode is derived from write/execute, never free-form.
    const wantsShell = entry.capabilities.includes('write') || entry.capabilities.includes('execute')
    assert.equal(entry.shellMode, wantsShell ? 'scoped-mutate' : 'none', roleId + ': shellMode rule')
    // network capability and declared egress are exactly co-present.
    assert.equal(entry.egress === 'declared', entry.capabilities.includes('network'), roleId + ': egress rule')
  }

  // The manifest is deep-frozen: runtime mutation attempts throw.
  const sample = core.ROLE_MANIFEST.research_coder
  assert.throws(() => { sample.capabilities.push('network') })
  assert.throws(() => { sample.shellMode = 'none' })
  assert.throws(() => { core.ROLE_MANIFEST.new_role = {} })
  assert.deepEqual(core.BROAD_BASELINE, ['read', 'grep', 'glob', 'bash', 'write', 'edit'])
  assert.ok(Object.isFrozen(core.BROAD_BASELINE))
}

// ── 2. the validator catches each violation class ───────────────────────────
{
  const clone = () => JSON.parse(JSON.stringify(core.ROLE_MANIFEST))
  const run = (mutate, fragment) => {
    const broken = clone()
    mutate(broken)
    const check = core.validateRoleManifest(broken)
    assert.equal(check.ok, false, 'violation must be caught: ' + fragment)
    assert.ok(check.errors.some((e) => e.includes(fragment)), 'expected ' + fragment + ' in ' + JSON.stringify(check.errors))
  }
  run((m) => { m.research_author.capabilities.push('quantum') }, 'unknown capability')
  run((m) => { m.research_author.capabilities.push('read') }, 'duplicate capabilities')
  run((m) => { m.research_author.outputMode = 'table' }, 'outputMode')
  run((m) => { m.research_author.shellMode = 'none' }, 'shellMode must be scoped-mutate')
  run((m) => { m.research_critic.shellMode = 'scoped-mutate' }, 'shellMode must be none')
  run((m) => { m.research_scout.egress = 'none' }, 'inconsistent with the network capability')
  run((m) => { m.research_critic.egress = 'declared' }, 'inconsistent with the network capability')
  run((m) => { m.research_scout.webPolicy = 'enabled'; m.research_scout.egress = 'none' }, 'webPolicy "enabled" requires egress "declared"')
  run((m) => { m.research_critic.directFileMutation = true }, 'directFileMutation requires the write capability')
  run((m) => { m.research_author.approvalClasses.push('treasure') }, 'unknown approval class')
  run((m) => { m.research_author.persistence = 'role-owns' }, 'persistence')
  run((m) => { m.research_coder.defaultTools = ['read', 'teleport'] }, 'defaultTools')
}

// ── 3. the gated broad baseline (gating matrix) ─────────────────────────────
{
  const WORKSPACE = '/ws/gate'
  const freshAttestation = () => ({
    kind: 'confinement-attestation',
    probedBoundary: 'role-child-adapters',
    workspace: WORKSPACE,
    probedAt: new Date().toISOString(),
    ttlMs: 3600000,
    passed: true,
    checks: { writeScope: 'enforced', readScope: 'enforced', egress: 'enforced' },
    notes: ['test attestation'],
  })
  const grant = (role, nodeContract, attestation, extra = {}) =>
    core.resolveRoleToolGrant(role, nodeContract, attestation, { workspace: WORKSPACE, ...extra })

  // Unattested: exactly today's narrow behavior, flagged.
  const coderNarrow = grant('research_coder', null, null)
  assert.deepEqual(coderNarrow.tools, ['read', 'write', 'edit', 'bash'], 'unattested coder keeps the current defaults')
  assert.equal(coderNarrow.gated, false)
  assert.equal(coderNarrow.confinement, 'confinement-unattested')

  // Attested: broad baseline.
  const coderBroad = grant('research_coder', null, freshAttestation())
  assert.deepEqual(coderBroad.tools, ['read', 'grep', 'glob', 'bash', 'write', 'edit'], 'attested coder gets the broad baseline')
  assert.equal(coderBroad.gated, true)
  assert.equal(coderBroad.confinement, 'attested')

  // Image capability: read_image in the broad grant even without a visual contract.
  const editorBroad = grant('research_integration_editor', null, freshAttestation())
  assert.ok(editorBroad.tools.includes('read_image'), 'image-capable role carries read_image in the broad grant')

  // Visual contract + attested judge: read_image via the node contract.
  const judgeBroad = grant('research_judge', { kind: 'figure', judgeWithImages: true }, freshAttestation())
  assert.ok(judgeBroad.tools.includes('read_image'), 'figure judge with visual contract gets read_image')
  const judgeTextOnly = grant('research_judge', { kind: 'research' }, freshAttestation())
  assert.ok(judgeTextOnly.tools.includes('read_image'), 'image-capability role keeps read_image (manifest rule)')

  // Web policy enabled + attested: web_search added.
  const plannerBroad = grant('research_planner', null, freshAttestation())
  assert.ok(plannerBroad.tools.includes('web_search'), 'enabled webPolicy adds web_search to the broad grant')
  const authorBroad = grant('research_author', null, freshAttestation())
  assert.ok(!authorBroad.tools.includes('web_search'), 'disabled webPolicy never adds web_search')

  // Stale attestation fails closed (flag distinguishes attempted-but-invalid).
  const stale = freshAttestation()
  stale.probedAt = new Date(Date.now() - 7200000).toISOString()
  const coderStale = grant('research_coder', null, stale)
  assert.deepEqual(coderStale.tools, ['read', 'write', 'edit', 'bash'])
  assert.equal(coderStale.confinement, 'attestation-invalid')

  // Workspace mismatch fails closed.
  const wrongWs = freshAttestation()
  wrongWs.workspace = '/other'
  assert.equal(grant('research_coder', null, wrongWs).confinement, 'attestation-invalid')

  // One non-enforced check fails closed.
  const partial = freshAttestation()
  partial.checks.egress = 'not-enforced'
  partial.passed = false
  assert.equal(grant('research_coder', null, partial).confinement, 'attestation-invalid')

  // Wrong kind tag fails closed.
  const badKind = freshAttestation()
  badKind.kind = 'not-an-attestation'
  assert.equal(core.attestationOk(badKind, WORKSPACE), false)

  // Config narrows within the raised ceiling (never expands).
  const narrowed = grant('research_coder', null, freshAttestation(), { tools: ['read'] })
  assert.deepEqual(narrowed.tools, ['read'])
  assert.equal(narrowed.narrowed, true)
  assert.deepEqual(narrowed.ceiling, ['read', 'grep', 'glob', 'bash', 'write', 'edit'])
  assert.throws(() => grant('research_coder', null, freshAttestation(), { tools: ['read', 'web_search'] }), /exceed the ceiling/)

  // The narrow-path ceiling is unchanged when unattested.
  assert.throws(() => grant('research_judge', null, null, { tools: ['read', 'bash'] }), /exceed the ceiling/)
}

// ── 4. preflight finding helpers + footer constants ─────────────────────────
{
  const f = core.preflightFinding('blocker', 'workspace', false, 'web-fetch provider', 'pick one')
  assert.equal(f.blocked, true, 'blocker severity forces blocked')
  assert.deepEqual(Object.keys(f).sort(), ['blocked', 'missing', 'owner', 'remediation', 'severity'])
  assert.throws(() => core.preflightFinding('fatal', 'workspace', true, 'x', 'y'), /unknown severity/)
  assert.throws(() => core.preflightFinding('warning', 'user', false, 'x', 'y'), /unknown owner/)
  assert.throws(() => core.preflightFinding('info', 'preset', false, '', 'y'), /missing must name/)
  assert.deepEqual(core.PREFLIGHT_FOOTER, [
    '/tmp is not a portable handoff location: role outputs must land under the run directory or the published outputs/ tree.',
    'Dot-prefixed TeX job names are avoided: they collide with build-tool state files and break the source-support closure.',
  ])
  for (const authority of ['plan approval', 'acceptance', 'promotion', 'publication', 'Linear mutation']) {
    assert.ok(core.COORDINATOR_ONLY_AUTHORITIES.some((entry) => entry.includes(authority)), 'coordinator-only list covers ' + authority)
  }
}

// ── 5. the hermetic probe fails closed in an unsandboxed test fs ────────────
{
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-capability-'))
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
      if (name === 'node') return process.execPath
      const find = (n) => {
        if (n.includes('/')) { try { fsSync.accessSync(n, fsSync.constants.X_OK); return n } catch { return null } }
        for (const dir of String(process.env.PATH ?? '').split(':')) {
          if (!dir) continue
          const candidate = path.join(dir, n)
          try { fsSync.accessSync(candidate, fsSync.constants.X_OK); return candidate } catch {}
        }
        return null
      }
      const found = find(name)
      if (!found) throw new Error('Executable not resolvable: ' + name)
      return found
    },
    spawn({ argv, cwd }) {
      const child = nodeSpawn(argv[0], argv.slice(1), { cwd: cwd ?? baseDir })
      const out = []
      const err = []
      child.stdout.on('data', (d) => out.push(d))
      child.stderr.on('data', (d) => err.push(d))
      const done = new Promise((resolve) => {
        child.on('close', (code) => resolve({ exitCode: code ?? 1 }))
        child.on('error', () => resolve({ exitCode: 127 }))
      })
      return {
        done,
        collected: {
          stdout: { readFrom: async () => ({ text: Buffer.concat(out).toString('utf8') }) },
          stderr: { readFrom: async () => ({ text: Buffer.concat(err).toString('utf8') }) },
        },
      }
    },
  }
  const registered = new Map()
  orchestrator.apply({
    get(name) {
      if (name === 'fs') return fileService
      if (name === 'subprocess') return subprocess
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      return undefined
    },
  })
  const probe = registered.get('autoresearch_capability_probe')
  assert.ok(probe, 'capability probe tool registered')
  const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }

  // Prepare a run dir (the declared work root).
  const runDir = path.join(baseDir, '.research-agent', 'runs', 'pf-proj', 'run-1')
  await fs.mkdir(runDir, { recursive: true })
  await fs.writeFile(path.join(runDir, 'run.json'), '{}\n')

  // A coordinator-adapter receipt is diagnostic only, even when every
  // observation is green. It must never cache or unlock a child grant.
  await fs.mkdir(path.join(runDir, 'capability'), { recursive: true })
  const fakeCoordinatorPassed = {
    kind: 'confinement-attestation',
    probedBoundary: 'coordinator-adapters',
    workspace: baseDir,
    runDir: '.research-agent/runs/pf-proj/run-1',
    workRoot: '.research-agent/runs/pf-proj/run-1',
    readRoots: ['.research-agent/runs/pf-proj/run-1'],
    probedAt: new Date().toISOString(),
    ttlMs: 3600000,
    checks: { writeScope: 'enforced', readScope: 'enforced', egress: 'enforced' },
    passed: true,
    notes: [],
  }
  await fs.writeFile(path.join(runDir, 'capability', 'confinement-attestation.json'), JSON.stringify(fakeCoordinatorPassed))
  const notCached = await probe.execute({ baseDir, runDir: '.research-agent/runs/pf-proj/run-1' }, exec)
  assert.equal(notCached.cached, undefined, 'coordinator evidence is never served as an authorizing cache')
  assert.equal(notCached.receipt.probedBoundary, 'coordinator-adapters')
  assert.equal(notCached.receipt.passed, false)

  const result = await probe.execute({ baseDir, runDir: '.research-agent/runs/pf-proj/run-1' }, exec)
  // The test harness fs has no sub-root confinement: the write probe SUCCEEDS,
  // so the receipt must fail closed — never a false attestation.
  assert.equal(result.receipt.kind, 'confinement-attestation')
  assert.equal(result.receipt.workspace, baseDir)
  assert.equal(result.receipt.checks.writeScope, 'not-enforced', 'plain fs allows sibling writes; the probe must see that')
  assert.ok(['enforced', 'not-enforced'].includes(result.receipt.checks.readScope))
  assert.ok(['enforced', 'not-enforced'].includes(result.receipt.checks.egress))
  assert.equal(result.receipt.passed, false, 'no false attestation in an unsandboxed environment')
  assert.equal(result.ok, false)
  assert.equal(result.persisted, true)
  const receiptPath = path.join(runDir, 'capability', 'confinement-attestation.json')
  const onDisk = JSON.parse(await fs.readFile(receiptPath, 'utf8'))
  assert.equal(onDisk.passed, false)
  assert.equal(onDisk.probedBoundary, 'coordinator-adapters')
  assert.ok(!('schemaVersion' in onDisk), 'receipt carries no schemaVersion')

  // A failing receipt must NOT be served from cache: the short-circuit path
  // returns { ok, cached: true, receipt } — the re-probe returns the full shape.
  const second = await probe.execute({ baseDir, runDir: '.research-agent/runs/pf-proj/run-1' }, exec)
  assert.equal(second.cached, undefined, 'a failed receipt is never served from cache')
  assert.equal(second.persisted, true, 'the second call re-probed and re-persisted')
  await fs.rm(baseDir, { recursive: true, force: true })
}

console.log('capability manifest tests passed for generation ' + manifest.generation)
