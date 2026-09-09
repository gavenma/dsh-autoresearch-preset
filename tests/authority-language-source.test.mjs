import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'agent.cordis.yml',
  'skills/research-project/SKILL.md',
  'skills/research-outline-project/SKILL.md',
  'CONTRIBUTING.md',
  'README.md',
  'src/autoresearch-core.mjs',
  'src/research-orchestrator.mjs',
  'src/linear.mjs',
]
const source = Object.fromEntries(await Promise.all(files.map(async (relative) => [
  relative,
  await fs.readFile(path.join(root, relative), 'utf8'),
])))

assert.match(source['agent.cordis.yml'], /plan\.json is the immutable approved DAG and contract authority/)
assert.match(source['agent.cordis.yml'], /Current Node Context is authoritative current-work context/)
assert.match(source['skills/research-project/SKILL.md'], /`plan\.json` remains immutable DAG\/contract authority/)
assert.match(source['skills/research-outline-project/SKILL.md'], /DAG\/contract authority/)
assert.match(source['CONTRIBUTING.md'], /authoritative current-work context/)

for (const [relative, text] of Object.entries(source)) {
  assert.doesNotMatch(text, /legacy research-agent(?:\/| config\.json).*?(?:is readable|is also read|is also supported)/i, `${relative} advertises the bare root as a runtime input`)
}
assert.doesNotMatch(source['agent.cordis.yml'], /Linear is a derived view/i)
assert.doesNotMatch(source['skills/research-outline-project/SKILL.md'], /Linear remains a derived view/i)
for (const relative of ['agent.cordis.yml', 'skills/research-project/SKILL.md', 'README.md']) {
  assert.doesNotMatch(source[relative], /fresh, confined role subagents|broad role baseline.*activates|path(?: and|\/)operation guards reject/is, `${relative} overstates role-child confinement`)
}

console.log('authority-language source scan passed')
