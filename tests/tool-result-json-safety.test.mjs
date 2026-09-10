import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// DSH 0.1.5 rejects a tool result that is not lossless JSON: the registry
// snapshots the value and throws `ToolOutputError("value is not lossless
// JSON")` for an `undefined`-valued key (see `snapshotToolValue` in
// dsh-tools). A tool whose declared output schema is permissive can therefore
// still fail at runtime on a perfectly ordinary call, returning a harness
// internal error instead of a result the model can act on.
//
// This test drives the service-free AutoResearch tools and asserts their
// results survive a JSON round trip with their key sets intact. It is the
// guard for that class: `assert.deepEqual` alone would NOT catch it, because
// it treats `{ a: undefined }` and `{}` as... different, but every existing
// assertion in this suite reads only fields it names explicitly, so a new
// optional field that arrives as `undefined` slips through unnoticed.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { createLibraries } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const scoring = createLibraries.scoring

/** The registry's own criterion: the detached snapshot must be lossless JSON. */
function assertLossless(label, value) {
  let text
  try {
    text = JSON.stringify(value)
  } catch (error) {
    assert.fail(`${label}: result is not JSON-serializable (${error.message})`)
  }
  assert.notEqual(text, undefined, `${label}: result serializes to undefined`)
  const roundTripped = JSON.parse(text)
  assert.deepEqual(roundTripped, value, `${label}: result does not survive a JSON round trip unchanged`)
  // Deep equality cannot see a dropped `undefined`-valued key, so compare the
  // serialized key shape explicitly: a key that exists but holds `undefined`
  // disappears from the JSON form, which is exactly what the registry rejects.
  assert.equal(countKeys(roundTripped), countKeys(value), `${label}: a result key was dropped by JSON serialization (undefined-valued key)`)
}

function countKeys(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countKeys(item), 0)
  if (value === null || typeof value !== 'object') return 0
  return Object.entries(value).reduce((sum, [, item]) => sum + 1 + countKeys(item), 0)
}

// ── score_borda ─────────────────────────────────────────────────────────────
// `pass` is OPTIONAL in the generated parameter schema, and the tool record
// used to carry it through as `undefined`. Callers that omit it are ordinary:
// neither the bundle guidance nor the skills tell the coordinator to pass it.
const unboundPass = scoring.scoreBorda({
  candidateIds: ['A', 'B', 'AB'],
  judgeRankings: [
    { judge: 0, ranking: ['AB', 'A', 'B'] },
    { judge: 1, ranking: ['A', 'AB', 'B'] },
  ],
})
assertLossless('score_borda without pass', unboundPass)
assert.equal(Object.prototype.hasOwnProperty.call(unboundPass, 'pass'), false, 'score_borda must omit an unbound pass rather than carry it as undefined')
assert.equal(unboundPass.winner, 'A')
assert.equal(unboundPass.degraded, false)
assert.deepEqual(unboundPass.degradedReasons, [])

const boundPass = scoring.scoreBorda({
  pass: 0,
  candidateIds: ['A', 'B'],
  judgeRankings: [{ judge: 0, ranking: ['B', 'A'] }],
})
assertLossless('score_borda with pass', boundPass)
assert.equal(boundPass.pass, 0)
assert.equal(boundPass.winner, 'B')

// Degraded and empty-ranking paths must be lossless too.
assertLossless('score_borda with no rankings', scoring.scoreBorda({ candidateIds: ['A', 'B'] }))
assertLossless('score_borda degraded', scoring.scoreBorda({
  candidateIds: ['A', 'B'],
  judgeRankings: [
    { judge: 0, ranking: ['A', 'Z'] },
    { judge: 1, ranking: [] },
  ],
}))
assertLossless('score_borda single candidate', scoring.scoreBorda({ candidateIds: ['A'] }))

// ── parse_ranking ───────────────────────────────────────────────────────────
// Without a map the tool has no anonymized-to-original binding; that used to
// serialize as `originalRanking: undefined`.
const unmapped = scoring.parseRanking('RANKING: 1. A 2. B', ['A', 'B'], null)
assertLossless('parse_ranking without a map', unmapped)
assert.equal(unmapped.valid, true)
assert.equal(Object.prototype.hasOwnProperty.call(unmapped, 'originalRanking'), true, 'parse_ranking must always carry an explicit originalRanking')
assert.equal(unmapped.originalRanking, null)

const mapped = scoring.parseRanking('RANKING: 1. C1 2. C2', ['C1', 'C2'], { C1: 'candidate-one', C2: 'candidate-two' })
assertLossless('parse_ranking with a map', mapped)
assert.deepEqual(mapped.originalRanking, ['candidate-one', 'candidate-two'])

assertLossless('parse_ranking unparseable', scoring.parseRanking('no ranking line here', ['A', 'B'], null))
assertLossless('parse_ranking missing labels', scoring.parseRanking('RANKING: 1. A', ['A', 'B'], null))

// A map that cannot resolve every label keeps the result lossless.
assertLossless('parse_ranking partial map', scoring.parseRanking('RANKING: 1. C1 2. C2', ['C1', 'C2'], { C1: 'candidate-one' }))

assertLossless('parse_attribution', scoring.parseAttribution('```attribution\n{"kind":"attribution"}\n```'))

console.log('tool result JSON-safety tests passed for generation ' + manifest.generation)
