import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as core from '../src/autoresearch-core.mjs'

// Regression cover for the audited hardening fixes. Each block names the
// defect it pins so a future refactor cannot silently reintroduce it.
//
//   1. The sandbox mutation gate: the three verbs DSH cannot serve through
//      `fs` (create dir, copy, remove) must consult the resolved sandbox
//      policy instead of reaching `subprocess` unchecked.
//   2. Generated tool schemas are mandatory: no tool may register with an
//      unrestricted open-object parameter surface.
//   3. `jsonDeepEqual` makes the schema-drift comparison order-insensitive.
//   4. Approval authority: a model-authored token is not authorization.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))

// ── 1. sandbox mutation gate ────────────────────────────────────────────────
// The gate resolves through the `fs` service and consults `sandboxPolicy`.
// These are the two behaviours that decide whether a mutation proceeds.

function makeFakeFs(workspace) {
  return {
    async resolve(target, options = {}) {
      const absolute = path.isAbsolute(target) ? path.normalize(target) : path.resolve(options.cwd ?? workspace, target)
      return { targetKey: absolute, displayPath: absolute }
    },
    processPath(target) { return target.targetKey },
  }
}

function makeGate({ workspace, mode, policyThrows = false, sandboxPolicy = true }) {
  return core.makeMutationGate({
    fs: makeFakeFs(workspace),
    sandboxPolicy: sandboxPolicy
      ? { resolve: () => { if (policyThrows) throw new Error('no session policy'); return { mode, workspaceRoot: workspace } } }
      : undefined,
    pathutil: { normalize: (p) => path.normalize(String(p)), resolve: (a, b) => path.resolve(a, b) },
    baseDir: workspace,
    exec: undefined,
  })
}

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-gate-'))

// workspace-write inside the root is permitted and yields the process path.
{
  const gate = makeGate({ workspace, mode: 'workspace-write' })
  const inside = path.join(workspace, '.research-agent', 'run')
  assert.equal(await gate(inside), inside, 'workspace-write must permit a location inside the workspace root')
  assert.equal(await gate('relative/child'), path.join(workspace, 'relative', 'child'), 'a relative target resolves against baseDir')
}

// workspace-write outside the root is refused with the structured code.
{
  const gate = makeGate({ workspace, mode: 'workspace-write' })
  const outside = path.join(path.dirname(workspace), 'sibling-escape')
  await assert.rejects(
    () => gate(outside),
    (error) => {
      assert.equal(error.code, 'FS_SANDBOX_DENIED', 'an out-of-workspace mutation must carry FS_SANDBOX_DENIED')
      assert.match(error.message, /outside the workspace root/, 'the denial names the reason')
      return true
    },
    'workspace-write must refuse a location outside the workspace root',
  )
}

// read-only refuses even inside the workspace: that is the whole defect the
// gate exists to close.
{
  const gate = makeGate({ workspace, mode: 'read-only' })
  await assert.rejects(
    () => gate(path.join(workspace, 'inside-but-read-only')),
    (error) => {
      assert.equal(error.code, 'FS_SANDBOX_DENIED')
      assert.match(error.message, /read-only mode/)
      return true
    },
    'read-only must refuse a mutation inside the workspace too',
  )
}

// danger-full-access is the documented escape hatch and returns the target.
{
  const gate = makeGate({ workspace, mode: 'danger-full-access' })
  const anywhere = path.join(os.tmpdir(), 'autoresearch-anywhere')
  assert.equal(await gate(anywhere), anywhere, 'danger-full-access must not fence the mutation')
}

// No policy service composed => the deployment runs no fence at all (the
// bare-`fs` posture of an unwrapped SDK), so the gate passes through rather
// than inventing a refusal; the web profile always composes the policy.
{
  const gate = makeGate({ workspace, mode: 'workspace-write', sandboxPolicy: false })
  const target = path.join(workspace, 'x')
  assert.equal(await gate(target), target, 'an absent policy service means no fence, not a denial')
}

// An unresolvable policy is NOT an absent one: that case must fail closed.
{
  const gate = makeGate({ workspace, mode: 'workspace-write', policyThrows: true })
  await assert.rejects(
    () => gate(path.join(workspace, 'x')),
    (error) => {
      assert.equal(error.code, 'FS_SANDBOX_DENIED', 'a throwing policy must fail closed, not open')
      return true
    },
  )
}

