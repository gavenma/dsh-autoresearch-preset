import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const bundle = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const { makeRoleRunner, createLibraries } = bundle
assert.equal(typeof makeRoleRunner, 'function')
assert.equal(typeof createLibraries.makeRoleRunner, 'function')

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
    async readText(file) {
      if (!files.has(file)) throw new Error('not found: ' + file)
      return files.get(file)
    },
    async readJson(file) {
      if (!files.has(file)) return undefined
      return JSON.parse(files.get(file))
    },
    async writeText(file, content, expected) { return write(file, content, expected) },
    async writeTextIntent(file, content, expected) { return write(file, content, expected) },
    async writeTextNew(file, content) { return write(file, content, { kind: 'createIfAbsent' }) },
    async writeJson(file, value, expected) { return write(file, JSON.stringify(value, null, 2) + '\n', expected) },
    async writeJsonNew(file, value) { return write(file, JSON.stringify(value, null, 2) + '\n', { kind: 'createIfAbsent' }) },
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

function textResult(text, stopReason = 'completed', extra = {}) {
  return { output: text === '' ? [] : [{ type: 'text', text }], stopReason, ...extra }
}

function makeRuns(script, options = {}) {
  let index = 0
  const requests = []
  const disposals = []
  const startSubagent = async (request) => {
    requests.push(request)
    const step = script[index++] ?? script[script.length - 1]
    if (step?.startError) throw step.startError
    const run = {
      id: 'child-' + index,
      localAgent: { options: request.agentOptions ?? {} },
      result: step?.result instanceof Promise ? step.result : Promise.resolve(step?.result ?? textResult('ok')),
      async dispose() {
        disposals.push(index)
        if (step?.disposeError) throw step.disposeError
      },
    }
    return run
  }
  return { startSubagent, requests, disposals, get starts() { return index }, options }
}

const runner = makeRoleRunner({
  pathutil: createLibraries.pathutil,
  util: createLibraries.util,
  core: createLibraries.core,
  previewLimit: 12,
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
  agentOptions: { provider: 'acme', model: 'alpha', maxTokens: 1234 },
  outputMode: 'text',
  logicalGroupKey: { runDigest: 'run-1', nodeId: 'node-1', step: 'author', role: 'research_author', route: { provider: 'acme', model: 'alpha' } },
}

{
  const fops = makeMemoryFops()
  const events = []
  let followups = 0
  const localAgent = {
    options: { provider: 'acme', model: 'alpha' },
    session: { events },
    followup(message) {
      assert.equal(message.role, 'user')
      followups += 1
      events.push(
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'continued complete output' }] } } },
        { type: 'turn/end', data: { reason: { kind: 'completed' } } },
      )
    },
    async whenIdle() {},
  }
  const runs = {
    requests: [],
    disposals: 0,
    starts: 0,
    async startSubagent(request) {
      this.requests.push(request)
      this.starts += 1
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'partial output' }] } } })
      return { id: 'same-child', localAgent, result: Promise.resolve(textResult('partial output', 'max-tokens')), async dispose() { runs.disposals += 1 } }
    },
  }
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent.bind(runs), maxAttempts: 1 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.sameChildRetry, true)
  assert.equal(result.firstStopReason, 'max-tokens')
  assert.equal(result.output, 'continued co')
  assert.equal(result.outputRef.complete, true)
  assert.equal(result.outputRef.length, 25)
  assert.equal(runs.starts, 1)
  assert.equal(followups, 1)
  assert.equal(runs.disposals, 1)
}

{
  const fops = makeMemoryFops()
  const events = []
  const localAgent = {
    options: { provider: 'acme', model: 'alpha' },
    session: { events },
    followup() {
      events.push({ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } })
    },
    async whenIdle() {},
  }
  const runs = makeRuns([{ result: textResult('partial output', 'max-tokens') }])
  const startSubagent = async (request) => ({ ...(await runs.startSubagent(request)), localAgent })
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent, maxAttempts: 1 })
  assert.equal(result.outcomeClass, 'max-tokens')
  assert.equal(result.outputRef.complete, false)
  assert.equal(result.sameChildRetry, true)
  assert.equal(result.output, '')
  assert.equal(result.firstOutputPreview, 'partial outp')
}

{
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: textResult('complete output') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 1, maxTokens: 200000, resolveModelDefault: async () => 128000 })
  assert.equal(result.requestedMaxTokens, 128000)
  assert.equal(result.configuredMaxTokens, 200000)
  assert.equal(result.modelDefaultMaxTokens, 128000)
  assert.equal(result.maxTokensSource, 'configured-cap')
  assert.equal(runs.requests[0].agentOptions.maxTokens, 128000)
}

{
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: textResult('', 'error') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 3 })
  assert.equal(result.outcomeClass, 'provider-error')
  assert.equal(result.attempts.length, 3)
  assert.equal(runs.starts, 3)
  assert.equal(runs.requests[0].agentOptions.provider, 'acme')
  assert.equal(runs.requests[1].agentOptions.model, 'alpha')
  assert.equal(runs.requests[2].agentOptions.maxTokens, 1234)
  assert.equal(result.outputRef.complete, false)
  assert.equal(result.diagnosticUnavailable, true)
}

{
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: textResult('', 'error') }, { result: textResult('complete output') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 3 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts.length, 2)
  assert.equal(result.attempts[0].outcomeClass, 'provider-error')
  assert.equal(result.outputRef.complete, true)
  assert.equal(result.outputPreview, 'complete out')
  const cached = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: async () => { throw new Error('must not spawn') }, maxAttempts: 3 })
  assert.equal(cached.cached, true)
  assert.equal(cached.attempts.length, 2)
}

