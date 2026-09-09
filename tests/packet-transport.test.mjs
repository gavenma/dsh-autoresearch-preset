// Phase 3 (plan §13): nested-number packet transport cannot occur because the
// dispatch fields are typed primitives. `pass: "1"` is rejected with a
// field-specific type error before any digest binding; canonical pass
// numbering is zero-based with no hidden offset; a judge context digest
// mismatch fails with a field-specific error; the flat primitives round-trip
// through validateJudgeDispatch; route source is fully recorded.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const bundle = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const { core } = bundle.createLibraries

// 1. pass "1" is rejected with a field-specific type error before digest
//    binding (nothing is computed or returned for a mistyped pass).
assert.throws(
  () => core.buildBlindPackets({ pass: '1', judgeCount: 2, runDigest: 'rd' }),
  (error) => /pass must be a zero-based non-negative integer \(got "1"\)/.test(error.message),
)
assert.throws(
  () => core.buildBlindPackets({ pass: -1, judgeCount: 2, runDigest: 'rd' }),
  (error) => /pass must be a zero-based non-negative integer/.test(error.message),
)
assert.throws(
  () => core.buildBlindPackets({ pass: 0, judgeCount: '2', runDigest: 'rd' }),
  (error) => /judgeCount must be a positive integer \(got "2"\)/.test(error.message),
)

// 2. Zero-based exactness: the loop's integers ARE the dispatch integers and
//    the file paths are derived from them (pass N -> pass_NN, judge j ->
//    judge_jj); no hidden +1/-1 anywhere.
const built = core.buildBlindPackets({
  pass: 0,
  judgeCount: 2,
  runDigest: 'run-digest',
  judgeContext: 'shared judging context',
  candidateIds: ['A', 'B'],
  contents: { A: 'alpha body one', B: 'beta body two' },
})
assert.equal(built.judges.length, 2)
const expectedContextDigest = core.sha256Text('shared judging context')
built.judges.forEach((judge, index) => {
  assert.equal(judge.judge, index)
  assert.equal(judge.pass, undefined) // pass lives on the dispatch primitive
  const d = judge.dispatch
  assert.deepEqual(d, {
    judgePacketPath: 'pass_00/judge_' + String(index).padStart(2, 0) + '_candidates.md',
    judgePacketHash: judge.packetHash,
    pass: 0,
    judge: index,
    judgeCount: 2,
    runDigest: 'run-digest',
    contextDigest: expectedContextDigest,
  })
  assert.equal(d.pass, 0)
  assert.equal(d.judge, index)
  assert.equal(d.judgeCount, 2)
  const verdict = core.validateJudgeDispatch(d, { runDigest: 'run-digest', contextDigest: expectedContextDigest })
  assert.equal(verdict.ok, true, 'the flat primitives validate: ' + verdict.errors.join('; '))
})
assert.equal(built.judges[1].dispatch.judgePacketPath, 'pass_00/judge_01_candidates.md')

// pass 1 is a legal zero-based value (the second pass) and derives pass_01 —
// a legal value with no hidden shift, distinct from the mistyped "1".
const passOne = core.buildBlindPackets({ pass: 1, judgeCount: 1, runDigest: 'rd', candidateIds: ['A', 'B'], contents: { A: 'a one', B: 'b one' } })
assert.equal(passOne.judges[0].dispatch.judgePacketPath, 'pass_01/judge_00_candidates.md')

// 3. validateJudgeDispatch: field-specific type errors are emitted before
//    any digest binding and name the mismatched field.
const d0 = built.judges[0].dispatch
const mistypedPass = core.validateJudgeDispatch({ ...d0, pass: '1' }, {})
assert.equal(mistypedPass.ok, false)
assert.ok(mistypedPass.errors.some((error) => error.startsWith('pass must be a zero-based non-negative integer (got "1")')))
const mistypedJudge = core.validateJudgeDispatch({ ...d0, judge: '0' }, {})
assert.ok(mistypedJudge.errors.some((error) => error.startsWith('judge must be a non-negative integer (got "0")')))
const mistypedCount = core.validateJudgeDispatch({ ...d0, judgeCount: 0 }, {})
assert.ok(mistypedCount.errors.some((error) => error.startsWith('judgeCount must be a positive integer (got 0)')))
// Type errors come first: with BOTH a mistyped pass and a context digest
// mismatch, only the type error is reported (digest binding never runs).
const both = core.validateJudgeDispatch({ ...d0, pass: '1', contextDigest: 'unbound' }, { contextDigest: expectedContextDigest })
assert.ok(both.errors.some((error) => error.includes('pass must be a zero-based')))
assert.ok(!both.errors.some((error) => error.includes('context digest mismatch')), 'no digest binding after a type error')

// 4. Digest binding is field-specific once types are valid.
const wrongContext = core.validateJudgeDispatch(d0, { contextDigest: core.sha256Text('a different context') })
assert.equal(wrongContext.ok, false)
assert.ok(wrongContext.errors.some((error) => error === 'context digest mismatch: the dispatch is not bound to this judge context.'))
const wrongRun = core.validateJudgeDispatch(d0, { runDigest: 'other-run' })
assert.ok(wrongRun.errors.some((error) => error === 'run digest mismatch: the dispatch is not bound to this run.'))
const outOfRange = core.validateJudgeDispatch({ ...d0, judge: 2 }, {})
assert.ok(outOfRange.errors.some((error) => /judge=2 is out of range for judgeCount 2/.test(error)))
const wrongPath = core.validateJudgeDispatch({ ...d0, judgePacketPath: 'pass_01/judge_00_candidates.md' }, {})
assert.ok(wrongPath.errors.some((error) => error === 'judgePacketPath must be pass_00/judge_00_candidates.md (derived from pass and judge).'))
const unsafePath = core.validateJudgeDispatch({ ...d0, judgePacketPath: '../escape/judge_00_candidates.md' }, {})
assert.ok(unsafePath.errors.some((error) => /safe relative file path/.test(error)))

// 5. The byte-identical judge context is bound into every judge's map: one
//    contextDigest for the whole pass, recomputable from the context bytes.
for (const judge of built.judges) {
  assert.equal(judge.map.contextDigest, expectedContextDigest)
  assert.equal(judge.map.kind, 'blind-packet')
  assert.equal(core.validateRecord(judge.map).ok, true, 'map is the closed blind-packet record')
  assert.equal(judge.map.pass, 0)
  assert.equal(judge.map.judgeCount, 2)
  assert.equal(judge.map.runDigest, 'run-digest')
}
assert.equal(new Set(built.judges.map((judge) => judge.map.contextDigest)).size, 1)

// 6. Route source recording: configured vs fallback vs explicit
//    coordinator-degradation, and null for a harness-default route (never
//    presented as 'configured').
assert.equal(core.routeSourceFor('acme/alpha', ['acme/alpha', 'acme-beta/labs/model-x'], null), 'configured')
assert.equal(core.routeSourceFor('acme-beta/labs/model-x', ['acme/alpha', 'acme-beta/labs/model-x'], null), 'fallback')
assert.equal(core.routeSourceFor('acme-degraded/model', ['acme/alpha'], 'acme-degraded/model'), 'coordinator-degradation')
assert.equal(core.routeSourceFor('acme/alpha', ['acme/alpha'], 'acme-degraded/model'), 'configured')
assert.equal(core.routeSourceFor(null, ['acme/alpha'], null), null)
assert.equal(core.routeSourceFor('acme/alpha', [], null), null)

console.log('packet-transport tests passed for generation ' + manifest.generation)
