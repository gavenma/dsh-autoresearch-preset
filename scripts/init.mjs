#!/usr/bin/env node
// First-run initializer for fresh clones of this preset.
//
// It greets the user and walks through the two things a new deployment must
// decide before mounting the preset:
//
//   1. Models — every research role defaults to deepseek-official/deepseek-v4-flash.
//      You may accept the defaults or pick a different model per role.
//   2. Linear — optional. The API key is verified against api.linear.app and
//      stored in the DSH credentials store ($DSH_HOME/.credentials.yaml).
//
// Nothing personal is written into the repository:
//   - model overrides differ from config.default.json -> config.local.json (git-ignored),
//     which scripts/install-preset.mjs merges into the installed preset;
//   - the Linear key -> $DSH_HOME/.credentials.yaml (created 0600, DSH-owned).
//
// Non-interactive terminals (CI, pipes) print the manual setup steps and exit 0.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultConfigPath = path.join(root, 'config.default.json')
const localConfigPath = path.join(root, 'config.local.json')
const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  ? path.resolve(process.env.DSH_HOME)
  : path.join(os.homedir(), '.dsh')
const credentialsPath = path.join(dshHome, '.credentials.yaml')
const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'

const banner = String.raw`
  ____  ___  _             _    _
 |  _ \| _ || |_   _  __ _| | _| | ___ ___  ___
 | | | |  _|| | | | |/ _  | |/ _ |/ _ / -_)/ -_)
 |_| |_|_|  |_| |_| \__,_|_|\__,_|\___|\___|\___|

 First-run setup for the AutoResearch DSH preset
`

const dim = (text) => (process.stdout.isTTY ? '\x1b[2m' + text + '\x1b[0m' : text)
const bold = (text) => (process.stdout.isTTY ? '\x1b[1m' + text + '\x1b[0m' : text)

function fail(message) {
  console.error('\n' + bold('init failed: ') + message)
  process.exit(1)
}

// ── terminal helpers ────────────────────────────────────────────────────────
// Lines are consumed from a queue instead of rl.question so that fast or
// pre-buffered input (paste, pty pipes) is never dropped between prompts, and
// EOF while a question is pending aborts loudly instead of exiting silently.

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const lineQueue = []
let pendingLine = null
let inputClosed = false
rl.on('line', (line) => {
  if (pendingLine) {
    const wait = pendingLine
    pendingLine = null
    wait(line)
  } else {
    lineQueue.push(line)
  }
})
rl.on('close', () => {
  inputClosed = true
  if (pendingLine) {
    const wait = pendingLine
    pendingLine = null
    wait(null)
  }
})

function eofAbort() {
  console.error('\nInput ended before setup completed. Nothing partial was left behind; re-run `npm run init`.')
  process.exit(1)
}

function readLine(promptText) {
  if (lineQueue.length > 0) {
    const line = lineQueue.shift()
    process.stdout.write(promptText + line + '\n')
    return Promise.resolve(line)
  }
  if (inputClosed) return Promise.resolve(null)
  process.stdout.write(promptText)
  return new Promise((resolve) => {
    pendingLine = resolve
  })
}

function ask(question, defaultValue) {
  const suffix = defaultValue !== undefined ? ' ' + dim('[' + defaultValue + ']') : ''
  return (async () => {
    const line = await readLine(question + suffix)
    if (line === null) eofAbort()
    const trimmed = line.trim()
    return trimmed === '' ? (defaultValue ?? '') : trimmed
  })()
}

function askYesNo(question, defaultValue = 'y') {
  const hint = defaultValue === 'y' ? '[Y/n]' : '[y/N]'
  return (async () => {
    const line = await readLine(question + ' ' + dim(hint))
    if (line === null) eofAbort()
    const t = line.trim().toLowerCase()
    if (t === '') return defaultValue === 'y'
    return t === 'y' || t === 'yes'
  })()
}

