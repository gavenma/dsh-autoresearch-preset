import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools', 'build-manifest.json'), 'utf8'))
const { default: linearPlugin } = await import(pathToFileURL(path.join(root, manifest.entries.linear)).href)
const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-linear-reconcile-'))
const projectId = 'reconcile-e2e'
const projectDir = path.join(baseDir, '.research-agent', 'projects', projectId)
const statePath = path.join(projectDir, 'state.json')
const versions = new Map()
const fileService = {
  async resolve(target, options = {}) { return path.isAbsolute(target) ? target : path.resolve(options.cwd ?? baseDir, target) },
  async processPath(target) { return target },
  async readText(target) { return await fs.readFile(target, 'utf8') },
  async writeText(target, content, mode = {}) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (mode.kind === 'createIfAbsent') await fs.writeFile(target, content, { flag: 'wx' })
    else {
      if (mode.kind === 'replaceIfVersion' && versions.get(target) !== mode.version) throw Object.assign(new Error('version mismatch'), { code: 'VERSION_MISMATCH' })
      await fs.writeFile(target, content)
    }
    versions.set(target, (versions.get(target) ?? 0) + 1)
  },
  async stat(target) { try { await fs.stat(target); return { version: versions.get(target) ?? 1 } } catch { return undefined } },
  async listDir(target) { try { return (await fs.readdir(target, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } catch { return [] } },
}

const remote = {
  outage: true,
  failAfterComment: false,
  mutations: 0,
  issue: {
    id: 'ISS-1', identifier: 'AR-1', title: 'Accepted node', description: '', url: 'https://linear.invalid/AR-1',
    state: { id: 'todo', name: 'Todo', type: 'unstarted' }, labels: [{ id: 'user-label', name: 'user-label' }], comments: [], archivedAt: null, trashed: false,
  },
}
function processHandle(stdout = '', stderr = '', exitCode = 0) {
  return { done: Promise.resolve({ exitCode }), collected: { stdout: { async readFrom() { return { text: stdout } } }, stderr: { async readFrom() { return { text: stderr } } } } }
}
function apiResult(data) { return JSON.stringify({ statusCode: 200, bodyText: JSON.stringify({ data }) }) }
function issueData() {
  return { ...remote.issue, labels: { nodes: remote.issue.labels }, relations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, inverseRelations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
}
const subprocess = {
  async resolveExecutable(name) { return name },
  spawn(options) {
    if (options.argv[0] === '/bin/mkdir') { fs.mkdir(options.argv.at(-1), { recursive: true }); return processHandle() }
    if (options.argv.includes('-e')) return processHandle('"auto"\n')
    const request = JSON.parse(options.stdio.stdin.data)
    if (remote.outage) return processHandle(JSON.stringify({ error: 'simulated Linear outage' }))
    const { query, variables } = request
    if (query.includes('query IssueComments')) {
      const firstPage = remote.issue.comments.length > 0 && !variables.after
      return processHandle(apiResult({ issue: { comments: { nodes: firstPage ? [] : remote.issue.comments, pageInfo: { hasNextPage: firstPage, endCursor: firstPage ? 'comments-page-2' : null } } } }))
    }
    if (query.includes('query IssueRelations')) return processHandle(apiResult({ issue: { relations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, inverseRelations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }))
    if (query.includes('query Issue(')) return processHandle(apiResult({ issue: issueData() }))
    if (query.includes('mutation IssueUpdate')) {
      remote.mutations += 1
      remote.issue.state = { id: variables.stateId, name: variables.stateId, type: variables.stateId === 'done' ? 'completed' : 'started' }
      return processHandle(apiResult({ issueUpdate: { success: true, issue: { id: remote.issue.id, state: remote.issue.state } } }))
    }
    if (query.includes('mutation IssueLabelsUpdate')) {
      remote.mutations += 1
      remote.issue.labels = variables.labelIds.map((id) => ({ id, name: id }))
      return processHandle(apiResult({ issueUpdate: { success: true, issue: { id: remote.issue.id, labels: { nodes: remote.issue.labels } } } }))
    }
    if (query.includes('mutation CommentCreate')) {
      remote.mutations += 1
      remote.issue.comments.push({ id: 'comment-' + remote.issue.comments.length, body: variables.body, createdAt: '2026-01-01T00:00:00Z', updatedAt: null, user: { id: 'bot', name: 'bot' } })
      if (remote.failAfterComment) { remote.failAfterComment = false; return processHandle(JSON.stringify({ error: 'response lost after comment commit' })) }
      return processHandle(apiResult({ commentCreate: { success: true, comment: { id: remote.issue.comments.at(-1).id } } }))
    }
    throw new Error('unexpected fake Linear query: ' + query.slice(0, 80))
  },
}

const tools = new Map()
linearPlugin.apply({ get(name) { if (name === 'tools') return { register(definition) { tools.set(definition.name, definition) } }; if (name === 'fs') return fileService; if (name === 'subprocess') return subprocess; if (name === 'credentials') return { async resolve() { return { value: 'fake-token' } } }; return undefined } })
const exec = { agent: { session: { header: { cwd: baseDir, delegationDepth: 0 } } } }
const invoke = (name, args) => tools.get(name).execute(args, exec)

try {
  await fs.mkdir(projectDir, { recursive: true })
  const state = { schemaVersion: 2, projectId, project: { linearProjectId: 'LP-1' }, nodes: { accepted: { status: 'done', projectionStatus: 'pending', linearProjection: { projectId, nodeId: 'accepted', status: 'done', blockedBy: ['upstream'], reason: 'upstream receipt invalid' } } } }
  await fileService.writeText(statePath, JSON.stringify(state, null, 2) + '\n')
  await assert.rejects(invoke('linear_project_node', { projectId, nodeId: 'accepted', issueId: 'ISS-1', stateId: 'done', blockedLabelId: 'autoresearch-blocked', status: 'done', blockedBy: ['upstream'], reason: 'upstream receipt invalid', baseDir }), /simulated Linear outage/)
  assert.equal(remote.mutations, 0)
  assert.equal(JSON.parse(await fs.readFile(statePath, 'utf8')).nodes.accepted.projectionStatus, 'pending')

  remote.outage = false
  remote.failAfterComment = true
  const firstReplay = await invoke('linear_sync_reconcile', { projectId, baseDir, maxAttempts: 5 })
  assert.equal(firstReplay.results.at(-1).status, 'retry')
  assert.equal(remote.issue.state.id, 'done')
  assert.deepEqual(remote.issue.labels.map((label) => label.id).sort(), ['autoresearch-blocked', 'user-label'])
  assert.equal(remote.issue.comments.length, 1)
  const mutationCount = remote.mutations

  const confirmed = await invoke('linear_sync_reconcile', { projectId, baseDir, maxAttempts: 5 })
  assert.equal(confirmed.results.at(-1).status, 'confirmed', JSON.stringify(confirmed))
  assert.equal(confirmed.results.at(-1).readBack, true)
  assert.equal(remote.mutations, mutationCount)
  assert.equal(remote.issue.comments.length, 1)
  assert.equal(JSON.parse(await fs.readFile(statePath, 'utf8')).nodes.accepted.projectionStatus, 'confirmed')

  const pendingAgain = JSON.parse(await fs.readFile(statePath, 'utf8'))
  pendingAgain.nodes.accepted.projectionStatus = 'pending'
  delete pendingAgain.nodes.accepted.linearProjection.confirmedAt
  await fileService.writeText(statePath, JSON.stringify(pendingAgain, null, 2) + '\n')
  const journalRepair = await invoke('linear_sync_reconcile', { projectId, baseDir })
  assert.equal(journalRepair.results.at(-1).journalRecovery, true)
  assert.equal(journalRepair.results.at(-1).journal.ok, true)
  assert.equal(remote.mutations, mutationCount)
  assert.equal(JSON.parse(await fs.readFile(statePath, 'utf8')).nodes.accepted.projectionStatus, 'confirmed')

  remote.issue.archivedAt = '2026-01-02T00:00:00Z'
  await invoke('linear_sync_enqueue', { projectId, nodeId: 'accepted', operation: 'comment', payload: { issueId: 'ISS-1', body: 'marker archived', marker: 'marker archived' }, baseDir })
  const archived = await invoke('linear_sync_reconcile', { projectId, baseDir })
  assert.equal(archived.results.at(-1).status, 'dead')
  assert.match(archived.results.at(-1).error, /archived or trashed/)

  console.log('mounted fake Linear outage/reconcile e2e passed for generation ' + manifest.generation)
} finally {
  await fs.rm(baseDir, { recursive: true, force: true })
}
