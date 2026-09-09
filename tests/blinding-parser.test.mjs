// Phase 3 (plan §10/§13): the blinding boundary. Ordinary words and
// legitimate TeX headings do not trigger identity leaks (token-bounded
// labels, never letters inside ordinary words); provenance comments DO
// trigger sanitization; section-leading blind candidates are normalized
// without changing the originals; candidate-invariant shared material fails
// closed unless bound in judgeContext; the typed ranking parser rejects
// free text and incomplete rankings.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const bundle = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const { core, scoring } = bundle.createLibraries
const IDS = { candidateIds: ['A', 'B', 'AB'] }

// 1. Ordinary words and legitimate headings never leak.
assert.deepEqual(core.scanBlindingLeaks('The ability of the Bayesian model is notable. A/B testing showed robust results.', IDS), [])
assert.deepEqual(core.scanBlindingLeaks('# Introduction\n\nWe discuss ablation and Bayesian bounds for the prior.', IDS), [])
assert.deepEqual(core.scanBlindingLeaks('\\section{Bayesian analysis}\n\nWe prove the bound.\\n\\section{Ablation study}\n\nThe ablation supports the claim.', IDS), [])
assert.deepEqual(core.scanBlindingLeaks('We report the prior and the posterior of the Bayesian model.', IDS), [])

// 2. Genuine identity forms are caught, with the pattern named.
const candidateLabel = core.scanBlindingLeaks('As candidate A, we show the result.', IDS)
assert.ok(candidateLabel.some((finding) => finding.name === 'candidate-label'))
const mdHeading = core.scanBlindingLeaks('# Candidate A\n\nBody text.', IDS)
assert.ok(mdHeading.some((finding) => finding.name === 'heading'))
const bracket = core.scanBlindingLeaks('See [Candidate B] for details.', IDS)
assert.ok(bracket.some((finding) => finding.name === 'bracket-label'))
const texLeak = core.scanBlindingLeaks('\\section{Candidate A}\n\nBody.', IDS)
assert.ok(texLeak.some((finding) => finding.name === 'tex-heading'))
const texStandaloneToken = core.scanBlindingLeaks('\\section{AB testing protocol}\n\nBody.', IDS)
assert.ok(texStandaloneToken.some((finding) => finding.name === 'tex-heading'), 'a standalone AB token in a heading still leaks')

// 3. Candidate-invariant shared material fails closed with
//    SHARED_CANDIDATE_MATERIAL; moving it into judgeContext binds it.
const sharedLine = 'This shared specification line is long enough to count as candidate-invariant material.'
assert.throws(
  () => core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'rd', candidateIds: ['A', 'B'], contents: { A: sharedLine + '\n\nAlpha body.', B: sharedLine + '\n\nBeta body.' } }),
  (error) => error.code === 'SHARED_CANDIDATE_MATERIAL',
)
const withContext = core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'rd', judgeContext: sharedLine, candidateIds: ['A', 'B'], contents: { A: sharedLine + '\n\nAlpha body.', B: sharedLine + '\n\nBeta body.' } })
assert.equal(withContext.contextDigest, core.sha256Text(sharedLine))
assert.equal(withContext.judges.length, 1)

// 4. Provenance comments do trigger sanitization: identity forms inside
//    comment blocks are stripped from blind copies (and therefore never
//    reach the full-byte leak scan as identity), while the visible prose
//    survives.
const provenanceContents = {
  A: 'Alpha results are strong.\n\n<!-- Provenance: candidate A, session 42, do not cite -->',
  B: 'Beta results are weaker.\n\n% Provenance: candidate B, session 43',
}
const provenanceBuilt = core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'rd', candidateIds: ['A', 'B'], contents: provenanceContents })
for (const judge of provenanceBuilt.judges) {
  assert.ok(!judge.packetText.includes('candidate A'), 'HTML comment provenance is stripped')
  assert.ok(!judge.packetText.includes('candidate B'), 'TeX-style comment provenance is stripped')
  assert.ok(!judge.packetText.includes('session 42'))
  assert.ok(judge.packetText.includes('Alpha results are strong.'), 'visible prose survives sanitization')
}
// The ORIGINALS are untouched — sanitization is blind-copy-only.
assert.ok(provenanceContents.A.includes('candidate A'), 'originals keep their provenance')