{
  const fops = makeMemoryFops()
  const rejection = new Error('transport unavailable')
  const runs = makeRuns([{ result: Promise.reject(rejection) }, { result: textResult('after retry') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts[0].outcomeClass, 'infrastructure-result')
  assert.equal(result.attempts[0].diagnostic, 'Error: transport unavailable')
}

{
  const fops = makeMemoryFops()
  const runs = makeRuns([{ disposeError: new Error('dispose failed'), result: textResult('ok') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 1 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.cleanupDegraded, true)
  assert.match(result.cleanupError, /dispose failed/)
}

{
  const fops = makeMemoryFops()
  const runs = makeRuns([textResult('not JSON', 'error')])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, outputMode: 'schema', outputSchema: { type: 'object', properties: { ranking: { type: 'string' } }, required: ['ranking'], additionalProperties: false }, maxAttempts: 3 })
  assert.equal(result.outcomeClass, 'schema-miss')
  assert.equal(result.attempts.length, 1)
  assert.equal(runs.starts, 1)
}

{
  const fops = makeMemoryFops()
  const controller = new AbortController()
  const runs = makeRuns([{ result: textResult('', 'aborted') }])
  const result = await runner.runRole({ ...base, fops, signal: controller.signal, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 3 })
  assert.equal(result.outcomeClass, 'aborted')
  assert.equal(result.attempts.length, 1)
}

{
  const fops = makeMemoryFops()
  const runs = makeRuns([{ startError: new Error('start rejected') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 1 })
  assert.equal(result.outcomeClass, 'infrastructure-start')
  assert.equal(runs.disposals.length, 0)
}

{
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: { output: [{ type: 'text', text: 'structured reply' }], structured: { ranking: 'A' }, stopReason: 'completed' } }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, outputMode: 'schema', outputSchema: { type: 'object', properties: { ranking: { type: 'string' } }, required: ['ranking'], additionalProperties: false }, maxAttempts: 1 })
  const recordPath = '/run/packets/role-attempts/' + result.logicalGroupId + '/attempt-01.json'
  assert.notEqual(result.outputRef.path, recordPath)
  assert.deepEqual(JSON.parse(fops.files.get(result.outputRef.path)), { ranking: 'A' })
  assert.equal(result.outputRef.hash, createLibraries.core.sha256Text(fops.files.get(result.outputRef.path)))
  assert.ok(fops.files.has(recordPath))
}

{
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: { output: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }], stopReason: 'completed' } }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 1 })
  assert.equal(result.outputPreview, 'first\nsecond')
  assert.equal(fops.files.get(result.outputRef.path), 'first\nsecond')
}

{
  const fops = makeMemoryFops()
  const groupId = runner.logicalId(base.logicalGroupKey)
  const groupDir = '/run/packets/role-attempts/' + groupId
  const outputPath = groupDir + '/attempt-01.output.txt'
  fops.files.set(outputPath, 'recovered')
  fops.files.set(groupDir + '/attempt-01.json', JSON.stringify({ logicalGroupId: groupId, attemptNumber: 1, attemptId: 'attempt-01', role: base.role, outcomeClass: 'success', stopReason: 'completed', retryable: false, output: 'recovered', outputPreview: 'recovered', outputLength: 9, partialOutput: false, outputRef: { path: outputPath, hash: createLibraries.core.sha256Text('recovered'), length: 9, complete: true }, structured: null, cleanupDegraded: false, cleanupError: null, status: 'terminal' }))
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: async () => { throw new Error('must discover the record') }, maxAttempts: 1 })
  assert.equal(result.cached, true)
  assert.equal(result.output, 'recovered')
}

{
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: textResult('', 'error') }])
  const first = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, maxAttempts: 1 })
  assert.equal(first.outcomeClass, 'provider-error')
  assert.equal((await fops.readJson('/run/packets/role-attempts/' + first.logicalGroupId + '/claim.json')).status, 'released')
  const cached = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: async () => { throw new Error('terminal failure must not relaunch') }, maxAttempts: 1 })
  assert.equal(cached.cached, true)
  assert.equal(cached.outcomeClass, 'provider-error')
}

{
  const fops = makeMemoryFops()
  let timer = null
  let disposeCount = 0
  const startSubagent = async (request) => {
    timer()
    return {
      id: 'hanging-child',
      localAgent: { options: request.agentOptions ?? {} },
      result: new Promise((resolve) => {
        if (request.signal.aborted) resolve(textResult('', 'aborted'))
        else request.signal.addEventListener('abort', () => resolve(textResult('', 'aborted')), { once: true })
      }),
      async dispose() { disposeCount += 1 },
    }
  }
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent, maxAttempts: 1, timeoutMs: 25, createAbortController: () => new AbortController(), schedule(callback) { timer = callback; return () => {} } })
  assert.equal(result.outcomeClass, 'timeout')
  assert.equal(disposeCount, 1)
}

// ── model fallback chain + per-workspace breaker ──────────────────────────────

