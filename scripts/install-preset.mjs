#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destination = process.argv[2]
const applyLocal = process.argv.includes('--apply-local')
const replaceConfig = process.argv.includes('--replace-config')
const cleanTarget = process.argv.includes('--clean-target')

if (!destination) {
  console.error('Usage: node scripts/install-preset.mjs <DSH_HOME/.agent-presets/research> [--apply-local] [--replace-config] [--clean-target]')
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
// deployment's configuration. The only two ways the installer writes that
// file are explicit instructions given on the command line:
//   --apply-local    layer the git-ignored config.local.json (created by
//                    `npm run init`) over the target config;
//   --replace-config reset the target config to the shipped defaults first.
// The single exception that needs no instruction: a first install into a
// target that has no config yet receives the shipped config.default.json,
// because a mounted preset cannot run without one. The installer never
// rewrites the repository itself.
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mergePresetConfig(base, overlay) {
  const out = JSON.parse(JSON.stringify(base))
  for (const [key, value] of Object.entries(overlay)) {
    if (key.startsWith('_') && key !== '_recognizedModels') continue
    if (isObject(value) && isObject(out[key])) {
      for (const [subKey, subValue] of Object.entries(value)) {
        out[key][subKey] = isObject(subValue) && isObject(out[key][subKey])
          ? { ...out[key][subKey], ...subValue }
          : subValue
      }
    } else {
      out[key] = value
    }
  }
  return out
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const repoConfigPath = path.join(root, 'config.default.json')
const localConfigPath = path.join(root, 'config.local.json')

if (hadExistingConfig && replaceConfig) {
  fs.copyFileSync(repoConfigPath, installedConfigPath)
  console.log('--replace-config: reset the existing config.default.json to the shipped defaults.')
} else if (!hadExistingConfig) {
  fs.copyFileSync(repoConfigPath, installedConfigPath)
  console.log('Installed the shipped config.default.json (the target had no config yet).')
}
if (applyLocal) {
  if (!fs.existsSync(localConfigPath)) {
    console.warn('--apply-local given but config.local.json does not exist; the config is unchanged.')
  } else {
    const base = readJson(installedConfigPath)
    const merged = mergePresetConfig(base, readJson(localConfigPath))
    fs.writeFileSync(installedConfigPath, JSON.stringify(merged, null, 2) + '\n')
    console.log('Applied config.local.json (git-ignored) over the target config, as instructed with --apply-local.')
  }
}
if (hadExistingConfig && !replaceConfig && !applyLocal) {
  console.log('config.default.json already exists at the target — left untouched. '
    + 'Use --apply-local to layer your config.local.json in, or --replace-config to reset to the shipped defaults.')
}

// The deployed manifest describes the effective runtime files. A local overlay
// intentionally changes config.default.json, so update only that mutable file's
// hash; generated entries and aggregate identity remain immutable build facts.
const installedManifestPath = path.join(target, 'tools', 'build-manifest.json')
if (fs.existsSync(installedManifestPath) && fs.existsSync(installedConfigPath)) {
  const deployedManifest = readJson(installedManifestPath)
  if (deployedManifest.files && Object.prototype.hasOwnProperty.call(deployedManifest.files, 'config.default.json')) {
    deployedManifest.files['config.default.json'] = sha256File(installedConfigPath)
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
  const installedPath = path.join(target, relativePath)
  if (!fs.existsSync(installedPath)) mismatches.push(relativePath + ': missing')
  else if (sha256File(installedPath) !== expectedHash) mismatches.push(relativePath + ': hash mismatch')
}
if (mismatches.length > 0) throw new Error('installed runtime verification failed: ' + mismatches.join('; '))
const aggregateHashes = Object.fromEntries((deployedManifest.aggregateScope ?? []).map((relativePath) => [relativePath, sha256File(path.join(target, relativePath))]))
const installedAggregateId = crypto.createHash('sha256').update(Object.entries(aggregateHashes).sort(([a], [b]) => a.localeCompare(b)).map(([relativePath, hash]) => relativePath + ':' + hash).join('\n')).digest('hex')
if (installedAggregateId !== deployedManifest.aggregateId) throw new Error('installed immutable aggregate mismatch: expected ' + deployedManifest.aggregateId + ', actual ' + installedAggregateId)
const installReceipt = {
  schemaVersion: 1,
  generation: deployedManifest.generation,
  aggregateId: deployedManifest.aggregateId,
  configSha256: sha256File(installedConfigPath),
  applyLocal,
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
  for (const fallback of profile?.modelFallbacks ?? []) usedModels.push([role + ' (fallback)', fallback])
}
for (const [role, model] of usedModels) {
  if (!recognized.has(model)) {
    console.warn(`Note: ${role} uses "${model}", which this version's recognized-model list does not include. `
      + 'The config is left exactly as-is; if intentional, keep it in config.local.json (apply with --apply-local).')
  }
}

console.log(`Installed preset runtime assets into ${target}`)
console.log('Start a new DSH session after installation so the preset generation is remounted.')