// 5. Section-leading candidates are normalized in blind copies only: a
//    candidate is never rejected for starting with \section / "# ...", the
//    blind copy carries a neutral heading, and the original (what gets
//    promoted) is byte-identical.
const headingContents = {
  A: '\\section{Bayesian analysis}\n\nAlpha body.',
  B: '\\section{Ablation study}\n\nBeta body.',
}
const headingBuilt = core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'rd', candidateIds: ['A', 'B'], artifactFormat: 'tex', contents: headingContents })
const headingPacket = headingBuilt.judges[0].packetText
assert.ok(headingPacket.includes('\\section{Section}'), 'blind copies carry the neutral heading')
assert.ok(!headingPacket.includes('Bayesian analysis'), 'the original title text is not in the blind copy')
assert.equal(headingContents.A, '\\section{Bayesian analysis}\n\nAlpha body.', 'originals are byte-identical after blind-copy normalization')
const mdHeadingBuilt = core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'rd2', candidateIds: ['A', 'B'], contents: { A: '# Alpha Title\n\nBody A.', B: '# Beta Title\n\nBody B.' } })
assert.ok(mdHeadingBuilt.judges[0].packetText.includes('# Section'), 'markdown leading headings are normalized in blind copies')

// 6. A leak that the scrub cannot neutralize fails closed (TAINTED_BLINDING)
//    — e.g. identity forms without the canonical spacing. (The plain
//    "candidate A" form is sanitized by the scrub itself and the sanitized
//    copy is what the full-byte scan verifies.)
assert.throws(
  () => core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'rd', candidateIds: ['A', 'B'], contents: { A: 'Body one.', B: 'The result for candidate: A wins.' } }),
  (error) => error.code === 'TAINTED_BLINDING',
)

// 7. Token-bounded anonymized labels: duplicate, empty, or self-leaking
//    labels are rejected before any packet is built.
assert.throws(
  () => core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'rd', candidateIds: ['A', 'B'], contents: { A: 'x one', B: 'y one' }, anonymizedLabels: ['Candidate 1', 'Candidate 1'] }),
  /Anonymized labels must be unique/,
)
assert.throws(
  () => core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'rd', candidateIds: ['A', 'B'], contents: { A: 'x one', B: 'y one' }, anonymizedLabels: ['', 'Candidate 2'] }),
  /non-empty/,
)
assert.throws(
  () => core.buildBlindPackets({ pass: 0, judgeCount: 1, runDigest: 'rd', candidateIds: ['A', 'B'], contents: { A: 'x one', B: 'y one' }, anonymizedLabels: ['Candidate A', 'Candidate 2'] }),
  /leaks an identity form/,
)

// 8. The typed ranking parser: a RANKING: line over the exact label set is
//    valid and maps back to the original ids; free text, missing lines, and
//    incomplete rankings are rejected.
const labels = ['Candidate 1', 'Candidate 2', 'Candidate 3']
const map = { 'Candidate 1': 'A', 'Candidate 2': 'B', 'Candidate 3': 'AB' }
const parsed = scoring.parseRanking('The second candidate is best overall.\nRANKING: Candidate 2 > Candidate 1 > Candidate 3', labels, map)
assert.equal(parsed.valid, true)
assert.deepEqual(parsed.ranking, ['Candidate 2', 'Candidate 1', 'Candidate 3'])
assert.deepEqual(parsed.originalRanking, ['B', 'A', 'AB'])
const freeText = scoring.parseRanking('I prefer the second one overall.', labels, map)
assert.equal(freeText.valid, false)
assert.ok(freeText.errors.some((error) => /Missing RANKING: line/.test(error)))
const incomplete = scoring.parseRanking('RANKING: Candidate 1 > Candidate 3', labels, map)
assert.equal(incomplete.valid, false)
assert.ok(incomplete.errors.some((error) => /Missing labels: Candidate 2/.test(error)))
const unknownLabel = scoring.parseRanking('RANKING: Candidate 9 > Candidate 1 > Candidate 2', labels, map)
assert.equal(unknownLabel.valid, false)

console.log('blinding-parser tests passed for generation ' + manifest.generation)
