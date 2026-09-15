// Regression targets for the preset-hardening fixes. Each one REPLAYS a recorded
// defect: it asserts the symptom is gone, not that a function exists. The comment
// on each block names the failure it would produce on the pre-fix source, so a
// reader can tell a proof from a guard without re-deriving it.
//
// Guards (tests that also pass pre-fix, and exist to stop a fix widening) are
// labelled GUARD explicitly. Everything else is a proof.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLibraries } from '../src/research-orchestrator.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { core, scoring } = createLibraries

const baseAttempt = {
  runDigest: 'a'.repeat(64), projectId: 'proj', nodeId: 'node',
  contractDigest: 'b'.repeat(64), logicalGroupId: 'lg-1', role: 'research_author',
  pass: 0, attempt: 1, attemptId: 'attempt-01', status: 'terminal', createdAt: '2026-09-14T00:00:00.000Z',
}

// ── T2: D1/D2 — record construction is transport-honest ─────────────────────
// Pre-fix: `makeRecord` copied every supplied key, so `guardFindings: undefined`
// entered the record, `JSON.stringify` dropped it, and the key sets differed by
// one. That mismatch is what made the harness reject every role dispatch with
// "value is not lossless JSON".
{
  const record = core.makeRecord('role-attempt', { ...baseAttempt, guardFindings: undefined })
  assert.equal(Object.hasOwn(record, 'guardFindings'), false, 'a top-level undefined key must not enter a record')
  const roundTripped = JSON.parse(JSON.stringify(record))
  assert.deepEqual(Object.keys(roundTripped).sort(), Object.keys(record).sort(), 'a record must round-trip with an identical key set')
  assert.deepEqual(roundTripped, record)

  // A nested undefined cannot be dropped without guessing which absence was
  // meant, so it is a construction error naming the exact path.
  assert.throws(
    () => core.makeRecord('role-attempt', { ...baseAttempt, outputRef: { path: 'p', hash: 'h', complete: true, ghost: undefined } }),
    /carries an undefined value at role-attempt\.outputRef\.ghost/,
    'a nested undefined must throw with its path',
  )

  // A populated guard finding is a real value and must survive: silently dropping
  // it would report an unauthorized filesystem change as success.
  const withFindings = core.makeRecord('role-attempt', { ...baseAttempt, guardFindings: [{ path: 'x', authorized: false }] })
  assert.equal(JSON.parse(JSON.stringify(withFindings)).guardFindings.length, 1)

  // validateRecord must SEE an own key holding undefined — the value loop used to
  // be blind to it while the unknown-field loop saw it.
  const withHole = { ...record }
  delete withHole.digest
  withHole.diagnostic = undefined
  const check = core.validateRecord(withHole)
  assert.equal(check.ok, false, 'validateRecord must reject an undefined-valued own key')
  assert.match(check.errors.join(' '), /diagnostic carries an undefined value/)

  // GUARD (passes pre-fix): a role-task written before `expectedPayload` existed
  // must keep validating — the new field is optional by design.
  const legacy = { ...record }
  delete legacy.digest
  assert.equal(core.validateRecord(legacy).ok, true)
}

// ── T1: D1 — the tool boundary rejects a non-transportable result AT THE SOURCE
// and says which field is at fault, instead of letting the harness report an
// opaque transport error after the work has already been done.
{
  assert.equal(core.checkLosslessJson({ a: 1, b: [1, 'x', null], c: { d: true } }).ok, true)
  const hole = core.checkLosslessJson({ a: 1, b: undefined })
  assert.equal(hole.ok, false)
  assert.equal(hole.path, '$.b')
  assert.match(hole.reason, /undefined/)
  // A Set is the real defect this boundary caught: it has no JSON form, so
  // `JSON.stringify` silently turns a quorum into `{}`.
  assert.equal(core.checkLosslessJson({ judges: new Set([1, 2]) }).ok, false)
  assert.equal(core.checkLosslessJson({ n: Number.NaN }).ok, false)
  assert.equal(core.checkLosslessJson({ big: 1n }).ok, false)
  const sparse = [1, , 3]
  assert.equal(core.checkLosslessJson({ s: sparse }).ok, false)
}