// The gate requires its dependencies rather than silently degrading.
assert.throws(() => core.makeMutationGate({ pathutil: { normalize: String }, baseDir: '.' }), /fs service is required/)
assert.throws(() => core.makeMutationGate({ fs: makeFakeFs('.'), baseDir: '.' }), /pathutil is required/)

// ── 2. generated tool schemas are mandatory ────────────────────────────────
// Every registered tool name must exist in the generated set, so the
// open-object fallback can never be reached. Names are read from source so a
// new tool added without a core definition fails this test.

{
  const generated = core.generateToolSchemas()
  const registered = []
  for (const file of ['src/research-orchestrator.mjs', 'src/linear.mjs']) {
    const text = await fs.readFile(path.join(root, file), 'utf8')
    for (const match of text.matchAll(/\btool\('([a-z0-9_]+)'/g)) registered.push(match[1])
  }
  assert.equal(registered.length, 62, 'the preset registers exactly 62 tools')
  const missing = registered.filter((name) => generated[name] === undefined)
  assert.deepEqual(missing, [], 'every registered tool must have a generated parameter schema')
  const unused = Object.keys(generated).filter((name) => !registered.includes(name))
  assert.deepEqual(unused, [], 'no generated schema may be left unregistered')
  for (const name of registered) {
    const schema = generated[name]
    assert.equal(typeof schema, 'object', name + ' must carry an object schema')
    assert.notEqual(schema.additionalProperties, true, name + ' must not be an unrestricted open object')
  }
}

// ── 3. order-insensitive schema comparison ─────────────────────────────────
{
  assert.equal(core.jsonDeepEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true, 'key order must not matter')
  assert.equal(core.jsonDeepEqual({ a: 1 }, { a: 1, b: 2 }), false, 'an extra key is a difference')
  assert.equal(core.jsonDeepEqual({ a: 1, b: 2 }, { a: 1 }), false, 'a missing key is a difference')
  assert.equal(core.jsonDeepEqual([1, 2], [2, 1]), false, 'array order IS semantic and must be compared positionally')
  assert.equal(core.jsonDeepEqual([1, [2, { x: 3 }]], [1, [2, { x: 3 }]]), true, 'nested arrays and objects compare structurally')
  assert.equal(core.jsonDeepEqual(null, null), true)
  assert.equal(core.jsonDeepEqual(null, {}), false)
  assert.equal(core.jsonDeepEqual('a', 'a'), true)
  assert.equal(core.jsonDeepEqual(0, false), false, 'distinct primitives are never equal')
  // The regression itself: the ordered stringify of two equal schemas differs.
  const left = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } }
  const right = { properties: { b: { type: 'number' }, a: { type: 'string' } }, type: 'object' }
  assert.notEqual(JSON.stringify(left), JSON.stringify(right), 'precondition: ordered stringify differs')
  assert.equal(core.jsonDeepEqual(left, right), true, 'the structural comparison must not report false drift')
}

// ── 4. approval authority is external ──────────────────────────────────────
// The path guard is the consumer of a token. A token whose digest is not the
// record's own digest must not authorize anything, whether or not its other
// fields look right -- that digest check is what a model-authored forgery
// cannot satisfy by copying visible fields.

{
  const binding = { approvalClass: 'plan', contractDigest: 'contract-1', nodeId: 'node-1' }
  const issued = core.makeApprovalToken({ ...binding, issuedAt: new Date().toISOString() })
  assert.equal(core.approvalTokenValid(issued, binding), true, 'a faithfully built token validates')

  // Forged: correct visible fields, digest that does not cover them.
  const forged = { ...issued, digest: core.recordDigest({ ...issued, approvalClass: 'plan', nodeId: 'other-node' }) }
  assert.equal(core.approvalTokenValid(forged, binding), false, 'a token whose digest does not cover its fields must be refused')

  // Substituted class / node / contract, digest left as issued.
  assert.equal(core.approvalTokenValid({ ...issued, approvalClass: 'published-output' }, { ...binding, approvalClass: 'published-output' }), false, 'changing the class must invalidate the digest')
  assert.equal(core.approvalTokenValid(issued, { ...binding, nodeId: 'node-2' }), false, 'a token is bound to its node')
  assert.equal(core.approvalTokenValid(issued, { ...binding, contractDigest: 'contract-2' }), false, 'a token is bound to its contract')

  // Expiry is enforced, so a replayed token from an earlier run cannot authorize.
  const stale = core.makeApprovalToken({ ...binding, issuedAt: new Date(Date.now() - 7200_000).toISOString() })
  assert.equal(core.approvalTokenValid(stale, binding), false, 'an expired token must be refused')

  // A token is frozen: a caller cannot mutate one into a different authority.
  assert.equal(Object.isFrozen(issued), true, 'an issued approval token must be immutable')
}

