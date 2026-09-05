#!/usr/bin/env node
// Live smoke for the model fallback chain against the LOCAL Qwen endpoint
// (Layer 4 companion to scripts/live-smoke-fallback.mjs, which needs
// CMD_API_KEY). Same three cases, same real role runner (built bundle), but
// the subagent stub maps DSH agentOptions to chat-completions calls on
// 127.0.0.1:18038 (override with LOCAL_QWEN_BASE_URL).
//
// Cost guard: <= 4 small completions on a local model.
//
//   node scripts/live-smoke-local.mjs
//
// Cases:
//   A. Happy path on the local primary; breaker untouched.
//   B. Forced handoff: nonexistent model id -> provider error -> local model
//      succeeds.
//   C. Breaker skip: a second runRole in the same workspace starts on the
//      fallback directly (1 API call).

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const bundle = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const { makeRoleRunner, createLibraries } = bundle
const { pathutil, util, core } = createLibraries

const API = (process.env.LOCAL_QWEN_BASE_URL || 'http://127.0.0.1:18038/v1') + '/chat/completions'
const PROVIDER = 'local-qwen'
const PRIMARY = 'qwen3.8-27b-fp8'
// Chain entries are "provider/model"; the fallback is the same local model id.
const PRIMARY_CHAIN = [PROVIDER + '/' + PRIMARY, PROVIDER + '/' + PRIMARY]
const TASK = 'Reply with exactly: PONG'
const BASE = {
  role: 'research_author',
  task: TASK,
  logicalGroupKey: { runDigest: 'smoke', nodeId: 'smoke-node', step: 'smoke', role: 'research_author' },
}

let apiCalls = 0

function makeMemoryFops() {
  const files = new Map()
  const versions = new Map()
  let version = 0
  const write = async (file, content, expected) => {
    const exists = files.has(file)
    if (expected?.kind === 'createIfAbsent' && exists) {
      const error = new Error('already exists')
      error.code = 'FS_NOT_OBSERVED'
      throw error
    }
    if (expected?.kind === 'replaceIfVersion' && versions.get(file) !== expected.version) {
      const error = new Error('stale')
      error.code = 'FS_STALE_VERSION'
      throw error
    }
    version += 1
    files.set(file, String(content))
    versions.set(file, 'v' + version)
    return { operation: exists ? 'update' : 'create', version: 'v' + version, before: null, after: String(content) }
  }
  return {
    files,
    async ensureDir() {},
    async exists(file) { return files.has(file) },
    async readText(file) { if (!files.has(file)) throw new Error('not found: ' + file); return files.get(file) },
    async readJson(file) { if (!files.has(file)) return undefined; return JSON.parse(files.get(file)) },
    async writeText(file, content, expected) { return write(file, content, expected) },
    async writeTextIntent(file, content, expected) { return write(file, content, expected) },
    async writeTextNew(file, content) { return write(file, content, { kind: 'createIfAbsent' }) },
    async writeJson(file, value, expected) { return this.writeText(file, JSON.stringify(value, null, 2) + '\n', expected) },
    async statInfo(file) { return files.has(file) ? { version: versions.get(file), type: 'file' } : undefined },
    async listDir(dir) {
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const names = new Set()
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue
        const tail = file.slice(prefix.length)
        if (!tail || tail.includes('/')) continue
        names.add(tail)
      }
      return [...names].sort().map((name) => ({ name, dir: false }))
    },
  }
}

// Stub subagent: one real chat-completion call per attempt against the local
// endpoint. Non-2xx surfaces as a completed-with-error result (the same
// branch a real 429/404 hits).
function makeLiveSubagent() {
  let n = 0
  const startSubagent = async (request) => {
    n += 1
    const options = request.agentOptions ?? {}
    if (options.provider !== PROVIDER) throw new Error('smoke only speaks to ' + PROVIDER + '; got ' + String(options.provider))
    const task = (request.prompt ?? []).map((p) => p?.text ?? '').join('\n')
    let result
    try {
      apiCalls += 1
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: options.model, max_tokens: 300, messages: [{ role: 'user', content: task }] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        result = { output: [], stopReason: 'error', diagnostic: 'HTTP ' + res.status + ': ' + JSON.stringify(data).slice(0, 200) }
      } else {
        const message = data.choices?.[0]?.message ?? {}
        const text = message.content ?? ''
        result = text ? { output: [{ type: 'text', text }], stopReason: 'completed' } : { output: [], stopReason: 'error', diagnostic: 'empty completion' }
      }
    } catch (error) {
      result = { output: [], stopReason: 'error', diagnostic: String(error?.message ?? error) }
    }
    return {
      id: 'live-child-' + n,
      localAgent: { options },
      result: Promise.resolve(result),
      async dispose() {},
    }
  }
  return { startSubagent, get starts() { return n } }
}