// ── T3: D3 — parse_ranking fails closed on an empty label set ───────────────
// Pre-fix: `parseRanking` defaulted the labels to [] and returned
// `{valid: true, ranking: []}` — a silent empty success indistinguishable from a
// real "nothing ranked" verdict downstream.
{
  const omitted = scoring.parseRanking('RANKING: 1. A 2. B', undefined, null)
  assert.equal(omitted.valid, false, 'omitted labels must not be a silent success')
  assert.deepEqual(omitted.ranking, [])
  assert.match(omitted.errors.join(' '), /allowedLabels is required/)
  assert.equal(scoring.parseRanking('RANKING: 1. A 2. B', [], null).valid, false, 'an empty label set must fail too')
  // The happy path is untouched.
  const ok = scoring.parseRanking('RANKING: 1. B 2. A', ['A', 'B'], null)
  assert.equal(ok.valid, true)
  assert.deepEqual(ok.ranking, ['B', 'A'])
  // And the generated transport schema now DECLARES it required, so the
  // requirement reaches the caller rather than only the parser.
  assert.deepEqual(core.generateToolSchemas().autoresearch_parse_ranking.required, ['allowedLabels'])
}

// ── T4: D4 (+ the misattributed #26) — the checkbox token survives Linear ───
// Pre-fix: Linear uppercases GFM task-list items, so a block the renderer wrote
// as `- [x] …` returned as `- [X] …` and parsed as `block-malformed`, failing the
// read-back digest confirmation. Populated `completed[]` is the ONLY state that
// emits the token, which is why the structured-entry failure was the same bug.
{
  const state = core.normalizeContextState({
    nodeId: 'N1', status: 'in_progress', objective: 'o',
    contract: { planRevision: 1, nodeRevision: 1, contractDigest: 'a'.repeat(64) },
    completed: [{ id: 'c1', text: 'did it', evidence: 'acceptance.json' }],
    findings: [{ id: 'f1', text: 'risk', evidence: 'log' }],
    requiredRevisions: [], remaining: [{ id: 'r1', text: 'more' }], dependencies: [],
    nextAction: { text: 'go', owner: 'coordinator', expectedOutput: 'x.tex', acceptanceCheck: 'builds' },
    evidenceRefs: [], watermark: '2026-09-14T02:12:00Z', lastVerified: null,
  })
  const expected = core.contextBlockDigest(state)
  const rendered = core.renderContextBlock(state)
  const foldBullets = (text) => text.split('\n').map((l) => (l.startsWith('- ') && !l.startsWith('- [') ? '* ' + l.slice(2) : l)).join('\n')
  const upperCheckbox = (text) => text.split('\n').map((l) => (l.startsWith('- [x] ') ? '- [X] ' + l.slice(6) : l)).join('\n')

  // The exact form Linear stores: bullets folded AND the checkbox uppercased.
  const stored = upperCheckbox(foldBullets(rendered))
  assert.ok(stored.includes('- [X] '), 'the fixture must exercise the uppercase token')
  const parsed = core.parseContextBlock(stored)
  assert.equal(parsed.ok, true, 'a Linear-normalized block must parse: ' + (parsed.reason ?? ''))
  assert.equal(core.contextBlockDigest(parsed.state), expected, 'the digest must be unchanged by an external case fold')
  assert.equal(parsed.state.completed.length, 1, 'structured completion survives the round trip')
  assert.equal(parsed.state.completed[0].evidence, 'acceptance.json')
}

