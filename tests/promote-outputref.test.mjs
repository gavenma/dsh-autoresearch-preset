// Phase 3 (plan §13): role-produced output promotes without coordinator text
// reconstruction — the promotion authority consumes the recorded outputRef
// { path, hash, complete }, verifies the exact bytes, and (for bound runs)
// checks the destination against the contract's declared artifact path.
// Hash mismatches, partial outputs, symlinks, and undeclared destinations
// fail closed; same-hash replays are idempotent.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const bundle = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const { core } = bundle.createLibraries
const { promoteArtifact } = bundle.createLibraries.helpers

function makeFops() {
  const files = new Map()
  const symlinks = new Set()
  return {
    files,
    symlinks,
    async lstat(p) {
      if (symlinks.has(p)) return { type: 'symlink' }
      return files.has(p) ? { type: 'file' } : undefined
    },
    async readText(p) {
      if (!files.has(p)) throw new Error('not found: ' + p)
      return files.get(p)
    },
    // Matches the real fops contract: undefined for missing OR invalid JSON.
    async readJson(p) {
      try {
        return JSON.parse(files.get(p))
      } catch {
        return undefined
      }
    },
    async writeText(p, content, expected) {
      if (expected?.kind === 'createIfAbsent' && files.has(p)) {
        const error = new Error('file already exists')
        error.code = 'EEXIST'
        throw error
      }
      files.set(p, String(content))
    },
  }
}

const ARTIFACT = 'The complete research artifact body.\n'
const contractFile = {
  kind: 'node-contract',
  projectId: 'proj-1',
  projectName: 'Project',
  nodeId: 'node-1',
  contractDigest: 'contract-digest',
  artifactFormat: 'markdown',
  contract: { outputContract: { artifactPath: 'output/final.md' } },
}

// 1. Reference promotion: complete + hash-matched outputRef promotes the
//    exact bytes to the contract-declared destination.
{
  const fops = makeFops()
  const run = 'run'
  const sourcePath = run + '/pass_00/A.md'
  fops.files.set(sourcePath, ARTIFACT)
  fops.files.set(run + '/node-contract.json', JSON.stringify(contractFile))
  const outputRef = { path: 'pass_00/A.md', hash: core.sha256Text(ARTIFACT), complete: true }
  const result = await promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef, destinationPath: 'output/final.md' })
  assert.equal(result.ok, true)
  assert.equal(result.idempotent, false)
  assert.equal(result.hash, core.sha256Text(ARTIFACT))
  assert.equal(fops.files.get(run + '/output/final.md'), ARTIFACT, 'published bytes are the source bytes, unmodified')
  // Idempotent replay of the same reference.
  const replay = await promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef, destinationPath: 'output/final.md' })
  assert.equal(replay.ok, true)
  assert.equal(replay.idempotent, true)
}

// 2. Hash mismatch fails closed — the reference is bound to the attempt's
//    exact bytes; a different on-disk hash is a tamper or a stale reference.
{
  const fops = makeFops()
  const run = 'run'
  fops.files.set(run + '/pass_00/A.md', 'changed bytes\n')
  fops.files.set(run + '/node-contract.json', JSON.stringify(contractFile))
  await assert.rejects(
    () => promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef: { path: 'pass_00/A.md', hash: core.sha256Text('the original bytes\n'), complete: true }, destinationPath: 'output/final.md' }),
    /source hash mismatch/,
  )
  assert.equal(fops.files.has(run + '/output/final.md'), false, 'nothing is written on hash mismatch')
}

// 3. A partial (complete: false) reference cannot be promoted.
{
  const fops = makeFops()
  const run = 'run'
  fops.files.set(run + '/pass_00/A.md', 'partial\n')
  fops.files.set(run + '/node-contract.json', JSON.stringify(contractFile))
  await assert.rejects(
    () => promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef: { path: 'pass_00/A.md', hash: core.sha256Text('partial\n'), complete: false }, destinationPath: 'output/final.md' }),
    /not marked complete/,
  )
}

