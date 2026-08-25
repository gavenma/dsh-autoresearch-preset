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

  for (const relativePath of [
    'preset.yml',
    'agent.cordis.yml',
    'config.default.json',
    'skills/research-project/SKILL.md',
    'roles/research_planner.md',
  ]) {
    if (!fs.existsSync(path.join(root, relativePath))) fail(`required preset asset is missing: ${relativePath}`)
  }

  if (!process.exitCode) {
    console.log(`Snapshot verified: generation ${manifest.generation}, aggregate ${manifest.aggregateId}`)
  }
}
