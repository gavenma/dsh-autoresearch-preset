#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destination = process.argv[2]

if (!destination) {
  console.error('Usage: node scripts/install-preset.mjs <DSH_HOME/.agent-presets/research>')
  process.exit(2)
}

const target = path.resolve(destination)
const excluded = new Set(['.git', '.github', 'docs', 'scripts', 'node_modules', '.research-agent'])
const entries = fs.readdirSync(root, { withFileTypes: true })
for (const entry of entries) {
  if (excluded.has(entry.name)) continue
  const source = path.join(root, entry.name)
  const output = path.join(target, entry.name)
  fs.cpSync(source, output, { recursive: true, force: true, errorOnExist: false })
}
console.log(`Installed preset snapshot into ${target}`)
console.log('Start a new DSH session after installation so the preset generation is remounted.')