{
  // A route failure on the primary steps to the next chain entry in the same
  // run; per-attempt routing and non-model options (maxTokens) are preserved.
  const fops = makeMemoryFops()
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']
  const runs = makeRuns([{ result: textResult('', 'error') }, { result: textResult('done via the fallback') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: chain, maxAttempts: 3 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts.length, 2)
  assert.equal(result.attempts[0].outcomeClass, 'provider-error')
  assert.equal(result.attempts[1].outcomeClass, 'success')
  assert.equal(runs.requests[0].agentOptions.provider, 'acme')
  assert.equal(runs.requests[0].agentOptions.model, 'alpha')
  assert.equal(runs.requests[1].agentOptions.provider, 'acme-beta')
  assert.equal(runs.requests[1].agentOptions.model, 'labs/model-x')
  assert.equal(runs.requests[1].agentOptions.maxTokens, 1234)
  assert.equal(runs.starts, 2)
}

{
  // provider-error WITH partial output is terminal today; with a fallback
  // chain it hands off to the next model instead of failing the role.
  const fops = makeMemoryFops()
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']
  const runs = makeRuns([{ result: textResult('partial output before the cut', 'error') }, { result: textResult('recovered on fallback') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: chain, maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts.length, 2)
  assert.equal(result.attempts[0].outcomeClass, 'provider-error')
  assert.equal(result.attempts[0].retryable, false)
  assert.equal(runs.requests[1].agentOptions.model, 'labs/model-x')
}

{
  // A route failure persists a breaker entry; a later role run (different
  // group) skips the breaker-blocked primary and starts on the fallback.
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']
  const runs1 = makeRuns([{ result: textResult('', 'error') }])
  const first = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs1.startSubagent, modelChain: chain, breakerPath, maxAttempts: 1 })
  assert.equal(first.outcomeClass, 'provider-error')
  const breaker = await fops.readJson(breakerPath)
  assert.equal(breaker.schemaVersion, 1, 'writer stamps schemaVersion on a fresh file')
  const entry = breaker.models['acme/alpha']
  assert.ok(entry && Number.isFinite(entry.blockedUntilMs) && entry.blockedUntilMs > 0)
  assert.equal(entry.lastOutcome, 'provider-error')
  const runs2 = makeRuns([{ result: textResult('the fallback picked up') }])
  const second = await runner.runRole({
    ...base,
    role: 'research_scout',
    fops,
    runDir: '/run',
    startSubagent: runs2.startSubagent,
    logicalGroupKey: { runDigest: 'run-1', nodeId: 'node-1', step: 'scout', role: 'research_scout' },
    modelChain: chain,
    breakerPath,
    maxAttempts: 2,
  })
  assert.equal(second.outcomeClass, 'success')
  assert.equal(runs2.starts, 1)
  assert.equal(runs2.requests[0].agentOptions.provider, 'acme-beta')
  assert.equal(runs2.requests[0].agentOptions.model, 'labs/model-x')
  const breakerAfter = await fops.readJson(breakerPath)
  assert.ok(breakerAfter.models['acme/alpha'], 'a fallback success must not clear the primary breaker entry')
}

{
  // While the cooldown is active a fresh run skips the primary; after it
  // expires the preferred model returns to the front of the chain, and a
  // success on it clears the breaker entry.
  let now = 1_000_000
  const clocked = makeRoleRunner({ pathutil: createLibraries.pathutil, util: createLibraries.util, core: createLibraries.core, nowMs: () => now, previewLimit: 12, defaultMaxAttempts: 3, maxAttemptsCeiling: 5 })
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']
  fops.files.set(breakerPath, JSON.stringify({ schemaVersion: 1, models: { 'acme/alpha': { blockedUntilMs: 2_000_000, lastOutcome: 'provider-error', lastAt: '1970-01-01T00:00:00.000Z', failures: 1 } } }, null, 2) + '\n')
  const runs1 = makeRuns([{ result: textResult('still on the fallback') }])
  const r1 = await clocked.runRole({ ...base, fops, runDir: '/run', startSubagent: runs1.startSubagent, logicalGroupKey: { runDigest: 'run-1', nodeId: 'node-1', step: 'a', role: 'research_author' }, modelChain: chain, breakerPath, maxAttempts: 1 })
  assert.equal(r1.outcomeClass, 'success')
  assert.equal(runs1.requests[0].agentOptions.model, 'labs/model-x')
  now = 2_500_000
  const runs2 = makeRuns([{ result: textResult('primary is back') }])
  const r2 = await clocked.runRole({ ...base, fops, runDir: '/run', startSubagent: runs2.startSubagent, logicalGroupKey: { runDigest: 'run-1', nodeId: 'node-1', step: 'b', role: 'research_author' }, modelChain: chain, breakerPath, maxAttempts: 1 })
  assert.equal(r2.outcomeClass, 'success')
  assert.equal(runs2.requests[0].agentOptions.provider, 'acme')
  assert.equal(runs2.requests[0].agentOptions.model, 'alpha')
  const breakerAfter = await fops.readJson(breakerPath)
  assert.equal(breakerAfter.models['acme/alpha'], undefined, 'a success on the model must clear its breaker entry')
}

{
  // Chain exhaustion: every model is tried, then the last model keeps the
  // legacy retry budget; the terminal diagnostic names the exhaustion and
  // the breaker records every failed model.
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']
  const runs = makeRuns([{ result: textResult('', 'error') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: chain, breakerPath, maxAttempts: 3 })
  assert.equal(result.outcomeClass, 'provider-error')
  assert.equal(result.attempts.length, 3)
  assert.equal(runs.requests[0].agentOptions.model, 'alpha')
  assert.equal(runs.requests[1].agentOptions.model, 'labs/model-x')
  assert.equal(runs.requests[2].agentOptions.model, 'labs/model-x')
  assert.match(result.diagnostic, /model fallback chain exhausted/)
  const breaker = await fops.readJson(breakerPath)
  assert.ok(breaker.models['acme/alpha'])
  assert.ok(breaker.models['acme-beta/labs/model-x'])
}

{
  // A bare model fallback (no provider) rides the session provider: the
  // primary's provider key must be stripped from the attempt options.
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: textResult('', 'error') }, { result: textResult('local pick up') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'bare-fallback'], maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(runs.requests[1].agentOptions.model, 'bare-fallback')
  assert.equal(runs.requests[1].agentOptions.provider, undefined)
}

{
  // Concurrent role runs racing the same breaker file: CAS retries must keep
  // the file valid JSON with the failed model recorded (advisory state, no
  // lost-update crash).
  const fops = makeMemoryFops()
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']
  const a = makeRuns([{ result: textResult('', 'error') }])
  const b = makeRuns([{ result: textResult('', 'error') }])
  const [ra, rb] = await Promise.all([
    runner.runRole({ ...base, fops, runDir: '/run', startSubagent: a.startSubagent, logicalGroupKey: { runDigest: 'run-1', nodeId: 'n', step: 'x', role: 'research_author' }, modelChain: chain, breakerPath: '/art/model-breaker.json', maxAttempts: 1 }),
    runner.runRole({ ...base, fops, runDir: '/run', startSubagent: b.startSubagent, logicalGroupKey: { runDigest: 'run-1', nodeId: 'n', step: 'y', role: 'research_author' }, modelChain: chain, breakerPath: '/art/model-breaker.json', maxAttempts: 1 }),
  ])
  assert.equal(ra.outcomeClass, 'provider-error')
  assert.equal(rb.outcomeClass, 'provider-error')
  const breaker = JSON.parse(fops.files.get('/art/model-breaker.json'))
  assert.ok(Number.isFinite(breaker.models['acme/alpha'].blockedUntilMs))
}

// ── L2: classification paths, negatives, resilience ──────────────────────────

{
  // infrastructure-start (spawn itself throws) is a route failure: hands off.
  const fops = makeMemoryFops()
  const runs = makeRuns([{ startError: new Error('provider "nope" is not recognized') }, { result: textResult('ok on fallback') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts[0].outcomeClass, 'infrastructure-start')
  assert.equal(runs.requests[1].agentOptions.model, 'labs/model-x')
}

{
  // infrastructure-result (result promise rejects) is a route failure: hands off.
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: Promise.reject(new Error('transport down')) }, { result: textResult('ok after reject') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts[0].outcomeClass, 'infrastructure-result')
  assert.equal(runs.requests[1].agentOptions.model, 'labs/model-x')
}

{
  // NEGATIVE: content-level outcomes must never touch the fallback chain —
  // same model stays, and NO breaker entry is written.
  const breakerPath = '/art/model-breaker.json'
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']

  // timeout (hanging child)
  {
    const fops = makeMemoryFops()
    let timer = null
    const startSubagent = async (request) => {
      timer()
      return {
        id: 'hang',
      localAgent: { options: request.agentOptions ?? {} },
      result: new Promise((resolve) => {
        if (request.signal.aborted) resolve(textResult('', 'aborted'))
        else request.signal.addEventListener('abort', () => resolve(textResult('', 'aborted')), { once: true })
      }),
      async dispose() {},
    }
  }
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent, modelChain: chain, breakerPath, maxAttempts: 1, timeoutMs: 25, createAbortController: () => new AbortController(), schedule(callback) { timer = callback; return () => {} } })
    assert.equal(result.outcomeClass, 'timeout')
    assert.equal(result.attempts.length, 1)
    assert.equal(await fops.readJson(breakerPath), undefined, 'timeout must not write a breaker entry')
  }
  // refusal
  {
    const fops = makeMemoryFops()
    const runs = makeRuns([{ result: textResult('I refuse', 'refusal') }])
    const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: chain, breakerPath, maxAttempts: 3 })
    assert.equal(result.outcomeClass, 'refusal')
    assert.equal(result.attempts.length, 1)
    assert.equal(runs.starts, 1, 'refusal must not consume the fallback')
    assert.equal(await fops.readJson(breakerPath), undefined, 'refusal must not write a breaker entry')
  }
  // schema-miss
  {
    const fops = makeMemoryFops()
    const runs = makeRuns([{ result: textResult('not JSON', 'completed') }])
    const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, outputMode: 'schema', outputSchema: { type: 'object', properties: { ranking: { type: 'string' } }, required: ['ranking'], additionalProperties: false }, modelChain: chain, breakerPath, maxAttempts: 3 })
    assert.equal(result.outcomeClass, 'schema-miss')
    assert.equal(result.attempts.length, 1)
    assert.equal(await fops.readJson(breakerPath), undefined, 'schema-miss must not write a breaker entry')
  }
}