const runner = makeRoleRunner({ pathutil, util, core, previewLimit: 4000, defaultMaxAttempts: 3, maxAttemptsCeiling: 5 })

// ── A. happy path on the local primary ──────────────────────────────────────
{
  const fops = makeMemoryFops()
  const live = makeLiveSubagent()
  const breakerPath = '/art/model-breaker.json'
  const result = await runner.runRole({ ...BASE, fops, runDir: '/run', startSubagent: live.startSubagent, agentOptions: { provider: PROVIDER, model: PRIMARY }, modelChain: PRIMARY_CHAIN, breakerPath, maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success', 'A: ' + JSON.stringify(result.diagnostic))
  assert.match(String(result.output ?? ''), /PONG/i, 'A: output must contain PONG')
  assert.equal(result.attempts.length, 1, 'A: primary must succeed on attempt 1')
  assert.equal(await fops.readJson(breakerPath), undefined, 'A: breaker must stay untouched')
  console.log('A. happy path on ' + PROVIDER + '/' + PRIMARY + ': OK (' + live.starts + ' API call(s))')
}

// ── B. forced handoff: nonexistent model -> local fallback ──────────────────
{
  const fops = makeMemoryFops()
  const live = makeLiveSubagent()
  const breakerPath = '/art/model-breaker.json'
  const result = await runner.runRole({
    ...BASE,
    fops,
    runDir: '/run',
    startSubagent: live.startSubagent,
    agentOptions: { provider: PROVIDER, model: 'does-not-exist-0' },
    modelChain: [PROVIDER + '/does-not-exist-0', PROVIDER + '/' + PRIMARY],
    breakerPath,
    maxAttempts: 3,
    logicalGroupKey: { ...BASE.logicalGroupKey, step: 'handoff' },
  })
  assert.equal(result.outcomeClass, 'success', 'B: ' + JSON.stringify(result.diagnostic))
  assert.equal(result.attempts.length, 2, 'B: attempt 1 provider-error, attempt 2 success')
  assert.equal(result.attempts[0].outcomeClass, 'provider-error')
  assert.equal(result.attempts[1].requestedModel, PRIMARY)
  assert.match(String(result.output ?? ''), /PONG/i, 'B: fallback output must contain PONG')
  const breaker = await fops.readJson(breakerPath)
  assert.equal(breaker.schemaVersion, 1, 'B: breaker file must be stamped schemaVersion 1')
  assert.ok(breaker.models[PROVIDER + '/does-not-exist-0'], 'B: breaker must record the failed model')
  console.log('B. forced handoff -> ' + PROVIDER + '/' + PRIMARY + ': OK (breaker recorded)')

  // ── C. breaker skip: the next run starts directly on the fallback ─────────
  const live2 = makeLiveSubagent()
  const result2 = await runner.runRole({
    ...BASE,
    fops,
    runDir: '/run',
    startSubagent: live2.startSubagent,
    agentOptions: { provider: PROVIDER, model: 'does-not-exist-0' },
    modelChain: [PROVIDER + '/does-not-exist-0', PROVIDER + '/' + PRIMARY],
    breakerPath,
    maxAttempts: 3,
    logicalGroupKey: { ...BASE.logicalGroupKey, step: 'handoff-skip' },
  })
  assert.equal(result2.outcomeClass, 'success', 'C: ' + JSON.stringify(result2.diagnostic))
  assert.equal(result2.attempts.length, 1, 'C: breaker-blocked primary must be skipped')
  assert.equal(result2.attempts[0].requestedModel, PRIMARY)
  assert.equal(live2.starts, 1, 'C: exactly one API call (the blocked model is never probed)')
  console.log('C. breaker skip across runs: OK (1 API call)')
}

console.log('LOCAL LIVE SMOKE PASSED — total API completions: ' + apiCalls)