// Masked single-line input (for API keys) using raw TTY mode; falls back to a
// plain prompt when stdin is not a TTY.
function askMasked(question) {
  if (!process.stdin.isTTY) return ask(question)
  return new Promise((resolve) => {
    process.stdout.write(question)
    let value = ''
    const stdin = process.stdin
    const finish = (result) => {
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      if (stdin.isRaw) stdin.setRawMode(false)
      resolve(result)
    }
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 13 || byte === 10) {
          process.stdout.write('\n')
          finish(value)
        } else if (byte === 3) {
          process.stdout.write('\n')
          process.exit(130)
        } else if (byte === 127 || byte === 8) {
          if (value.length > 0) {
            value = value.slice(0, -1)
            process.stdout.write('\b \b')
          }
        } else if (byte >= 32) {
          value += String.fromCharCode(byte)
          process.stdout.write('*')
        }
      }
    }
    const onEnd = () => {
      process.stdout.write('\n')
      finish(null)
    }
    stdin.setRawMode(true)
    stdin.on('data', onData)
    stdin.on('end', onEnd)
  })
}

// ── credentials store ($DSH_HOME/.credentials.yaml) ────────────────────────

function yamlQuote(value) {
  // Single-quoted YAML scalar: safe for any API-key-shaped string.
  return "'" + String(value).replace(/'/g, "''") + "'"
}

/**
 * Insert or replace one ref in the version-1 credentials document. The file
 * format is strict (see @deepseek-ai/dsh-credentials-local): a top-level
 * `version: 1`, a `refs:` block of `REF: value` lines, and optionally a
 * `records:` block. This patcher only touches the one ref line it owns and
 * preserves everything else verbatim; it refuses to write a document it does
 * not recognize and prints the manual step instead.
 */
function upsertCredentialRef(ref, value) {
  const quoted = yamlQuote(value)
  const refLine = /^ {2}[A-Za-z_][A-Za-z0-9_]*:( .+)?$/
  let lines
  if (fs.existsSync(credentialsPath)) {
    lines = fs.readFileSync(credentialsPath, 'utf8').split('\n')
  } else {
    if (!fs.existsSync(dshHome)) {
      return { written: false, reason: 'DSH home not found' }
    }
    lines = ['version: 1', 'refs:']
  }

  if (!/^version: 1\s*$/.test(lines[0] ?? '')) {
    return { written: false, reason: 'unrecognized credentials document' }
  }
  const refsIdx = lines.findIndex((line) => /^refs:\s*$/.test(line))
  if (refsIdx === -1) {
    lines.splice(1, 0, 'refs:')
  }

  const existingIdx = lines.findIndex((line, i) => i > 1 && line.startsWith('  ' + ref + ':'))
  if (existingIdx !== -1) {
    lines[existingIdx] = '  ' + ref + ': ' + quoted
  } else {
    // Insert after the last existing ref line, or right after `refs:`.
    let insertAt = lines.slice(0, -1).findLastIndex((line, i) => i > 1 && refLine.test(line))
    if (insertAt === -1) insertAt = lines.findIndex((line) => /^refs:\s*$/.test(line))
    lines.splice(insertAt + 1, 0, '  ' + ref + ': ' + quoted)
  }

  fs.writeFileSync(credentialsPath, lines.join('\n'), { mode: 0o600 })
  fs.chmodSync(credentialsPath, 0o600)
  return { written: true }
}

// ── Linear key verification ─────────────────────────────────────────────────

async function probeLinear(key) {
  try {
    const response = await fetch(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ query: 'query { viewer { name } teams(first: 50) { nodes { key name } } }' }),
      signal: AbortSignal.timeout(10000),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.errors?.length) {
      const message = body?.errors?.[0]?.message ?? ('HTTP ' + response.status)
      return { ok: false, error: message }
    }
    return { ok: true, viewer: body?.data?.viewer?.name ?? 'unknown', teams: body?.data?.teams?.nodes ?? [] }
  } catch (error) {
    return { ok: false, error: error?.cause?.code ?? error?.message ?? String(error) }
  }
}