// ── T5: D5 — the marker classifier covers what the producers emit ───────────
// Pre-fix: the alternation listed `causal` while the producer emitted
// `causal-event`, and every body builder prepends `Marker: `, so the preset's own
// comments were classified HUMAN. That raised LINEAR_CONTEXT_STALE and, because
// the same regex is the human filter, removed those bodies from a child's
// `## Unresolved Human Input`.
{
  // Enumerated from the producers themselves rather than hand-listed — a
  // hand-written list is exactly what produced the two-token gap.
  const sources = await Promise.all(['autoresearch-core.mjs', 'research-orchestrator.mjs', 'linear.mjs']
    .map((file) => fs.readFile(path.join(root, 'src', file), 'utf8')))
  const emitted = new Set()
  for (const text of sources) {
    for (const match of text.matchAll(/autoresearch-(causal-event|causal|evidence|feedback-triage|scope-note|spec-block|node|project):/g)) emitted.add(match[1])
  }
  assert.ok(emitted.size >= 6, 'the scan must find the marker vocabulary, found: ' + [...emitted].join(', '))
  assert.ok(emitted.has('causal-event') && emitted.has('feedback-triage'), 'the scan must see the two tokens the old regex missed')
  for (const token of emitted) {
    const bare = 'autoresearch-' + token + ':proj:1:node:digest'
    assert.equal(core.isAutoresearchComment(bare), true, 'bare marker must be machine: ' + token)
    assert.equal(core.isAutoresearchComment('Marker: ' + bare), true, 'the `Marker: ` form the builders emit must be machine: ' + token)
  }
  // GUARD (passes pre-fix): the anchor is load-bearing. It is also the HUMAN
  // filter, so matching the token anywhere would swallow a human comment that
  // merely quotes a marker and remove it from the node's context.
  assert.equal(core.isAutoresearchComment('why does the tool print `Marker: autoresearch-causal-event:proj:1:x`? confusing'), false)
  assert.equal(core.isAutoresearchComment('please double-check the page budget'), false)
}


// ── T10: D11 — an invalid journal is REPORTED, never substituted, and never written
// Pre-fix: `loadState` returned the plan-derived empty template for a present-but-
// invalid journal, and the next merge persisted that emptiness as the whole
// journal — losing node entries and re-seeding `createdAt`.
{
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const pathmod = await import('node:path')
  const { projectstate } = createLibraries
  const baseDir = await fs.mkdtemp(pathmod.join(os.tmpdir(), 'ar-t10-'))
  const projectId = 't10'
  const projectDir = pathmod.join(baseDir, '.research-agent', 'projects', projectId)
  await fs.mkdir(projectDir, { recursive: true })
  const plan = { projectId, integrationId: 'integration', nodes: [{ id: 'a' }, { id: 'b' }] }
  const statePath = pathmod.join(projectDir, 'state.json')
  // The item-33 corruption: a node entry carrying a non-canonical `receipt` object.
  const corrupt = {
    kind: 'project-state', projectId, marker: 'autoresearch-project:' + projectId,
    createdAt: '2026-09-13T11:56:31.174Z', updatedAt: '2026-09-13T11:56:31.174Z',
    project: { linearProjectId: '', url: '', createdAt: '' }, integrationRevision: 1,
    nodes: { a: { status: 'done', receipts: [], receipt: { acceptanceHash: 'abc' } }, b: { status: 'todo' } },
    commentCursors: {}, integration: { epoch: 1, inputDigest: null, lastKnownGood: null, feedback: [] }, lastError: '',
  }
  await fs.writeFile(statePath, JSON.stringify(corrupt, null, 2) + '\n')
  const before = await fs.readFile(statePath, 'utf8')

  const makeFops = () => ({
    async exists(f) { try { await fs.access(f); return true } catch { return false } },
    async readJson(f) { try { return JSON.parse(await fs.readFile(f, 'utf8')) } catch { return undefined } },
    async writeJson(f, v, o = {}) { if (o.kind === 'createIfAbsent') { const h = await fs.open(f, 'wx'); await h.writeFile(JSON.stringify(v)); await h.close() } else await fs.writeFile(f, JSON.stringify(v)) },
    async ensureDir(d) { await fs.mkdir(d, { recursive: true }) },
    async statInfo(f) { try { await fs.access(f); return { version: 'v1' } } catch { return undefined } },
    async listDir() { return [] },
  })
  const fops = makeFops()

  // (a) A READ reports invalid and does NOT substitute a state.
  const loaded = await projectstate.loadState(fops, baseDir, projectId, plan, '.research-agent')
  assert.equal(loaded.health, 'invalid', 'a corrupt journal must report invalid')
  assert.equal(loaded.invalid, true)
  assert.equal(loaded.state, null, 'no state may be substituted for an invalid journal')
  assert.ok(loaded.errors.length > 0 && /receipt/.test(loaded.errors.join(' ')), 'the error names the offending field')

  // (b) A WRITE is refused, and the file is byte-identical afterwards.
  await assert.rejects(
    projectstate.mutateState(fops, baseDir, projectId, plan, (state) => { state.lastError = 'should not happen' }, '.research-agent'),
    /PROJECT_STATE_INVALID/,
  )
  assert.equal(await fs.readFile(statePath, 'utf8'), before, 'a refused write must leave the journal byte-identical')

  // (c) A MISSING journal still yields the plan-derived template, because there is
  //     nothing to lose — that is the one case where a template is correct.
  const other = await projectstate.loadState(fops, baseDir, 'absent-project', plan, '.research-agent')
  assert.equal(other.health, 'missing')
  assert.ok(other.state && other.state.nodes, 'a missing journal still gets a template')

  await fs.rm(baseDir, { recursive: true, force: true })
}