{
  // Corrupt breaker file: treated as empty (preferred model tried first),
  // then rewritten as valid JSON after a route failure.
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  fops.files.set(breakerPath, 'not json {{{')
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']
  const runs = makeRuns([{ result: textResult('', 'error') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: chain, breakerPath, maxAttempts: 1 })
  assert.equal(result.outcomeClass, 'provider-error')
  assert.equal(runs.requests[0].agentOptions.model, 'alpha', 'corrupt breaker must not skip the preferred model')
  const rewritten = JSON.parse(fops.files.get(breakerPath))
  assert.ok(Number.isFinite(rewritten.models['acme/alpha'].blockedUntilMs))
}

{
  // Breaker entry already expired at run start: model is not skipped.
  let now = 2_000
  const clocked = makeRoleRunner({ pathutil: createLibraries.pathutil, util: createLibraries.util, core: createLibraries.core, nowMs: () => now, previewLimit: 12, defaultMaxAttempts: 3, maxAttemptsCeiling: 5 })
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  fops.files.set(breakerPath, JSON.stringify({ schemaVersion: 1, models: { 'acme/alpha': { blockedUntilMs: 1_000, lastOutcome: 'provider-error', lastAt: 'x', failures: 1 } } }))
  const runs = makeRuns([{ result: textResult('preferred again') }])
  const result = await clocked.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath, maxAttempts: 1 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(runs.requests[0].agentOptions.model, 'alpha', 'an expired entry must not block the model')
}

{
  // Duplicates and junk in modelChain are deduped/handled by the runner.
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: textResult('', 'error') }, { result: textResult('ok') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme/alpha', '  ', 'acme-beta/labs/model-x'], maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts.length, 2)
  assert.equal(runs.requests[1].agentOptions.model, 'labs/model-x')
}

{
  // Resume after crash: a persisted terminal retryable provider-error attempt
  // plus a persisted breaker entry -> the continued run hands off to the
  // fallback instead of re-probing the failed model.
  const fops = makeMemoryFops()
  const groupId = runner.logicalId(base.logicalGroupKey)
  const groupDir = '/run/packets/role-attempts/' + groupId
  const breakerPath = '/art/model-breaker.json'
  fops.files.set(breakerPath, JSON.stringify({ schemaVersion: 1, models: { 'acme/alpha': { blockedUntilMs: Number.MAX_SAFE_INTEGER, lastOutcome: 'provider-error', lastAt: 'x', failures: 1 } } }))
  fops.files.set(groupDir + '/manifest.json', JSON.stringify({ logicalGroupId: groupId, status: 'running', attempts: [] }, null, 2) + '\n')
  fops.files.set(groupDir + '/attempt-01.json', JSON.stringify({ logicalGroupId: groupId, attemptNumber: 1, attemptId: 'attempt-01', role: base.role, requestedProvider: 'acme', requestedModel: 'alpha', outcomeClass: 'provider-error', stopReason: 'error', retryable: true, output: '', outputPreview: '', outputLength: 0, partialOutput: true, outputRef: null, structured: null, cleanupDegraded: false, cleanupError: null, status: 'terminal' }))
  const runs = makeRuns([{ result: textResult('resumed on fallback') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath, maxAttempts: 3 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts.length, 2)
  assert.equal(result.attempts[0].attemptNumber, 1)
  assert.equal(result.attempts[0].requestedModel, 'alpha', 'the persisted failed attempt is retained')
  assert.equal(runs.starts, 1)
  assert.equal(runs.requests[0].agentOptions.model, 'labs/model-x', 'the resumed run must not re-probe the breaker-blocked model')
}

{
  // Non-contract-bound call (no runDir) still hands off and writes the breaker.
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  const runs = makeRuns([{ result: textResult('', 'error') }, { result: textResult('adhoc ok') }])
  const result = await runner.runRole({ ...base, fops, startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath, maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts.length, 2)
  const breaker = await fops.readJson(breakerPath)
  assert.ok(breaker.models['acme/alpha'])
}

// ── L2 (v2): multi-model breaker critique additions ──────────────────────────────────────

{
  // A.1 Concurrent lost-update race: two parallel runs failing DIFFERENT models
  // at once must both end up recorded (CAS retries), and the file stays valid.
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  const runsA = makeRuns([{ result: textResult('', 'error') }])
  const runsB = makeRuns([{ result: textResult('', 'error') }])
  await Promise.all([
    runner.runRole({ ...base, role: 'research_scout', fops, runDir: '/run', startSubagent: runsA.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath, maxAttempts: 1, logicalGroupKey: { runDigest: 'race', nodeId: 'a', step: 'x', role: 'research_scout' } }),
    runner.runRole({ ...base, role: 'research_critic', fops, runDir: '/run', startSubagent: runsB.startSubagent, modelChain: ['acme-qwen/labs/qwen-max', 'acme/alpha'], breakerPath, maxAttempts: 1, logicalGroupKey: { runDigest: 'race', nodeId: 'b', step: 'x', role: 'research_critic' } }),
  ])
  const breaker = JSON.parse(fops.files.get(breakerPath))
  assert.equal(breaker.schemaVersion, 1)
  assert.ok(breaker.models['acme/alpha'], 'run A model recorded')
  assert.ok(breaker.models['acme-qwen/labs/qwen-max'], 'run B model recorded (no last-writer clobber)')
}

{
  // A.2 (highest-value per critique): breaker WRITE failure must never sink the
  // handoff — the resilience path itself must be fault-tolerant.
  const inner = makeMemoryFops()
  const failing = { ...inner }
  const guard = (fn) => async (...a) => {
    if (typeof a[0] === 'string' && a[0] === '/art/model-breaker.json') throw new Error('injected breaker write failure')
    return fn(...a)
  }
  failing.writeText = guard(inner.writeText)
  failing.writeTextIntent = guard(inner.writeTextIntent)
  failing.writeTextNew = guard(inner.writeTextNew)
  const runs = makeRuns([{ result: textResult('', 'error') }, { result: textResult('rescued by fallback') }])
  const result = await runner.runRole({ ...base, fops: failing, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath: '/art/model-breaker.json', maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts.length, 2)
  assert.equal(inner.files.has('/art/model-breaker.json'), false, 'breaker file was never written')
}

{
  // A.3 429-shaped failure (rate-limit window exhausted) is a route failure:
  // hands off to the next model, never a content-level same-model retry.
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: Promise.reject(new Error('429 Too Many Requests: rate limit exceeded')) }, { result: textResult('after 429') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme-qwen/labs/qwen-max', 'acme-beta/labs/model-x'], breakerPath: '/art/model-breaker.json', maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.attempts[0].outcomeClass, 'infrastructure-result')
  assert.match(String(result.attempts[0].diagnostic ?? ''), /429/)
  assert.equal(runs.requests[1].agentOptions.model, 'labs/model-x')
}

{
  // A.4 Cooldown re-probe refresh: after expiry the preferred model is probed
  // again; if it fails a second time the block REFRESHES (new until, failures++)
  // and the run hands off in the same attempt budget.
  let now = 0
  const clocked = makeRoleRunner({ pathutil: createLibraries.pathutil, util: createLibraries.util, core: createLibraries.core, nowMs: () => now, previewLimit: 12, defaultMaxAttempts: 3, maxAttemptsCeiling: 5 })
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  const cooldown = 1000
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']
  const runs1 = makeRuns([{ result: textResult('', 'error') }])
  await clocked.runRole({ ...base, fops, runDir: '/run', startSubagent: runs1.startSubagent, modelChain: chain, breakerPath, fallbackCooldownMs: cooldown, maxAttempts: 1, logicalGroupKey: { runDigest: 'probe', nodeId: '1', step: 'x', role: 'research_author' } })
  const entry1 = JSON.parse(fops.files.get(breakerPath)).models['acme/alpha']
  assert.equal(entry1.blockedUntilMs, cooldown)
  now = cooldown + 10 // past expiry
  const runs2 = makeRuns([{ result: textResult('', 'error') }, { result: textResult('the fallback saves it') }])
  const result2 = await clocked.runRole({ ...base, fops, runDir: '/run', startSubagent: runs2.startSubagent, modelChain: chain, breakerPath, fallbackCooldownMs: cooldown, maxAttempts: 2, logicalGroupKey: { runDigest: 'probe', nodeId: '2', step: 'x', role: 'research_author' } })
  assert.equal(result2.outcomeClass, 'success')
  assert.equal(result2.attempts[0].requestedModel, 'alpha', 'expired model is re-probed')
  const entry2 = JSON.parse(fops.files.get(breakerPath)).models['acme/alpha']
  assert.equal(entry2.blockedUntilMs, now + cooldown, 'block refreshed from the NEW now')
  assert.equal(entry2.failures, 2, 'failure count increments across windows')
}

{
  // A.5 Legacy coexistence: a no-chain role whose model is breaker-blocked by
  // ANOTHER role still runs that model (legacy semantics), and its failure
  // neither adds nor modifies the breaker file.
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  const runsA = makeRuns([{ result: textResult('', 'error') }])
  await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runsA.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath, maxAttempts: 1, logicalGroupKey: { runDigest: 'legacy', nodeId: 'a', step: 'x', role: 'research_author' } })
  const before = fops.files.get(breakerPath)
  const runsB = makeRuns([{ result: textResult('', 'error') }])
  const resultB = await runner.runRole({ ...base, role: 'research_critic', fops, runDir: '/run', startSubagent: runsB.startSubagent, agentOptions: { provider: 'acme', model: 'alpha' }, breakerPath, maxAttempts: 1, logicalGroupKey: { runDigest: 'legacy', nodeId: 'b', step: 'x', role: 'research_critic' } })
  assert.equal(resultB.outcomeClass, 'provider-error')
  assert.equal(runsB.requests[0].agentOptions.model, 'alpha', 'legacy role runs its model despite the breaker')
  assert.equal(fops.files.get(breakerPath), before, 'legacy failure must not touch the breaker file')
}

{
  // A.6 All chain entries breaker-blocked and unexpired: the run does NOT
  // crash — it probes the soonest-unblocking model (cheap re-probe by design).
  let now = 0
  const clocked = makeRoleRunner({ pathutil: createLibraries.pathutil, util: createLibraries.util, core: createLibraries.core, nowMs: () => now, previewLimit: 12, defaultMaxAttempts: 3, maxAttemptsCeiling: 5 })
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  fops.files.set(breakerPath, JSON.stringify({ schemaVersion: 1, models: { 'acme/alpha': { blockedUntilMs: 500, lastOutcome: 'provider-error', lastAt: 'x', failures: 1 }, 'acme-beta/labs/model-x': { blockedUntilMs: 400, lastOutcome: 'provider-error', lastAt: 'x', failures: 1 } } }))
  const runs = makeRuns([{ result: textResult('recovered on the soonest window') }])
  const result = await clocked.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath, maxAttempts: 1 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(runs.requests[0].agentOptions.model, 'labs/model-x', 'the soonest-unblocking model is probed')
}

{
  // A.7 Budget allocation: N is a TOTAL attempt budget across the chain.
  // Ceiling clamp: budget 99 -> exactly 5 attempts, all on the route-failure path.
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: textResult('', 'error') }, { result: textResult('', 'error') }, { result: textResult('', 'error') }, { result: textResult('', 'error') }, { result: textResult('', 'error') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], maxAttempts: 99 })
  assert.equal(result.outcomeClass, 'provider-error')
  assert.equal(result.attempts.length, 5, 'ceiling clamps the budget to 5')
  // Truncation: chain [P,F1,F2,F3] with budget 3 -> F3 never attempted.
  const fops2 = makeMemoryFops()
  const runs2 = makeRuns([{ result: textResult('', 'error') }, { result: textResult('', 'error') }, { result: textResult('', 'error') }])
  const result2 = await runner.runRole({ ...base, fops: fops2, runDir: '/run', startSubagent: runs2.startSubagent, modelChain: ['m/one', 'm/two', 'm/three', 'm/four'], maxAttempts: 3 })
  assert.equal(result2.outcomeClass, 'provider-error')
  const models = result2.attempts.map((a) => a.requestedModel)
  assert.deepEqual(models, ['one', 'two', 'three'], 'F3 is never attempted inside the budget')
  assert.doesNotMatch(String(result2.diagnostic ?? ''), /chain exhausted/, 'budget exhaustion is NOT chain exhaustion (F3 is untried)')
}