// ── config.local.json (user-local preset overrides) ─────────────────────────

function readLocalConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

function writeLocalConfig(local) {
  const stamp = {
    _comment: 'User-local preset overrides created by npm run init. Merged into the installed preset by scripts/install-preset.mjs; never commit this file.',
  }
  fs.writeFileSync(localConfigPath, JSON.stringify({ ...stamp, ...local }, null, 2) + '\n', { mode: 0o600 })
}

// ── steps ───────────────────────────────────────────────────────────────────

function preflight() {
  const problems = []
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (Number.isInteger(nodeMajor) && nodeMajor < 20) {
    problems.push('Node.js 20 or later is required (found ' + process.versions.node + ')')
  }
  if (!fs.existsSync(dshHome)) {
    problems.push('DSH home not found at ' + dshHome + ' — install DeepSeek Harness (DSH) first, then re-run npm run init')
  }
  return problems
}

async function modelStep(defaultConfig) {
  console.log(bold('\n1/2  Models'))
  console.log('Every research role currently defaults to: ' + (defaultConfig.roleProfiles ? 'see config.default.json' : ''))
  const roles = Object.keys(defaultConfig.roleProfiles ?? {})
  const recognized = new Set(defaultConfig._recognizedModels ?? [])
  const allDefault = roles.every((role) => defaultConfig.roleProfiles[role].model === 'deepseek-official/deepseek-v4-flash')
  if (allDefault) {
    console.log('   ' + dim(roles.length + ' roles -> deepseek-official/deepseek-v4-flash'))
  }
  const keepDefaults = await askYesNo('Keep the default model for every role?', 'y')
  const local = readLocalConfig()
  if (keepDefaults) {
    // Drop stale role overrides so the shipped defaults apply cleanly.
    if (local.roleProfiles) {
      delete local.roleProfiles
      writeLocalConfig(local)
      console.log(dim('Cleared any previous model overrides in config.local.json.'))
    } else {
      console.log(dim('Nothing to change — the preset will run on its shipped defaults.'))
    }
    return
  }

  local.roleProfiles = local.roleProfiles ?? {}
  let changed = 0
  for (const role of roles) {
    const current = defaultConfig.roleProfiles[role].model
    const answer = await ask('Model for ' + role + '?', current)
    const trimmed = answer.trim()
    if (!trimmed) continue
    if (!recognized.has(trimmed)) {
      console.log('   ' + dim(trimmed + ' is not in this deployment recognized-model list; double-check the provider/model string.'))
      const ok = await askYesNo('Use it anyway?', 'n')
      if (!ok) continue
    }
    if (trimmed !== current) {
      local.roleProfiles[role] = { ...local.roleProfiles[role], model: trimmed }
      changed++
    } else if (local.roleProfiles[role] && local.roleProfiles[role].model === current) {
      delete local.roleProfiles[role].model
    }
  }
  if (Object.keys(local.roleProfiles).length === 0) delete local.roleProfiles
  if (changed > 0) {
    writeLocalConfig(local)
    console.log('Wrote ' + changed + ' model override(s) to config.local.json (git-ignored). The installer merges it into the preset you mount.')
  } else {
    console.log(dim('No model changes.'))
  }
}

