// WS3 — Judge degradation detection + mechanical critic-gate routing
// (GRF-2026 SOD #11, #12; plan WS3).
//
// Covers the mechanical degradation criteria in scoreBorda (parse/mapping
// failures, dup/missing labels, <2 candidates, all-tie, quorum), the
// additive result fields, the checkpoint-boundary routing that forces the
// critic-gate nextAction, the loop-checklist documentation, and the config
// model fallbacks for the five writing roles.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)
const { default: orchestrator, createLibraries: lib } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

// ══════════════════════════════════════════════════════════════════════════
// 1. Mechanical degradation criteria in core.scoreBorda
// ══════════════════════════════════════════════════════════════════════════
{
  const two = (a, b) => core.scoreBorda({
    pass: 1,
    candidateIds: ['A', 'B', 'AB'],
    judgeRankings: [
      { judge: 'j1', ranking: a },
      { judge: 'j2', ranking: b },
    ],
  })

  // Healthy small panel: no false positive.
  let r = two(['A', 'B', 'AB'], ['A', 'AB', 'B'])
  assert.equal(r.degraded, false, 'healthy panel must not be degraded: ' + JSON.stringify(r.degradedReasons))
  assert.deepEqual(r.degradedReasons, [])
  assert.equal(r.routing, null)
  assert.equal(r.quorumJudges, 2)
  assert.equal(r.winner, 'A')
  // Legacy fields unchanged.
  assert.equal(r.validJudges, 2)
  assert.equal(r.invalidJudges, 0)

  // (a) Unparseable ranking (no ranking array).
  r = core.scoreBorda({
    pass: 1,
    candidateIds: ['A', 'B', 'AB'],
    judgeRankings: [{ judge: 'j1', ranking: ['A', 'B', 'AB'] }, { judge: 'j2', rawText: 'could not rank' }],
  })
  assert.equal(r.degraded, true)
  assert.ok(r.degradedReasons.some((e) => e.includes('judge j2: ranking unparseable')), JSON.stringify(r.degradedReasons))
  assert.equal(r.routing, 'critic-gate')

  // (b) Label mapping failure: duplicate and missing labels.
  r = core.scoreBorda({
    pass: 1,
    candidateIds: ['A', 'B', 'AB'],
    judgeRankings: [
      { judge: 'j1', ranking: ['A', 'B', 'AB'] },
      { judge: 'j2', ranking: ['A', 'A', 'C'] },
    ],
  })
  assert.equal(r.degraded, true)
  assert.ok(r.degradedReasons.some((e) => e.includes('judge j2: label mapping failed') && e.includes('Duplicate') && e.includes('Missing')), JSON.stringify(r.degradedReasons))
  assert.equal(r.routing, 'critic-gate')

  // (c) Fewer than 2 distinct candidates.
  r = core.scoreBorda({
    pass: 1,
    candidateIds: ['A'],
    judgeRankings: [{ judge: 'j1', ranking: ['A'] }, { judge: 'j2', ranking: ['A'] }],
  })
  assert.equal(r.degraded, true)
  assert.ok(r.degradedReasons.some((e) => e.includes('fewer than 2 distinct candidates')), JSON.stringify(r.degradedReasons))

  // (d) All-tie scoring: symmetric swapped rankings tie every candidate.
  r = core.scoreBorda({
    pass: 1,
    candidateIds: ['A', 'B', 'AB'],
    judgeRankings: [
      { judge: 'j1', ranking: ['A', 'B', 'AB'] },
      { judge: 'j2', ranking: ['AB', 'B', 'A'] },
    ],
  })
  assert.equal(r.degraded, true)
  assert.ok(r.degradedReasons.some((e) => e.includes('all-tie')), JSON.stringify(r.degradedReasons))

  // (e) Quorum: one usable ranking with the default quorum of 2.
  r = core.scoreBorda({
    pass: 1,
    candidateIds: ['A', 'B', 'AB'],
    judgeRankings: [
      { judge: 'j1', ranking: ['A', 'B', 'AB'] },
      { judge: 'j2', ranking: ['B', 'B', 'AB'] }, // invalid
    ],
  })
  assert.equal(r.degraded, true)
  assert.ok(r.degradedReasons.some((e) => e.includes('1 usable judge ranking(s); quorum requires 2')), JSON.stringify(r.degradedReasons))

  // (e) Quorum is an input: 2 distinct usable rankings do not hit the
  // default quorum 3, but they do not degrade below it either.
  r = core.scoreBorda({
    pass: 1,
    candidateIds: ['A', 'B', 'AB'],
    judgeRankings: [
      { judge: 'j1', ranking: ['A', 'B', 'AB'] },
      { judge: 'j2', ranking: ['A', 'AB', 'B'] },
    ],
    quorumJudges: 3,
  })
  assert.equal(r.degraded, true)
  assert.ok(r.degradedReasons.some((e) => e.includes('2 usable judge ranking(s); quorum requires 3')), JSON.stringify(r.degradedReasons))
  r = core.scoreBorda({
    pass: 1,
    candidateIds: ['A', 'B', 'AB'],
    judgeRankings: [
      { judge: 'j1', ranking: ['A', 'B', 'AB'] },
      { judge: 'j2', ranking: ['A', 'AB', 'B'] },
      { judge: 'j3', ranking: ['AB', 'A', 'B'] },
    ],
    quorumJudges: 3,
  })
  assert.equal(r.degraded, false, 'three usable distinct rankings at quorum 3 must not degrade: ' + JSON.stringify(r.degradedReasons))
  // Lowered quorum clears (e) for a single usable ranking.
  r = core.scoreBorda({
    pass: 1,
    candidateIds: ['A', 'B', 'AB'],
    judgeRankings: [{ judge: 'j1', ranking: ['A', 'B', 'AB'] }],
    quorumJudges: 1,
  })
  assert.equal(r.degraded, false, 'quorum 1 with one usable ranking must not degrade: ' + JSON.stringify(r.degradedReasons))
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Mounted e2e: tool quorum parameter + checkpoint-boundary routing
// ══════════════════════════════════════════════════════════════════════════
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-degradation-'))
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, options = {}) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
  },
  async readBytes(target, _options, maxBytes) {
    const data = await fs.readFile(target)
    const copy = new Uint8Array(Math.min(data.length, maxBytes ?? data.length))
    copy.set(data.subarray(0, copy.length))
    return copy
  },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}
