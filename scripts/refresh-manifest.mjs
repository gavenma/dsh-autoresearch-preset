#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'tools', 'build-manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const hashFile = (relativePath) => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root, relativePath)))
  .digest('hex')

const scopeHashes = Object.fromEntries((manifest.aggregateScope ?? []).map((relativePath) => [relativePath, hashFile(relativePath)]))
const aggregateId = crypto.createHash('sha256')
  .update(Object.entries(scopeHashes).sort(([left], [right]) => left.localeCompare(right)).map(([relativePath, hash]) => `${relativePath}:${hash}`).join('\n'), 'utf8')
  .digest('hex')

for (const [entryName, relativePath] of Object.entries(manifest.entries ?? {})) {
  if (entryName === 'core') continue
  const absolutePath = path.join(root, relativePath)
  const source = fs.readFileSync(absolutePath, 'utf8')
  if (!/EMBEDDED_BUILD_ID = '[0-9a-f]{64}'/.test(source)) {
    throw new Error(`missing EMBEDDED_BUILD_ID in ${relativePath}`)
  }
  const updated = source.replace(/EMBEDDED_BUILD_ID = '[0-9a-f]{64}'/, `EMBEDDED_BUILD_ID = '${aggregateId}'`)
  fs.writeFileSync(absolutePath, updated)
}

manifest.aggregateId = aggregateId
for (const relativePath of Object.keys(manifest.files ?? {})) manifest.files[relativePath] = hashFile(relativePath)
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Refreshed manifest for generation ${manifest.generation}: ${aggregateId}`)