// The orchestrator's own issuer is the only writer of the register, and the
// register is what makes a caller-supplied token acceptable. Assert the
// present-shaped source directly: acceptance must consult the register, not
// the argument alone.
{
  const text = await fs.readFile(path.join(root, 'src/research-orchestrator.mjs'), 'utf8')
  assert.match(text, /const issuedApprovals = new Map\(\)/, 'the issuance register must exist at plugin scope')
  assert.match(text, /validateIssuedApprovals\(args\.approvalTokens/, 'caller-supplied tokens must be matched against the register')
  assert.match(text, /never issued/, 'an unmatched token must be refused with an explanatory error')
  assert.match(text, /approval\.request\(/, 'authority must come from the host approval service')
  assert.doesNotMatch(
    text,
    /if \(!util\.isPlainObject\(token\) \|\| token\.kind !== 'coordinator-approval'[\s\S]{0,200}approvalTokens = args\.approvalTokens/,
    'the old shape-only acceptance of caller tokens must be gone',
  )
}

// The bundled runtime carries the same seams as the source.
{
  const bundled = await fs.readFile(pathToFileURL(path.join(root, manifest.entries.orchestrator)), 'utf8')
  assert.match(bundled, /makeMutationGate/, 'the bundle must carry the shared mutation gate')
  assert.match(bundled, /issuedApprovals/, 'the bundle must carry the issuance register')
  const coreBundle = await fs.readFile(pathToFileURL(path.join(root, manifest.entries.core)), 'utf8')
  assert.match(coreBundle, /export function makeMutationGate/, 'the core bundle must export the gate')
  assert.match(coreBundle, /export function jsonDeepEqual/, 'the core bundle must export the structural comparison')
}

// ── 5. error taxonomy of the fops read seam ────────────────────────────────
// `listDir`/`readJson` answer "no entries"/"no record" for a path that is
// absent, but must not turn a refusal or an I/O fault into the same answer.
// Both facets must classify by error code and rethrow anything else.
{
  for (const file of ['src/research-orchestrator.mjs', 'src/linear.mjs']) {
    const text = await fs.readFile(path.join(root, file), 'utf8')
    // Absence is classified by code and answered; anything else propagates.
    assert.match(
      text,
      /if \(error\?\.code === 'FS_NOT_FOUND' \|\| error\?\.code === 'ENOENT' \|\| error\?\.code === 'ENOTDIR' \|\| error\?\.code === 'FS_NOT_DIRECTORY'\) return \[\]/,
      file + ': listDir must answer "no entries" only for absence, by code',
    )
    assert.match(
      text,
      /if \(error\?\.code === 'FS_NOT_FOUND' \|\| error\?\.code === 'ENOENT'\) return undefined/,
      file + ': readJson must answer "no record" only for absence, by code',
    )
    // `readText` inside readJson uses the same classification, which is what
    // distinguishes "missing" from "refused". The old blanket swallow
    // (`catch { return undefined }` around the read) is the defect.
    assert.doesNotMatch(
      text,
      /await fs\.readText\(await targetOf\(p\)\)\)\s*\} catch \{\s*return undefined/,
      file + ': readJson must not collapse a read failure into "no record"',
    )
  }
}

// The mutation gate is shared, not re-implemented per facet: both facets must
// build it from the core so the two can never drift apart.
{
  for (const file of ['src/research-orchestrator.mjs', 'src/linear.mjs']) {
    const text = await fs.readFile(path.join(root, file), 'utf8')
    assert.match(text, /makeMutationGate\(\{ fs, sandboxPolicy, pathutil, baseDir, exec \}\)/, file + ': must build the shared gate')
    assert.doesNotMatch(text, /const sandboxFor = \(\) =>/, file + ': the hand-rolled per-facet gate must be gone')
  }
}

await fs.rm(workspace, { recursive: true, force: true })
console.log('hardening audit-fix regression tests passed for generation ' + manifest.generation)
