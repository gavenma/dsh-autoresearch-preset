// Regression fixtures for the post-plan hardening fixes (2026-09-09 audit):
//   1. confinement attestation freshness is bounded on BOTH sides and the
//      receipt is bound to the run it was produced for;
//   2. classifyPathOperation collapses `.`/`..` segments before the
//      write-root prefix check;
//   3. stripProvenanceBlocks is escape/URL-aware (`\%` and `%20` survive;
//      real TeX comments are stripped);
//   4. the Linear Current Node Context block round-trips losslessly for
//      ordinary coordinator prose (render → parse → identical digest);
//   5. feedbackVersion carries the triage link forward;
//   6. watermark freshness compares instants, not strings.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)

const NOW_MS = Date.parse('2026-01-01T00:00:00.000Z')

// ── 1. attestation freshness bounds + run binding ──────────────────────────
const baseAttestation = {
  kind: 'confinement-attestation',
  probedBoundary: 'role-child-adapters',
  passed: true,
  checks: { writeScope: 'enforced', readScope: 'enforced', egress: 'enforced' },
  workspace: '/ws',
  probedAt: '2026-01-01T00:00:00.000Z',
  ttlMs: 600000,
  runDir: '/ws/run-a',
}
assert.equal(core.attestationOk(baseAttestation, '/ws', NOW_MS + 300000, '/ws/run-a'), true, 'fresh receipt within TTL for the same run is valid')
assert.equal(core.attestationOk(baseAttestation, '/ws', NOW_MS + 900000, '/ws/run-a'), false, 'expired receipt is rejected')
assert.equal(core.attestationOk({ ...baseAttestation, probedAt: '2099-01-01T00:00:00.000Z' }, '/ws', NOW_MS, '/ws/run-a'), false, 'future-dated probe must not extend the TTL forever')
assert.equal(core.attestationOk(baseAttestation, '/ws', NOW_MS + 300000, '/ws/run-b'), false, 'a receipt copied from another run cannot authorize this one')
assert.equal(core.attestationOk(baseAttestation, '/ws', NOW_MS + 300000), true, 'no run binding requested -> still valid')
// The run binding flows through the gated grant resolver.
const wrongRunGrant = core.resolveRoleToolGrant('research_judge', null, baseAttestation, { workspace: '/ws', now: NOW_MS + 300000, runDir: '/ws/run-b' })
assert.equal(wrongRunGrant.confinement, 'attestation-invalid', 'grant resolver rejects a receipt bound to another run')
const rightRunGrant = core.resolveRoleToolGrant('research_judge', null, baseAttestation, { workspace: '/ws', now: NOW_MS + 300000, runDir: '/ws/run-a' })
assert.equal(rightRunGrant.confinement, 'attested', 'grant resolver accepts the receipt for its own run')

// ── 2. classifyPathOperation collapses dot segments ────────────────────────
const traversal = core.classifyPathOperation('run/../outputs/x.md', { op: 'mutate', writeRoot: 'run' })
assert.equal(traversal.allowed, false, '..-traversal must not hide behind the write-root prefix')
assert.equal(traversal.approvalClass, 'published-output', 'run/../outputs/x.md must classify as published-output')
assert.equal(core.classifyPathOperation('run/./notes/x.md', { op: 'mutate', writeRoot: 'run' }).allowed, true, 'dot segments inside the write root stay allowed')
assert.equal(core.classifyPathOperation('/a/../../etc/passwd', { op: 'mutate', writeRoot: '/a' }).allowed, false, 'absolute traversal above the root stays out of scope')
assert.equal(core.classifyPathOperation('run/x.md', { op: 'mutate', writeRoot: 'run' }).allowed, true, 'plain in-root mutation unchanged')

