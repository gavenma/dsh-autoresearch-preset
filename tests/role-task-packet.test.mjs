import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createLibraries } from '../src/research-orchestrator.mjs'

const { core, helpers } = createLibraries
const digest = 'a'.repeat(64)
const inputs = [{ name: 'dep-output', path: '.research-agent/runs/dep/out.md', hash: 'b'.repeat(64), format: 'markdown', producer: 'dep' }]

assert.equal(helpers.localCurrentTaskContextDigest({
  runDigest: 'run', projectId: 'project', nodeId: 'node', contractDigest: 'contract',
  planDigest: 'plan', role: 'research_author', pass: 0, inputs,
}), core.digestOf({
  kind: 'local-current-task-context', runDigest: 'run', projectId: 'project', nodeId: 'node',
  contractDigest: 'contract', planDigest: 'plan', role: 'research_author', pass: 0, inputs,
}))
assert.notEqual(
  helpers.localCurrentTaskContextDigest({ runDigest: 'run', projectId: 'project', nodeId: 'node', contractDigest: 'contract', planDigest: 'plan', role: 'research_author', pass: 0, inputs }),
  core.sha256Text('task prose'),
)

const spawnParams = new Map(core.TOOL_PARAMETER_DEFINITIONS.autoresearch_spawn_role.params.map(([name, type, required, description]) => [name, { type, required, description }]))
const runParams = new Map(core.TOOL_PARAMETER_DEFINITIONS.autoresearch_run_role.params.map(([name, type, required, description]) => [name, { type, required, description }]))
assert.equal(spawnParams.get('nodeContextDigest').type, 'string')
assert.equal(runParams.get('nodeContextDigest').type, 'string')
assert.match(spawnParams.get('nodeContextDigest').description, /distinct from the judge contextDigest/)
assert.match(runParams.get('contextDigest').description, /shared judge context/)

const orchestratorSource = await fs.readFile(fileURLToPath(new URL('../src/research-orchestrator.mjs', import.meta.url)), 'utf8')
const spawnPlan = createLibraries.spawn.buildSpawnPlan({ role: 'research_author', task: 'task', profile: { role: 'research_author', tools: ['read'], nodeContextDigest: digest }, nodeContextDigest: digest })
assert.equal(spawnPlan.recommendedRunRoleCall.nodeContextDigest, digest)

assert.match(orchestratorSource, /boundRun\?\.sourceType === 'linear'/)
assert.match(orchestratorSource, /contextDigest: linearBoundProject\s*\? args\.nodeContextDigest\s*: localCurrentTaskContextDigest/)
assert.match(orchestratorSource, /isJudge && typeof args\.judgePacketPath === 'string' && args\.judgePacketPath\.trim\(\)/)
assert.match(orchestratorSource, /guardScan = \{ roots: \[runDirRel, projectDirRel, outputsRel, \.\.\.otherRunRoots\], otherRunRoots \}/)
assert.doesNotMatch(orchestratorSource, /contextDigest: core\.sha256Text\(task\)/)
assert.doesNotMatch(orchestratorSource, /readRoots: \[runDirRel, projectDirRel\]/)

console.log('role-task packet source tests passed')