{
  // A.8 Full content-negative matrix: every content-level outcome stays on the
  // same model and writes NO breaker entry. (aborted halts immediately.)
  const breakerPath = '/art/model-breaker.json'
  const chain = ['acme/alpha', 'acme-beta/labs/model-x']
  const cases = [
    ['max-tokens', { result: textResult('too long', 'max-tokens') }],
    ['empty-output', { result: textResult('', 'completed') }],
    ['aborted', { result: textResult('partial', 'aborted') }],
  ]
  for (const [expectedClass, script] of cases) {
    const fops = makeMemoryFops()
    const runs = makeRuns([script])
    const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: chain, breakerPath, maxAttempts: 3, logicalGroupKey: { runDigest: 'neg', nodeId: expectedClass, step: 'x', role: 'research_author' } })
    assert.equal(result.outcomeClass, expectedClass, expectedClass + ' class')
    assert.equal(result.attempts.length, 1, expectedClass + ': no second attempt')
    assert.equal(runs.starts, 1, expectedClass + ': fallback must not be consumed')
    assert.equal(await fops.readJson(breakerPath), undefined, expectedClass + ': no breaker write')
  }
}

{
  // A.10 Partial-output isolation: the fallback runs with clean context; the
  // failed model's fragment lives only in its attempt record.
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: textResult('PARTIAL-FRAGMENT garbage', 'error') }, { result: textResult('CLEAN-OUTPUT') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath: '/art/model-breaker.json', maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(result.output, 'CLEAN-OUTPUT', 'final output is only the fallback attempt')
  assert.match(String(result.attempts[0].outputPreview ?? ''), /PARTIAL-FRAG/)
}

