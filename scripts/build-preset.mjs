#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(root, 'src')
const toolsDir = path.join(root, 'tools')
const manifestPath = path.join(toolsDir, 'build-manifest.json')
const compositionPath = path.join(root, 'agent.cordis.yml')
const sourcePaths = {
  core: path.join(sourceDir, 'autoresearch-core.mjs'),
  orchestrator: path.join(sourceDir, 'research-orchestrator.mjs'),
  linear: path.join(sourceDir, 'linear.mjs'),
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const hashFile = (relativePath) => sha256(fs.readFileSync(path.join(root, relativePath)))
const sourceText = Object.fromEntries(Object.entries(sourcePaths).map(([name, file]) => [name, fs.readFileSync(file, 'utf8')]))
const sourceIdentity = Object.entries(sourceText)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, text]) => name + ':' + sha256(text))
  .join('\n')

// Runtime asset inventory. Role prompts, skills, and vendored modules are
// discovered from the tree so a newly added asset is fingerprinted without a
// second edit here; the fixed metadata files are listed explicitly.
const readDir = (dir) => fs.readdirSync(dir, { withFileTypes: true })
const roleAssetPaths = readDir(path.join(root, 'roles'))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => 'roles/' + entry.name)
  .sort()
const skillAssetPaths = readDir(path.join(root, 'skills'))
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md')))
  .map((entry) => 'skills/' + entry.name + '/SKILL.md')
  .sort()
const vendorAssetPaths = []
const collectVendor = (dir, relative) => {
  for (const entry of readDir(dir)) {
    const childRelative = relative ? relative + '/' + entry.name : entry.name
    const childDir = path.join(dir, entry.name)
    if (entry.isDirectory()) collectVendor(childDir, childRelative)
    else if (entry.isFile() && entry.name.endsWith('.mjs')) vendorAssetPaths.push('tools/vendor/' + childRelative)
  }
}
collectVendor(path.join(root, 'tools', 'vendor'), '')
vendorAssetPaths.sort()
const dataAssetPaths = ['config.default.json', 'preset.yml']
const helperPaths = ['tools/linear-client.mjs', 'tools/research-web-fetch.mjs', 'tools/byte-utils.mjs']

// Every non-generated runtime asset participates in the generation identity:
// changing a role prompt, skill, config, preset metadata, or vendored module
// produces a new generation so the preset is remounted coherently.
const generationAssetPaths = [...roleAssetPaths, ...skillAssetPaths, ...vendorAssetPaths, ...dataAssetPaths, ...helperPaths]
const runtimeIdentity = sourceIdentity + '\n' + generationAssetPaths
  .sort()
  .map((relativePath) => relativePath + ':' + hashFile(relativePath))
  .join('\n')
const generation = sha256(runtimeIdentity).slice(0, 12)
const paths = {
  core: 'tools/autoresearch-core-' + generation + '.mjs',
  orchestrator: 'tools/research-orchestrator-' + generation + '.mjs',
  linear: 'tools/linear-' + generation + '.mjs',
}

const writeText = (relativePath, text) => fs.writeFileSync(path.join(root, relativePath), text)
writeText(paths.core, sourceText.core)

// The aggregate build ID is defined over the imported runtime graph: the core
// entry, the static helper modules, and the vendored PDF.js runtime they import.
const aggregateScope = [paths.core, ...helperPaths, ...vendorAssetPaths].sort()
const aggregateLines = aggregateScope
  .map((relativePath) => [relativePath, hashFile(relativePath)])
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([relativePath, hash]) => relativePath + ':' + hash)
  .join('\n')
const aggregateId = sha256(aggregateLines)

function emitEntry(text, entryName) {
  const header = entryName === 'orchestrator'
    ? '// AUTO-GENERATED orchestrator entry, generation ' + generation + '. Source: src/research-orchestrator.mjs.\n'
    : '// AUTO-GENERATED Linear entry, generation ' + generation + '. Source: src/linear.mjs.\n'
  const content = text
    .replace(/^\/\/ Source entry[^\n]*\n/, header)
    .replace('./autoresearch-core.mjs', './autoresearch-core-' + generation + '.mjs')
    .replace('__AUTORESEARCH_GENERATION__', generation)
    .replace('__AUTORESEARCH_BUILD_ID__', aggregateId)
  if (content.includes('__AUTORESEARCH_')) throw new Error('unresolved build placeholder in ' + entryName)
  return content
}

writeText(paths.orchestrator, emitEntry(sourceText.orchestrator, 'orchestrator'))
writeText(paths.linear, emitEntry(sourceText.linear, 'linear'))

const composition = fs.readFileSync(compositionPath, 'utf8')
  .replace(/\.\/tools\/research-orchestrator-[0-9a-f]{12}\.mjs/, './' + paths.orchestrator)
  .replace(/\.\/tools\/linear-[0-9a-f]{12}\.mjs/, './' + paths.linear)
if (!composition.includes(paths.orchestrator) || !composition.includes(paths.linear)) {
  throw new Error('composition rewrite did not pin the generated bundles: check agent.cordis.yml tool rows')
}
fs.writeFileSync(compositionPath, composition)

// Remove obsolete generated bundles from previous generations. Only files that
// match the exact generated naming pattern are candidates; the current
// generation and every static helper/vendor file are never touched.
const bundlePattern = /^tools\/(?:autoresearch-core|research-orchestrator|linear)-[0-9a-f]{12}\.mjs$/
const currentBundles = new Set(Object.values(paths))
const removed = []
for (const name of fs.readdirSync(toolsDir)) {
  const relativePath = 'tools/' + name
  if (bundlePattern.test(relativePath) && !currentBundles.has(relativePath)) {
    fs.rmSync(path.join(root, relativePath))
    removed.push(relativePath)
  }
}

// The manifest's files map is the complete verified runtime surface: generated
// entries, the module graph, role prompts, skills, config, preset metadata, and
// the rewritten composition. It is rebuilt from the current inventory each
// build, so a removed asset cannot linger as a stale hash and a missing
// manifest is handled implicitly (no prior manifest is required).
const filePaths = new Set([
  ...Object.values(paths),
  ...aggregateScope,
  ...roleAssetPaths,
  ...skillAssetPaths,
  ...dataAssetPaths,
  'agent.cordis.yml',
])
const files = {}
for (const relativePath of [...filePaths].sort()) {
  files[relativePath] = hashFile(relativePath)
}

const manifest = {
  schemaVersion: 2,
  generation,
  aggregateId,
  aggregateScope,
  entries: paths,
  files,
  generatedAt: new Date().toISOString(),
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
if (removed.length > 0) console.log('Removed ' + removed.length + ' orphan bundle(s): ' + removed.join(', '))
console.log('Built generation ' + generation + ', aggregate ' + aggregateId)
