import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The `read_image` grant follows the role's resolved ROUTE, not just the role's
// declared capability: the tool hands the model an image, and a text-only
// adapter rejects that call with UNSUPPORTED_CONTENT_TYPE. A tool that can only
// fail is not a capability.
//
// Capability is deliberately three-valued, and this test pins that:
//   stated image    -> grant
//   stated text-only-> withhold the tool from BOTH the grant and the ceiling
//   unstated        -> keep the declared grant (absence is not a denial)
// The distinction matters because an adapter that reports no `inputModalities`
// must not have a working capability silently removed.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const core = await import(pathToFileURL(path.join(root, manifest.entries.core)).href)

const grant = (opts) => core.resolveRoleToolGrant('research_author', null, null, opts)
// A listed route is a capability statement. Every installed adapter resolves
// `inputModalities` for each model it serves (pi-ai fills a model that declares
// nothing from its provider's `defaultInput`, then `["text"]`; deepseek
// defaults to `["text"]`), so absence of `imageCapable: true` means text-only
// rather than unknown. Only a route the listing does not contain is unstated.
const availability = {
  models: [
    { provider: 'prov', model: 'text-only', imageCapable: false },
    { provider: 'prov', model: 'vision', imageCapable: true },
    { provider: 'prov', model: 'listed-plain' },
  ],
}

// ── the three states ───────────────────────────────────────────────────────
assert.ok(grant({ routes: [{ provider: 'prov', model: 'vision' }], availability }).tools.includes('read_image'), 'a stated image route keeps read_image')
assert.ok(!grant({ routes: [{ provider: 'prov', model: 'text-only' }], availability }).tools.includes('read_image'), 'a stated text-only route withholds read_image')
assert.ok(grant({ routes: [{ provider: 'prov', model: 'unlisted' }], availability }).tools.includes('read_image'), 'a route the listing omits keeps the declared grant')
assert.ok(!grant({ routes: [{ provider: 'prov', model: 'listed-plain' }], availability }).tools.includes('read_image'), 'a listed route that does not report image input is text-only')
assert.ok(grant({ routes: [{ provider: 'prov', model: 'unlisted' }] }).tools.includes('read_image'), 'no availability at all keeps the declared grant')

// ── explicit overrides win over route inspection ───────────────────────────
assert.ok(grant({ imageCapable: true }).tools.includes('read_image'), 'an explicit capable flag grants')
assert.ok(!grant({ imageCapable: false }).tools.includes('read_image'), 'an explicit incapable flag withholds')
assert.ok(!grant({
  routes: [{ provider: 'prov', model: 'vision' }],
  availability,
  imageCapable: false,
}).tools.includes('read_image'), 'an explicit incapable flag overrides a capable route')
assert.ok(grant({
  routes: [{ provider: 'prov', model: 'text-only' }],
  availability,
  imageCapable: true,
}).tools.includes('read_image'), 'an explicit capable flag overrides a text-only route')

// ── a fallback chain grants if ANY route can read images ───────────────────
assert.ok(grant({
  routes: [{ provider: 'prov', model: 'text-only' }, { provider: 'prov', model: 'vision' }],
  availability,
}).tools.includes('read_image'), 'a chain with a capable fallback keeps read_image')
assert.ok(grant({
  routes: [{ provider: 'prov', model: 'text-only' }, { provider: 'prov', model: 'unlisted' }],
  availability,
}).tools.includes('read_image'), 'a chain is withheld only when every route is known text-only')
assert.ok(!grant({
  routes: [{ provider: 'prov', model: 'text-only' }, { provider: 'prov', model: 'text-only' }],
  availability,
}).tools.includes('read_image'), 'a chain of text-only routes withholds read_image')

// ── the shift applies to the ceiling too ───────────────────────────────────
{
  const withheld = grant({ routes: [{ provider: 'prov', model: 'text-only' }], availability })
  assert.ok(!withheld.ceiling.includes('read_image'), 'a tool the route cannot serve is not in the ceiling either')
  assert.equal(withheld.imageToolWithheld, true, 'the withholding is reported for the spawn audit')
  // A config narrowing that asks for the withheld tool is refused, naming why.
  assert.throws(
    () => grant({ routes: [{ provider: 'prov', model: 'text-only' }], availability, tools: ['read', 'read_image'] }),
    /read_image is withheld: the resolved route does not accept image input/,
  )
  // Narrowing that stays inside the reduced ceiling still works.
  const narrowed = grant({ routes: [{ provider: 'prov', model: 'text-only' }], availability, tools: ['read'] })
  assert.deepEqual(narrowed.tools, ['read'])
  assert.equal(narrowed.narrowed, true)
}

// ── the attested path is gated the same way ────────────────────────────────
{
  const attestation = {
    kind: 'confinement-attestation',
    probedBoundary: 'role-child-adapters',
    workspace: '/ws',
    probedAt: new Date().toISOString(),
    ttlMs: 3600000,
    passed: true,
    checks: { writeScope: 'enforced', readScope: 'enforced', egress: 'enforced' },
  }
  const capable = core.resolveRoleToolGrant('research_coder', null, attestation, {
    workspace: '/ws', routes: [{ provider: 'prov', model: 'vision' }], availability,
  })
  assert.ok(capable.tools.includes('read_image'), 'an attested capable route keeps read_image')
  const textOnly = core.resolveRoleToolGrant('research_coder', null, attestation, {
    workspace: '/ws', routes: [{ provider: 'prov', model: 'text-only' }], availability,
  })
  assert.ok(!textOnly.tools.includes('read_image'), 'an attested text-only route withholds read_image from the broad baseline')
  assert.ok(!textOnly.ceiling.includes('read_image'), 'the raised ceiling excludes it too')
}

// ── the declared capability still means something on its own ───────────────
{
  const judge = core.resolveRoleToolGrant('research_judge', { artifactFormat: 'image' }, null, { routes: [{ provider: 'prov', model: 'unlisted' }] })
  assert.ok(judge.tools.includes('read_image'), 'a visual node keeps read_image when the route states nothing')
}

console.log('read_image route-gate tests passed for generation ' + manifest.generation)