{
  // B.5 Real-FS concurrent writers: 8 parallel route failures racing the same
  // breaker file (real disk, real torn-write/CAS surface, not memory FS).
  function makeRealFops(baseDir, nodeFs) {
    const resolve = (p) => path.resolve(baseDir, p)
    const versionOf = (st) => st.mtimeMs + ':' + st.size
    const writeText = async (p, content, expected) => {
      const target = resolve(p)
      if (expected?.kind === 'createIfAbsent') {
        await nodeFs.mkdir(path.dirname(target), { recursive: true })
        const handle = await nodeFs.open(target, 'wx')
        await handle.close()
      } else if (expected?.kind === 'replaceIfVersion') {
        const st = await nodeFs.stat(target)
        if (versionOf(st) !== expected.version) {
          const wrapped = new Error('stale')
          wrapped.code = 'FS_STALE_VERSION'
          throw wrapped
        }
      }
      await nodeFs.mkdir(path.dirname(target), { recursive: true })
      await nodeFs.writeFile(target, content)
    }
    return {
      async ensureDir(p) { await nodeFs.mkdir(resolve(p), { recursive: true }) },
      async exists(p) { try { await nodeFs.access(resolve(p)); return true } catch { return false } },
      async readText(p) { return await nodeFs.readFile(resolve(p), 'utf8') },
      async readJson(p) {
        try { return JSON.parse(await nodeFs.readFile(resolve(p), 'utf8')) }
        catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
      },
      async writeText(p, content, expected) { return writeText(p, content, expected) },
      async writeTextIntent(p, content, expected) { return writeText(p, content, expected) },
      async writeTextNew(p, content) {
        try { return await writeText(p, content, { kind: 'createIfAbsent' }) }
        catch (error) { if (error.code === 'EEXIST') throw error; throw error }
      },
      async writeJson(p, value, expected) { return writeText(p, JSON.stringify(value, null, 2) + '\n', expected) },
      async writeJsonNew(p, value) { return writeText(p, JSON.stringify(value, null, 2) + '\n', { kind: 'createIfAbsent' }) },
      async statInfo(p) {
        try {
          const st = await nodeFs.stat(resolve(p))
          return { version: versionOf(st), type: 'file' }
        } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
      },
      async listDir(dir) {
        let entries
        try { entries = await nodeFs.readdir(resolve(dir), { withFileTypes: true }) }
        catch (error) { if (error.code === 'ENOENT') return []; throw error }
        return entries.map((entry) => ({ name: entry.name, dir: entry.isDirectory() })).sort((a, b) => a.name.localeCompare(b.name))
      },
    }
  }
  const os = await import('node:os')
  const nodeFs = await import('node:fs/promises')
  const realDir = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'breaker-race-'))
  const realFops = makeRealFops(realDir, nodeFs)
  try {
    const breakerPath = 'model-breaker.json'
    await Promise.all(Array.from({ length: 8 }, (_, i) => {
      const runs = makeRuns([{ result: textResult('', 'error') }])
      return runner.runRole({ ...base, role: 'research_scout', fops: realFops, runDir: 'run', startSubagent: runs.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath, maxAttempts: 1, logicalGroupKey: { runDigest: 'realfs', nodeId: 'g' + i, step: 'x', role: 'research_scout' } })
    }))
    const parsed = JSON.parse(await nodeFs.readFile(path.join(realDir, breakerPath), 'utf8'))
    assert.ok(parsed.models['acme/alpha'], 'real-FS breaker entry survived the race')
    assert.ok(Number.isFinite(parsed.models['acme/alpha'].blockedUntilMs))
  } finally {
    await nodeFs.rm(realDir, { recursive: true, force: true })
  }
}

