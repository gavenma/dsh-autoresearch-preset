import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-install-'))
const result = await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts/install-preset.mjs'), path.join(target, 'research'), '--apply-local', '--clean-target'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('close', (code) => resolve({ code, stdout, stderr }))
})
assert.equal(result.code, 0, result.stderr)
const installed = path.join(target, 'research')
const manifest = JSON.parse(await fs.readFile(path.join(installed, 'tools/build-manifest.json'), 'utf8'))
const installedConfigBytes = await fs.readFile(path.join(installed, 'config.default.json'))
const installedConfig = JSON.parse(installedConfigBytes)
const configHash = createHash('sha256').update(installedConfigBytes).digest('hex')
assert.equal(manifest.files['config.default.json'], configHash)
assert.equal(Object.values(installedConfig.roleProfiles).every((profile) => profile.reasoningEffort === null), true)
assert.match(result.stdout, /Updated deployed manifest hash/)
const receipt = JSON.parse(await fs.readFile(path.join(installed, 'install-receipt.json'), 'utf8'))
assert.equal(receipt.generation, manifest.generation)
assert.equal(receipt.aggregateId, manifest.aggregateId)
assert.equal(receipt.configSha256, configHash)
assert.equal(receipt.applyLocal, true)
assert.equal(receipt.cleanTarget, true)
assert.equal(receipt.verifiedFiles, Object.keys(manifest.files).length)
const generatedBundles = (await fs.readdir(path.join(installed, 'tools'))).filter((name) => /^(autoresearch-core|linear|research-orchestrator)-[0-9a-f]{12}\.mjs$/.test(name))
assert.deepEqual(generatedBundles.sort(), Object.values(manifest.entries).map((entry) => path.basename(entry)).sort())
await fs.writeFile(path.join(installed, 'stale-unmanaged.txt'), 'remove me')
const preservedConfig = await fs.readFile(path.join(installed, 'config.default.json'))
const reinstall = await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts/install-preset.mjs'), installed, '--clean-target'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('close', (code) => resolve({ code, stdout, stderr }))
})
assert.equal(reinstall.code, 0, reinstall.stderr)
await assert.rejects(fs.access(path.join(installed, 'stale-unmanaged.txt')))
assert.deepEqual(await fs.readFile(path.join(installed, 'config.default.json')), preservedConfig)
assert.equal(JSON.parse(await fs.readFile(path.join(installed, 'install-receipt.json'), 'utf8')).cleanTarget, true)
await fs.rm(target, { recursive: true, force: true })
console.log('clean install manifest test passed')
