import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { createLibraries } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-visible-deliverables-'))
const fops = {
  async exists(target) { try { await fs.stat(target); return true } catch { return false } },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async readBytes(target) { return await fs.readFile(target) },
  async readJson(target) { try { return JSON.parse(await fs.readFile(target, 'utf8')) } catch { return undefined } },
  async writeText(target, content, options = {}) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, options.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
  },
  async writeTextNew(target, content) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, { flag: 'wx' })
  },
  async writeJson(target, value) { await this.writeText(target, JSON.stringify(value, null, 2) + '\n') },
  async ensureDir(target) { await fs.mkdir(target, { recursive: true }) },
  async remove(target) { await fs.rm(target, { force: true }) },
  async lstat(target) {
    try { const info = await fs.lstat(target); return { type: info.isSymbolicLink() ? 'symlink' : 'file' } } catch { return undefined }
  },
}

const result = await createLibraries.lifecycle.initRun(fops, {
  baseDir,
  issueId: 'visible-check',
  issueTitle: 'Visible deliverable check',
  sourceType: 'local',
}, path.join(root, 'config.default.json'))
assert.equal(result.artifactRoot, '.research-agent')
assert.equal(result.outputRoot, 'outputs')
assert.equal(result.runDir.startsWith('.research-agent/runs/'), true)
assert.equal(await fops.exists(path.join(baseDir, 'research-agent')), false)
assert.equal(await fops.exists(path.join(baseDir, '.research-agent', 'runs')), true)

const runDir = path.join(baseDir, result.runDir)
await fops.writeText(path.join(runDir, 'final.md'), '# Completed research\n')
const finalized = await createLibraries.lifecycle.finalizeRun(fops, { baseDir, runDir })
assert.equal(finalized.status, 'complete')
assert.equal(finalized.deliverables.length, 1)
assert.equal(finalized.deliverables[0].path, 'outputs/visible-check/final.md')
assert.equal(await fs.readFile(path.join(baseDir, 'outputs', 'visible-check', 'final.md'), 'utf8'), '# Completed research\n')
assert.equal(await fops.exists(path.join(baseDir, 'research-agent')), false)

await fs.rm(baseDir, { recursive: true, force: true })
console.log('hidden internals and visible deliverables test passed')
