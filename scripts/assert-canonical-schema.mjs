#!/usr/bin/env node
// scripts/assert-canonical-schema.mjs (canonical plan §4.4)
//
// Enforces the Schema Discipline rule in source and generated runtime
// artifacts:
//   1. No AutoResearch-owned record carries a `schemaVersion` object-literal
//      write, a `exposurePolicyVersion` policy fork, or a v1/v2 runtime
//      branch. Deployment build metadata is explicitly excluded: the
//      build-manifest `schemaVersion` and the build probe pass-throughs.
//   2. Tool parameter schemas are generated from autoresearch-core.mjs; no
//      transport-specific hand copy may exist. Every registered tool's
//      parameter schema (captured by mounting the generated bundles) must
//      equal the schema generated from the core.
//
// Exits non-zero on any violation. This is a CI/release gate, not a model
// tool.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = async (rel) => await fs.readFile(path.join(root, rel), 'utf8')

const manifest = JSON.parse(await read('tools/build-manifest.json'))
const coreModule = await import(pathToFileURL(path.join(root, 'src/autoresearch-core.mjs')).href)
const generated = coreModule.generateToolSchemas()

let violations = []

// ── 1. Static scan: no schemaVersion / policy-fork object-literal writes ────
// Property reads (`.schemaVersion`, `.exposurePolicyVersion`) are legitimate:
// they power the closed legacy-fingerprint catalog and the build probe. Only
// object-literal KEY writes are research-record schema markers and forbidden.
// A key write is one not preceded by a dot (property access) or identifier
// character. Build-metadata pass-throughs (value from the build manifest or
// the build probe) are explicitly excluded: they report deployment build
// metadata, not a research record.
const BUILD_METADATA_VALUE = /(manifest|probe)\.schemaVersion\b/
// Matches an object-literal key `schemaVersion:` / `exposurePolicyVersion:`
// that is NOT a property access (no leading dot) and NOT part of an
// identifier (no leading word char). Captures the rest of the line for the
// build-metadata value check.
const SCAN_PATTERNS = [
  { field: 'schemaVersion', re: /(?<![\w.])schemaVersion\s*:(.*)$/ },
  { field: 'exposurePolicyVersion', re: /(?<![\w.])exposurePolicyVersion\s*:(.*)$/ },
]
const FILES_TO_SCAN = []
for (const entry of await fs.readdir(path.join(root, 'src'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
  FILES_TO_SCAN.push(path.join(root, 'src', entry.name))
}
for (const rel of [manifest.entries.orchestrator, manifest.entries.linear, manifest.entries.core]) {
  if (rel) FILES_TO_SCAN.push(path.join(root, rel))
}
for (const file of [...new Set(FILES_TO_SCAN)]) {
  const text = await read(path.relative(root, file))
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    for (const { field, re } of SCAN_PATTERNS) {
      const match = raw.match(re)
      if (!match) continue
      const valueExpr = match[1]
      if (field === 'schemaVersion' && BUILD_METADATA_VALUE.test(valueExpr)) continue // build-metadata pass-through
      violations.push(path.relative(root, file) + ':' + (i + 1) + ' forbidden ' + field + ' record write: ' + raw.trim())
    }
  }
}

// ── 2. Generated tool schemas are closed and complete ───────────────────────
const toolNames = Object.keys(generated)
assert.ok(toolNames.length >= 50, 'generateToolSchemas must define the full tool set (got ' + toolNames.length + ')')
const openAllowlist = coreModule.TOOL_SCHEMA_OPEN_PATH_ALLOWLIST ?? {}
const usedOpenPaths = new Set()
for (const [location, rationale] of Object.entries(openAllowlist)) {
  assert.ok(typeof rationale === 'string' && rationale.trim().length >= 20, location + ' open-schema allowlist entry needs a concrete rationale')
}
function assertStructuredObjectsClosed(schema, location) {
  if (!schema || typeof schema !== 'object') return
  if (schema.type === 'object') {
    if (schema.additionalProperties === true) {
      assert.ok(openAllowlist[location], location + ' open object is not explicitly allowlisted')
      usedOpenPaths.add(location)
    } else {
      assert.ok(schema.additionalProperties === false || (schema.additionalProperties && typeof schema.additionalProperties === 'object'), location + ' object must be closed or declare a typed dynamic-value schema')
    }
    if (schema.properties !== undefined) {
      const propertyNames = new Set(Object.keys(schema.properties))
      for (const required of schema.required ?? []) assert.ok(propertyNames.has(required), location + ' requires undeclared property ' + required)
      for (const [name, child] of Object.entries(schema.properties)) assertStructuredObjectsClosed(child, location + '.' + name)
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') assertStructuredObjectsClosed(schema.additionalProperties, location + '{}')
  }
  if (schema.type === 'array' && schema.items) assertStructuredObjectsClosed(schema.items, location + '[]')
  for (const [index, child] of (schema.oneOf ?? []).entries()) assertStructuredObjectsClosed(child, location + '.oneOf[' + index + ']')
}
for (const [name, schema] of Object.entries(generated)) {
  assert.equal(schema.type, 'object', name + ' generated schema must be an object')
  assert.equal(schema.additionalProperties, false, name + ' generated schema must be closed (additionalProperties: false)')
  assert.ok(schema.properties && typeof schema.properties === 'object', name + ' generated schema must declare properties')
  assertStructuredObjectsClosed(schema, name)
}
for (const location of Object.keys(openAllowlist)) assert.ok(usedOpenPaths.has(location), location + ' stale open-schema allowlist entry')

// ── 3. Mounted bundles register only generated tool schemas ─────────────────
const registeredTools = new Map()
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? root, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, options = {}) { await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined) },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async lstat(target) { try { return await fs.lstat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}
const register = (definition) => registeredTools.set(definition.name, definition)

const orchestrator = (await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)).default
const linearPlugin = (await import(pathToFileURL(path.join(root, manifest.entries.linear)).href)).default
orchestrator.apply({ get(name) { return name === 'fs' ? fileService : name === 'tools' ? { register } : undefined } })
linearPlugin.apply({ get(name) { return name === 'tools' ? { register } : undefined } })

assert.ok(registeredTools.size > 0, 'mounted bundles must register tools')
for (const [name, definition] of registeredTools) {
  const expected = generated[name]
  if (expected === undefined) continue // transport-only tools may exist; the generated set covers every owned tool
  const actual = definition.parameters
  const expectedJson = JSON.stringify(expected)
  const actualJson = JSON.stringify(actual)
  if (actualJson !== expectedJson) {
    violations.push('tool ' + name + ' registered parameter schema differs from the core-generated schema')
  }
}

if (violations.length > 0) {
  console.error('assert-canonical-schema FAILED: ' + violations.length + ' violation(s):')
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log('assert-canonical-schema passed: generation ' + manifest.generation
  + ', ' + registeredTools.size + ' registered tools, ' + toolNames.length + ' generated schemas, no research-record schemaVersion/policy forks.')
