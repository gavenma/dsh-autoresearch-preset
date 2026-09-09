// P-031 / plan §9: a role timeout returns durable but UNACCEPTED artifact
// references — recoverable candidates with completion and hash status,
// never auto-accepted. The attempt record (contract-bound) persists as
// terminal with its outputRef, and a crash/relaunch recovers the same
// terminal outcome without relaunching the child.
import assert from 'node:assert/strict'
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const bundle = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const { makeRoleRunner, createLibraries } = bundle

function makeMemoryFops() {
  const files = new Map()
  const write = async (file, content, expected) => {
    const exists = files.has(file)
    if (expected?.kind === 'createIfAbsent' && exists) {
      const error = new Error('already exists')
      error.code = 'FS_NOT_OBSERVED'
      throw error
    }
    files.set(file, String(content))
    return { operation: exists ? 'update' : 'create', version: 'v1' }
  }
  return {
    files,
    async ensureDir() {},
    async exists(file) { return files.has(file) },
    async readText(file) {
      if (!files.has(file)) throw new Error('not found: ' + file)
      return files.get(file)
    },
    async readJson(file) {
      if (!files.has(file)) return undefined
      return JSON.parse(files.get(file))
    },
    async writeText(file, content, expected) { return write(file, content, expected) },
    async writeTextNew(file, content) { return write(file, content, { kind: 'createIfAbsent' }) },
    async writeJson(file, value, expected) { return write(file, JSON.stringify(value, null, 2) + '\n', expected) },
    async writeJsonNew(file, value) { return write(file, JSON.stringify(value, null, 2) + '\n', { kind: 'createIfAbsent' }) },
  }
}

function textResult(text, stopReason = 'completed') {
  return { output: text === '' ? [] : [{ type: 'text', text }], stopReason }
}

const runner = makeRoleRunner({
  pathutil: createLibraries.pathutil,
  util: createLibraries.util,
  core: createLibraries.core,
  previewLimit: 64,
  defaultMaxAttempts: 3,
  maxAttemptsCeiling: 5,
})
const base = {
  role: 'research_author',
  task: 'write the artifact',
  parent: { id: 'parent' },
  signal: new AbortController().signal,
  persona: 'role persona',
  toolFilter: { allow: ['read'] },
  agentOptions: { provider: 'acme', model: 'alpha' },
  outputMode: 'text',
  logicalGroupKey: { runDigest: 'run-1', projectId: 'proj-1', nodeId: 'node-1', contractDigest: 'contract-1', pass: 0, step: 'author', role: 'research_author', route: { provider: 'acme', model: 'alpha' } },
}

// ── 1. timeout returns a recoverable, unaccepted output reference ─────────
{
  const fops = makeMemoryFops()
  let starts = 0
  let timer = null
  let disposed = 0
  const startSubagent = async (request) => {
    starts += 1
    timer() // fire the scheduled timeout once the child is running
    return {
      id: 'hanging-child',
      localAgent: { options: request.agentOptions ?? {} },
      // The child never produces a result; only the timeout ends the attempt.
      result: new Promise((resolve) => {
        if (request.signal.aborted) resolve(textResult('', 'aborted'))
        else request.signal.addEventListener('abort', () => resolve(textResult('', 'aborted')), { once: true })
      }),
      async dispose() { disposed += 1 },
    }
  }
  const result = await runner.runRole({
    ...base,
    fops,
    runDir: '/run',
    startSubagent,
    maxAttempts: 1,
    timeoutMs: 25,
    createAbortController: () => new AbortController(),
    schedule(callback) { timer = callback; return () => {} },
  })
  assert.equal(result.outcomeClass, 'timeout')
  assert.equal(result.partialOutput, true, 'a timeout is partial, never a completion')
  assert.equal(result.stopReason, 'timeout')
  assert.equal(result.retryable, false, 'a timeout is never silently retried into acceptance')
  assert.ok(result.outputRef, 'the envelope carries a durable output reference')
  assert.equal(result.outputRef.complete, false, 'the timeout artifact is NEVER marked accepted')
  assert.match(result.outputRef.hash, /^[0-9a-f]{64}$/, 'the reference carries the content hash')
  assert.equal(typeof result.outputRef.path, 'string')
  assert.equal(disposed, 1, 'the hanging child was disposed')

  // The durable attempt record persists the same reference (hash status).
  const persisted = [...fops.files.entries()].filter(([file, value]) => file.endsWith('.json') && String(value).includes('"outputRef"'))
  assert.ok(persisted.length >= 1, 'the terminal attempt record is durable: ' + JSON.stringify([...fops.files.keys()]))
  const terminal = JSON.parse(persisted[0][1])
  assert.equal(terminal.status, 'terminal', 'the persisted attempt is terminal')
  assert.equal(terminal.outputRef.complete, false, 'the persisted record never claims acceptance')
  assert.equal(terminal.outputRef.hash, result.outputRef.hash, 'persisted and returned hashes agree')

  // No acceptance of any kind may be fabricated by the runner.
  for (const file of fops.files.keys()) {
    assert.ok(!file.includes('acceptance'), 'the runner must never write an acceptance record: ' + file)
  }

  // ── 2. crash/relaunch recovers the same terminal outcome, no re-run ──────
  const result2 = await runner.runRole({
    ...base,
    fops,
    runDir: '/run',
    startSubagent,
    maxAttempts: 1,
    timeoutMs: 25,
    createAbortController: () => new AbortController(),
    schedule(callback) { timer = callback; return () => {} },
  })
  assert.equal(result2.cached, true, 'the persisted terminal attempt is recovered')
  assert.equal(result2.outcomeClass, 'timeout')
  assert.equal(result2.outputRef.complete, false, 'the recovered reference stays unaccepted')
  assert.equal(result2.outputRef.hash, result.outputRef.hash, 'recovery returns the same hash-bound reference')
  assert.equal(starts, 1, 'no child relaunch after the terminal timeout')
  assert.equal(disposed, 1)
}

// ── 3. a partial provider-error attempt keeps the same discipline ─────────
{
  const fops = makeMemoryFops()
  const runs = {
    async startSubagent() {
      return {
        id: 'error-child',
        localAgent: { options: {} },
        result: Promise.resolve(textResult('partial prose before the failure', 'error')),
        async dispose() {},
      }
    },
  }
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 1 })
  assert.equal(result.outcomeClass, 'provider-error')
  assert.equal(result.outputRef.complete, false, 'a failed attempt is recoverable, never accepted')
  assert.ok(result.outputRef.hash.length === 64)
  for (const file of fops.files.keys()) assert.ok(!file.includes('acceptance'), 'no acceptance is fabricated: ' + file)
}

console.log('role timeout recovery passed for generation ' + manifest.generation)