async function linearStep() {
  console.log(bold('\n2/2  Linear'))
  console.log(dim('Linear is the project tracker the preset mirrors each DAG node into. Skip it for local-only research.'))
  const useLinear = await askYesNo('Set up a Linear account?', 'n')
  if (!useLinear) {
    console.log(dim('Skipped — you can add a key any time by re-running npm run init.'))
    return
  }

  let key = ''
  for (;;) {
    const line = await askMasked('Paste your Linear API key (starts with lin_api_): ')
    if (line === null) eofAbort()
    key = line.trim()
    if (key) break
    console.log('A key is required to continue with Linear setup.')
  }

  const probe = await probeLinear(key)
  if (probe.ok) {
    console.log('Verified — workspace user ' + probe.viewer +
      (probe.teams.length > 0 ? ', teams: ' + probe.teams.map((t) => t.key + ' (' + t.name + ')').join(', ') : ''))
    console.log(dim('The preset resolves the Linear team from the plan or from a single-team workspace; pick one of the teams above when a project asks.'))
  } else {
    console.log('Could not verify the key: ' + probe.error)
    const ok = await askYesNo('Store it anyway?', 'n')
    if (!ok) {
      console.log(dim('Linear setup skipped — the key was not stored.'))
      return
    }
  }

  const result = upsertCredentialRef('LINEAR_API_KEY', key)
  if (result.written) {
    console.log('Stored LINEAR_API_KEY in ' + credentialsPath + ' (mode 0600).')
  } else if (result.reason === 'DSH home not found') {
    console.log('DSH home not found, so the key was not stored. After installing DSH, add this line under refs: in ' + credentialsPath + ':')
    console.log('  LINEAR_API_KEY: ' + yamlQuote(key))
  } else {
    console.log('The existing credentials file at ' + credentialsPath + ' is not the version-1 layout, so it was left untouched. Add this line under refs: manually:')
    console.log('  LINEAR_API_KEY: ' + yamlQuote(key))
  }
}

function printManualSteps(defaultConfig) {
  console.log(bold('\nNon-interactive terminal detected — here is the manual setup:'))
  console.log('')
  console.log('1) Models. Every role defaults to deepseek-official/deepseek-v4-flash in config.default.json.')
  console.log('   To change a role, create a git-ignored config.local.json, e.g.:')
  console.log(JSON.stringify({ roleProfiles: { research_planner: { model: 'provider/model' } } }, null, 2))
  console.log('   The installer merges config.local.json into the installed preset.')
  console.log('2) Linear (optional). Store your API key under refs: in ' + credentialsPath + ':')
  console.log('     version: 1')
  console.log('     refs:')
  console.log('       LINEAR_API_KEY: <your lin_api_... key>')
  console.log('3) Then run: npm run verify:snapshot && npm run install:preset -- <target>')
  console.log('   The installer never touches a config.default.json that already exists at the target;')
  console.log('   pass --apply-local to explicitly layer your config.local.json into it.')
  console.log('   (or re-run `npm run init` from an interactive terminal)')
  console.log('Recognized models in the shipped config: ' + (defaultConfig._recognizedModels ?? []).join(', '))
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(banner)
  if (!fs.existsSync(defaultConfigPath)) fail('config.default.json is missing from this checkout')
  const defaultConfig = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'))

  const problems = preflight()
  if (problems.length > 0) {
    for (const problem of problems) console.log('  ' + bold('!') + ' ' + problem)
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
    if (!interactive) {
      console.log('\nResolving the problems above will make re-running `npm run init` a guided flow.')
      process.exit(1)
    }
    const ok = await askYesNo('Continue anyway?', 'n')
    if (!ok) fail('aborting at preflight')
  }

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    printManualSteps(defaultConfig)
    rl.close()
    return
  }

  await modelStep(defaultConfig)
  await linearStep()
  rl.close()

  const localOverrides = fs.existsSync(localConfigPath)
  console.log(bold('\nDone. Next steps:'))
  console.log('  1. npm run verify:snapshot        # offline integrity check of the built preset')
  console.log('  2. npm run install:preset -- ' + path.join(dshHome, '.agent-presets', 'research') + (localOverrides ? ' --apply-local' : ''))
  if (localOverrides) {
    console.log('     --apply-local explicitly layers your config.local.json into the installed preset.')
  }
  console.log('     Note: the installer never touches a config.default.json that already exists at')
  console.log('     the target, so re-installing after an update can never change your setup.')
  console.log('  3. Start a NEW DSH session (restart the DSH process if the preset is already mounted)')
  console.log('Then open a research session in a project workspace and use the research-project skill.')
}

main().catch((error) => fail(error?.message ?? String(error)))
