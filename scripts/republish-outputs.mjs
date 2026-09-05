#!/usr/bin/env node
// Offline republish of a project's outputs/<projectId>/ folder (plan WS4
// item 6). Uses the EXACT tested publish core from the generated bundle —
// the same exposure computation, preflight, transactional staging, rollback
// journal, and MANIFEST v8 that finalize_run uses.
//
// Usage:
//   node scripts/republish-outputs.mjs --base-dir <workspace> --project-id <id> --source-root <runDir>
//       [--output-root outputs] [--deliverables-file <file.json>]
//       [--final-build-file <file.json>] [--write]
//
//   --base-dir           workspace root (contains the hidden project tree)
//   --project-id         the project to republish (must equal plan.projectId)
//   --source-root        the integration run directory to republish from
//                        (absolute, or relative to --base-dir)
//   --output-root        outputs root (default: outputs)
//   --deliverables-file  reviewed override JSON: { projectId, deliverables,
//                        diagnosticMappings?, rebuildable? }. NEVER written
//                        back to plan.json. Its presence makes the republish
//                        an explicit new-policy exposure, even for legacy
//                        (marker-absent) plans.
//   --final-build-file   reviewed finalBuild JSON: { sourcePath, sourceHash,
//                        flsPath?, flsHash?, pdfPath?, pdfHash? }. Verified
//                        (hashes recomputed) for reproducible TeX source
//                        packages; for PDF-only historical republish it
//                        verifies the accepted PDF and requires no .fls.
//   --write              actually publish (default is a dry run that prints
//                        the proposed MANIFEST and changes nothing).
//
// Safety: project-id mismatch is rejected; unsafe ids are rejected; unmanaged
// destination files are never pruned or clobbered (e.g. an existing GAV-*
// report directory stays exactly as it is); the publish is transactional with
// rollback, exactly like finalize.
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { createLibraries } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const { computePublishSet, publishProjectDeliverables, hashFile } = createLibraries.helpers
const core = createLibraries.core
const projectstate = createLibraries.projectstate
if (typeof computePublishSet !== 'function' || typeof publishProjectDeliverables !== 'function') {
  throw new Error('Generated bundle does not expose the publish core — rebuild the preset first.')
}

// Minimal node:fs-backed fops with the same interface the in-harness makeFops
// exposes (the publish core is fops-abstract).
function makeNodeFops() {
  return {
    async resolveTarget(p) { return path.isAbsolute(p) ? p : path.resolve(p) },
    async stat(p) { try { return await fs.stat(p) } catch { return undefined } },
    async lstat(p) {
      try { const info = await fs.lstat(p); return { type: info.isSymbolicLink() ? 'symlink' : (info.isDirectory() ? 'directory' : 'file') } } catch { return undefined }
    },
    async exists(p) { try { return (await fs.stat(p)) !== undefined } catch { return false } },
    async readText(p) { return await fs.readFile(p, 'utf8') },
    async readBytes(p, maxBytes) {
      const data = await fs.readFile(p)
      const copy = new Uint8Array(Math.min(data.length, maxBytes ?? data.length))
      copy.set(data.subarray(0, copy.length))
      return copy
    },
    async writeText(p, content) { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, content) },
    async writeJson(p, value) { await this.writeText(p, JSON.stringify(value, null, 2) + '\n') },
    async readJson(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')) } catch { return undefined } },
    async ensureDir(p) { await fs.mkdir(p, { recursive: true }) },
    async remove(p) { await fs.rm(p, { force: true }) },
    async removeTree(p) { await fs.rm(p, { recursive: true, force: true }) },
    async listDir(p) {
      try { return (await fs.readdir(p, { withFileTypes: true })).map((entry) => ({ name: entry.name, dir: entry.isDirectory() })).sort((a, b) => (a.name < b.name ? -1 : 1)) } catch { return [] }
    },
    async copy(source, destination) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(source, destination) },
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw new Error('unexpected argument: ' + arg)
    const key = arg.slice(2)
    if (key === 'write') { args.write = true; continue }
    const value = argv[++i]
    if (value === undefined) throw new Error('missing value for ' + arg)
    args[key] = value
  }
  return args
}

