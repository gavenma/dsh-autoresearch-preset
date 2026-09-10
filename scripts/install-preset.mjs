#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Identity hashing must not depend on locale. `localeCompare` collates by
// language rules (punctuation weight, case folding) whose implementation varies
// with the ICU data shipped by the Node release, so the same tree could hash to
// a different generation on Node 20 than on Node 24 — silently re-identifying
// the build and stranding the previous generation's bundles. Compare by UTF-16
// code unit instead: total, locale-free, and identical everywhere.
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destination = process.argv[2]
const replaceConfig = process.argv.includes('--replace-config')
const cleanTarget = process.argv.includes('--clean-target')

if (!destination) {
  console.error('Usage: node scripts/install-preset.mjs <DSH_HOME/.agent-presets/research> [--replace-config] [--clean-target]')
  process.exit(2)
}

const target = path.resolve(destination)
const installedConfigPath = path.join(target, 'config.default.json')
const hadExistingConfig = fs.existsSync(installedConfigPath)
const preservedConfig = hadExistingConfig ? fs.readFileSync(installedConfigPath) : null
if (cleanTarget) {
  const home = path.resolve(process.env.HOME ?? '/')
  if (target === path.parse(target).root || target === home || target === root || root.startsWith(target + path.sep)) throw new Error('refusing unsafe --clean-target destination: ' + target)
  fs.rmSync(target, { recursive: true, force: true })
}
fs.mkdirSync(target, { recursive: true })
if (cleanTarget && preservedConfig && !replaceConfig) fs.writeFileSync(installedConfigPath, preservedConfig)

// Only runtime assets are installed: the composition, preset metadata, role
// prompts, skills, and the generated tools/ tree. Development and
// documentation files — src/, tests/, briefs/, docs/, scripts/, package.json,
// README/license/notice files, VCS/CI metadata — are never copied into a
// mounted preset. The config file is deliberately NOT in this list: see the
// "config: never touched unless instructed" block below.
const runtimeAssets = ['agent.cordis.yml', 'preset.yml', 'roles', 'skills', 'tools']
for (const relativePath of runtimeAssets) {
  const source = path.join(root, relativePath)
  if (!fs.existsSync(source)) {
    console.warn(`Skipping missing runtime asset: ${relativePath}`)
    continue
  }
  fs.cpSync(source, path.join(target, relativePath), { recursive: true, force: true, errorOnExist: false })
}

// ── config: never touched unless instructed ─────────────────────────────────
// A config.default.json that already exists at the target is left
// byte-for-byte untouched — no merging, no overwriting, no key backfill.
// Re-installing after a code update therefore cannot change a working
// deployment's configuration. The only way the installer writes that file
// is the explicit --replace-config flag, which resets the target config to
// this checkout's local config.default.json — the single source of truth for
// deployment model routing (gitignored, never committed). A checkout without
// one falls back to the committed public template config.example.json. The
// single exception that needs no instruction: a first install into a target
// that has no config yet receives config.default.json (local, or seeded from
// the example), because a mounted preset cannot run without one.
// The installer never rewrites the repository itself.

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const repoConfigPath = fs.existsSync(path.join(root, 'config.default.json'))
  ? path.join(root, 'config.default.json')
  : path.join(root, 'config.example.json')

if (hadExistingConfig && replaceConfig) {
  fs.copyFileSync(repoConfigPath, installedConfigPath)
  console.log('--replace-config: reset the existing config.default.json to this checkout\'s config (local config.default.json, or the config.example.json template).')
} else if (!hadExistingConfig) {
  fs.copyFileSync(repoConfigPath, installedConfigPath)
  console.log('Installed config.default.json (seeded from the checkout\'s local config, or config.example.json; the target had no config yet).')
}
if (hadExistingConfig && !replaceConfig) {
  console.log('config.default.json already exists at the target — left untouched. '
    + 'Use --replace-config to reset it to this checkout\'s config (local config.default.json, or the config.example.json template).')
}

