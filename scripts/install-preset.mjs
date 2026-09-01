#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destination = process.argv[2]
const freshConfig = process.argv.includes('--fresh-config')

if (!destination) {
  console.error('Usage: node scripts/install-preset.mjs <DSH_HOME/.agent-presets/research> [--fresh-config]')
  process.exit(2)
}

const target = path.resolve(destination)
fs.mkdirSync(target, { recursive: true })

// Only runtime assets are installed: the composition, preset metadata,
// default config, role prompts, skills, and the generated tools/ tree.
// Development and documentation files — src/, tests/, briefs/, docs/,
// scripts/, package.json, README/license/notice files, VCS/CI metadata — are
// never copied into a mounted preset. The config file is handled separately
// below: it is the one runtime asset a deployment is expected to customize,
// so re-installing merges instead of overwriting.
const runtimeAssets = ['agent.cordis.yml', 'preset.yml', 'roles', 'skills', 'tools']
for (const relativePath of runtimeAssets) {
  const source = path.join(root, relativePath)
  if (!fs.existsSync(source)) {
    console.warn(`Skipping missing runtime asset: ${relativePath}`)
    continue
  }
  fs.cpSync(source, path.join(target, relativePath), { recursive: true, force: true, errorOnExist: false })
}

// ── config: shipped defaults < installed deployment config < config.local.json ──
// Re-installing after a code update must never silently rewrite a deployment's
// configuration, so the installed config.default.json is layered over the
// shipped defaults (shipped values only fill in keys the deployment has not
// set yet) and config.local.json — the git-ignored local overrides created by
// `npm run init` — layers on top of both. The installer never rewrites the
// repository and never auto-migrates model choices; models that are no longer
// in the shipped recognized list are preserved and reported. Use
// --fresh-config to skip both local layers and install the shipped defaults
// verbatim.
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
const repoConfigPath = path.join(root, 'config.default.json')
const installedConfigPath = path.join(target, 'config.default.json')
const localConfigPath = path.join(root, 'config.local.json')

let config = readJson(repoConfigPath)
if (!freshConfig && fs.existsSync(installedConfigPath)) {
  try {
    config = mergePresetConfig(config, readJson(installedConfigPath))
    console.log('Preserved your existing installed configuration; shipped defaults only fill in keys it does not set.')
  } catch (error) {
    console.warn(`Existing ${installedConfigPath} is not valid JSON (${error.message}); installing the shipped defaults instead.`)
  }
}
if (!freshConfig && fs.existsSync(localConfigPath)) {
  config = mergePresetConfig(config, readJson(localConfigPath))
  console.log('Applied local overrides from config.local.json (git-ignored).')
}
fs.writeFileSync(installedConfigPath, JSON.stringify(config, null, 2) + '\n')
if (freshConfig) console.log('--fresh-config: installed the shipped defaults verbatim (both local layers skipped).')

// Advisory only: report role models outside the effective recognized list.
// They are preserved exactly as configured, never migrated.
const recognized = new Set(config._recognizedModels ?? [])
const usedModels = []
for (const [role, profile] of Object.entries(config.roleProfiles ?? {})) {
  if (profile?.model) usedModels.push([role, profile.model])
  for (const fallback of profile?.modelFallbacks ?? []) usedModels.push([role + ' (fallback)', fallback])
}
for (const [role, model] of usedModels) {
  if (!recognized.has(model)) {
    console.warn(`Note: ${role} uses "${model}", which this version's recognized-model list does not include. `
      + 'It is preserved as-is; if intentional, keep it in config.local.json so a fresh install still applies it.')
  }
}

console.log(`Installed preset runtime assets into ${target}`)
console.log('Start a new DSH session after installation so the preset generation is remounted.')