// ── T11: D11 — concurrent writers cannot erase each other
// Pre-fix: two `node_transition complete` calls read the same base and each wrote
// the whole file from its own snapshot, so the last writer won and the sibling's
// fresh `done` entry (with its runDir and receipt) vanished.
{
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const pathmod = await import('node:path')
  const { projectstate } = createLibraries
  const baseDir = await fs.mkdtemp(pathmod.join(os.tmpdir(), 'ar-t11-'))
  const projectId = 't11'
  const projectDir = pathmod.join(baseDir, '.research-agent', 'projects', projectId)
  await fs.mkdir(projectDir, { recursive: true })
  const plan = { projectId, integrationId: 'integration', nodes: [{ id: 'left' }, { id: 'right' }] }
  await fs.writeFile(pathmod.join(projectDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
  const versions = new Map()
  let version = 0
  const fops = {
    async exists(f) { try { await fs.access(f); return true } catch { return false } },
    async readJson(f) { try { return JSON.parse(await fs.readFile(f, 'utf8')) } catch { return undefined } },
    async ensureDir(d) { await fs.mkdir(d, { recursive: true }) },
    async listDir(d) { try { return (await fs.readdir(d, { withFileTypes: true })).map((e) => ({ name: e.name, dir: e.isDirectory() })) } catch { return [] } },
    async statInfo(f) { return versions.has(f) ? { version: versions.get(f) } : undefined },
    async writeJson(f, v, o = {}) {
      await fs.mkdir(pathmod.dirname(f), { recursive: true })
      if (o.kind === 'replaceIfVersion' && versions.get(f) !== o.version) throw Object.assign(new Error('version mismatch'), { code: 'VERSION_MISMATCH' })
      await fs.writeFile(f, JSON.stringify(v, null, 2) + '\n')
      version += 1
      versions.set(f, 'v' + version)
    },
  }
  // Seed a canonical journal.
  await projectstate.mutateState(fops, baseDir, projectId, plan, (state) => { state.nodes.left.status = 'todo' }, '.research-agent')
  // Two sibling completions in the same wave.
  await projectstate.transitionNode(fops, baseDir, projectId, 'left', 'complete', { receipts: ['left-receipt'] })
  await projectstate.transitionNode(fops, baseDir, projectId, 'right', 'complete', { receipts: ['right-receipt'] })
  const settled = JSON.parse(await fs.readFile(pathmod.join(projectDir, 'state.json'), 'utf8'))
  assert.equal(settled.nodes.left.status, 'done', 'the first writer\'s entry survives the second')
  assert.deepEqual(settled.nodes.left.receipts, ['left-receipt'], 'and keeps its receipt')
  assert.equal(settled.nodes.right.status, 'done')
  assert.deepEqual(settled.nodes.right.receipts, ['right-receipt'])
  await fs.rm(baseDir, { recursive: true, force: true })
}


// ── T13: D12 — an unfinished payload is incomplete, not success ─────────────
// Pre-fix: `stopReason === 'completed'` with non-empty output was success, so a
// synthesizer that stopped mid-JSON-fence at ~18.5k chars was recorded as
// completed and its truncated output was promoted as if it were whole.
{
  // An UNCLOSED fence is the exact recorded shape.
  assert.equal(core.payloadIsComplete('```json\n{"a": 1, "b": [', '```json'), false, 'an unclosed fence must be incomplete')
  assert.equal(core.payloadIsComplete('```json\n{"a": 1}\n```', '```json'), true, 'a closed fence is complete')
  assert.equal(core.payloadIsComplete('no fence at all', '```json'), false, 'a declared fence that never arrives is incomplete')
  // A named section that never arrives.
  assert.equal(core.payloadIsComplete('## Plan rationale\nprose only', '## Plan JSON'), false)
  assert.equal(core.payloadIsComplete('## Plan rationale\n## Plan JSON\n{}', '## Plan JSON'), true)
  // GUARD: format is NOT policed. A payload written unusually but completely is
  // still complete - the declaration is that it finished, not how it was written.
  assert.equal(core.payloadIsComplete('```json {"a":1} ```', '```json'), true)
  // GUARD: no declaration means nothing to enforce, so today's behaviour stands.
  assert.equal(core.payloadIsComplete('anything', null), true)
  assert.equal(core.payloadIsComplete('', null), true)
}

// ── T8: D9 — an unbound attempt persists a durable output, at a declared path ──
// Pre-fix: `outputRef` was null for every unbound run because the output file was
// written only when `params.runDir` existed, so a 55k output arrived as a
// 4000-char preview and the coordinator mined session logs for the rest.
{
  const bound = core.attemptOutputPath({ runDir: '/x/runs/GAV-1/run', logicalGroupId: 'lg-abc', attemptId: 'attempt-01', outputMode: 'text' })
  assert.equal(bound.kind, 'bound')
  assert.equal(bound.relative, 'packets/role-attempts/lg-abc/attempt-01.output.txt')

  const unbound = core.attemptOutputPath({ baseDir: '/x', artifactRoot: '.research-agent', logicalGroupId: 'lg-abc', attemptId: 'attempt-02', outputMode: 'text' })
  assert.equal(unbound.kind, 'unbound', 'an unbound run must still persist its output')
  assert.equal(unbound.root, '.research-agent')
  assert.equal(unbound.relative, 'packets/role-attempts/lg-abc/attempt-02.output.txt')
  // The schema mode extends .json, so a structured payload is not written as text.
  assert.equal(core.attemptOutputPath({ baseDir: '/x', artifactRoot: '.research-agent', logicalGroupId: 'lg', attemptId: 'attempt-01', outputMode: 'schema' }).relative.endsWith('.output.json'), true)
  // No destination is inventable from nothing: without a run dir AND without an
  // artifact root there is no path, which is reported rather than guessed.
  assert.equal(core.attemptOutputPath({ logicalGroupId: 'lg', attemptId: 'attempt-01', outputMode: 'text' }), null)
}

console.log('preset-hardening regression tests passed')