// ── 3. escape/verbatim-aware TeX comment stripping (blind-copy integrity) ──
const texPackets = core.buildBlindPackets({
  pass: 0,
  judgeCount: 1,
  candidateIds: ['A', 'B'],
  artifactFormat: 'tex',
  contents: {
    A: 'Progress: 100\\% complete and verified by the author.',
    B: 'Line one.\n% internal provenance: author alice\nLine two. https://example.test/a%2Fb\nLine three \\\\% after linebreak comment\n\\verb|keep 50%| stays',
  },
  judgeContext: 'shared context for the round',
})
const texPacketText = texPackets.judges[0].packetText
assert.ok(texPacketText.includes('100\\% complete'), 'escaped \\% must survive in the blind copy')
assert.ok(texPacketText.includes('a%2Fb'), 'percent-encoded URL must survive in the blind copy')
assert.ok(texPacketText.includes('keep 50%'), '\\verb content must survive untouched')
assert.ok(!texPacketText.includes('internal provenance'), 'a real TeX provenance comment must be stripped')
assert.ok(!texPacketText.includes('after linebreak comment'), '\\\\ then % is a comment in TeX and must be stripped')

// Markdown bodies: '%' is literal text — no truncation, no false stripping.
const mdPackets = core.buildBlindPackets({
  pass: 0,
  judgeCount: 1,
  candidateIds: ['A', 'B'],
  artifactFormat: 'markdown',
  contents: { A: 'Progress: 50% done.', B: 'Other text' },
  judgeContext: 'shared context for the round',
})
assert.ok(mdPackets.judges[0].packetText.includes('50% done'), 'markdown "50% done" must survive intact')

// ── 4. context block round-trips losslessly for ordinary prose ─────────────
const state = {
  kind: 'node-context',
  nodeId: 'n1',
  status: 'todo',
  objective: 'Verify the fix',
  contract: { planRevision: 1, nodeRevision: 1, contractDigest: 'a'.repeat(64) },
  completed: [{ id: 'c1', text: 'done thing', evidence: 'B - evidence: C' }],
  findings: [],
  requiredRevisions: [
    { id: 'r1', reason: 'Fix the units (see fig 2)', source: 'verifier', affectedCriteria: ['AA-01'], requiredChange: 'Use format: JSON output' },
  ],
  remaining: [{ id: 'w1', text: 'Rerun (fast path)' }],
  dependencies: [{ nodeId: 'n2', issueId: 'T-1', relation: 'blocks: others', why: 'needed later' }],
  nextAction: { text: 'Claim the node', owner: 'A; B', expectedOutput: 'receipt', acceptanceCheck: 'check: all' },
  evidenceRefs: [],
  watermark: '2026-01-01T00:00:00.000Z',
  lastVerified: null,
}
const rendered = core.renderContextBlock(state)
const parsed = core.parseContextBlock(rendered)
assert.ok(parsed.ok, 'round-tripped block must parse: ' + JSON.stringify(parsed))
assert.equal(core.contextBlockDigest(parsed.state), core.contextBlockDigest(state), 'render → parse must reproduce the digest-exact state')
assert.equal(parsed.state.requiredRevisions[0].requiredChange, 'Use format: JSON output', 'values containing ": " survive')
assert.equal(parsed.state.requiredRevisions[0].reason, 'Fix the units (see fig 2)', 'trailing non-keyed parens stay in the reason')
assert.equal(parsed.state.remaining[0].text, 'Rerun (fast path)', 'trailing parens stay in remaining-work text')
assert.equal(parsed.state.nextAction.text, 'Claim the node', 'next action text round-trips')
assert.equal(parsed.state.completed[0].evidence, 'B - evidence : C', 'the evidence delimiter is canonicalized inside evidence values')
assert.equal(parsed.state.dependencies[0].relation, 'blocks: others', 'relation values keep their ": " content')
assert.equal(parsed.state.nextAction.owner, 'A;B', 'meta values fold "; " so the paren group split stays unambiguous')
// Prose that mimics the legacy paren grammar must stay prose (no grammar
// collision, no legacy parsing).
const proseBlock = core.renderContextBlock(core.parseContextBlock(core.renderContextBlock({
  ...state,
  requiredRevisions: [{ id: 'r2', reason: 'Fix (source: user manual)', source: '', affectedCriteria: [], requiredChange: '' }],
})).state)
const proseParsed = core.parseContextBlock(proseBlock)
assert.ok(proseParsed.ok, 'a reason ending in a keyed-looking paren group must round-trip: ' + JSON.stringify(proseParsed))
assert.equal(proseParsed.state.requiredRevisions[0].reason, 'Fix (source: user manual)', 'prose parens are never interpreted as machine metadata')
// Prose containing the literal sentinel token is canonicalized so the LAST
// trailing (meta: ...) group is always the machine's own.
const sentinelState = {
  ...state,
  requiredRevisions: [{ id: 'r3', reason: 'Fix (meta: source: fake)', source: 'verifier', affectedCriteria: ['AA-01'], requiredChange: 'Use format: JSON output' }],
}
const sentinelParsed = core.parseContextBlock(core.renderContextBlock(sentinelState))
assert.ok(sentinelParsed.ok, 'sentinel-looking prose must round-trip: ' + JSON.stringify(sentinelParsed))
assert.equal(sentinelParsed.state.requiredRevisions[0].reason, 'Fix (meta : source: fake)', 'prose sentinel token is canonicalized')
assert.equal(sentinelParsed.state.requiredRevisions[0].source, 'verifier', 'the real trailing meta group still parses')

