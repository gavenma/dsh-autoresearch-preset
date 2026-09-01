#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tools = path.join(root, 'tools')
const manifestPath = path.join(tools, 'build-manifest.json')
const fail = (message) => {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}
const hashFile = (relativePath) => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root, relativePath)))
  .digest('hex')

// Required runtime assets, discovered the same way build-preset.mjs inventories
// them. Every one must exist on disk and be fingerprinted (hash-verified) in the
// manifest, so a role prompt, skill, or vendored module added to the tree cannot
// silently escape verification.
function collectVendor(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectVendor(full))
    else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(path.relative(root, full).split(path.sep).join('/'))
  }
  return out
}
const requiredAssets = [
  ...fs.readdirSync(path.join(root, 'roles')).filter((name) => name.endsWith('.md')).map((name) => 'roles/' + name),
  ...fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md')))
    .map((entry) => 'skills/' + entry.name + '/SKILL.md'),
  'config.default.json',
  'preset.yml',
  'agent.cordis.yml',
  ...collectVendor(path.join(root, 'tools', 'vendor')),
]

if (!fs.existsSync(manifestPath)) {
  fail('tools/build-manifest.json is missing')
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 2) fail(`unexpected manifest schema: ${manifest.schemaVersion}`)
  if (!/^[0-9a-f]{12}$/.test(manifest.generation ?? '')) fail('manifest generation must be 12 lowercase hex characters')

  const mismatches = []
  for (const [relativePath, expectedHash] of Object.entries(manifest.files ?? {})) {
    const absolutePath = path.join(root, relativePath)
    if (!fs.existsSync(absolutePath)) mismatches.push(`${relativePath}: missing`)
    else if (hashFile(relativePath) !== expectedHash) mismatches.push(`${relativePath}: SHA-256 mismatch`)
  }
  if (mismatches.length > 0) fail(`manifest file checks failed: ${mismatches.join('; ')}`)

  const aggregateLines = Object.entries(Object.fromEntries((manifest.aggregateScope ?? []).map((relativePath) => [relativePath, hashFile(relativePath)])))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, hash]) => `${relativePath}:${hash}`)
    .join('\n')
  const aggregateId = crypto.createHash('sha256').update(aggregateLines, 'utf8').digest('hex')
  if (aggregateId !== manifest.aggregateId) fail('aggregate build ID does not match aggregate scope')

  for (const [entryName, relativePath] of Object.entries(manifest.entries ?? {})) {
    const absolutePath = path.join(root, relativePath)
    if (!fs.existsSync(absolutePath)) {
      fail(`${entryName} entry is missing: ${relativePath}`)
      continue
    }
    if (entryName === 'core') continue
    const source = fs.readFileSync(absolutePath, 'utf8')
    const embeddedId = source.match(/EMBEDDED_BUILD_ID = '([0-9a-f]{64})'/)?.[1]
    const embeddedGeneration = source.match(/EMBEDDED_GENERATION = '([0-9a-f]+)'/)?.[1]
    if (embeddedId !== manifest.aggregateId) fail(`${entryName} embedded build ID does not match manifest`)
    if (embeddedGeneration && embeddedGeneration !== manifest.generation) fail(`${entryName} embedded generation does not match manifest`)
  }

  for (const relativePath of [...new Set(requiredAssets)].sort()) {
    if (!fs.existsSync(path.join(root, relativePath))) fail(`required preset asset is missing: ${relativePath}`)
    else if (!(relativePath in (manifest.files ?? {}))) fail(`required preset asset is not fingerprinted in the manifest: ${relativePath}`)
  }

  if (!process.exitCode) {
    console.log(`Snapshot verified: generation ${manifest.generation}, aggregate ${manifest.aggregateId}`)
  }
}
