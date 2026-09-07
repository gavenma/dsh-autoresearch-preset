#!/usr/bin/env node
// One-time backfill (plan WS2.4, GRF-2026 SOD #8): generate node-output.json
// for already-accepted runs from their acceptance.json + accepted artifact,
// using the exact derivation the acceptance tool uses (imported from the
// generated bundle, never from src/). Deterministic, read-then-write, and it
// never modifies receipts. A run whose ledger already carries the same
// outputHash + nodeRevision is left untouched.
//
// Usage:
//   node scripts/backfill-ledgers.mjs <workspaceDir> [--dry-run] [runDir ...]
//
// Without explicit runDir arguments, every run under
// <workspaceDir>/.research-agent/runs/ that has a PASSing acceptance.json is
// processed in deterministic (sorted) order.
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { createLibraries } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const { deriveNodeOutputDocument } = createLibraries.helpers
if (typeof deriveNodeOutputDocument !== 'function') {
  throw new Error('Generated bundle does not expose helpers.deriveNodeOutputDocument — rebuild the preset first.')
}

async function readJsonIn(runDir, name) {
  try {
    return JSON.parse(await fs.readFile(path.join(runDir, name), 'utf8'))
  } catch {
    return null
  }
}

// Derive (or keep) the ledger for one run directory. Never touches
// acceptance.json or any other run file besides node-output.json.
export async function backfillRun(runDirAbs, { dryRun = false } = {}) {
  const receipt = await readJsonIn(runDirAbs, 'acceptance.json')
  if (!receipt || receipt.kind !== 'acceptance-receipt' || receipt.overall !== 'PASS') {
    return { ok: false, skipped: 'no PASSing acceptance receipt' }
  }
  const artifactName = typeof receipt.artifact?.path === 'string' && receipt.artifact.path.trim()
    ? receipt.artifact.path.trim()
    : (receipt.artifactFormat === 'markdown' ? 'final.md' : 'output.tex')
  if (path.isAbsolute(artifactName) || artifactName.split('/').includes('..') || artifactName.includes('\\')) {
    return { ok: false, skipped: 'accepted artifact path is unsafe: ' + artifactName }
  }
  let outputText
  try {
    outputText = await fs.readFile(path.join(runDirAbs, artifactName), 'utf8')
  } catch {
    return { ok: false, skipped: 'accepted artifact missing: ' + artifactName }
  }
  const contractFile = await readJsonIn(runDirAbs, 'node-contract.json')
  const nodeId = receipt.nodeId ?? contractFile?.nodeId ?? ''
  if (typeof nodeId !== 'string' || nodeId.trim() === '') {
    return { ok: false, skipped: 'node id unavailable (legacy unbound run)' }
  }
  const nodeRevision = Number.isInteger(receipt.nodeRevision) && receipt.nodeRevision > 0 ? receipt.nodeRevision : 1
  const ledger = deriveNodeOutputDocument({
    contract: { nodeId, artifactFormat: receipt.artifactFormat },
    artifactPath: artifactName,
    outputText,
    outputHash: String(receipt.outputHash ?? ''),
    nodeRevision,
    nodeId,
    contractDigest: String(receipt.nodeContractDigest ?? contractFile?.contractDigest ?? ''),
    criteria: receipt.criteria ?? [],
  })
  const existing = await readJsonIn(runDirAbs, 'node-output.json')
  const current = existing
    && existing.ledgerVersion === ledger.ledgerVersion
    && existing.outputHash === ledger.outputHash
    && existing.nodeRevision === ledger.nodeRevision
  if (current) return { ok: true, action: 'current', runDir: runDirAbs, ledger }
  if (dryRun) return { ok: true, action: 'would-write', runDir: runDirAbs, ledger }
  await fs.writeFile(path.join(runDirAbs, 'node-output.json'), JSON.stringify(ledger, null, 2) + '\n')
  return { ok: true, action: 'written', runDir: runDirAbs, ledger }
}

// Deterministically discover run directories (sorted) under the hidden root.
export async function discoverRuns(workspaceDir) {
  const runsRoot = path.join(workspaceDir, '.research-agent', 'runs')
  const found = []
  const walk = async (dir, depth) => {
    let entries
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      if ((await readJsonIn(full, 'acceptance.json')) !== null) {
        found.push(full)
      }
      if (depth < 8) await walk(full, depth + 1)
    }
  }
  await walk(runsRoot, 0)
  return found
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const rest = argv.filter((arg) => arg !== '--dry-run')
  if (rest.length < 1 || rest[0].startsWith('-')) {
    console.log('Usage: node scripts/backfill-ledgers.mjs <workspaceDir> [--dry-run] [runDir ...]')
    process.exit(2)
  }
  const workspace = path.resolve(rest[0])
  const targets = rest.length > 1
    ? rest.slice(1).map((target) => path.resolve(target))
    : await discoverRuns(workspace)
  if (targets.length === 0) {
    console.log('No accepted runs found under ' + path.join(workspace, '.research-agent', 'runs'))
    return
  }
  let written = 0
  let current = 0
  let skipped = 0
  let failed = 0
  for (const target of targets) {
    try {
      const result = await backfillRun(target, { dryRun })
      if (!result.ok) {
        console.log('skipped ' + target + ': ' + result.skipped)
        skipped += 1
      } else if (result.action === 'current') {
        console.log('current ' + target)
        current += 1
      } else if (result.action === 'would-write') {
        console.log('would-write ' + path.join(target, 'node-output.json'))
        written += 1
      } else {
        console.log('written ' + path.join(target, 'node-output.json'))
        written += 1
      }
    } catch (error) {
      console.log('failed ' + target + ': ' + error.message)
      failed += 1
    }
  }
  const summary = (dryRun ? 'dry-run complete' : 'backfill complete')
    + ': ' + written + ' ledger(s)' + (dryRun ? ' would be written' : ' written')
    + ', ' + current + ' already current, ' + skipped + ' skipped, ' + failed + ' failed'
  console.log(summary)
  if (failed > 0) process.exitCode = 1
}

const isMain = typeof process !== 'undefined'
  && typeof process.argv !== 'undefined'
  && process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) await main()