function makeRealSubprocess() {
  const find = (name) => {
    if (name.includes('/')) {
      try { fsSync.accessSync(name, fsSync.constants.X_OK); return name } catch { return null }
    }
    for (const dir of String(process.env.PATH ?? '').split(':')) {
      if (!dir) continue
      const candidate = path.join(dir, name)
      try { fsSync.accessSync(candidate, fsSync.constants.X_OK); return candidate } catch {}
    }
    return null
  }
  return {
    async resolveExecutable(name) {
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
}
const registered = new Map()
orchestrator.apply({
  get(name) {
    if (name === 'fs') return fileService
    if (name === 'subprocess') return makeRealSubprocess()
    if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
    return undefined
  },
})
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
const scoreBordaTool = registered.get('autoresearch_score_borda')
const initRun = registered.get('autoresearch_init_run')
const checkpoint = registered.get('autoresearch_checkpoint')

{
  // The tool honors the quorum parameter.
  const healthy = await scoreBordaTool.execute({
    pass: 1,
    candidateIds: ['A', 'B'],
    judgeRankings: [
      { judge: 'j1', ranking: ['A', 'B'] },
      { judge: 'j2', ranking: ['A', 'B'] },
    ],
    quorumJudges: 3,
  }, exec)
  assert.equal(healthy.degraded, true)
  assert.equal(healthy.routing, 'critic-gate')
  const ok = await scoreBordaTool.execute({
    pass: 1,
    candidateIds: ['A', 'B'],
    judgeRankings: [
      { judge: 'j1', ranking: ['A', 'B'] },
      { judge: 'j2', ranking: ['A', 'B'] },
    ],
  }, exec)
  assert.equal(ok.degraded, false, JSON.stringify(ok.degradedReasons))
  assert.equal(ok.winner, 'A')

  // Checkpoint-boundary routing on a degraded scored pass.
  const run = await initRun.execute({ issueId: 'deg-run', issueTitle: 'Degradation', sourceType: 'local' }, exec)
  const runAbs = path.join(baseDir, run.runDir)
  await fs.mkdir(path.join(runAbs, 'pass_01'), { recursive: true })
  await fs.writeFile(path.join(runAbs, 'pass_01', 'result.json'), JSON.stringify({
    pass: 1,
    winner: 'A',
    degraded: true,
    degradedReasons: ['only 1 usable judge ranking(s); quorum requires 2'],
    routing: 'critic-gate',
  }, null, 2))

  const forced = await checkpoint.execute({
    runDir: run.runDir,
    baseDir,
    currentStep: 'pass_01_scoring',
    currentPass: 1,
    status: 'in-progress',
    nextAction: 'Spawn 4 more judges for pass 2 and rescore.',
  }, exec)
  assert.ok(String(forced.nextAction).startsWith('CRITIC-GATE'), 'checkpoint nextAction must be forced to the critic gate: ' + JSON.stringify(forced.nextAction))
  assert.ok(forced.nextAction.includes('degraded judge panel'), forced.nextAction)
  assert.ok(forced.nextAction.includes('1 usable judge ranking(s); quorum requires 2'), forced.nextAction)
  assert.ok(!forced.nextAction.includes('Spawn 4 more judges'), 'judge-spawn steps must be removed by the mechanical routing')
  const resume = await fs.readFile(path.join(runAbs, 'resume.md'), 'utf8')
  assert.ok(resume.includes('CRITIC-GATE'), 'resume.md must carry the critic-gate directive')

  // A healthy scored pass leaves the coordinator nextAction untouched.
  await fs.writeFile(path.join(runAbs, 'pass_01', 'result.json'), JSON.stringify({
    pass: 1,
    winner: 'A',
    degraded: false,
    degradedReasons: [],
    routing: null,
  }, null, 2))
  const passthrough = await checkpoint.execute({
    runDir: run.runDir,
    baseDir,
    currentStep: 'pass_01_scoring',
    currentPass: 1,
    status: 'in-progress',
    nextAction: 'Start pass 2: copy incumbent and spawn research_critic.',
  }, exec)
  assert.equal(passthrough.nextAction, 'Start pass 2: copy incumbent and spawn research_critic.')

  // No scored pass at all: no override.
  const bare = await initRun.execute({ issueId: 'deg-run-bare', issueTitle: 'Bare', sourceType: 'local' }, exec)
  const bareCheckpoint = await checkpoint.execute({
    runDir: bare.runDir,
    baseDir,
    currentStep: 'pass_01_critic',
    status: 'in-progress',
    nextAction: 'Spawn research_critic.',
  }, exec)
  assert.equal(bareCheckpoint.nextAction, 'Spawn research_critic.')

  // The loop checklist documents the rule (written at init_run).
  const checklist = await fs.readFile(path.join(runAbs, 'autoreason_loop_checklist.md'), 'utf8')
  assert.ok(checklist.includes('degraded: true'), 'loop checklist must document the degradation rule')
  assert.ok(checklist.includes('critic gate'), 'loop checklist must name the critic gate: ' + JSON.stringify(checklist.match(/critic[^\n]*/g)))

  await fs.rm(baseDir, { recursive: true, force: true })
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Config: model fallbacks on the five writing roles (SOD #12)
// ══════════════════════════════════════════════════════════════════════════
{
  const cfg = JSON.parse(await fs.readFile(path.join(root, 'config.default.json'), 'utf8'))
  const withFallbacks = new Set(Object.entries(cfg.roleProfiles).filter(([, p]) => Array.isArray(p.modelFallbacks)).map(([role]) => role))
  for (const role of ['research_planner', 'research_author', 'research_synthesizer', 'research_abstract_writer', 'research_integration_editor']) {
    assert.ok(withFallbacks.has(role), role + ' must have modelFallbacks')
    assert.ok(cfg.roleProfiles[role].modelFallbacks.some((fallback) => (typeof fallback === 'string' ? fallback : fallback.model) === 'deepseek-official/deepseek-v4-pro'), role + ' fallback must name v4-pro')
  }
  // Fallback entries must be recognized models; primaries stay within the
  // recognized pick list (config.default.json is the single source of truth).
  const recognized = new Set(cfg._recognizedModels ?? [])
  for (const [role, profile] of Object.entries(cfg.roleProfiles)) {
    assert.ok(recognized.has(profile.model), role + ' primary must be a recognized model')
    for (const fallback of profile.modelFallbacks ?? []) {
      const model = typeof fallback === 'string' ? fallback : fallback.model
      assert.ok(recognized.has(model), role + ' fallback must be a recognized model')
    }
  }
  console.log('judge degradation tests passed for generation ' + manifest.generation)
}