// 4. An outputRef without a hash is a field-specific error: reference
//    promotion is always hash-bound.
{
  const fops = makeFops()
  const run = 'run'
  fops.files.set(run + '/pass_00/A.md', 'body\n')
  fops.files.set(run + '/node-contract.json', JSON.stringify(contractFile))
  await assert.rejects(
    () => promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef: { path: 'pass_00/A.md', complete: true }, destinationPath: 'output/final.md' }),
    /outputRef\.hash is required/,
  )
  await assert.rejects(
    () => promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef: { hash: core.sha256Text('body\n'), complete: true }, destinationPath: 'output/final.md' }),
    /outputRef\.path is required/,
  )
}

// 5. Contract-bound runs may only promote to the declared artifact path (or
//    an internal packets/ path); anything else is rejected naming the
//    declared path.
{
  const fops = makeFops()
  const run = 'run'
  fops.files.set(run + '/pass_00/A.md', ARTIFACT)
  fops.files.set(run + '/node-contract.json', JSON.stringify(contractFile))
  const outputRef = { path: 'pass_00/A.md', hash: core.sha256Text(ARTIFACT), complete: true }
  await assert.rejects(
    () => promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef, destinationPath: 'elsewhere/final.md' }),
    (error) => /undeclared destination/.test(error.message) && error.message.includes('output/final.md'),
  )
  // The internal packets/ surface stays open (runner/coordinator artifacts).
  const packets = await promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef, destinationPath: 'packets/coordinator-accepted.md' })
  assert.equal(packets.ok, true)
  assert.equal(fops.files.get(run + '/packets/coordinator-accepted.md'), ARTIFACT)
  // Unbound runs (no node-contract.json) keep the legacy open destination.
  const fopsUnbound = makeFops()
  const run2 = 'run2'
  fopsUnbound.files.set(run2 + '/pass_00/A.md', ARTIFACT)
  const unbound = await promoteArtifact({ baseDir: '.', runDir: 'run2', fops: fopsUnbound, outputRef, destinationPath: 'final.md' })
  assert.equal(unbound.ok, true)
}

// 6. Symlinks fail closed on both sides.
{
  const fops = makeFops()
  const run = 'run'
  fops.files.set(run + '/pass_00/A.md', ARTIFACT)
  fops.files.set(run + '/node-contract.json', JSON.stringify(contractFile))
  fops.symlinks.add(run + '/pass_00/A.md')
  await assert.rejects(
    () => promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef: { path: 'pass_00/A.md', hash: core.sha256Text(ARTIFACT), complete: true }, destinationPath: 'output/final.md' }),
    /sourcePath must not be a symbolic link/,
  )
  const fops2 = makeFops()
  fops2.files.set(run + '/pass_00/A.md', ARTIFACT)
  fops2.files.set(run + '/node-contract.json', JSON.stringify(contractFile))
  fops2.symlinks.add(run + '/output/final.md')
  await assert.rejects(
    () => promoteArtifact({ baseDir: '.', runDir: 'run', fops: fops2, outputRef: { path: 'pass_00/A.md', hash: core.sha256Text(ARTIFACT), complete: true }, destinationPath: 'output/final.md' }),
    /destinationPath must not be a symbolic link/,
  )
}

// 7. A destination that exists with different bytes is a conflict (never
//    silently overwritten).
{
  const fops = makeFops()
  const run = 'run'
  fops.files.set(run + '/pass_00/A.md', ARTIFACT)
  fops.files.set(run + '/node-contract.json', JSON.stringify(contractFile))
  fops.files.set(run + '/output/final.md', 'some other bytes\n')
  await assert.rejects(
    () => promoteArtifact({ baseDir: '.', runDir: 'run', fops, outputRef: { path: 'pass_00/A.md', hash: core.sha256Text(ARTIFACT), complete: true }, destinationPath: 'output/final.md' }),
    /destination conflict/,
  )
}

console.log('promote-outputref tests passed for generation ' + manifest.generation)