{
  // B.d.2 Cross-role blocking: role A's failure on M blocks role B's PRIMARY
  // (shared chain entry) — B starts on its own fallback. Intended, now pinned.
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  const runsA = makeRuns([{ result: textResult('', 'error') }])
  await runner.runRole({ ...base, role: 'research_scout', fops, runDir: '/run', startSubagent: runsA.startSubagent, modelChain: ['acme/alpha', 'acme-beta/labs/model-x'], breakerPath, maxAttempts: 1, logicalGroupKey: { runDigest: 'xrole', nodeId: 'a', step: 'x', role: 'research_scout' } })
  const runsB = makeRuns([{ result: textResult('critic on own fallback') }])
  const resultB = await runner.runRole({ ...base, role: 'research_critic', fops, runDir: '/run', startSubagent: runsB.startSubagent, modelChain: ['acme/alpha', 'acme-qwen/labs/qwen-max'], breakerPath, maxAttempts: 1, logicalGroupKey: { runDigest: 'xrole', nodeId: 'b', step: 'x', role: 'research_critic' } })
  assert.equal(resultB.outcomeClass, 'success')
  assert.equal(runsB.requests[0].agentOptions.model, 'labs/qwen-max', 'role B skips the cross-blocked primary')
}

{
  // B.d.6 Breaker hygiene: expired entries are evicted on the next write.
  let now = 200
  const clocked = makeRoleRunner({ pathutil: createLibraries.pathutil, util: createLibraries.util, core: createLibraries.core, nowMs: () => now, previewLimit: 12, defaultMaxAttempts: 3, maxAttemptsCeiling: 5 })
  const fops = makeMemoryFops()
  const breakerPath = '/art/model-breaker.json'
  fops.files.set(breakerPath, JSON.stringify({ schemaVersion: 1, models: { 'stale/model': { blockedUntilMs: 100, lastOutcome: 'provider-error', lastAt: 'x', failures: 3 }, 'live/model': { blockedUntilMs: Number.MAX_SAFE_INTEGER, lastOutcome: 'provider-error', lastAt: 'x', failures: 1 } } }))
  const runs = makeRuns([{ result: textResult('', 'error') }])
  await clocked.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, modelChain: ['fresh/model', 'live/model'], breakerPath, maxAttempts: 1 })
  const models = JSON.parse(fops.files.get(breakerPath)).models
  assert.ok(models['fresh/model'], 'new failure recorded')
  assert.ok(models['live/model'], 'live entry retained')
  assert.equal(models['stale/model'], undefined, 'expired entry evicted on write')
}