// The deployed manifest describes the effective runtime files. The installed
// config.default.json is intentionally mutable, so update only the manifest's
// config slot (the public config.example.json entry); generated entries and
// aggregate identity remain immutable build facts.
const installedManifestPath = path.join(target, 'tools', 'build-manifest.json')
if (fs.existsSync(installedManifestPath) && fs.existsSync(installedConfigPath)) {
  const deployedManifest = readJson(installedManifestPath)
  if (deployedManifest.files && Object.prototype.hasOwnProperty.call(deployedManifest.files, 'config.example.json')) {
    deployedManifest.files['config.example.json'] = sha256File(installedConfigPath)
    fs.writeFileSync(installedManifestPath, JSON.stringify(deployedManifest, null, 2) + '\n')
    console.log('Updated deployed manifest hash for the effective config.default.json.')
  }
}

const deployedManifest = readJson(installedManifestPath)
const deployedEntries = new Set(Object.values(deployedManifest.entries ?? {}).map((entry) => path.basename(entry)))
const installedTools = path.join(target, 'tools')
for (const name of fs.readdirSync(installedTools)) {
  if (/^(autoresearch-core|linear|research-orchestrator)-[0-9a-f]{12}\.mjs$/.test(name) && !deployedEntries.has(name)) {
    fs.rmSync(path.join(installedTools, name), { force: true })
  }
}
const mismatches = []
for (const [relativePath, expectedHash] of Object.entries(deployedManifest.files ?? {})) {
  // The manifest's config slot tracks the public template; the installed
  // preset carries the effective deployment config as config.default.json.
  const probePath = relativePath === 'config.example.json' ? 'config.default.json' : relativePath
  const installedPath = path.join(target, probePath)
  if (!fs.existsSync(installedPath)) mismatches.push(relativePath + ': missing')
  else if (sha256File(installedPath) !== expectedHash) mismatches.push(relativePath + ': hash mismatch')
}
if (mismatches.length > 0) throw new Error('installed runtime verification failed: ' + mismatches.join('; '))
const aggregateHashes = Object.fromEntries((deployedManifest.aggregateScope ?? []).map((relativePath) => [relativePath, sha256File(path.join(target, relativePath))]))
const installedAggregateId = crypto.createHash('sha256').update(Object.entries(aggregateHashes).sort(([a], [b]) => byCodeUnit(a, b)).map(([relativePath, hash]) => relativePath + ':' + hash).join('\n')).digest('hex')
if (installedAggregateId !== deployedManifest.aggregateId) throw new Error('installed immutable aggregate mismatch: expected ' + deployedManifest.aggregateId + ', actual ' + installedAggregateId)
const installReceipt = {
  schemaVersion: 1,
  generation: deployedManifest.generation,
  aggregateId: deployedManifest.aggregateId,
  configSha256: sha256File(installedConfigPath),
  replaceConfig,
  cleanTarget,
  target,
  installedAt: new Date().toISOString(),
  verifiedFiles: Object.keys(deployedManifest.files ?? {}).length,
}
fs.writeFileSync(path.join(target, 'install-receipt.json'), JSON.stringify(installReceipt, null, 2) + '\n')

// Advisory only: report role models outside the effective recognized list.
// Read-only — nothing here changes any file.
const finalConfig = readJson(installedConfigPath)
const recognized = new Set(finalConfig._recognizedModels ?? [])
const usedModels = []
for (const [role, profile] of Object.entries(finalConfig.roleProfiles ?? {})) {
  if (profile?.model) usedModels.push([role, profile.model])
  for (const fallback of profile?.modelFallbacks ?? []) {
    const model = typeof fallback === 'string' ? fallback : fallback?.model
    if (model) usedModels.push([role + ' (fallback)', model])
  }
}
for (const [role, model] of usedModels) {
  if (!recognized.has(model)) {
    console.warn(`Note: ${role} uses "${model}", which this version's recognized-model list does not include. `
      + 'The config is left exactly as-is; if intentional, keep it in config.default.json (this checkout\'s source of truth).')
  }
}

console.log(`Installed preset runtime assets into ${target}`)
console.log('Start a new DSH session after installation so the preset generation is remounted.')