// ── 5. feedbackVersion carries the triage link forward ─────────────────────
const feedbackBase = {
  kind: 'user-feedback',
  projectId: 'p1',
  feedback: 'fix the abstract',
  receivedAt: '2026-01-01T00:00:00.000Z',
  source: 'user',
  authority: 'user',
  baseInputDigest: 'b'.repeat(64),
  baseManifestDigest: 'c'.repeat(64),
  userAuthority: 'stale',
  nodeId: null,
  targetContributionIds: [],
  targetCriterionIds: [],
  idempotencyKey: 'd'.repeat(64),
  status: 'triaged',
  triageDigest: 'e'.repeat(64),
  closure: null,
}
const resolving = core.feedbackVersion(feedbackBase, { status: 'resolving' })
assert.equal(resolving.triageDigest, 'e'.repeat(64), 'a status advance must keep the triage link')
const resolved = core.feedbackVersion(resolving, { status: 'resolved', closure: { resolvedAt: '2026-01-02T00:00:00.000Z', affectedNodeIds: ['n1'], receiptHashes: [], integrationInputDigest: 'b'.repeat(64), publishManifestDigest: 'c'.repeat(64), judgeQuorumBypass: 'not-applied' } })
assert.equal(resolved.triageDigest, 'e'.repeat(64), 'the resolved version must still link the triage')

// ── 6. watermark freshness compares instants ───────────────────────────────
const instantCompose = core.composeNodeWorkContext({
  issue: { id: 'i1', identifier: 'T-1', title: '', url: '', state: { name: 'Todo' } },
  contextBlock: parsed,
  specBlock: null,
  comments: [{ id: 'c1', body: 'human note', createdAt: '2026-01-01T00:00:00Z' }],
  relations: { relations: [], inverseRelations: [] },
  evidenceStatus: [],
  drift: [],
})
assert.equal(instantCompose.freshness.newComments, 0, 'an equal-instant comment (different ISO precision) must not be newer than the watermark')
const laterCompose = core.composeNodeWorkContext({
  issue: { id: 'i1', identifier: 'T-1', title: '', url: '', state: { name: 'Todo' } },
  contextBlock: parsed,
  specBlock: null,
  comments: [{ id: 'c1', body: 'human note', createdAt: '2026-01-01T00:00:01+00:00' }],
  relations: { relations: [], inverseRelations: [] },
  evidenceStatus: [],
  drift: [],
})
assert.equal(laterCompose.freshness.newComments, 1, 'a strictly later comment must be newer than the watermark')

console.log('hardening regression tests passed for generation ' + manifest.generation)