function readJsonFile(file) {
  try {
    return JSON.parse(fsSync.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error('cannot read JSON file ' + file + ': ' + error.message)
  }
}

export async function republish({ baseDir, projectId, sourceRoot, outputRoot = 'outputs', deliverablesFile = null, finalBuildFile = null, write = false, now = Date.now() }) {
  const fops = makeNodeFops()
  const idError = core.projectIdError(projectId)
  if (idError) throw new Error(idError)
  const sourceAbs = path.isAbsolute(sourceRoot) ? sourceRoot : path.resolve(baseDir, sourceRoot)
  const rel = path.relative(baseDir, sourceAbs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('--source-root must be inside --base-dir')
  try { await fops.stat(sourceAbs) } catch { throw new Error('--source-root does not exist: ' + sourceAbs) }

  const loadedPlan = await projectstate.loadPlan(fops, baseDir, projectId)
  if (!loadedPlan.ok) throw new Error(loadedPlan.error)
  if (loadedPlan.plan.projectId !== projectId) {
    throw new Error('project-id mismatch: --project-id ' + projectId + ' does not equal plan.projectId ' + loadedPlan.plan.projectId)
  }
  const plan = loadedPlan.plan
  const rawProject = (plan.projectContract && typeof plan.projectContract === 'object') ? plan.projectContract : {}
  const isNewPlan = rawProject.exposurePolicyVersion === 1

  let override = null
  if (deliverablesFile) {
    override = readJsonFile(deliverablesFile)
    if (!override || typeof override !== 'object') throw new Error('override file must be a JSON object')
    if (override.projectId !== undefined && override.projectId !== projectId) {
      throw new Error('override file projectId ' + override.projectId + ' does not match --project-id ' + projectId)
    }
    if (!Array.isArray(override.deliverables)) throw new Error('override file must carry a deliverables array')
  }

  let finalBuild = null
  let acceptance = null
  try {
    acceptance = await fops.readJson(path.join(sourceAbs, 'acceptance.json'))
    if (acceptance && typeof acceptance === 'object' && acceptance.finalBuild && typeof acceptance.finalBuild === 'object') finalBuild = acceptance.finalBuild
  } catch {}
  if (finalBuildFile) {
    const reviewed = readJsonFile(finalBuildFile)
    if (!reviewed || typeof reviewed !== 'object') throw new Error('final-build file must be a JSON object')
    for (const field of ['sourcePath', 'sourceHash']) {
      if (typeof reviewed[field] !== 'string' || !reviewed[field]) throw new Error('final-build file requires ' + field)
    }
    finalBuild = reviewed
  }

  const effectiveFinalBuild = finalBuild
  // Reviewed finalBuild verification for the record itself (hash recomputed
  // against the source root). rebuildable: true additionally requires the
  // recorder pair, enforced by the shared publish core.
  if (effectiveFinalBuild) {
    const srcHash = await hashFile(fops, path.join(sourceAbs, effectiveFinalBuild.sourcePath))
    if (srcHash !== effectiveFinalBuild.sourceHash) {
      throw new Error('finalBuild verification failed: sourcePath ' + effectiveFinalBuild.sourcePath + ' hash mismatch (recorded ' + String(effectiveFinalBuild.sourceHash).slice(0, 12) + '… now ' + (srcHash || 'missing').slice(0, 12) + '…)')
    }
    if (effectiveFinalBuild.pdfPath) {
      const pdfHash = await hashFile(fops, path.join(sourceAbs, effectiveFinalBuild.pdfPath))
      if (pdfHash !== effectiveFinalBuild.pdfHash) {
        throw new Error('finalBuild verification failed: pdfPath ' + effectiveFinalBuild.pdfPath + ' hash mismatch (recorded ' + String(effectiveFinalBuild.pdfHash).slice(0, 12) + '… now ' + (pdfHash || 'missing').slice(0, 12) + '…)')
      }
    }
  }

  const integrationId = plan.integrationId ?? 'integration'
  const integrationContract = core.nodeContract(plan, integrationId)
  const isTex = integrationContract.artifactFormat === 'tex'
  const mode = isNewPlan || override ? 'new' : 'legacy-adapter'

  let specs = []
  let mappings = []
  let rebuildable = false
  if (override) {
    specs = []
    const specErrors = []
    for (const entry of override.deliverables) {
      const parsed = core.parseDeliverableSpec(entry)
      if (parsed.ok) specs.push(parsed)
      else specErrors.push(parsed.error)
    }
    if (specErrors.length > 0) throw new Error('override deliverables: ' + specErrors.join('; '))
    mappings = Array.isArray(override.diagnosticMappings) ? override.diagnosticMappings : []
    rebuildable = override.rebuildable === true
  } else if (isNewPlan) {
    if (!Array.isArray(rawProject.deliverables)) throw new Error('exposure-policy plan requires an explicit deliverables array')
    const specErrors = []
    for (const entry of rawProject.deliverables) {
      const parsed = core.parseDeliverableSpec(entry)
      if (parsed.ok) specs.push(parsed)
      else specErrors.push(parsed.error)
    }
    if (specErrors.length > 0) throw new Error('plan deliverables: ' + specErrors.join('; '))
    mappings = Array.isArray(rawProject.diagnosticMappings) ? rawProject.diagnosticMappings : []
    rebuildable = rawProject.rebuildable === true
  }
  if (rebuildable && !effectiveFinalBuild) {
    throw new Error('rebuildable: true requires a finalBuild record (acceptance.json or --final-build-file)')
  }

  const computed = await computePublishSet({
    fops,
    baseDir,
    runDirAbs: sourceAbs,
    nodeRunDirs: [],
    mode,
    isTex,
    deliverableSpecs: specs,
    rebuildable,
    diagnosticMappings: mappings,
    acceptance: effectiveFinalBuild ? { ...acceptance, finalBuild: effectiveFinalBuild } : acceptance,
  })
  if (!computed.ok) throw new Error('republish preflight failed: ' + computed.errors.join('; '))

  const integrationRunRel = rel
  if (!write) {
    const preserved = []
    const projectDirAbs = path.join(baseDir, outputRoot, projectId)
    const walkInventory = async (dirAbs, relPrefix, depth) => {
      if (depth > 8) return
      let items = []
      try { items = await fops.listDir(dirAbs) } catch { return }
      for (const item of items) {
        const itemRel = relPrefix ? relPrefix + '/' + item.name : item.name
        if (item.dir) { await walkInventory(path.join(dirAbs, item.name), itemRel, depth + 1); continue }
        const hash = await hashFile(fops, path.join(dirAbs, item.name))
        if (hash !== '' && itemRel !== 'MANIFEST.json') preserved.push({ path: itemRel, hash })
      }
    }
    try { await fops.stat(projectDirAbs) } catch { /* not yet published */ }
    await walkInventory(projectDirAbs, '', 0)
    const proposed = {
      dryRun: true,
      mode,
      policyVersion: mode === 'legacy-adapter' ? 'legacy-adapter' : 1,
      projectId,
      outputDir: path.join(outputRoot, projectId),
      rebuildable,
      entries: computed.entries.map((entry) => ({
        path: entry.destinationPath,
        sourcePath: path.relative(baseDir, entry.sourceAbs).split(path.sep).join('/'),
        sourceRule: entry.rule,
        requiredBy: entry.requiredBy,
        hash: entry.hash,
      })),
      preservedExisting: preserved.filter((item) => !computed.entries.some((entry) => entry.destinationPath === item.path)),
      warnings: computed.warnings,
    }
    return proposed
  }

  const result = await publishProjectDeliverables(fops, baseDir, outputRoot, projectId, computed, {
    runId: 'republish-' + projectId,
    runRelDir: integrationRunRel,
    planRevision: plan.revision ?? null,
    artifactFormat: integrationContract.artifactFormat,
    rebuildable,
    integrationRunRel,
    now,
  })
  if (!result.ok) throw new Error('republish failed: ' + result.errors.join('; '))
  return { dryRun: false, ...result }
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    console.error('Usage: node scripts/republish-outputs.mjs --base-dir <workspace> --project-id <id> --source-root <runDir> [--output-root outputs] [--deliverables-file file.json] [--final-build-file file.json] [--write]')
    process.exit(2)
  }
  for (const required of ['base-dir', 'project-id', 'source-root']) {
    if (!args[required]) {
      console.error('missing required flag --' + required)
      process.exit(2)
    }
  }
  const baseDir = path.resolve(args['base-dir'])
  try {
    const result = await republish({
      baseDir,
      projectId: args['project-id'],
      sourceRoot: args['source-root'],
      outputRoot: args['output-root'] ?? 'outputs',
      deliverablesFile: args['deliverables-file'] ?? null,
      finalBuildFile: args['final-build-file'] ?? null,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error('republish: ' + error.message)
    process.exit(1)
  }
}

const isMain = typeof process !== 'undefined'
  && typeof process.argv !== 'undefined'
  && process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) await main()
