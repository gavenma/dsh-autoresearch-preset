import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const presetRoot = process.argv[2] ?? '/home/gaven/.dsh/.agent-presets/research'
const manifest = JSON.parse(await fs.readFile(path.join(presetRoot, 'tools', 'build-manifest.json'), 'utf8'))
async function listFiles(dir, prefix = '') {
  const files = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) files.push(...await listFiles(path.join(dir, entry.name), rel))
    else files.push(rel)
  }
  return files.sort()
}
const installedFiles = await listFiles(presetRoot)
const declaredFiles = [...Object.keys(manifest.files), 'tools/build-manifest.json', 'install-receipt.json'].sort()
assert.deepEqual(installedFiles, declaredFiles, 'installed preset contains missing or undeclared relic files')
const subprocess = {
  async resolveExecutable(name) { return name },
  spawn({ argv, cwd }) {
    const child = spawn(argv[0], argv.slice(1), { cwd })
    const stdout = []; const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk)); child.stderr.on('data', (chunk) => stderr.push(chunk))
    return {
      done: new Promise((resolve) => child.on('close', (code) => resolve({ exitCode: code ?? 1 }))),
      collected: {
        stdout: { readFrom: async () => ({ text: Buffer.concat(stdout).toString('utf8') }) },
        stderr: { readFrom: async () => ({ text: Buffer.concat(stderr).toString('utf8') }) },
      },
    }
  },
}
const orchestrator = await import(pathToFileURL(path.join(presetRoot, manifest.entries.orchestrator)).href + '?probe=' + Date.now())
const linear = await import(pathToFileURL(path.join(presetRoot, manifest.entries.linear)).href + '?probe=' + Date.now())
const probeWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-installed-probe-'))
let orchestratorProbe
let linearProbe
try {
  orchestratorProbe = await orchestrator.createLibraries.helpers.runBuildProbe(subprocess, probeWorkspace)
  linearProbe = await linear.createLibraries.helpers.runBuildProbe(subprocess, probeWorkspace)
} finally {
  await fs.rm(probeWorkspace, { recursive: true, force: true })
}
for (const probe of [orchestratorProbe, linearProbe]) {
  assert.equal(probe.graphMatches, true, JSON.stringify(probe.mismatches))
  assert.equal(probe.generation, manifest.generation)
  assert.equal(probe.expectedAggregateId, manifest.aggregateId)
  assert.equal(probe.actualAggregateId, manifest.aggregateId)
  assert.equal(probe.embeddedAggregateId, manifest.aggregateId)
  assert.deepEqual(probe.configDrift, [])
}
assert.equal(orchestratorProbe.expectedAggregateId, linearProbe.expectedAggregateId)
console.log(JSON.stringify({ ok: true, generation: manifest.generation, aggregateId: manifest.aggregateId, probes: [orchestratorProbe.probeName, linearProbe.probeName] }))