{
  // B.d.9 Provider-key setting in BOTH directions: bare primary -> prefixed
  // fallback must ADD the provider (the reverse of L1.6).
  const fops = makeMemoryFops()
  const runs = makeRuns([{ result: textResult('', 'error') }, { result: textResult('prefixed fallback ok') }])
  const result = await runner.runRole({ ...base, fops, runDir: '/run', startSubagent: runs.startSubagent, agentOptions: { model: 'local-only-model' }, modelChain: ['local-only-model', 'acme-beta/labs/model-x'], maxAttempts: 2 })
  assert.equal(result.outcomeClass, 'success')
  assert.equal(runs.requests[0].agentOptions.provider, undefined)
  assert.equal(runs.requests[1].agentOptions.provider, 'acme-beta', 'prefixed fallback sets the provider')
  assert.equal(runs.requests[1].agentOptions.model, 'labs/model-x')
}

// ── profile resolution + config merge for modelFallbacks ──────────────────────

{
  const profiles = createLibraries.profiles
  const cfg = {
    roleProfiles: {
      research_author: { model: 'acme/alpha', modelFallbacks: ['acme-beta/labs/model-x', 'acme/alpha', 'acme-beta/labs/model-x', '  ', 42] },
      research_scout: { model: 'acme/local-scout' },
    },
  }
  const author = profiles.resolveEffectiveProfile('research_author', cfg)
  assert.deepEqual(author.modelFallbacks, ['acme-beta/labs/model-x'])
  const scout = profiles.resolveEffectiveProfile('research_scout', cfg)
  assert.deepEqual(scout.modelFallbacks, [])
}

{
  // A partial workspace roleExecution override must not drop the cooldown.
  const merged = createLibraries.config.mergeConfig({ roleExecution: { maxAttempts: 5 } })
  assert.equal(merged.roleExecution.maxAttempts, 5)
  assert.equal(merged.roleExecution.modelFallbackCooldownMs, 600000)
}

console.log('role-runner tests passed')
