import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The route gate must actually RUN, not merely exist. This drives the real
// `autoresearch_spawn_role` tool with a stubbed LLM service and asserts that the
// tool filter a child would be spawned with follows the model's declared input
// modalities:
//   - a model that declares image input keeps `read_image`
//   - a model whose adapter reports text-only does NOT get it
// Without availability reaching the grant, both cases look identical and a
// text-only role is handed a tool that can only fail at the adapter.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { default: orchestrator } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)

const registered = new Map()
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'route-gate-wiring-'))

function makeLlm(declared) {
  return {
    async listProviders() { return [{ id: 'prov', name: 'prov' }] },
    async listModels(providerId) {
      return declared.map((entry) => ({
        provider: providerId,
        id: entry.id,
        name: entry.id,
        ...(entry.image ? { inputModalities: ['text', 'image'] } : { inputModalities: ['text'] }),
      }))
    },
    async resolveModelInfo() { return {} },
  }
}

const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? workspace, target) },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content) },
  async stat(target) { try { return await fs.stat(target) } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}

const roleProfile = { roleProfiles: { research_author: { model: 'prov/vision-author' } } }
const stubConfig = { roleProfiles: roleProfile.roleProfiles, artifactRoot: '.research-agent' }

async function spawnPlanFor(llm) {
  registered.clear()
  // The tool resolves its config from the workspace ARTIFACT root
  // (`.research-agent/config.json`), not from the workspace root.
  const artifactRoot = path.join(workspace, '.research-agent')
  await fs.mkdir(artifactRoot, { recursive: true })
  await fs.writeFile(path.join(artifactRoot, 'config.json'), JSON.stringify(stubConfig))
  orchestrator.apply({
    get(name) {
      if (name === 'fs') return fileService
      if (name === 'llm') return llm
      if (name === 'tools') return { register(definition) { registered.set(definition.name, definition) } }
      return undefined
    },
  })
  const spawnRole = registered.get('autoresearch_spawn_role')
  assert.ok(spawnRole, 'spawn_role must be registered')
  const exec = { agent: { session: { header: { cwd: workspace, delegationDepth: 1 } } } }
  const result = await spawnRole.execute({ baseDir: workspace, role: 'research_author', task: 'Write it.' }, exec)
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.plan.tools
}

// The tool resolves its config from the workspace artifact root; the stub above
// is enough for the grant path, which is what this test pins.
{
  const capable = await spawnPlanFor(makeLlm([{ id: 'vision-author', image: true }]))
  assert.ok(capable.includes('read_image'), 'a model declaring image input keeps read_image: ' + JSON.stringify(capable))
}
{
  const textOnly = await spawnPlanFor(makeLlm([{ id: 'vision-author', image: false }]))
  assert.ok(!textOnly.includes('read_image'), 'a model its adapter reports as text-only is not handed read_image: ' + JSON.stringify(textOnly))
  assert.ok(textOnly.includes('read'), 'the ordinary read tool is unaffected')
}
{
  // A model missing from the catalog states nothing about modalities: the
  // declared grant stands rather than being silently removed.
  const unlisted = await spawnPlanFor(makeLlm([{ id: 'some-other-model', image: false }]))
  assert.ok(unlisted.includes('read_image'), 'a route absent from the listing keeps the declared grant: ' + JSON.stringify(unlisted))
}

await fs.rm(workspace, { recursive: true, force: true })
console.log('route-gate wiring tests passed for generation ' + manifest.generation)
