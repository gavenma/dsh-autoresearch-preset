import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { createLibraries } = await import(pathToFileURL(path.join(root, manifest.entries.orchestrator)).href)
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-local-smoke-'))

const fops = {
  async exists(file) { try { await fs.access(file); return true } catch { return false } },
  async readText(file) { return await fs.readFile(file, 'utf8') },
  async readBytes(file) { return new Uint8Array(await fs.readFile(file)) },
  async writeText(file, text) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text) },
  async writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n') },
  async readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return null } },
  async listDir(dir) { try { return (await fs.readdir(dir, { withFileTypes: true })).map((entry) => ({ name: entry.name, dir: entry.isDirectory() })) } catch { return [] } },
  async ensureDir(dir) { await fs.mkdir(dir, { recursive: true }) },
  async copy(source, destination) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(source, destination) },
  async removeTree(dir) { await fs.rm(dir, { recursive: true, force: true }) },
  async remove(file) { await fs.rm(file, { force: true }) },
}
const subprocess = {
  async resolveExecutable(name) { return name },
  spawn({ argv, cwd }) {
    const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, SOURCE_DATE_EPOCH: '1767225600', TZ: 'UTC' } })
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

try {
  const markdownDir = path.join(work, 'markdown')
  await fs.mkdir(markdownDir, { recursive: true })
  const markdown = '# Local-only report\n\nDeterministic smoke artifact.\n'
  await fs.writeFile(path.join(markdownDir, 'report.md'), markdown)
  const markdownReceipt = { format: 'markdown', path: 'report.md', sha256: hash(Buffer.from(markdown)) }
  await fs.writeFile(path.join(markdownDir, 'receipt.json'), JSON.stringify(markdownReceipt, null, 2) + '\n')
  assert.equal(markdownReceipt.sha256, hash(await fs.readFile(path.join(markdownDir, 'report.md'))))

  const texSource = '\\documentclass{article}\n\\begin{document}\nLocal-only deterministic smoke.\n\\end{document}\n'
  const pdfDir = path.join(work, 'pdf-only')
  await fs.mkdir(pdfDir, { recursive: true })
  await fs.writeFile(path.join(pdfDir, 'main.tex'), texSource)
  const pdfBuild = await createLibraries.helpers.strictTexBuild(fops, subprocess, work, pdfDir, 'main.tex')
  assert.equal(pdfBuild.clean, true)
  assert.equal(pdfBuild.pdfExists, true)
  const pdfReceipt = { format: 'pdf', path: 'main.pdf', sha256: pdfBuild.pdfHash }
  await fs.writeFile(path.join(pdfDir, 'receipt.json'), JSON.stringify(pdfReceipt, null, 2) + '\n')

  const reproducibleDir = path.join(work, 'reproducible-tex')
  await fs.mkdir(reproducibleDir, { recursive: true })
  await fs.writeFile(path.join(reproducibleDir, 'main.tex'), texSource)
  const first = await createLibraries.helpers.strictTexBuild(fops, subprocess, work, reproducibleDir, 'main.tex')
  const second = await createLibraries.helpers.strictTexBuild(fops, subprocess, work, reproducibleDir, 'main.tex')
  assert.equal(first.clean && second.clean, true)
  assert.equal(first.pdfHash, second.pdfHash)
  const texReceipt = { format: 'tex', path: 'main.tex', sourceHash: hash(await fs.readFile(path.join(reproducibleDir, 'main.tex'))), pdfHash: second.pdfHash, doubleBuildMatch: true }
  await fs.writeFile(path.join(reproducibleDir, 'receipt.json'), JSON.stringify(texReceipt, null, 2) + '\n')

  for (const project of [markdownDir, pdfDir, reproducibleDir]) {
    assert.equal(await fops.exists(path.join(project, 'linear-sync')), false)
  }
  console.log(JSON.stringify({ ok: true, generation: manifest.generation, projects: ['markdown', 'pdf-only', 'reproducible-tex'] }))
} finally {
  await fs.rm(work, { recursive: true, force: true })
}
