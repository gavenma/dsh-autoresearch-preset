// Source entry for the AutoResearch Linear adapter. The build script emits a versioned runtime bundle.
import * as autoresearchCore from "./autoresearch-core.mjs"
// ── lib/pathutil.js ──
'use strict'
// Pure POSIX-style path utilities. No node:path dependency, so the same code
// runs inside a dynamic Cordis plugin (which has no `require`) and under node
// tests. Behavior mirrors node:path for the call shapes the pi port uses.
function makePathUtil() {
  const path = {}
  path.sep = '/'

  function assertString(p) {
    if (typeof p !== 'string') throw new TypeError('path must be a string')
  }

  path.isAbsolute = function (p) {
    assertString(p)
    return p.length > 0 && p.charCodeAt(0) === 47 // '/'
  }

  path.normalize = function (p) {
    assertString(p)
    if (p === '') return '.'
    const absolute = p.charCodeAt(0) === 47
    const segments = []
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') {
        if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop()
        else if (!absolute) segments.push('..')
      } else {
        segments.push(seg)
      }
    }
    let out = segments.join('/')
    if (absolute) out = '/' + out
    return out === '' ? (absolute ? '/' : '.') : out
  }

  path.join = function (...parts) {
    let out = ''
    for (let part of parts) {
      assertString(part)
      if (part === '') continue
      if (out === '') out = part
      else out = out.replace(/\/+$/, '') + '/' + part.replace(/^\/+/, '')
    }
    return path.normalize(out)
  }

  // node:path.resolve without the cwd fallback: all parts must be supplied.
  path.resolve = function (...parts) {
    let resolved = ''
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]
      assertString(part)
      if (part === '') continue
      resolved = resolved === '' ? part : part + '/' + resolved
      if (path.isAbsolute(part)) break
    }
    return path.normalize(resolved)
  }

  path.dirname = function (p) {
    assertString(p)
    const n = path.normalize(p)
    const i = n.lastIndexOf('/')
    if (i <= 0) return i === 0 ? '/' : '.'
    return n.slice(0, i)
  }

  path.basename = function (p, ext) {
    assertString(p)
    let n = path.normalize(p)
    if (n.endsWith('/') && n !== '/') n = n.slice(0, -1)
    const i = n.lastIndexOf('/')
    let base = i >= 0 ? n.slice(i + 1) : n
    if (ext !== undefined && base.length > ext.length && base.endsWith(ext)) {
      base = base.slice(0, base.length - ext.length)
    }
    return base
  }

  path.relative = function (from, to) {
    assertString(from)
    assertString(to)
    const fromAbs = path.resolve(from)
    const toAbs = path.resolve(to)
    const fromParts = fromAbs === '/' ? [] : fromAbs.split('/').slice(1)
    const toParts = toAbs === '/' ? [] : toAbs.split('/').slice(1)
    let i = 0
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++
    const ups = fromParts.length - i
    const downs = toParts.slice(i)
    return [...new Array(ups).fill('..'), ...downs].join('/')
  }

  // Confinement: resolve `child` under `root` and refuse escapes. `root` is
  // expected to be an absolute normalized path.
  path.resolveInside = function (root, child) {
    const rootPath = path.normalize(root)
    const target = path.resolve(rootPath, child)
    if (target !== rootPath && !target.startsWith(rootPath === '/' ? '/' : rootPath + '/')) {
      throw new Error(`Path escapes allowed root: ${child}`)
    }
    return target
  }

  path.relativePath = function (root, target) {
    const rootPath = path.normalize(root)
    const targetPath = path.normalize(target)
    const prefix = rootPath === '/' ? '/' : rootPath + '/'
    return targetPath === rootPath ? '' : (targetPath.startsWith(prefix) ? targetPath.slice(prefix.length) : targetPath)
  }

  return path
}

if (typeof module !== 'undefined' && module.exports) module.exports = makePathUtil

// ── lib/util.js ──
'use strict'
// Port of pi ref/extensions/research-orchestrator/lib/util.ts (pure parts).
// Filesystem helpers moved to the injected `fops` adapter; path helpers come
// from the injected `pathutil` factory. Factory pattern keeps this file
// concatenatable into a dynamic Cordis plugin body (no imports anywhere).
function makeUtil(pathutil) {
  const util = {}

  util.isPlainObject = function (value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  util.isAlreadyExistsError = function (error) {
    return util.isPlainObject(error) && error.code === 'EEXIST'
  }

  util.requiredString = function (value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`)
    return value
  }

  util.requiredPositiveInteger = function (value, name) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer.`)
    }
    return value
  }

  util.nonEmptyStringArray = function (value, fallback) {
    const items = Array.isArray(value)
      ? value.map(String).map((item) => item.trim()).filter(Boolean)
      : []
    return items.length > 0 ? items : fallback
  }

  util.numberArray = function (value, fallback) {
    const items = Array.isArray(value) ? value.map(Number).filter((item) => Number.isFinite(item)) : []
    return items.length > 0 ? items : fallback
  }

  util.safeSegment = function (value) {
    const safe = String(value).trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/-+/g, '-')
    if (!safe || safe === '.' || safe === '..') throw new Error(`Invalid path segment: ${value}`)
    return safe
  }

  util.timestampForPath = function (iso) {
    return String(iso).replace(/[:.]/g, '-')
  }

  util.passName = function (pass) {
    return `pass_${String(pass).padStart(2, '0')}`
  }

  util.resolveInside = function (root, path) {
    return pathutil.resolveInside(root, path)
  }

  util.relativePath = function (root, target) {
    return pathutil.relativePath(root, target)
  }

  util.findDuplicates = function (values) {
    const seen = new Set()
    const duplicates = new Set()
    for (const value of values) {
      if (seen.has(value)) duplicates.add(value)
      seen.add(value)
    }
    return [...duplicates]
  }

  util.hashString = function (value) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  // Deterministic Fisher-Yates seeded by the FNV-1a hash of `seed` + LCG.
  util.shuffle = function (items, seed) {
    const output = [...items]
    let state = util.hashString(seed)
    for (let index = output.length - 1; index > 0; index -= 1) {
      state = (state * 1664525 + 1013904223) >>> 0
      const swapIndex = state % (index + 1)
      ;[output[index], output[swapIndex]] = [output[swapIndex], output[index]]
    }
    return output
  }

  util.escapeRegExp = function (value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  return util
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeUtil

const pathutil = makePathUtil()
const util = makeUtil(pathutil)
// ── lib/linear-core.js ──
'use strict'
// Linear GraphQL core: fixed query templates + response shaping (plan §3.11).
// Transport is injected: the plugin glue provides the subprocess+helper
// implementation; unit tests provide a mock. The model never supplies GraphQL
// text — only variables.
function makeLinearCore(util) {
  const core = {}

  // Fixed query templates per tool. Variables are positional-safe strings.
  core.QUERIES = {
    whoami: `query { viewer { id name email } organization { id name } }`,
    workspaceMetadata: `query {
      teams {
        nodes {
          id name key
          states { nodes { id name type } }
          labels { nodes { id name } }
        }
      }
      issueLabels { nodes { id name } }
    }`,
    getIssue: `query Issue($id: String!, $relationsFirst: Int, $relationsAfter: String, $inverseRelationsFirst: Int, $inverseRelationsAfter: String) {
      issue(id: $id) {
        id identifier title description
        state { id name type }
        team { id name key }
        project { id name }
        labels { nodes { id name } }
        assignee { id name }
        updatedAt archivedAt trashed
        url
        relations(first: $relationsFirst, after: $relationsAfter) {
          nodes { id type relatedIssue { id identifier title url } }
          pageInfo { hasNextPage endCursor }
        }
        inverseRelations(first: $inverseRelationsFirst, after: $inverseRelationsAfter) {
          nodes { id type relatedIssue { id identifier title url } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    listComments: `query IssueComments($id: String!, $first: Int, $after: String) {
      issue(id: $id) {
        comments(first: $first, after: $after) {
          nodes { id body createdAt updatedAt user { id name } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    listIssueRelations: `query IssueRelations($id: String!, $first: Int, $after: String) {
      issue(id: $id) {
        relations(first: $first, after: $after) {
          nodes { id type relatedIssue { id identifier title url } }
          pageInfo { hasNextPage endCursor }
        }
        inverseRelations(first: $first, after: $after) {
          nodes { id type relatedIssue { id identifier title url } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    issueRelationCreate: `mutation IssueRelationCreate($input: IssueRelationCreateInput!) {
      issueRelationCreate(input: $input) { success issueRelation { id type relatedIssue { id identifier title url } } }
    }`,
    issueRelationDelete: `mutation IssueRelationDelete($id: String!) {
      issueRelationDelete(id: $id) { success }
    }`,
    updateIssueLabels: `mutation IssueLabelsUpdate($id: String!, $labelIds: [String!]!) {
      issueUpdate(id: $id, input: { labelIds: $labelIds }) { success issue { id labels { nodes { id name } } } }
    }`,
    listIssues: `query Issues($first: Int) {
      issues(first: $first, orderBy: updatedAt) {
        nodes { identifier title state { name } url }
      }
    }`,
    searchIssues: `query Search($term: String!) {
      issues(
        first: 20
        filter: {
          or: [
            { title: { containsIgnoreCase: $term } }
            { description: { containsIgnoreCase: $term } }
          ]
        }
      ) {
        nodes { identifier title state { name } url }
      }
    }`,
    createComment: `mutation CommentCreate($id: String!, $body: String!) {
      commentCreate(input: { issueId: $id, body: $body }) { success comment { id } }
    }`,
    updateIssue: `mutation IssueUpdate($id: String!, $stateId: String) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id state { name } } }
    }`,
    updateIssueDescription: `mutation IssueDescriptionUpdate($id: String!, $description: String!) {
      issueUpdate(id: $id, input: { description: $description }) {
        success issue { id identifier title description url }
      }
    }`,
    // ── project mode (plan §3 C1–C3, §10) ─────────────────────────────────
    projectCreate: `mutation ProjectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) { success project { id name url } }
    }`,
    issueCreate: `mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier title url } }
    }`,
    listProjects: `query Projects($first: Int, $after: String) {
      projects(first: $first, after: $after) {
        nodes { id name description }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    listProjectIssues: `query ProjectIssues($id: String!, $first: Int, $after: String) {
      project(id: $id) {
        issues(first: $first, after: $after, orderBy: updatedAt) {
          nodes {
            id identifier title description
            state { id name type }
            project { id }
            team { id }
            url
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
  }

  core.buildRequest = function (tool, variables = {}) {
    const query = core.QUERIES[tool]
    if (!query) throw new Error(`Unknown Linear tool template: ${tool}`)
    return { query, variables }
  }

  // Parse the transport result into a shaped tool result, or throw a typed
  // error. `transportOut` = { statusCode, bodyText } as produced by
  // tools/linear-client.mjs.
  core.parseResponse = function (tool, transportOut) {
    if (!util.isPlainObject(transportOut)) throw new Error('Linear transport produced no result')
    if (typeof transportOut.error === 'string' && transportOut.error) {
      throw Object.assign(new Error(transportOut.error), { code: 'LINEAR_TRANSPORT' })
    }
    if (typeof transportOut.statusCode !== 'number' || typeof transportOut.bodyText !== 'string') {
      throw Object.assign(new Error('Linear transport result is malformed'), { code: 'LINEAR_TRANSPORT' })
    }
    if (transportOut.statusCode >= 400) {
      throw Object.assign(new Error(`Linear API HTTP ${transportOut.statusCode}`), { code: 'LINEAR_HTTP' })
    }
    let parsed
    try {
      parsed = JSON.parse(transportOut.bodyText)
    } catch {
      throw Object.assign(new Error(`Linear API returned non-JSON (HTTP ${transportOut.statusCode})`), { code: 'LINEAR_BAD_RESPONSE' })
    }
    if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
      const message = parsed.errors.map((e) => e?.message ?? String(e)).join('; ')
      throw Object.assign(new Error(`Linear API error: ${message}`), { code: 'LINEAR_GRAPHQL' })
    }
    if (parsed === null || typeof parsed !== 'object' || !util.isPlainObject(parsed.data)) {
      throw Object.assign(new Error('Linear API returned no data'), { code: 'LINEAR_BAD_RESPONSE' })
    }
    return core.shapeResult(tool, parsed.data)
  }

  // Shape per-tool results into compact, JSON-safe objects. getIssue also
  // renders the markdown snapshot the orchestrator's init_run consumes.
  core.shapeRelations = function (connection) {
     return {
       nodes: (connection?.nodes ?? []).map((relation) => ({
         id: relation.id,
         type: relation.type,
         relatedIssue: relation.relatedIssue ? { id: relation.relatedIssue.id, identifier: relation.relatedIssue.identifier, title: relation.relatedIssue.title, url: relation.relatedIssue.url } : null,
       })),
       pageInfo: connection?.pageInfo ?? { hasNextPage: false, endCursor: null },
     }
   }

   core.shapeResult = function (tool, data) {
    switch (tool) {
      case 'whoami':
        return {
          ok: true,
          viewer: data.viewer ?? null,
          organization: data.organization ?? null,
        }
      case 'workspaceMetadata':
        return {
          ok: true,
          labels: (data.issueLabels?.nodes ?? []).map((label) => ({ id: label.id, name: label.name })),
          teams: (data.teams?.nodes ?? []).map((team) => ({
            id: team.id,
            name: team.name,
            key: team.key,
             labels: (team.labels?.nodes ?? []).map((label) => ({ id: label.id, name: label.name })),
            states: (team.states?.nodes ?? []).map((state) => ({ id: state.id, name: state.name, type: state.type })),
          })),
        }
      case 'getIssue': {
        const issue = data.issue
        if (!issue) throw Object.assign(new Error('Issue not found'), { code: 'LINEAR_NOT_FOUND' })
        const labelRecords = (issue.labels?.nodes ?? []).map((label) => ({ id: label.id, name: label.name }))
        const labels = labelRecords.map((label) => label.name)
        const markdown = [
          `# ${issue.identifier} — ${issue.title}`,
          '',
          `State: ${issue.state?.name ?? 'unknown'}${issue.assignee?.name ? ` · Assignee: ${issue.assignee.name}` : ''}${labels.length > 0 ? ` · Labels: ${labels.join(', ')}` : ''}`,
          '',
          `${issue.description ?? ''}`,
        ].join('\n')
        return {
          ok: true,
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description ?? '',
            state: issue.state ? { id: issue.state.id, name: issue.state.name, type: issue.state.type } : null,
            labels,
             labelRecords,
            assignee: issue.assignee?.name ?? null,
             assigneeId: issue.assignee?.id ?? null,
             team: issue.team ? { id: issue.team.id, name: issue.team.name, key: issue.team.key } : null,
             project: issue.project ? { id: issue.project.id, name: issue.project.name } : null,
             updatedAt: issue.updatedAt ?? null,
             archivedAt: issue.archivedAt ?? null,
             trashed: issue.trashed === true,
             relations: core.shapeRelations(issue.relations),
             inverseRelations: core.shapeRelations(issue.inverseRelations),
            url: issue.url,
          },
          markdown,
        }
      }
      case 'listComments':
        return {
          ok: true,
          comments: (data.issue?.comments?.nodes ?? []).map((comment) => ({
            id: comment.id,
            body: comment.body,
            createdAt: comment.createdAt,
            user: comment.user?.name ?? null,
             userId: comment.user?.id ?? null,
             updatedAt: comment.updatedAt ?? null,
          })),
           pageInfo: data.issue?.comments?.pageInfo ?? { hasNextPage: false, endCursor: null },
         }
       case 'listIssueRelations':
         return { ok: true, relations: core.shapeRelations(data.issue?.relations), inverseRelations: core.shapeRelations(data.issue?.inverseRelations) }
       case 'issueRelationCreate': {
         const relation = data.issueRelationCreate?.issueRelation
         return { ok: true, success: data.issueRelationCreate?.success === true, relation: relation ? core.shapeRelations({ nodes: [relation] }).nodes[0] : null }
       }
       case 'issueRelationDelete':
         return { ok: true, success: data.issueRelationDelete?.success === true }
       case 'updateIssueLabels':
         return { ok: true, success: data.issueUpdate?.success === true, labels: (data.issueUpdate?.issue?.labels?.nodes ?? []).map((label) => ({ id: label.id, name: label.name })) }
       case 'listIssues':
      case 'searchIssues': {
        const nodes = data.issues?.nodes
        return {
          ok: true,
          issues: (nodes ?? []).map((issue) => ({
            identifier: issue.identifier,
            title: issue.title,
            state: issue.state?.name ?? null,
            url: issue.url,
          })),
        }
      }
      case 'createComment':
        return { ok: true, success: data.commentCreate?.success === true, commentId: data.commentCreate?.comment?.id ?? null }
      case 'updateIssue':
        return { ok: true, success: data.issueUpdate?.success === true, state: data.issueUpdate?.issue?.state?.name ?? null }
      case 'updateIssueDescription':
        return { ok: true, success: data.issueUpdate?.success === true, issue: data.issueUpdate?.issue ?? null }
      case 'projectCreate':
        return { ok: true, success: data.projectCreate?.success === true, project: data.projectCreate?.project ?? null }
      case 'issueCreate':
        return { ok: true, success: data.issueCreate?.success === true, issue: data.issueCreate?.issue ?? null }
      case 'listProjects':
        return {
          ok: true,
          projects: (data.projects?.nodes ?? []).map((project) => ({
            id: project.id,
            name: project.name,
            description: project.description ?? '',
          })),
          pageInfo: data.projects?.pageInfo ?? null,
        }
      case 'listProjectIssues':
        if (data.project === null || data.project === undefined) {
          throw Object.assign(new Error('Project not found'), { code: 'LINEAR_NOT_FOUND' })
        }
        return {
          ok: true,
          issues: (data.project?.issues?.nodes ?? []).map((issue) => ({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description ?? '',
            state: issue.state ? { id: issue.state.id, name: issue.state.name, type: issue.state.type } : null,
            projectId: issue.project?.id ?? null,
            teamId: issue.team?.id ?? null,
            url: issue.url,
          })),
          pageInfo: data.project?.issues?.pageInfo ?? null,
        }
      default:
        throw new Error(`Unknown Linear tool template: ${tool}`)
    }
  }

  // Full request/response round-trip over an injected transport
  // `transport(request)` -> { statusCode, bodyText } | { error }.
  core.execute = async function (tool, variables, transport) {
    const request = core.buildRequest(tool, variables)
    return core.parseResponse(tool, await transport(request))
  }

  // ── project mode (plan §3 C1–C3, §9.3/§9.7/§9.13, §10) ──────────────────
  // Stable markers; keep in sync with lib/planvalidate.js (asserted by the
  // marker-consistency test).
  core.projectMarker = function (projectId) {
    return `autoresearch-project:${projectId}`
  }

  core.nodeMarker = function (projectId, nodeId) {
    return `autoresearch-node:${projectId}:${nodeId}`
  }

  // Deterministic local WAL primitives. Linear has no mutation idempotency
  // key, so the local event digest and mutation key are the replay contract.
  core.SUPPORTED_OUTBOX_OPERATIONS = Object.freeze(['relation.create', 'labels.update', 'comment', 'node.project', 'node.context.update'])
  core.isSupportedOutboxOperation = function (operation) { return core.SUPPORTED_OUTBOX_OPERATIONS.includes(String(operation ?? '')) }
  core.syncMutationKey = function (projectId, nodeId, operation, payload = {}) {
    return autoresearchCore.sha256Text(autoresearchCore.stableStringify({ projectId: String(projectId), nodeId: String(nodeId), operation: String(operation), payload }))
  }
  core.makeSyncEvent = function ({ prevDigest = '', projectId, nodeId, operation, payload = {}, phase = 'projection', expect = null, createdAt } = {}) {
    const body = {
      kind: 'sync-event',
      prevDigest: String(prevDigest ?? ''),
      projectId: String(projectId ?? ''),
      nodeId: String(nodeId ?? ''),
      operation: String(operation ?? ''),
      phase: String(phase ?? 'projection'),
      expect: expect ?? null,
      payload,
      createdAt: typeof createdAt === 'string' && createdAt ? createdAt : new Date().toISOString(),
    }
    return { ...body, digest: autoresearchCore.sha256Text(autoresearchCore.stableStringify(body)) }
  }
  core.verifySyncEvent = function (event, expectedPrevDigest = '') {
    if (!util.isPlainObject(event) || event.kind !== 'sync-event') return { ok: false, error: 'invalid sync event schema' }
    // prevDigest is a string, but the empty string is the legal genesis
    // predecessor: the first event in a project chain has nothing before it.
    if (typeof event.prevDigest !== 'string') return { ok: false, error: 'invalid sync event field: prevDigest' }
    for (const field of ['projectId', 'nodeId', 'operation', 'phase', 'createdAt']) {
      if (typeof event[field] !== 'string' || !event[field]) return { ok: false, error: 'invalid sync event field: ' + field }
    }
    if (!util.isPlainObject(event.payload)) return { ok: false, error: 'invalid sync event payload' }
    if (typeof event.digest !== 'string' || !event.digest) return { ok: false, error: 'invalid sync event digest' }
    if (String(event.prevDigest ?? '') !== String(expectedPrevDigest ?? '')) return { ok: false, error: 'sync event predecessor mismatch' }
    const { digest, ...body } = event
    const actual = autoresearchCore.sha256Text(autoresearchCore.stableStringify(body))
    return actual === digest ? { ok: true, digest } : { ok: false, error: 'sync event digest mismatch', actual }
  }
  core.deriveDependencyRelations = function (plan, issueByNode = {}) {
    const edges = []
    for (const node of Array.isArray(plan?.nodes) ? plan.nodes : []) {
      const downstreamIssueId = issueByNode[node.id]?.id ?? issueByNode[node.id]
      if (!downstreamIssueId) continue
      for (const upstreamId of Array.isArray(node.dependsOn) ? node.dependsOn : []) {
        const upstreamIssueId = issueByNode[upstreamId]?.id ?? issueByNode[upstreamId]
        if (!upstreamIssueId || upstreamIssueId === downstreamIssueId) continue
        edges.push({ issueId: upstreamIssueId, relatedIssueId: downstreamIssueId, type: 'blocks', upstreamNodeId: upstreamId, downstreamNodeId: node.id })
      }
    }
    return edges.sort((a, b) => (a.upstreamNodeId + '\\0' + a.downstreamNodeId).localeCompare(b.upstreamNodeId + '\\0' + b.downstreamNodeId))
  }

  core.issueUnavailable = function (issue) {
    return Boolean(issue && (issue.archivedAt || issue.trashed === true))
  }
  core.mutationSucceeded = function (operation, remote) {
    if (!remote || remote.ok === false || remote.success === false) return false
    if (operation === 'node.project') return remote.state?.ok !== false && remote.state?.success !== false && remote.labels?.ok !== false && remote.labels?.success !== false && (!remote.comment || (remote.comment.ok !== false && remote.comment.success !== false))
    return true
  }
  core.findExistingRelation = function (snapshot, payload) {
    const expected = { kind: 'relation-edge', issueId: payload?.issueId, relatedIssueId: payload?.relatedIssueId, type: payload?.type }
    return (snapshot?.relations ?? []).find((item) => core.confirmationMatches(expected, item)) ?? null
  }
  core.confirmationMatches = function (expect, remote) {
    if (!expect || !remote || core.issueUnavailable(remote)) return false
    if (expect.kind === 'comment-marker') return String(remote.body ?? '').includes(String(expect.marker ?? ''))
    if (expect.kind === 'relation-edge') return remote.type === expect.type && remote.relatedIssue?.id === expect.relatedIssueId
    if (expect.kind === 'issue-state') return remote.state?.id === expect.stateId
    if (expect.kind === 'node-projection') {
      const issue = remote.issue ?? remote
      const labels = new Set((issue.labelRecords ?? issue.labels ?? []).map((label) => typeof label === 'string' ? label : label?.id).filter(Boolean))
      const stateMatches = issue.state?.id === expect.stateId
      // Without a configured blocked label the label requirement is vacuous
      // (preflight enforces the label when blocked holds are actually used).
      const labelMatches = !expect.blockedLabelId || (expect.blocked ? labels.has(expect.blockedLabelId) : !labels.has(expect.blockedLabelId))
      const commentMatches = !expect.commentMarker || (remote.comments ?? []).some((comment) => String(comment.body ?? '').includes(expect.commentMarker))
      return stateMatches && labelMatches && commentMatches
    }
    if (expect.kind === 'context-block') {
      const issue = remote.issue ?? remote
      const parsed = autoresearchCore.parseContextBlock(String(issue.description ?? ''))
      return parsed.ok === true && autoresearchCore.contextBlockDigest(parsed.state) === expect.contextDigest
    }
    if (expect.kind === 'labels') {
      const actual = new Set((remote.labelRecords ?? remote.labels ?? []).map((label) => typeof label === 'string' ? label : label?.id).filter(Boolean))
      const additions = new Set(expect.addIds ?? [])
      const removals = new Set(expect.removeIds ?? [])
      if (additions.size > 0 || removals.size > 0) return [...additions].every((id) => actual.has(id)) && [...removals].every((id) => !actual.has(id))
      const expected = new Set(expect.labelIds ?? [])
      return actual.size === expected.size && [...expected].every((id) => actual.has(id))
    }
    return false
  }
  core.causalComment = function ({ nodeId, blockedBy = [], reason = '', eventDigest } = {}) {
    const marker = 'autoresearch-causal:' + String(eventDigest ?? '')
    const blockers = [...new Set((Array.isArray(blockedBy) ? blockedBy : []).map(String).filter(Boolean))].sort()
    return { marker, body: marker + '\n\nCausal hold for node `' + String(nodeId ?? '') + '`. Blocked by: ' + (blockers.join(', ') || 'unspecified') + '. Reason: ' + (String(reason) || 'unspecified'), idempotencyMarker: marker }
  }

  core.deriveCausalHold = function ({ nodeId, blockedBy = [], reason, sourceEventDigest = null } = {}) {
    const blockers = [...new Set((Array.isArray(blockedBy) ? blockedBy : []).map(String).filter(Boolean))].sort()
    if (!String(nodeId ?? '').trim() || blockers.length === 0) return null
    return {
      kind: 'causal-hold',
      nodeId: String(nodeId),
      blockedBy: blockers,
      reason: String(reason ?? 'upstream causal dependency is unresolved'),
      sourceEventDigest: sourceEventDigest ? String(sourceEventDigest) : null,
    }
  }
  core.makeOutboxRecord = function ({ event, mutation, confirms = null, createdAt } = {}) {
    if (!util.isPlainObject(event) || typeof event.digest !== 'string' || !event.digest) throw new Error('outbox event is required')
    if (!util.isPlainObject(mutation) || typeof mutation.operation !== 'string' || !mutation.operation) throw new Error('outbox mutation is required')
    const operation = mutation.operation
    const payload = mutation.payload ?? {}
    const expected = confirms ?? event.expect ?? ({
      kind: operation === 'comment' ? 'comment-marker' : operation === 'relation.create' ? 'relation-edge' : operation === 'node.project' ? 'node-projection' : operation === 'node.context.update' ? 'context-block' : 'labels',
      ...(operation === 'comment' ? { marker: payload.idempotencyMarker ?? payload.marker ?? null } : {}),
      ...(operation === 'relation.create' ? { issueId: payload.issueId ?? null, relatedIssueId: payload.relatedIssueId ?? null, type: payload.type ?? null } : {}),
      ...(operation === 'node.project' ? { issueId: payload.issueId ?? null, stateId: payload.stateId ?? null, blockedLabelId: payload.blockedLabelId ?? null, blocked: (payload.blockedBy ?? []).length > 0, commentMarker: ((payload.blockedBy ?? []).length > 0 || payload.reason) ? 'autoresearch-causal:' + event.digest : null } : {}),
      ...(operation === 'node.context.update' ? { issueId: payload.issueId ?? null, contextDigest: payload.contextDigest ?? null } : {}),
      ...(operation === 'labels.update' ? { issueId: payload.issueId ?? null, labelIds: payload.labelIds ?? [], addIds: payload.addIds ?? [], removeIds: payload.removeIds ?? [] } : {}),
    })
    return {
      kind: 'outbox-record',
      phase: event.phase,
      confirms: expected,
      mutationKey: core.syncMutationKey(event.projectId, event.nodeId, mutation.operation, mutation.payload ?? {}),
      eventDigest: event.digest,
      projectId: event.projectId,
      nodeId: event.nodeId,
      operation: mutation.operation,
      payload: mutation.payload ?? {},
      status: 'pending',
      attempts: 0,
      createdAt: typeof createdAt === 'string' && createdAt ? createdAt : new Date().toISOString(),
      updatedAt: typeof createdAt === 'string' && createdAt ? createdAt : new Date().toISOString(),
    }
  }
  core.transitionOutbox = function (record, action, details = {}, now = new Date().toISOString()) {
    if (!util.isPlainObject(record) || record.kind !== 'outbox-record' || typeof record.mutationKey !== 'string' || !record.mutationKey || typeof record.eventDigest !== 'string' || !record.eventDigest || typeof record.operation !== 'string' || !record.operation) throw new Error('invalid outbox record')
    const terminal = record.status === 'confirmed' || record.status === 'dead'
    if (terminal) return { ...record }
    const next = { ...record, updatedAt: now }
    if (action === 'attempt') {
      // A hard crash can leave a record inflight; an inflight attempt is
      // retryable (the mutation may or may not have landed — replay paths
      // are idempotent and the context-update replay is CAS-guarded).
      if (!['pending', 'retry', 'inflight'].includes(record.status)) throw new Error('cannot attempt outbox record in status ' + record.status)
      next.status = 'inflight'; next.attempts = Number(record.attempts ?? 0) + 1
    } else if (action === 'confirm') {
      if (record.status !== 'inflight') throw new Error('cannot confirm outbox record in status ' + record.status)
      next.status = 'confirmed'; next.receipt = details
    } else if (action === 'retry') {
      if (record.status !== 'inflight') throw new Error('cannot retry outbox record in status ' + record.status)
      next.status = 'retry'; next.lastError = String(details.error ?? details)
    } else if (action === 'dead') {
      if (!['inflight', 'retry'].includes(record.status)) throw new Error('cannot dead-letter outbox record in status ' + record.status)
      next.status = 'dead'; next.lastError = String(details.error ?? details)
    } else throw new Error('unknown outbox transition: ' + action)
    return next
  }

  core.syncRoot = function (baseDir, projectId) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) throw new Error('linear sync requires a workspace base directory')
    if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('linear sync requires a project id')
    return pathutil.join(baseDir, '.research-agent', 'projects', projectId.trim(), 'linear-sync')
  }
  core.persistSyncEvent = async function (fops, baseDir, projectId, event) {
    if (!fops || typeof fops.readJson !== 'function' || typeof fops.writeJson !== 'function') throw new Error('linear sync requires JSON filesystem operations')
    const root = core.syncRoot(baseDir, projectId)
    const eventsDir = pathutil.join(root, 'events')
    const outboxDir = pathutil.join(root, 'outbox')
    await fops.ensureDir(eventsDir); await fops.ensureDir(outboxDir)
    const headPath = pathutil.join(root, 'head.json')
    const stat = typeof fops.statInfo === 'function' ? await fops.statInfo(headPath) : undefined
    const current = await fops.readJson(headPath)
    if (current && !stat?.version) throw new Error('linear sync head update requires versioned CAS support')
    if (!current && stat?.version) throw new Error('linear sync head observation is inconsistent')
    const expected = current?.digest ?? ''
    const check = core.verifySyncEvent(event, expected)
    if (!check.ok) throw new Error(check.error)
    const eventPath = pathutil.join(eventsDir, event.digest + '.json')
    const existing = await fops.readJson(eventPath)
    if (existing) return { ok: true, duplicate: true, digest: event.digest, outbox: null }
    await fops.writeJson(eventPath, event, { kind: 'createIfAbsent' })
    const head = { kind: 'sync-head', digest: event.digest, updatedAt: event.createdAt }
    if (stat?.version) await fops.writeJson(headPath, head, { kind: 'replaceIfVersion', version: stat.version })
    else await fops.writeJson(headPath, head, { kind: 'createIfAbsent' })
    return { ok: true, duplicate: false, digest: event.digest, outbox: null }
  }

  core.markProjectionConfirmed = async function (fops, baseDir, projectId, record, receipt = null) {
    if (record?.operation !== 'node.project' || !record.nodeId) return { ok: true, skipped: true }
    const statePath = pathutil.join(baseDir, '.research-agent', 'projects', projectId, 'state.json')
    const state = await fops.readJson(statePath)
    const entry = state?.nodes?.[record.nodeId]
    if (!entry || entry.projectionStatus !== 'pending' || entry.linearProjection?.status !== record.payload?.status) return { ok: true, skipped: true, reason: 'projection superseded or absent' }
    const stat = typeof fops.statInfo === 'function' ? await fops.statInfo(statePath) : null
    if (!stat?.version) return { ok: false, skipped: true, reason: 'state acknowledgement requires versioned CAS support' }
    const confirmedAt = new Date().toISOString()
    entry.projectionStatus = 'confirmed'
    entry.linearProjection = { ...entry.linearProjection, confirmedAt, mutationKey: record.mutationKey, receipt }
    state.updatedAt = confirmedAt
    await fops.writeJson(statePath, state, { kind: 'replaceIfVersion', version: stat.version })
    return { ok: true, skipped: false, nodeId: record.nodeId, confirmedAt }
  }

  core.persistOutboxRecord = async function (fops, baseDir, projectId, record) {
    if (!fops || typeof fops.writeJson !== 'function') throw new Error('linear outbox requires JSON filesystem operations')
    const root = core.syncRoot(baseDir, projectId)
    const dir = pathutil.join(root, 'outbox')
    await fops.ensureDir(dir)
    const file = pathutil.join(dir, record.mutationKey + '.json')
    const existing = typeof fops.readJson === 'function' ? await fops.readJson(file) : undefined
    if (existing) return { ok: true, duplicate: true, record: existing }
    await fops.writeJson(file, record, { kind: 'createIfAbsent' })
    return { ok: true, duplicate: false, record }
  }

  core.listOutboxRecords = async function (fops, baseDir, projectId, opts = {}) {
    const root = core.syncRoot(baseDir, projectId)
    const entries = typeof fops.listDir === 'function' ? await fops.listDir(pathutil.join(root, 'outbox')) : []
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 50
    const records = []
    for (const entry of entries.filter((item) => !item.dir && String(item.name).endsWith('.json'))) {
      const record = await fops.readJson(pathutil.join(root, 'outbox', entry.name))
      if (record) records.push(record)
    }
    const eventEntries = typeof fops.listDir === 'function' ? await fops.listDir(pathutil.join(root, 'events')) : []
    const events = new Map()
    for (const entry of eventEntries.filter((item) => !item.dir && String(item.name).endsWith('.json'))) {
      const event = await fops.readJson(pathutil.join(root, 'events', entry.name))
      if (event?.digest) events.set(event.digest, event)
    }
    const head = await fops.readJson(pathutil.join(root, 'head.json'))
    const order = new Map(); let digest = head?.digest; let index = events.size
    while (digest) {
      if (order.has(digest)) throw new Error('linear WAL event chain contains a cycle')
      const event = events.get(digest)
      if (!event || !core.verifySyncEvent(event, event.prevDigest ?? '').ok) throw new Error('linear WAL event chain is missing or corrupt at ' + digest)
      order.set(digest, index); index -= 1; digest = event.prevDigest
    }
    for (const record of records) {
      const event = events.get(record.eventDigest)
      if (!event || !order.has(record.eventDigest)) throw new Error('outbox record references an event outside the active WAL chain: ' + record.mutationKey)
      if (event.projectId !== record.projectId || event.nodeId !== record.nodeId || event.operation !== record.operation || autoresearchCore.stableStringify(event.payload) !== autoresearchCore.stableStringify(record.payload)) throw new Error('outbox record does not match its WAL event: ' + record.mutationKey)
    }
    // Non-terminal records are SELECTED first (a backlog of retained
    // confirmed/dead records must never starve newer pending intent out of
    // the window), but the returned window keeps WAL order so callers see
    // results in causal sequence.
    const prioritized = records.sort((a, b) => {
      const aTerminal = a.status === 'confirmed' || a.status === 'dead'
      const bTerminal = b.status === 'confirmed' || b.status === 'dead'
      if (aTerminal !== bTerminal) return aTerminal ? 1 : -1
      return order.get(a.eventDigest) - order.get(b.eventDigest)
    })
    return prioritized.slice(0, limit).sort((a, b) => order.get(a.eventDigest) - order.get(b.eventDigest))
  }
  core.listComments = async function (issueId, transport, opts = {}) {
    const first = typeof opts.first === 'number' ? opts.first : 50
    const maxPages = typeof opts.maxPages === 'number' ? opts.maxPages : 10
    let after = null; let pages = 0; const comments = []
    for (;;) {
      pages += 1
      const page = await core.execute('listComments', { id: issueId, first, ...(after ? { after } : {}) }, transport)
      comments.push(...(page.comments ?? []))
      if (!page.pageInfo?.hasNextPage || !page.pageInfo?.endCursor || pages >= maxPages) break
      after = page.pageInfo.endCursor
    }
    return { ok: true, issueId, comments, pages, truncated: pages >= maxPages }
  }

  core.listIssueRelations = async function (issueId, transport, opts = {}) {
    const first = typeof opts.first === 'number' ? opts.first : 50
    const maxPages = typeof opts.maxPages === 'number' ? opts.maxPages : 10
    let after = null; let pages = 0; const relations = []; const inverseRelations = []
    for (;;) {
      pages += 1
      const page = await core.execute('listIssueRelations', { id: issueId, first, ...(after ? { after } : {}) }, transport)
      relations.push(...(page.relations?.nodes ?? [])); inverseRelations.push(...(page.inverseRelations?.nodes ?? []))
      if ((!page.relations?.pageInfo?.hasNextPage && !page.inverseRelations?.pageInfo?.hasNextPage) || pages >= maxPages) break
      after = page.relations?.pageInfo?.endCursor ?? page.inverseRelations?.pageInfo?.endCursor
      if (!after) break
    }
    return { ok: true, issueId, relations, inverseRelations, pages, truncated: pages >= maxPages }
  }

  core.resolveLabelId = function (labels, name) {
    const wanted = String(name ?? '').trim().toLowerCase()
    return (Array.isArray(labels) ? labels : []).find((label) => String(label?.name ?? '').trim().toLowerCase() === wanted)?.id ?? null
  }
  core.preflightCapabilities = function (metadata, opts = {}) {
    const teams = Array.isArray(metadata?.teams) ? metadata.teams : []
    const teamId = String(opts.teamId ?? '').trim()
    const errors = []; const warnings = []
    if (!util.isPlainObject(metadata) || metadata.ok === false || !Array.isArray(metadata?.teams)) errors.push('workspace metadata schema invalid')
    const malformedTeams = teams.filter((team) => !util.isPlainObject(team) || typeof team.id !== 'string' || !team.id || !Array.isArray(team.states))
    if (malformedTeams.length > 0) errors.push('workspace metadata contains malformed team records')
    const teamMatches = teams.filter((team) => !teamId || team.id === teamId)
    if (teamMatches.length !== 1) errors.push(teamMatches.length === 0 ? 'selected team not found' : 'selected team is ambiguous')
    const team = teamMatches[0]
    const states = Array.isArray(team?.states) ? team.states : []
    const labels = Array.isArray(metadata?.labels) ? metadata.labels : (Array.isArray(team?.labels) ? team.labels : [])
    const byType = (types) => states.filter((state) => types.includes(String(state.type ?? '').toLowerCase()))
    const stateMap = {}
    for (const [name, types] of Object.entries({ todo: ['triage', 'backlog', 'unstarted'], inProgress: ['started'], done: ['completed'], canceled: ['canceled'] })) {
      const matches = byType(types)
      if (matches.length > 1) errors.push('state mapping ambiguous for ' + name)
      else if (matches.length === 1) stateMap[name] = { id: matches[0].id, name: matches[0].name, type: matches[0].type }
      else errors.push('state mapping missing for ' + name)
    }
    const blockedLabel = core.resolveLabelId(labels, opts.blockedLabel ?? 'autoresearch-blocked')
    if (!blockedLabel) warnings.push('blocked label not found; causal holds cannot be labeled until it is created or configured')
    const selectedStateIds = new Set(states.map((state) => state?.id).filter(Boolean))
    for (const stateId of Array.isArray(opts.requestedStateIds) ? opts.requestedStateIds : []) {
      if (!selectedStateIds.has(stateId)) errors.push('state id does not belong to selected team: ' + stateId)
    }
    const mutationCapability = ['read-write', 'read-only'].includes(opts.mutationCapability) ? opts.mutationCapability : 'unverified'
    if (mutationCapability === 'read-only') errors.push('Linear mutation permission is read-only')
    if (mutationCapability === 'unverified') warnings.push('Linear mutation permission is unverified; establish capability before replay')
    return { ok: errors.length === 0, team: team ? { id: team.id, name: team.name } : null, states: stateMap, blockedLabelId: blockedLabel, capabilities: { read: metadata?.ok !== false, mutation: mutationCapability, contextDescription: mutationCapability === 'read-write' ? 'available' : 'unavailable' }, errors, warnings, checkedAt: new Date().toISOString() }
  }

  core.mergeLabelIds = function (currentLabels, addIds = [], removeIds = []) {
    const removed = new Set(removeIds.filter(Boolean)); const result = []
    for (const id of [...(currentLabels ?? []).map((label) => typeof label === 'string' ? label : label?.id), ...addIds]) {
      if (id && !removed.has(id) && !result.includes(id)) result.push(id)
    }
    return result
  }

  core.createIssueRelation = async function (input, transport) {
    return await core.execute('issueRelationCreate', { input }, transport)
  }

  core.deleteIssueRelation = async function (relationId, transport) {
    return await core.execute('issueRelationDelete', { id: relationId }, transport)
  }

  core.updateIssueLabels = async function (issueId, currentLabels, transport, opts = {}) {
    const labelIds = core.mergeLabelIds(currentLabels, opts.addIds, opts.removeIds)
    return await core.execute('updateIssueLabels', { id: issueId, labelIds }, transport)
  }

  core.updateIssueDescription = async function (issueId, description, transport) {
    return await core.execute('updateIssueDescription', { id: issueId, description: String(description ?? '') }, transport)
  }

  // Render the owned context block into a description, preserving all
  // user-authored text outside the block (plan §7.2/§7.6).
  core.buildContextDescription = function (currentDescription, state) {
    const block = autoresearchCore.renderContextBlock(state)
    return autoresearchCore.upsertContextBlock(String(currentDescription ?? ''), block)
  }

  // ── recovery cache (plan §7.7) ───────────────────────────────────────────
  // Non-authoritative: the last successfully read block, its digest, and the
  // pending write intent. It never authorizes claim/reopen/acceptance/
  // completion/publication; on reconnection Linear is read first and the
  // intent reconciled before work resumes.

  core.recoveryCachePath = function (baseDir, projectId, nodeId) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) throw new Error('recovery cache requires a workspace base directory')
    if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('recovery cache requires a project id')
    if (typeof nodeId !== 'string' || !nodeId.trim()) throw new Error('recovery cache requires a node id')
    return pathutil.join(baseDir, '.research-agent', 'projects', projectId.trim(), 'linear-sync', 'recovery', nodeId.trim() + '.json')
  }
  core.validateRecoveryCache = function (cache) {
    if (!util.isPlainObject(cache) || cache.kind !== 'linear-node-context-recovery') return { ok: false, error: 'invalid recovery cache shape' }
    // expectedContextDigest may be empty: initializing a block that does not
    // yet exist has no prior digest to expect. Every other field is required.
    for (const field of ['projectId', 'nodeId', 'issueId', 'contextDigest', 'description', 'createdAt']) {
      if (typeof cache[field] !== 'string' || !cache[field]) return { ok: false, error: 'recovery cache field ' + field + ' is required' }
    }
    if (typeof cache.expectedContextDigest !== 'string') return { ok: false, error: 'recovery cache field expectedContextDigest is required' }
    if (!['pending', 'confirmed'].includes(cache.status)) return { ok: false, error: 'recovery cache status must be pending or confirmed' }
    return { ok: true }
  }
  core.writeRecoveryCache = async function (fops, baseDir, projectId, nodeId, intent) {
    if (!fops || typeof fops.writeJson !== 'function') throw new Error('recovery cache requires JSON filesystem operations')
    const cache = {
      kind: 'linear-node-context-recovery',
      projectId: String(projectId),
      nodeId: String(nodeId),
      issueId: String(intent.issueId ?? ''),
      expectedContextDigest: String(intent.expectedContextDigest ?? ''),
      contextDigest: String(intent.contextDigest ?? ''),
      description: String(intent.description ?? ''),
      state: intent.state ?? null,
      status: 'pending',
      createdAt: typeof intent.createdAt === 'string' && intent.createdAt ? intent.createdAt : new Date().toISOString(),
    }
    if (!cache.issueId) throw new Error('recovery cache intent requires issueId')
    const check = core.validateRecoveryCache(cache)
    if (!check.ok) throw new Error(check.error)
    const file = core.recoveryCachePath(baseDir, projectId, nodeId)
    await fops.ensureDir(pathutil.dirname(file))
    await fops.writeJson(file, cache)
    return cache
  }
  core.readRecoveryCache = async function (fops, baseDir, projectId, nodeId) {
    if (!fops || typeof fops.readJson !== 'function') return null
    const cache = await fops.readJson(core.recoveryCachePath(baseDir, projectId, nodeId))
    const check = core.validateRecoveryCache(cache)
    return check.ok ? cache : null
  }
  core.markRecoveryCacheConfirmed = async function (fops, baseDir, projectId, nodeId, receipt = null) {
    if (!fops || typeof fops.writeJson !== 'function') throw new Error('recovery cache requires JSON filesystem operations')
    const file = core.recoveryCachePath(baseDir, projectId, nodeId)
    const cache = await core.readRecoveryCache(fops, baseDir, projectId, nodeId)
    if (!cache) return { ok: false, skipped: true, reason: 'absent' }
    if (cache.status === 'confirmed') return { ok: true, skipped: true, cache }
    const confirmed = { ...cache, status: 'confirmed', confirmedAt: typeof receipt === 'string' && receipt ? receipt : new Date().toISOString(), receipt: receipt === null || typeof receipt === 'object' ? receipt : null }
    await fops.writeJson(file, confirmed)
    return { ok: true, cache: confirmed }
  }
  core.clearRecoveryCache = async function (fops, baseDir, projectId, nodeId) {
    if (!fops || typeof fops.remove !== 'function') return false
    try { await fops.remove(core.recoveryCachePath(baseDir, projectId, nodeId)); return true } catch { return false }
  }
  // Read Linear FIRST (plan §7.7), then classify the pending intent:
  //  - 'applied'     the live block already carries the intent digest (write
  //                  landed; confirm and clear the cache)
  //  - 'not-applied' the live block still carries the expected prior digest
  //                  (replay through the WAL/outbox)
  //  - 'conflict'    the live block carries something else (a human or a
  //                  concurrent actor edited the owned area; surface it,
  //                  never overwrite)
  //  - 'missing'     the live issue has no valid block; the intent's prior
  //                  was also empty, so a replay is safe
  core.reconcileRecoveryCache = function (cache, liveDescription) {
    const check = core.validateRecoveryCache(cache)
    if (!check.ok) return { status: 'invalid', error: check.error }
    const live = autoresearchCore.parseContextBlock(String(liveDescription ?? ''))
    const liveDigest = live.ok ? autoresearchCore.contextBlockDigest(live.state) : null
    if (liveDigest === cache.contextDigest) return { status: 'applied', liveState: live.state, liveDescription: String(liveDescription ?? '') }
    if (!live.ok && cache.expectedContextDigest === '') return { status: 'not-applied', liveState: null }
    if (live.ok && liveDigest === cache.expectedContextDigest) return { status: 'not-applied', liveState: live.state, liveDescription: String(liveDescription ?? '') }
    return { status: 'conflict', liveState: live.ok ? live.state : null, liveDigest, expectedDigest: cache.expectedContextDigest, intentDigest: cache.contextDigest }
  }

  // Paginated project listing (plan C3): never assumes one page.
  core.listProjectIssues = async function (projectId, transport, opts = {}) {
    const first = typeof opts.first === 'number' ? opts.first : 50
    const maxPages = Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? Math.min(opts.maxPages, 100) : 10
    const maxNodes = Number.isInteger(opts.maxNodes) && opts.maxNodes > 0 ? Math.min(opts.maxNodes, 5000) : 500
    let after = null
    const issues = []
    let pages = 0
    for (;;) {
      pages += 1
      const variables = { id: projectId, first, ...(after ? { after } : {}) }
      const page = await core.execute('listProjectIssues', variables, transport)
      for (const issue of page.issues ?? []) {
        if (issues.length >= maxNodes) throw Object.assign(new Error('Linear project node ceiling exceeded: ' + maxNodes), { code: 'LINEAR_PROJECT_NODE_CEILING' })
        issues.push(issue)
      }
      if (!page.pageInfo?.hasNextPage || !page.pageInfo?.endCursor) break
      if (pages >= maxPages) throw Object.assign(new Error('Linear project snapshot page ceiling exceeded: ' + maxPages), { code: 'LINEAR_PROJECT_SNAPSHOT_TRUNCATED' })
      after = page.pageInfo.endCursor
    }
    return { ok: true, projectId, issues, pages, truncated: false, maxNodes }
  }

  // Resolve the single approved team (plan D6/§9.3): explicit teamId wins,
  // then teamKey, then a lone team; otherwise fail closed. Never guesses.
  core.resolveTeam = async function (params, transport) {
    const meta = await core.execute('workspaceMetadata', {}, transport)
    const teams = Array.isArray(meta?.teams) ? meta.teams : []
    if (typeof params?.teamId === 'string' && params.teamId.trim()) {
      const team = teams.find((entry) => entry.id === params.teamId.trim())
      if (!team) throw Object.assign(new Error(`Team id not found in workspace: ${params.teamId}`), { code: 'LINEAR_TEAM_NOT_FOUND' })
      return { team, resolvedFrom: 'teamId' }
    }
    if (typeof params?.teamKey === 'string' && params.teamKey.trim()) {
      const key = params.teamKey.trim().toLowerCase()
      const team = teams.find((entry) => String(entry.key ?? '').toLowerCase() === key)
      if (!team) throw Object.assign(new Error(`Team key not found in workspace: ${params.teamKey}`), { code: 'LINEAR_TEAM_NOT_FOUND' })
      return { team, resolvedFrom: 'teamKey' }
    }
    if (teams.length === 1) return { team: teams[0], resolvedFrom: 'solo' }
    throw Object.assign(new Error('A team is required: pass teamId or teamKey (or configure a workspace with exactly one team).'), { code: 'LINEAR_TEAM_REQUIRED' })
  }

  // Build the project description within Linear's 255-char project
  // description limit (projectCreate input constraint), always preserving the
  // full AutoResearch marker (reconciliation depends on it).
  core.projectDescription = function (description, projectId) {
    const marker = core.projectMarker(projectId)
    const separator = '\n\n'
    const budget = 255 - marker.length - separator.length
    let desc = typeof description === 'string' && description.trim() ? description.trim() : ''
    if (desc.length > budget) desc = `${desc.slice(0, budget - 1)}\u2026`
    return desc ? `${desc}${separator}${marker}` : marker
  }

  // Marker-based reconciliation (plan §9.7): never by name alone. Scans
  // project descriptions for the AutoResearch project marker. Ambiguity
  // fails loudly rather than guessing.
  core.reconcileProject = async function (projectId, transport, opts = {}) {
    const marker = core.projectMarker(projectId)
    const first = typeof opts.first === 'number' ? opts.first : 50
    const maxPages = typeof opts.maxPages === 'number' ? opts.maxPages : 10
    let after = null
    const matches = []
    let pages = 0
    for (;;) {
      pages += 1
      const variables = { first, ...(after ? { after } : {}) }
      const page = await core.execute('listProjects', variables, transport)
      for (const project of page.projects ?? []) {
        if ((project.description ?? '').includes(marker)) matches.push(project)
      }
      if (!page.pageInfo?.hasNextPage || !page.pageInfo?.endCursor) break
      if (pages >= maxPages) break
      after = page.pageInfo.endCursor
    }
    if (matches.length > 1) {
      throw Object.assign(new Error(`Multiple Linear projects carry the marker "${marker}"; reconcile by marker before creating.`), { code: 'LINEAR_AMBIGUOUS' })
    }
    return matches.length === 1 ? matches[0] : null
  }

  // Marker-based issue reconciliation keeps the Linear container id separate
  // from the stable AutoResearch plan id embedded in node markers. Only the
  // canonical marker (keyed on the stable AutoResearch project id) is matched.
  core.reconcileIssueCandidates = async function (linearProjectId, autoresearchProjectId, nodeId, transport, opts = {}) {
    const marker = core.nodeMarker(autoresearchProjectId, nodeId)
    const { issues } = await core.listProjectIssues(linearProjectId, transport, opts)
    const canonicalMatches = issues.filter((issue) => (issue.description ?? '').includes(marker))
    if (canonicalMatches.length > 1) {
      throw Object.assign(new Error(`Multiple Linear issues carry the canonical marker for node "${nodeId}"; reconcile before creating.`), { code: 'LINEAR_AMBIGUOUS' })
    }
    return {
      marker,
      canonical: canonicalMatches[0] ?? null,
    }
  }

  core.reconcileIssue = async function (linearProjectId, nodeId, transport, opts = {}) {
    const autoresearchProjectId = typeof opts.autoresearchProjectId === 'string' && opts.autoresearchProjectId.trim()
      ? opts.autoresearchProjectId.trim()
      : linearProjectId
    const matches = await core.reconcileIssueCandidates(linearProjectId, autoresearchProjectId, nodeId, transport, opts)
    return matches.canonical
  }

  // Approval-gated project creation (plan §9.13): reconcile by marker, and
  // only when nothing exists request approval; unavailable/rejected/cancelled
  // approval fails closed (the injected `approver` throws for those).
  // `approver(reason)` -> Promise<void>.
  core.createProjectFlow = async function (params, transport, approver) {
    if (!params || typeof params.name !== 'string' || !params.name.trim()) {
      throw new Error('name must be a non-empty string.')
    }
    if (!params || typeof params.projectId !== 'string' || !params.projectId.trim()) {
      throw new Error('projectId must be a non-empty string (the stable AutoResearch project id).')
    }
    const { team, resolvedFrom } = await core.resolveTeam(params, transport)

    const existing = await core.reconcileProject(params.projectId, transport, params)
    if (existing) {
      return { created: false, reconciled: true, project: existing, team: { id: team.id, key: team.key, name: team.name, resolvedFrom }, reason: 'existing project with the same marker' }
    }

    await approver(`create Linear project "${params.name}" (team ${team.key})`)

    const input = {
      name: params.name.trim(),
      teamIds: [team.id],
      description: core.projectDescription(params.description, params.projectId),
    }
    if (typeof params.priority === 'number') input.priority = params.priority
    if (typeof params.startDate === 'string' && params.startDate) input.startDate = params.startDate
    if (typeof params.targetDate === 'string' && params.targetDate) input.targetDate = params.targetDate

    const result = await core.execute('projectCreate', { input }, transport)
    if (result.success !== true || !result.project) {
      throw Object.assign(new Error('Linear projectCreate reported failure'), { code: 'LINEAR_MUTATION_FAILED' })
    }
    return {
      created: true,
      reconciled: false,
      project: result.project,
      team: { id: team.id, key: team.key, name: team.name, resolvedFrom },
      receipt: {
        marker: core.projectMarker(params.projectId),
        teamId: team.id,
        projectId: result.project.id,
        name: result.project.name,
        url: result.project.url ?? '',
        createdAt: new Date().toISOString(),
      },
    }
  }

  // Approval-gated issue creation (plan C2/§9.3/§9.13): the Linear project
  // UUID selects the container; autoresearchProjectId supplies the stable plan
  // id embedded in the canonical node marker.
  core.createIssueFlow = async function (params, transport, approver) {
    if (!params || typeof params.projectId !== 'string' || !params.projectId.trim()) {
      throw new Error('projectId must be a non-empty string (the Linear project id).')
    }
    if (!params || typeof params.autoresearchProjectId !== 'string' || !params.autoresearchProjectId.trim()) {
      throw new Error('autoresearchProjectId must be a non-empty string (matches plan.projectId).')
    }
    if (!params || typeof params.nodeId !== 'string' || !params.nodeId.trim()) {
      throw new Error('nodeId must be a non-empty string.')
    }
    if (!params || typeof params.title !== 'string' || !params.title.trim()) {
      throw new Error('title must be a non-empty string.')
    }
    const linearProjectId = params.projectId.trim()
    const autoresearchProjectId = params.autoresearchProjectId.trim()
    const nodeId = params.nodeId.trim()
    const { team, resolvedFrom } = await core.resolveTeam(params, transport)
    const teamReceipt = { id: team.id, key: team.key, name: team.name, resolvedFrom }

    const matches = await core.reconcileIssueCandidates(linearProjectId, autoresearchProjectId, nodeId, transport, params)
    if (matches.canonical) {
      return { created: false, reconciled: true, issue: matches.canonical, team: teamReceipt, reason: 'existing issue with the same marker' }
    }

    await approver(`create Linear issue "${params.title.trim()}" in project ${linearProjectId} (team ${team.key})`)

    const input = {
      teamId: team.id,
      projectId: linearProjectId,
      title: params.title.trim(),
      description: `${typeof params.description === 'string' && params.description.trim() ? `${params.description.trim()}\n\n` : ''}${matches.marker}`,
    }
    if (typeof params.parentId === 'string' && params.parentId) input.parentId = params.parentId
    if (typeof params.stateId === 'string' && params.stateId) input.stateId = params.stateId
    if (typeof params.estimate === 'number') input.estimate = params.estimate

    const result = await core.execute('issueCreate', { input }, transport)
    if (result.success !== true || !result.issue) {
      throw Object.assign(new Error('Linear issueCreate reported failure'), { code: 'LINEAR_MUTATION_FAILED' })
    }
    return {
      created: true,
      reconciled: false,
      issue: result.issue,
      team: teamReceipt,
      receipt: {
        marker: matches.marker,
        teamId: team.id,
        projectId: linearProjectId,
        autoresearchProjectId,
        issueId: result.issue.id,
        identifier: result.issue.identifier,
        url: result.issue.url ?? '',
        createdAt: new Date().toISOString(),
      },
    }
  }

  return core
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeLinearCore


// ── LINEAR PLUGIN GLUE TAIL v2 (concatenated after lib/linear-core.js) ──
// Generation-aware Linear glue. The Linear transport, marker reconciliation,
// and approval gate are unchanged; this tail adds the contract-derived spec
// block projection (plan §4.5), idempotent revision-request comments, and the
// runtime build probe.

export const EMBEDDED_GENERATION = '__AUTORESEARCH_GENERATION__'
export const EMBEDDED_BUILD_ID = '__AUTORESEARCH_BUILD_ID__'

const LINEAR_HELPER_PATH = decodeURIComponent(new URL('./linear-client.mjs', import.meta.url).pathname)
const MANIFEST_PATH = decodeURIComponent(new URL('./build-manifest.json', import.meta.url).pathname)
const linearCore = makeLinearCore(util)

// ── module-level helpers (shared with apply) ───────────────────────────────

function absPath(baseDir, p) {
  const base = pathutil.normalize(baseDir)
  const value = String(p)
  if (pathutil.isAbsolute(value)) return pathutil.normalize(value)
  return pathutil.join(base, value)
}

async function runSubprocess(subprocessService, baseDir, argv, opts = {}) {
  const handle = subprocessService.spawn({
    argv,
    cwd: baseDir,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: opts.maxBytes ?? 4 * 1024 * 1024 },
      stderr: { maxBytes: opts.maxBytes ?? 1024 * 1024 },
    },
    graceMs: opts.graceMs ?? 60000,
    ...(opts.env ? { env: opts.env } : {}),
  })
  const outcome = await handle.done
  const stdout = await handle.collected.stdout.readFrom(0)
  const stderr = await handle.collected.stderr.readFrom(0)
  return { exitCode: outcome.exitCode, stdout: stdout.text, stderr: stderr.text }
}

async function resolveExecutable(subprocessService, name) {
  try {
    return await subprocessService.resolveExecutable(name)
  } catch (error) {
    throw new Error('Executable not resolvable: ' + name + ' (' + (error instanceof Error ? error.message : String(error)) + ')')
  }
}

// Runtime build probe: read the manifest from disk (cat), recompute disk
// hashes (shasum), compare with the embedded aggregate ID.
async function runBuildProbe(subprocessService, baseDir) {
  const cat = await resolveExecutable(subprocessService, 'cat')
  const manifestResult = await runSubprocess(subprocessService, baseDir, [cat, MANIFEST_PATH])
  let manifest = null
  try {
    manifest = JSON.parse(manifestResult.stdout)
  } catch {
    return { probeName: 'linear-build-probe', graphMatches: false, mismatches: ['build-manifest.json unreadable or invalid'], manifest: null }
  }
  const shasum = await resolveExecutable(subprocessService, 'shasum')
  // Manifest paths are relative to the preset root, not the caller's
  // workspace. Derive that root from the absolute manifest URL.
  const presetRoot = pathutil.dirname(pathutil.dirname(MANIFEST_PATH))
  const graph = {}
  const mismatches = []
  const configDrift = []
  const scope = Array.isArray(manifest.aggregateScope) ? manifest.aggregateScope : Object.keys(manifest.files ?? {})
  const immutableScope = new Set(scope)
  for (const [relPath, expectedHash] of Object.entries(manifest.files ?? {})) {
    // The manifest's config slot tracks the public template, while the
    // installed preset carries the effective deployment config under its
    // own name; hash the installed file for that slot.
    const probePath = relPath === 'config.example.json' ? 'config.default.json' : relPath
    try {
      const result = await runSubprocess(subprocessService, baseDir, [shasum, '-a', '256', absPath(presetRoot, probePath)])
      const match = String(result.stdout).match(/^([0-9a-f]{64})\s+/m)
      if (!match) {
        (immutableScope.has(relPath) ? mismatches : configDrift).push(relPath + ': shasum produced no hash')
        continue
      }
      graph[relPath] = match[1]
      if (match[1] !== expectedHash) (immutableScope.has(relPath) ? mismatches : configDrift).push(relPath + ': hash mismatch')
    } catch (error) {
      (immutableScope.has(relPath) ? mismatches : configDrift).push(relPath + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const scopeGraph = {}
  for (const rel of scope) {
    if (graph[rel] !== undefined) scopeGraph[rel] = graph[rel]
  }
  const aggregate = autoresearchCore.aggregateBuildId(scopeGraph)
  const graphMatches = aggregate === manifest.aggregateId && mismatches.length === 0 && EMBEDDED_BUILD_ID === manifest.aggregateId
  return {
    probeName: 'linear-build-probe',
    generation: manifest.generation,
    schemaVersion: manifest.schemaVersion,
    expectedAggregateId: manifest.aggregateId,
    embeddedAggregateId: EMBEDDED_BUILD_ID,
    actualAggregateId: aggregate,
    graphMatches,
    graph,
    mismatches,
    configDrift,
    mountedUrl: import.meta.url,
  }
}

const LINEAR_PLUGIN = {
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const credentials = ctx.get('credentials')
    const fs = ctx.get('fs')

    function assertCallingAgent(exec) {
      if (exec?.agent === undefined) throw new Error('This tool requires a calling agent.')
    }

    function assertCoordinator(exec) {
      assertCallingAgent(exec)
      const depth = Number(exec?.agent?.session?.header?.delegationDepth ?? 0)
      if (depth > 0) throw new Error('This tool must be called by the coordinator, not a subagent child.')
    }

    async function transport(request, exec, baseDir) {
      const resolved = credentials !== undefined ? await credentials.resolve('LINEAR_API_KEY') : null
      const token = resolved !== null && typeof resolved === 'object' && 'value' in resolved ? resolved.value : resolved
      if (!token || !String(token).trim()) {
        return { error: 'LINEAR_API_KEY is not set in the environment or credentials store. Set it (env or credentials store) and retry; linear_whoami verifies.' }
      }
      if (subprocess === undefined) return { error: 'subprocess service unavailable; cannot run the linear-client helper.' }
      const node = await subprocess.resolveExecutable('node')
      const handle = subprocess.spawn({
        argv: [node, LINEAR_HELPER_PATH],
        cwd: baseDir,
        stdio: {
          stdin: { data: JSON.stringify(request) },
          stdout: { maxBytes: 2 * 1024 * 1024 },
          stderr: { maxBytes: 65536 },
        },
        graceMs: 30000,
        signal: exec?.signal,
        env: { LINEAR_API_KEY: String(token) },
      })
      const outcome = await handle.done
      const stdout = await handle.collected.stdout.readFrom(0)
      const stderr = await handle.collected.stderr.readFrom(0)
      if (outcome.exitCode === 2) {
        return { error: 'linear-client rejected the request: ' + stderr.text.slice(0, 500) }
      }
      if (outcome.exitCode !== 0) {
        return { error: 'linear-client failed: ' + (stderr.text || stdout.text).slice(0, 500) }
      }
      let parsed
      try {
        parsed = JSON.parse(stdout.text.trim())
      } catch {
        return { error: 'linear-client produced no parseable output.' }
      }
      if (!parsed || typeof parsed !== 'object') return { error: 'linear-client produced no parseable output.' }
      return parsed
    }

    function makeFops(baseDir) {
      if (fs === undefined) return null
      async function targetOf(p) {
        return await fs.resolve(p, { cwd: pathutil.normalize(baseDir) })
      }
      return {
        readJson: async (p) => {
          try {
            return JSON.parse(await fs.readText(await targetOf(p)))
          } catch {
            return undefined
          }
        },
        readText: async (p) => await fs.readText(await targetOf(p)),
        listDir: async (p) => {
          try {
            return (await fs.listDir(await targetOf(p))).map((entry) => ({ name: entry.name, dir: entry.type === 'directory' }))
          } catch { return [] }
        },
        statInfo: async (p) => await fs.stat(await targetOf(p)),
        writeJson: async (p, value, expected) => await fs.writeText(await targetOf(p), JSON.stringify(value, null, 2) + '\n', expected),
        ensureDir: async (p) => {
          if (subprocess === undefined) throw new Error('subprocess service unavailable; cannot create Linear sync directory')
          const mkdir = await subprocess.resolveExecutable('/bin/mkdir')
          const target = typeof fs.processPath === 'function' ? await fs.processPath(await targetOf(p)) : pathutil.normalize(p)
          const result = await runSubprocess(subprocess, baseDir, [mkdir, '-p', target])
          if (result.exitCode !== 0) throw new Error('mkdir failed for ' + target + ': ' + result.stderr.slice(-400))
        },
        remove: async (p) => {
          if (typeof fs.remove !== 'function') throw new Error('REMOVE_UNAVAILABLE')
          return await fs.remove(await targetOf(p))
        },
      }
    }

    // Load the approved plan from the calling workspace (plan §4.5): Linear
    // projection derives from the canonical contract, never from caller
    // prose.
    async function loadApprovedPlan(fops, baseDir, autoresearchProjectId) {
      if (!fops) throw new Error('fs service unavailable; cannot load the approved plan from the workspace')
      // Single root: the approved plan lives in the hidden .research-agent
      // artifact root; the bare 'research-agent/' tree is migration input
      // only, never a runtime candidate.
      const planPath = absPath(baseDir, '.research-agent/projects/' + autoresearchProjectId + '/plan.json')
      const plan = await fops.readJson(planPath)
      if (util.isPlainObject(plan)) return plan
      throw new Error('Approved plan not readable at ' + planPath + '; Linear projection is blocked (plan §4.5).')
    }

    function registerTool(definition) {
      if (typeof harness !== 'undefined' && harness && typeof harness.defineTool === 'function' && typeof harness.registerTool === 'function') {
        harness.registerTool(ctx, harness.defineTool(definition))
        return
      }
      const tools = ctx.get('tools')
      if (tools === undefined) throw new Error('tools registry unavailable')
      tools.register(definition)
    }

    function str(description) {
      return { type: 'string', description }
    }

    async function readLinearApprovalKnob(baseDir) {
      if (process.env.DSH_LINEAR_APPROVAL === 'ask') return 'ask'
      if (subprocess === undefined) return 'auto'
      try {
        const configCandidates = ['research-agent/config.json', '.research-agent/config.json']
        let configPath = absPath(baseDir, configCandidates[0])
        for (const candidate of configCandidates) {
          const path = absPath(baseDir, candidate)
          try {
            const value = await fs.readText(await fs.resolve(path, { cwd: baseDir }))
            JSON.parse(value)
            configPath = path
            break
          } catch {
          }
        }
        const node = await subprocess.resolveExecutable('node')
        const script = "const fs=require('fs');try{const c=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(c&&c.linear&&typeof c.linear.approval==='string'?c.linear.approval:'auto'))}catch(e){console.log('auto')}"
        const handle = subprocess.spawn({
          argv: [node, '-e', script, configPath],
          cwd: baseDir,
          stdio: {
            stdin: { data: '' },
            stdout: { maxBytes: 65536 },
            stderr: { maxBytes: 65536 },
          },
          graceMs: 10000,
        })
        const outcome = await handle.done
        const stdout = await handle.collected.stdout.readFrom(0)
        const parsed = JSON.parse(String(stdout.text).trim())
        return parsed === 'ask' ? 'ask' : 'auto'
      } catch {
        return 'auto'
      }
    }

    async function requireApproval(exec, toolName, reason, baseDir) {
      const knob = await readLinearApprovalKnob(baseDir)
      if (knob !== 'ask') return // default: approved without asking
      const approval = ctx.get('approval')
      if (approval === undefined) throw new Error(toolName + ' requires approval, but no approval service is composed')
      if (exec?.agent === undefined) throw new Error(toolName + ' requires approval, but the call has no agent to route it through')
      const outcome = await approval.request({
        agent: exec.agent,
        toolName,
        callId: exec.callId,
        reason,
        ...(exec.signal ? { signal: exec.signal } : {}),
      })
      switch (outcome) {
        case 'allowed-once': return
        case 'rejected': throw new Error('approval for "' + reason + '" was rejected (a real user rejection, or the session approval policy is \'never\', which auto-rejects without prompting)')
        case 'cancelled': throw new Error('approval for ' + reason + ' was cancelled')
        case 'unavailable': throw new Error(toolName + ' requires approval, but no approval channel is available')
        default: throw new Error('unexpected approval outcome: ' + String(outcome))
      }
    }

    // The ONE tool-schema boundary (shared with the orchestrator): every
    // tool's parameter schema is generated from autoresearch-core
    // (plan §4.2 / §6.5); no transport-specific hand copy may diverge.
    const GENERATED_TOOL_SCHEMAS = autoresearchCore.generateToolSchemas()
    function tool(name, description, paramsSchema, executor) {
      const generated = GENERATED_TOOL_SCHEMAS[name]
      if (paramsSchema != null && generated !== undefined) {
        if (JSON.stringify(generated) !== JSON.stringify(paramsSchema)) {
          throw new Error('Tool schema drift for ' + name + ': the inline parameter schema does not equal the schema generated from autoresearch-core.')
        }
      }
      registerTool({
        name,
        description,
        parameters: generated ?? paramsSchema ?? { type: 'object', additionalProperties: true },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render(_args, value) {
            const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
            return [{ type: 'text', text }]
          },
        },
        async execute(args, exec) {
          try {
            const result = await executor(args ?? {}, exec)
            return result === undefined ? null : result
          } catch (error) {
            throw error instanceof Error ? error : new Error(String(error))
          }
        },
      })
    }

    function executeLinear(toolName, variables, exec, baseDir) {
      return linearCore.execute(toolName, variables, (request) => transport(request, exec, baseDir))
    }

    function baseDirOf(exec, args) {
      if (typeof args?.baseDir === 'string' && args.baseDir.trim()) return args.baseDir
      const cwd = exec?.agent?.session?.header?.cwd
      return typeof cwd === 'string' && cwd ? cwd : '.'
    }
    // ── tools (installed behavior preserved; spec-block projection added) ──

    tool('linear_whoami', 'Verify Linear authentication and list the viewer + organization. Run this first on any Linear workflow.', null, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('whoami', {}, exec, baseDirOf(exec, args))
    })

    tool('linear_workspace_metadata', 'List teams with their issue states and labels. Required before any issue state transition.', null, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('workspaceMetadata', {}, exec, baseDirOf(exec, args))
    })

    tool('linear_capability_preflight', 'Coordinator-only: validate team-scoped Linear state mappings and blocked-label capability without remote mutation.', null, async (args, exec) => {
      assertCoordinator(exec)
      return linearCore.preflightCapabilities(args.metadata, args)
    })

    tool('linear_get_issue', 'Fetch one Linear issue as a structured snapshot plus init_run-ready markdown.', null, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('getIssue', { id: args.id }, exec, baseDirOf(exec, args))
    })

    tool('linear_list_comments', 'List comments on one Linear issue.', null, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('listComments', { id: args.id }, exec, baseDirOf(exec, args))
    })

    tool('linear_list_relations', 'List all outgoing and inverse relations for one focused issue, with bounded pagination.', null, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = baseDirOf(exec, args)
      return await linearCore.listIssueRelations(args.id, (request) => transport(request, exec, baseDir), args)
    })

    tool('linear_sync_enqueue', 'Coordinator-only: append a local digest-chained event and durable outbox record before projecting a Linear mutation.', null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      const fops = makeFops(baseDir)
      if (!fops) throw new Error('fs service unavailable; cannot persist Linear WAL')
      if (!linearCore.isSupportedOutboxOperation(args.operation)) throw new Error('unsupported outbox operation: ' + args.operation)
      const root = linearCore.syncRoot(baseDir, args.projectId)
      const head = await fops.readJson(pathutil.join(root, 'head.json'))
      // One shared expects-derivation (makeOutboxRecord's defaults): a
      // replayed projection must confirm the SAME things a direct projection
      // confirms — including the owned context block for node.context.update.
      const event = linearCore.makeSyncEvent({ prevDigest: head?.digest ?? '', projectId: args.projectId, nodeId: args.nodeId, operation: args.operation, payload: args.payload })
      const persisted = await linearCore.persistSyncEvent(fops, baseDir, args.projectId, event)
      const record = linearCore.makeOutboxRecord({ event, mutation: { operation: args.operation, payload: args.payload } })
      const queued = await linearCore.persistOutboxRecord(fops, baseDir, args.projectId, record)
      return { ok: true, event, persisted, outbox: queued.record, duplicate: queued.duplicate }
    })

    tool('linear_plan_relations', 'Coordinator-only: derive the exact approved-DAG dependency edges to project as upstream blocks downstream relations.', null, async (args, exec) => {
      assertCoordinator(exec)
      return { ok: true, relations: linearCore.deriveDependencyRelations(args.plan, args.issueByNode) }
    })

    tool('linear_sync_plan_relations', 'Coordinator-only: project the approved dependency DAG as WAL-backed Linear blocks relations.', null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args); const fops = makeFops(baseDir)
      if (!fops) throw new Error('fs service unavailable; cannot persist Linear WAL')
      const relations = linearCore.deriveDependencyRelations(args.plan, args.issueByNode); const results = []
      for (const relation of relations) {
        const payload = { issueId: relation.issueId, relatedIssueId: relation.relatedIssueId, type: relation.type }
        const root = linearCore.syncRoot(baseDir, args.projectId); const head = await fops.readJson(pathutil.join(root, 'head.json'))
        const event = linearCore.makeSyncEvent({ prevDigest: head?.digest ?? '', projectId: args.projectId, nodeId: relation.downstreamNodeId, operation: 'relation.create', payload })
        await linearCore.persistSyncEvent(fops, baseDir, args.projectId, event)
        const queued = await linearCore.persistOutboxRecord(fops, baseDir, args.projectId, linearCore.makeOutboxRecord({ event, mutation: { operation: 'relation.create', payload } }))
        if (['confirmed', 'dead'].includes(queued.record.status)) { results.push({ relation, status: queued.record.status, mutationKey: queued.record.mutationKey }); continue }
        const recordPath = pathutil.join(root, 'outbox', queued.record.mutationKey + '.json'); const attempted = linearCore.transitionOutbox(queued.record, 'attempt'); await fops.writeJson(recordPath, attempted)
        try {
          const snapshot = await linearCore.listIssueRelations(payload.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 })
          const existing = linearCore.findExistingRelation(snapshot, payload)
          const remote = existing ? { existing, deduplicated: true } : await linearCore.createIssueRelation(payload, (request) => transport(request, exec, baseDir))
          if (!linearCore.mutationSucceeded('relation.create', remote)) throw Object.assign(new Error('Linear relation mutation returned success:false'), { code: 'LINEAR_MUTATION_FAILED' }); const confirmed = linearCore.transitionOutbox(attempted, 'confirm', { remote }); await fops.writeJson(recordPath, confirmed); results.push({ relation, status: confirmed.status, mutationKey: queued.record.mutationKey, remote })
        } catch (error) {
          const retry = linearCore.transitionOutbox(attempted, 'retry', { error: error?.message ?? String(error) }); await fops.writeJson(recordPath, retry); results.push({ relation, status: retry.status, mutationKey: queued.record.mutationKey, error: retry.lastError })
        }
      }
      return { ok: results.every((entry) => entry.status === 'confirmed'), projectId: args.projectId, relationCount: relations.length, results }
    })

    tool('linear_project_node', 'Coordinator-only: project one focused node lifecycle state and causal hold to Linear through the local WAL/outbox.', null, async (args, exec) => {
      assertCoordinator(exec)
      if (!['todo', 'in_progress', 'done', 'blocked', 'retry'].includes(args.status)) throw new Error('unsupported node projection status: ' + args.status)
      const baseDir = baseDirOf(exec, args)
      const fops = makeFops(baseDir)
      if (!fops) throw new Error('fs service unavailable; cannot persist Linear WAL')
      const payload = { issueId: args.issueId, stateId: args.stateId, blockedLabelId: args.blockedLabelId, status: args.status, blockedBy: [...new Set(args.blockedBy ?? [])].sort(), reason: args.reason ?? '', contextDigest: typeof args.contextDigest === 'string' ? args.contextDigest : '' }
      const root = linearCore.syncRoot(baseDir, args.projectId)
      const head = await fops.readJson(pathutil.join(root, 'head.json'))
      const event = linearCore.makeSyncEvent({ prevDigest: head?.digest ?? '', projectId: args.projectId, nodeId: args.nodeId, operation: 'node.project', payload })
      await linearCore.persistSyncEvent(fops, baseDir, args.projectId, event)
      const outbox = linearCore.makeOutboxRecord({ event, mutation: { operation: 'node.project', payload } })
      const queued = await linearCore.persistOutboxRecord(fops, baseDir, args.projectId, outbox)
      if (['confirmed', 'dead'].includes(queued.record.status)) return { ok: queued.record.status === 'confirmed', skipped: true, outboxStatus: queued.record.status, receipt: queued.record.receipt }
      const recordPath = pathutil.join(root, 'outbox', outbox.mutationKey + '.json')
      const attempted = linearCore.transitionOutbox(queued.record, 'attempt')
      await fops.writeJson(recordPath, attempted)
      try {
        const currentIssue = await executeLinear('getIssue', { id: args.issueId }, exec, baseDir)
        const snapshot = currentIssue?.issue ?? currentIssue
        if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
        // Plan §7.1/§7.4: a lifecycle transition is not committed until the
        // fresh Linear read confirms the current context block; a stale or
        // missing digest fails closed (the coordinator re-queries).
        const liveContext = autoresearchCore.parseContextBlock(String(snapshot.description ?? ''))
        if (!liveContext.ok) {
          throw Object.assign(new Error('LINEAR_CONTEXT_MISSING: this Linear node has no valid Current Node Context block. Initialize it with linear_update_node_context (from the node contract and latest comments) before projecting a lifecycle transition.'), { code: 'LINEAR_CONTEXT_MISSING' })
        }
        const liveContextDigest = autoresearchCore.contextBlockDigest(liveContext.state)
        // Node cross-check: the block must belong to the node being projected.
        if (typeof args.nodeId === 'string' && args.nodeId.trim() && liveContext.state.nodeId && liveContext.state.nodeId !== args.nodeId.trim()) {
          throw Object.assign(new Error('LINEAR_CONTEXT_NODE_MISMATCH: the issue\'s Current Node Context block belongs to node ' + liveContext.state.nodeId + ', not ' + args.nodeId.trim() + '.'), { code: 'LINEAR_CONTEXT_NODE_MISMATCH' })
        }
        if (!autoresearchCore.isContextDigest(args.contextDigest)) {
          throw Object.assign(new Error('LINEAR_CONTEXT_STALE: linear_project_node requires contextDigest — the SHA-256 digest from a fresh linear_get_node_context (the issue block digest is ' + liveContextDigest.slice(0, 12) + '...).'), { code: 'LINEAR_CONTEXT_STALE', liveDigest: liveContextDigest })
        }
        if (args.contextDigest !== liveContextDigest) {
          throw Object.assign(new Error('LINEAR_CONTEXT_STALE: the context digest you passed (' + args.contextDigest.slice(0, 12) + '...) is not the current Linear block digest (' + liveContextDigest.slice(0, 12) + '...). New comments or edits invalidated it — re-run linear_get_node_context and retry.'), { code: 'LINEAR_CONTEXT_STALE', liveDigest: liveContextDigest })
        }
        // Human-input freshness (plan §7.4 / gate 12): a human comment newer
        // than the block watermark invalidates the bound digest. Machine
        // evidence comments are the coordinator's own reduced facts and do
        // not rotate freshness (they are consumed by the next reduce).
        const freshnessComments = await linearCore.listComments(args.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 })
        const blockWatermark = String(liveContext.state.watermark ?? '')
        const newHumanComment = (freshnessComments.comments ?? []).some((comment) => !autoresearchCore.isAutoresearchComment(String(comment?.body ?? '')) && autoresearchCore.newerThan(String(comment?.createdAt ?? ''), blockWatermark))
        if (newHumanComment) {
          throw Object.assign(new Error('LINEAR_CONTEXT_STALE: a new human comment arrived after the context block watermark; re-run linear_get_node_context, reduce it into the block, and retry.'), { code: 'LINEAR_CONTEXT_STALE', liveDigest: liveContextDigest })
        }
        const stateRemote = await executeLinear('updateIssue', { id: args.issueId, stateId: args.stateId }, exec, baseDir)
        const blocked = payload.blockedBy.length > 0
        // A blocked hold cannot be confirmed without the configured blocked
        // label (plan §7.1): fail before any remote mutation instead of
        // posting an unconfirmable state and duplicating causal comments.
        if (blocked && !payload.blockedLabelId) throw Object.assign(new Error('blocked projection requires blockedLabelId: the causal hold cannot be confirmed without the configured blocked label.'), { code: 'LINEAR_BLOCKED_LABEL_MISSING' })
        const labelsRemote = await linearCore.updateIssueLabels(args.issueId, snapshot.labelRecords ?? [], (request) => transport(request, exec, baseDir), { addIds: blocked ? [payload.blockedLabelId] : [], removeIds: blocked ? [] : [payload.blockedLabelId] })
        let remote = { state: stateRemote, labels: labelsRemote }
        if (payload.blockedBy.length > 0 || payload.reason) {
          const comment = linearCore.causalComment({ nodeId: args.nodeId, blockedBy: payload.blockedBy, reason: payload.reason, eventDigest: event.digest })
          // Marker dedupe before creation: a prior crashed attempt may have
          // already posted this exact causal comment.
          const existingComments = await linearCore.listComments(args.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 })
          const alreadyPosted = (existingComments.comments ?? []).some((item) => String(item.body ?? '').includes(comment.idempotencyMarker))
          if (!alreadyPosted) remote.comment = await executeLinear('createComment', { id: args.issueId, body: comment.body, idempotencyMarker: comment.idempotencyMarker }, exec, baseDir)
          else remote.comment = { ok: true, success: true, skipped: true, deduplicated: true }
        }
        if (!linearCore.mutationSucceeded('node.project', remote)) throw Object.assign(new Error('Linear node projection returned success:false'), { code: 'LINEAR_MUTATION_FAILED' })
        const readBackIssue = await executeLinear('getIssue', { id: args.issueId }, exec, baseDir)
        const readBackComments = outbox.confirms.commentMarker ? await linearCore.listComments(args.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 }) : { comments: [] }
        const readBack = { issue: readBackIssue?.issue ?? readBackIssue, comments: readBackComments.comments ?? [] }
        if (!linearCore.confirmationMatches(outbox.confirms, readBack)) throw Object.assign(new Error('Linear node projection read-back did not match the requested state, labels, and causal marker'), { code: 'LINEAR_CONFIRMATION_FAILED' })
        const readBackContext = autoresearchCore.parseContextBlock(String(readBack.issue.description ?? ''))
        if (!readBackContext.ok || autoresearchCore.contextBlockDigest(readBackContext.state) !== liveContextDigest) throw Object.assign(new Error('Linear node projection read-back did not confirm the owned context block'), { code: 'LINEAR_CONFIRMATION_FAILED' })
        remote.readBack = readBack
        const confirmed = linearCore.transitionOutbox(attempted, 'confirm', { remote })
        await fops.writeJson(recordPath, confirmed)
        const journal = await linearCore.markProjectionConfirmed(fops, baseDir, args.projectId, confirmed, confirmed.receipt)
        return { ok: true, remote, eventDigest: event.digest, mutationKey: outbox.mutationKey, outboxStatus: confirmed.status, journal }
      } catch (error) {
        const retry = error?.code === 'LINEAR_ISSUE_UNAVAILABLE' || error?.code === 'LINEAR_NOT_FOUND'
          ? linearCore.transitionOutbox(attempted, 'dead', { error: error?.message ?? String(error) })
          : linearCore.transitionOutbox(attempted, 'retry', { error: error?.message ?? String(error) })
        await fops.writeJson(recordPath, retry)
        throw error
      }
    })

    tool('linear_sync_reconcile', 'Coordinator-only: replay pending Linear outbox mutations with bounded read-back and durable retry/confirmation receipts.', null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      const fops = makeFops(baseDir)
      if (!fops) throw new Error('fs service unavailable; cannot reconcile Linear WAL')
      const records = await linearCore.listOutboxRecords(fops, baseDir, args.projectId, args)
      const maxAttempts = Number.isInteger(args.maxAttempts) && args.maxAttempts > 0 ? Math.min(args.maxAttempts, 10) : 3
      const results = []
      for (const record of records) {
        if (record.status === 'confirmed') {
          const journal = await linearCore.markProjectionConfirmed(fops, baseDir, args.projectId, record, record.receipt)
          if (record.operation === 'node.project') results.push({ mutationKey: record.mutationKey, status: record.status, journalRecovery: true, journal })
          continue
        }
        // inflight records are retryable: a hard crash between the attempt
        // write and the catch must not strand the mutation forever.
        if (!['pending', 'retry', 'inflight'].includes(record.status)) continue
        const recordPath = pathutil.join(linearCore.syncRoot(baseDir, args.projectId), 'outbox', record.mutationKey + '.json')
        let attempted = null
        try {
          const expected = record.confirms ?? null
          let alreadyApplied = null
          if (expected?.kind === 'comment-marker' && expected.marker) {
            const issue = await executeLinear('getIssue', { id: record.payload.issueId }, exec, baseDir)
            const snapshot = issue?.issue ?? issue
            if (!snapshot?.id) throw Object.assign(new Error('Linear issue was deleted'), { code: 'LINEAR_NOT_FOUND' })
            if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
            const comments = await linearCore.listComments(record.payload.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 })
            alreadyApplied = comments.comments?.find((comment) => linearCore.confirmationMatches(expected, comment)) ?? null
          } else if (expected?.kind === 'relation-edge' && expected.issueId && expected.relatedIssueId) {
            const issue = await executeLinear('getIssue', { id: expected.issueId }, exec, baseDir)
            const snapshot = issue?.issue ?? issue
            if (!snapshot?.id) throw Object.assign(new Error('Linear issue was deleted'), { code: 'LINEAR_NOT_FOUND' })
            if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
            const relations = await linearCore.listIssueRelations(expected.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 })
            alreadyApplied = linearCore.findExistingRelation(relations, expected)
          } else if (expected?.kind === 'issue-state' && expected.issueId && expected.stateId) {
            const issue = await executeLinear('getIssue', { id: expected.issueId }, exec, baseDir)
            const snapshot = issue?.issue ?? issue
            if (!snapshot?.id) throw Object.assign(new Error('Linear issue was deleted'), { code: 'LINEAR_NOT_FOUND' })
            if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
            alreadyApplied = linearCore.confirmationMatches(expected, snapshot) ? snapshot : null
          } else if (expected?.kind === 'node-projection' && expected.issueId && expected.stateId && expected.blockedLabelId) {
            const issue = await executeLinear('getIssue', { id: expected.issueId }, exec, baseDir)
            const snapshot = issue?.issue ?? issue
            if (!snapshot?.id) throw Object.assign(new Error('Linear issue was deleted'), { code: 'LINEAR_NOT_FOUND' })
            if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
            const comments = expected.commentMarker ? await linearCore.listComments(expected.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 }) : { comments: [] }
            const readBack = { issue: snapshot, comments: comments.comments ?? [] }
            alreadyApplied = linearCore.confirmationMatches(expected, readBack) ? readBack : null
          } else if (expected?.kind === 'labels' && expected.issueId) {
            const issue = await executeLinear('getIssue', { id: expected.issueId }, exec, baseDir)
            const snapshot = issue?.issue ?? issue
            if (!snapshot?.id) throw Object.assign(new Error('Linear issue was deleted'), { code: 'LINEAR_NOT_FOUND' })
            if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
            alreadyApplied = linearCore.confirmationMatches(expected, snapshot) ? snapshot : null
          } else if (expected?.kind === 'context-block' && expected.issueId && expected.contextDigest) {
            const issue = await executeLinear('getIssue', { id: expected.issueId }, exec, baseDir)
            const snapshot = issue?.issue ?? issue
            if (!snapshot?.id) throw Object.assign(new Error('Linear issue was deleted'), { code: 'LINEAR_NOT_FOUND' })
            if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
            const parsedBlock = autoresearchCore.parseContextBlock(String(snapshot.description ?? ''))
            alreadyApplied = (parsedBlock.ok && autoresearchCore.contextBlockDigest(parsedBlock.state) === expected.contextDigest) ? { issue: snapshot } : null
          }
          if (alreadyApplied) {
            const readBackAttempt = record.status === 'inflight' ? record : linearCore.transitionOutbox(record, 'attempt', {}, new Date().toISOString())
            const confirmed = linearCore.transitionOutbox(readBackAttempt, 'confirm', { remote: alreadyApplied, readBack: true }, new Date().toISOString())
            await fops.writeJson(recordPath, confirmed)
            const journal = await linearCore.markProjectionConfirmed(fops, baseDir, args.projectId, confirmed, confirmed.receipt)
            // Digest-guarded settle: only the recovery cache that carries THIS
            // record's intent digest may be settled — an older confirmation
            // must never delete or confirm a newer pending intent.
            let settled = null
            if (record.operation === 'node.context.update') {
              const pendingCache = await linearCore.readRecoveryCache(fops, baseDir, args.projectId, record.nodeId)
              if (pendingCache && pendingCache.status === 'pending' && pendingCache.contextDigest === record.payload?.contextDigest) {
                settled = await linearCore.markRecoveryCacheConfirmed(fops, baseDir, args.projectId, record.nodeId, confirmed.updatedAt)
                if (settled?.ok && settled.cache?.status === 'confirmed') await linearCore.clearRecoveryCache(fops, baseDir, args.projectId, record.nodeId)
              }
            }
            results.push({ mutationKey: record.mutationKey, status: confirmed.status, readBack: true, journal, ...(settled?.ok ? { recoveryCache: 'cleared' } : {}) })
            continue
          }
          attempted = linearCore.transitionOutbox(record, 'attempt')
          await fops.writeJson(recordPath, attempted)
          let remote
          if (record.operation === 'relation.create') remote = await linearCore.createIssueRelation(record.payload, (request) => transport(request, exec, baseDir))
          else if (record.operation === 'labels.update') {
            const issue = await executeLinear('getIssue', { id: record.payload.issueId }, exec, baseDir)
            const snapshot = issue?.issue ?? issue
            if (!snapshot?.id) throw Object.assign(new Error('Linear issue was deleted'), { code: 'LINEAR_NOT_FOUND' })
            if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
            remote = await linearCore.updateIssueLabels(record.payload.issueId, snapshot.labelRecords ?? [], (request) => transport(request, exec, baseDir), { addIds: record.payload.addIds ?? [], removeIds: record.payload.removeIds ?? [] })
          }
          else if (record.operation === 'comment') remote = await executeLinear('createComment', { ...record.payload, id: record.payload.id ?? record.payload.issueId }, exec, baseDir)
          else if (record.operation === 'node.project') {
            const issue = await executeLinear('getIssue', { id: record.payload.issueId }, exec, baseDir)
            const snapshot = issue?.issue ?? issue
            if (!snapshot?.id) throw Object.assign(new Error('Linear issue was deleted'), { code: 'LINEAR_NOT_FOUND' })
            if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
            const replayBlocked = (record.payload.blockedBy ?? []).length > 0
            if (replayBlocked && !record.payload.blockedLabelId) {
              const dead = linearCore.transitionOutbox(attempted, 'dead', { error: 'blocked projection replay requires blockedLabelId: the causal hold cannot be confirmed without the configured blocked label.' })
              await fops.writeJson(recordPath, dead)
              results.push({ mutationKey: record.mutationKey, status: 'dead', error: dead.lastError })
              continue
            }
            // The replay must honor the same context binding as the direct
            // path (gate 12): a projection bound to a stale block digest
            // dead-letters instead of committing against any valid block.
            if (typeof record.payload.contextDigest === 'string' && record.payload.contextDigest) {
              const replayBound = autoresearchCore.parseContextBlock(String(snapshot.description ?? ''))
              if (!replayBound.ok || autoresearchCore.contextBlockDigest(replayBound.state) !== record.payload.contextDigest) {
                const dead = linearCore.transitionOutbox(attempted, 'dead', { error: 'LINEAR_CONTEXT_STALE on replay: the issue context block no longer matches the digest the projection was bound to; re-query and re-project.' })
                await fops.writeJson(recordPath, dead)
                results.push({ mutationKey: record.mutationKey, status: 'dead', error: dead.lastError })
                continue
              }
            }
            const stateRemote = await executeLinear('updateIssue', { id: record.payload.issueId, stateId: record.payload.stateId }, exec, baseDir)
            const blocked = (record.payload.blockedBy ?? []).length > 0
            const labelsRemote = record.payload.blockedLabelId
              ? await linearCore.updateIssueLabels(record.payload.issueId, snapshot.labelRecords ?? [], (request) => transport(request, exec, baseDir), { addIds: blocked ? [record.payload.blockedLabelId] : [], removeIds: blocked ? [] : [record.payload.blockedLabelId] })
              : { ok: true, success: true, skipped: true }
            remote = { state: stateRemote, labels: labelsRemote }
            if ((record.payload.blockedBy ?? []).length > 0 || record.payload.reason) {
              const comment = linearCore.causalComment({ nodeId: record.nodeId, blockedBy: record.payload.blockedBy, reason: record.payload.reason, eventDigest: record.eventDigest })
              // Marker dedupe before creation: a crashed prior attempt may
              // have already posted this exact causal comment.
              const existingComments = await linearCore.listComments(record.payload.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 })
              const alreadyPosted = (existingComments.comments ?? []).some((item) => String(item.body ?? '').includes(comment.idempotencyMarker))
              if (!alreadyPosted) remote.comment = await executeLinear('createComment', { id: record.payload.issueId, body: comment.body, idempotencyMarker: comment.idempotencyMarker }, exec, baseDir)
              else remote.comment = { ok: true, success: true, skipped: true, deduplicated: true }
            }
          }
          else if (record.operation === 'node.context.update') {
            const issue = await executeLinear('getIssue', { id: record.payload.issueId }, exec, baseDir)
            const snapshot = issue?.issue ?? issue
            if (!snapshot?.id) throw Object.assign(new Error('Linear issue was deleted'), { code: 'LINEAR_NOT_FOUND' })
            if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
            // Replay CAS (plan §7.7): never roll the block back over newer
            // machine updates or human edits. The enqueue path records the
            // expected PRIOR digest; replay proceeds only when the live
            // block still matches it (or both are absent/empty).
            const replayLive = autoresearchCore.parseContextBlock(String(snapshot.description ?? ''))
            const replayLiveDigest = replayLive.ok ? autoresearchCore.contextBlockDigest(replayLive.state) : ''
            const expectedPrior = typeof record.payload.expectedContextDigest === 'string' ? record.payload.expectedContextDigest : null
            const casOk = expectedPrior !== null && (replayLiveDigest === expectedPrior || (replayLiveDigest === '' && expectedPrior === ''))
            if (!casOk) {
              const dead = linearCore.transitionOutbox(attempted, 'dead', { error: 'LINEAR_CONTEXT_CONFLICT on replay: the live context block no longer matches the expected prior digest (live ' + (replayLiveDigest ? replayLiveDigest.slice(0, 12) + '...' : '(absent)') + ', expected ' + (expectedPrior ? expectedPrior.slice(0, 12) + '...' : '(none)') + '). Surface a conflict for coordinator/user resolution; never overwrite the change (plan §7.7).' })
              await fops.writeJson(recordPath, dead)
              results.push({ mutationKey: record.mutationKey, status: 'dead', conflict: true, error: dead.lastError })
              continue
            }
            // Upsert the INTENDED block into the LIVE description: the
            // payload carries a stale full description, so writing it
            // verbatim would clobber user text edited outside the block
            // since the crash.
            const intendedBlock = autoresearchCore.parseContextBlock(String(record.payload.description ?? ''))
            if (!intendedBlock.ok) {
              const dead = linearCore.transitionOutbox(attempted, 'dead', { error: 'replay intent is not a valid Current Node Context block; dead-lettered instead of writing a malformed description.' })
              await fops.writeJson(recordPath, dead)
              results.push({ mutationKey: record.mutationKey, status: 'dead', conflict: true, error: dead.lastError })
              continue
            }
            const replayDescription = autoresearchCore.upsertContextBlock(String(snapshot.description ?? ''), intendedBlock.blockText)
            remote = await linearCore.updateIssueDescription(record.payload.issueId, replayDescription, (request) => transport(request, exec, baseDir))
          }
          else throw new Error('unsupported outbox operation: ' + record.operation)
          if (record.operation === 'node.project') {
            const readBackIssue = await executeLinear('getIssue', { id: record.payload.issueId }, exec, baseDir)
            const readBackComments = record.confirms?.commentMarker ? await linearCore.listComments(record.payload.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 }) : { comments: [] }
            const readBack = { issue: readBackIssue?.issue ?? readBackIssue, comments: readBackComments.comments ?? [] }
            if (!linearCore.confirmationMatches(record.confirms, readBack)) throw Object.assign(new Error('Linear node projection read-back did not match the requested state, labels, and causal marker'), { code: 'LINEAR_CONFIRMATION_FAILED' })
            // Plan §7.1: the lifecycle commit is confirmed together with the
            // owned context block — a replay must never commit a node whose
            // issue no longer carries the block.
            const replayBlock = autoresearchCore.parseContextBlock(String(readBack.issue.description ?? ''))
            if (!replayBlock.ok) throw Object.assign(new Error('Linear node projection read-back did not confirm a valid Current Node Context block'), { code: 'LINEAR_CONFIRMATION_FAILED' })
            remote.readBack = readBack
          }
          if (record.operation === 'node.context.update') {
            const readBackIssue = await executeLinear('getIssue', { id: record.payload.issueId }, exec, baseDir)
            const readBackSnapshot = readBackIssue?.issue ?? readBackIssue
            const readBackBlock = autoresearchCore.parseContextBlock(String(readBackSnapshot.description ?? ''))
            if (!readBackBlock.ok || autoresearchCore.contextBlockDigest(readBackBlock.state) !== record.payload.contextDigest) throw Object.assign(new Error('Linear context replay read-back did not confirm the requested digest'), { code: 'LINEAR_CONFIRMATION_FAILED' })
            remote.readBack = { issue: readBackSnapshot }
          }
          if (!linearCore.mutationSucceeded(record.operation, remote)) throw Object.assign(new Error('Linear mutation returned success:false'), { code: 'LINEAR_MUTATION_FAILED' })
          const confirmed = linearCore.transitionOutbox(attempted, 'confirm', { remote }, new Date().toISOString())
          await fops.writeJson(recordPath, confirmed)
          const journal = await linearCore.markProjectionConfirmed(fops, baseDir, args.projectId, confirmed, confirmed.receipt)
          const settled = record.operation === 'node.context.update' ? await linearCore.markRecoveryCacheConfirmed(fops, baseDir, args.projectId, record.nodeId, confirmed.updatedAt) : null
          results.push({ mutationKey: record.mutationKey, status: confirmed.status, remote, journal, ...(settled ? { recoveryCache: settled.cache.status } : {}) })
        } catch (error) {
          const failure = { error: error?.message ?? String(error) }
          const failedAttempt = attempted ?? linearCore.transitionOutbox(record, 'attempt')
          const terminalDrift = error?.code === 'LINEAR_ISSUE_UNAVAILABLE' || error?.code === 'LINEAR_NOT_FOUND'
          const next = terminalDrift || failedAttempt.attempts >= maxAttempts
            ? linearCore.transitionOutbox(failedAttempt, 'dead', failure, new Date().toISOString())
            : linearCore.transitionOutbox(failedAttempt, 'retry', failure, new Date().toISOString())
          await fops.writeJson(recordPath, next)
          results.push({ mutationKey: record.mutationKey, status: next.status, error: next.lastError })
        }
      }
      return { ok: true, projectId: args.projectId, results }
    })

    tool('linear_create_relation', 'Coordinator-only: create one directed Linear issue relation after enqueueing the matching local WAL mutation.', null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      const fops = makeFops(baseDir)
      if (!fops) throw new Error('fs service unavailable; cannot persist Linear WAL')
      const payload = { issueId: args.issueId, relatedIssueId: args.relatedIssueId, type: args.type }
      const root = linearCore.syncRoot(baseDir, args.projectId)
      const head = await fops.readJson(pathutil.join(root, 'head.json'))
      const event = linearCore.makeSyncEvent({ prevDigest: head?.digest ?? '', projectId: args.projectId, nodeId: args.nodeId, operation: 'relation.create', payload })
      await linearCore.persistSyncEvent(fops, baseDir, args.projectId, event)
      const outbox = linearCore.makeOutboxRecord({ event, mutation: { operation: 'relation.create', payload } })
      const queued = await linearCore.persistOutboxRecord(fops, baseDir, args.projectId, outbox)
      const recordPath = pathutil.join(root, 'outbox', outbox.mutationKey + '.json')
      if (['confirmed', 'dead'].includes(queued.record.status)) return { ok: queued.record.status === 'confirmed', skipped: true, outboxStatus: queued.record.status, mutationKey: outbox.mutationKey, receipt: queued.record.receipt }
      const attempted = linearCore.transitionOutbox(queued.record, 'attempt')
      await fops.writeJson(recordPath, attempted)
      try {
        const snapshot = await linearCore.listIssueRelations(payload.issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 })
        const existing = linearCore.findExistingRelation(snapshot, payload)
        const result = existing ? { ok: true, relation: existing, deduplicated: true } : await linearCore.createIssueRelation(payload, (request) => transport(request, exec, baseDir))
        if (!linearCore.mutationSucceeded('relation.create', result)) throw Object.assign(new Error('Linear relation mutation returned success:false'), { code: 'LINEAR_MUTATION_FAILED' })
        const confirmed = linearCore.transitionOutbox(attempted, 'confirm', { remote: result })
        await fops.writeJson(recordPath, confirmed)
        return { ...result, eventDigest: event.digest, mutationKey: outbox.mutationKey, outboxStatus: confirmed.status }
      } catch (error) {
        const retry = linearCore.transitionOutbox(attempted, 'retry', { error: error?.message ?? String(error) })
        await fops.writeJson(recordPath, retry)
        throw error
      }
    })

    tool('linear_update_labels', 'Coordinator-only: update labels by preserving current IDs and applying explicit additions/removals.', null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      const fops = makeFops(baseDir)
      if (!fops) throw new Error('fs service unavailable; cannot persist Linear WAL')
      const payload = { issueId: args.id, labelIds: linearCore.mergeLabelIds(args.currentLabels, args.addIds, args.removeIds), addIds: [...new Set(args.addIds ?? [])], removeIds: [...new Set(args.removeIds ?? [])] }
      const root = linearCore.syncRoot(baseDir, args.projectId)
      const head = await fops.readJson(pathutil.join(root, 'head.json'))
      const event = linearCore.makeSyncEvent({ prevDigest: head?.digest ?? '', projectId: args.projectId, nodeId: args.nodeId, operation: 'labels.update', payload })
      await linearCore.persistSyncEvent(fops, baseDir, args.projectId, event)
      const outbox = linearCore.makeOutboxRecord({ event, mutation: { operation: 'labels.update', payload } })
      const queued = await linearCore.persistOutboxRecord(fops, baseDir, args.projectId, outbox)
      const recordPath = pathutil.join(root, 'outbox', outbox.mutationKey + '.json')
      if (['confirmed', 'dead'].includes(queued.record.status)) return { ok: queued.record.status === 'confirmed', skipped: true, outboxStatus: queued.record.status, mutationKey: outbox.mutationKey, receipt: queued.record.receipt }
      const attempted = linearCore.transitionOutbox(queued.record, 'attempt')
      await fops.writeJson(recordPath, attempted)
      try {
        const result = await linearCore.updateIssueLabels(args.id, args.currentLabels, (request) => transport(request, exec, baseDir), args)
        if (!linearCore.mutationSucceeded('labels.update', result)) throw Object.assign(new Error('Linear label mutation returned success:false'), { code: 'LINEAR_MUTATION_FAILED' })
        const confirmed = linearCore.transitionOutbox(attempted, 'confirm', { remote: result })
        await fops.writeJson(recordPath, confirmed)
        return { ...result, eventDigest: event.digest, mutationKey: outbox.mutationKey, outboxStatus: confirmed.status }
      } catch (error) {
        const retry = linearCore.transitionOutbox(attempted, 'retry', { error: error?.message ?? String(error) })
        await fops.writeJson(recordPath, retry)
        throw error
      }
    })

    tool('linear_list_issues', 'List recent Linear issues ordered by update time; pass projectId to list one project\'s issues (paginated, marker-bearing).', null, async (args, exec) => {
      assertCallingAgent(exec)
      if (typeof args.projectId === 'string' && args.projectId.trim()) {
        return await linearCore.listProjectIssues(args.projectId.trim(), (request) => transport(request, exec, baseDirOf(exec, args)), args)
      }
      return await executeLinear('listIssues', { first: typeof args.first === 'number' ? args.first : 25 }, exec, baseDirOf(exec, args))
    })

    tool('linear_search_issues', 'Search Linear issues by term.', null, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('searchIssues', { term: args.term }, exec, baseDirOf(exec, args))
    })

    tool('linear_create_comment', 'Post a comment on a Linear issue. Pass idempotencyMarker to make posting idempotent: when a comment already contains the marker, the call skips creation and returns the existing comment (revision-protocol replay converges without duplicates).', null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      if (typeof args.idempotencyMarker === 'string' && args.idempotencyMarker.trim()) {
        const existing = await linearCore.listComments(args.id, (request) => transport(request, exec, baseDir), { maxPages: 20 })
        const hit = (existing.comments ?? []).find((comment) => String(comment.body ?? '').includes(args.idempotencyMarker))
        if (hit) {
          return { ok: true, skipped: true, commentId: hit.id, reason: 'an idempotent comment with the marker already exists' }
        }
      }
      const result = await executeLinear('createComment', { id: args.id, body: args.body }, exec, baseDir)
      return { ok: true, ...result, skipped: false }
    })

    // ── Linear Current Node Context (plan §7) ──────────────────────────────

    function linearUnavailable(error) {
      const message = error instanceof Error ? error.message : String(error ?? 'Linear unavailable')
      return { ok: false, status: 'linear-unavailable', error: message }
    }

    async function requireIssueSnapshot(exec, baseDir, issueId) {
      const remote = await executeLinear('getIssue', { id: issueId }, exec, baseDir)
      if (remote && typeof remote === 'object' && remote.error) throw new Error(remote.error)
      const snapshot = remote?.issue ?? remote
      if (!snapshot?.id) throw Object.assign(new Error('Linear issue was not found: ' + issueId), { code: 'LINEAR_NOT_FOUND' })
      if (linearCore.issueUnavailable(snapshot)) throw Object.assign(new Error('Linear issue is archived or trashed'), { code: 'LINEAR_ISSUE_UNAVAILABLE' })
      return snapshot
    }

    // Local artifact integrity for evidence refs named in the block. A
    // missing local file makes the reference 'unverified'/'missing' — it
    // never blocks context reconstruction (plan §7.4 step 7).
    async function checkEvidenceRefs(fops, baseDir, refs) {
      const out = []
      for (const ref of Array.isArray(refs) ? refs : []) {
        const value = String(ref?.ref ?? '')
        const hash = String(ref?.hash ?? '')
        if (!value) continue
        const localish = !value.includes('://') && !value.startsWith('/') && !value.startsWith('..') && !value.includes(':')
        // Non-local references cannot be checked against local bytes; they
        // are 'unverified', never 'missing' and never blocking.
        if (!localish || !fops || typeof fops.readText !== 'function') {
          out.push({ ref: value, status: 'unverified' })
          continue
        }
        let localHash = null
        try {
          // Traversal-safe resolution + byte-first hashing (plan §9: hash
          // bytes first; text decode only when text inspection is needed).
          const abs = pathutil.resolveInside(baseDir, value)
          const binary = /\.(pdf|png|jpe?g|gif|gz|zip|bin)$/i.test(value)
          if (binary && typeof fops.readBytes === 'function') {
            const bytes = await fops.readBytes(abs, 64 * 1024 * 1024)
            localHash = bytes !== null ? autoresearchCore.sha256Bytes(bytes) : null
          } else {
            localHash = autoresearchCore.sha256Text(await fops.readText(abs))
          }
        } catch {
          localHash = null
        }
        let status
        if (localHash === null) status = 'missing'
        else if (hash) status = localHash === hash ? 'verified' : 'unverified'
        else status = 'unverified'
        out.push({ ref: value, status })
      }
      return out
    }

    tool('linear_get_node_context', 'Coordinator-only, REQUIRED intake for Linear-backed work (plan §7.4): reconstructs the node\'s Current Node Context from the Linear issue description, comments, and relations. Reconstructs from Linear alone when local state.json is absent. Returns a compact structured NodeWorkContext plus readable Markdown; evidence references carry integrity status verified/unverified/missing without blocking. A missing or invalid owned block returns context-missing (repair it with linear_update_node_context before node work); a Linear outage returns a structured linear-unavailable pause result.', null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      const issueId = String(args.issueId ?? '').trim()
      if (!issueId) throw new Error('issueId is required')
      let snapshot
      try {
        snapshot = await requireIssueSnapshot(exec, baseDir, issueId)
      } catch (error) {
        if (error?.code === 'LINEAR_NOT_FOUND' || error?.code === 'LINEAR_ISSUE_UNAVAILABLE') throw error
        return linearUnavailable(error)
      }
      const description = String(snapshot.description ?? '')
      const contextBlock = autoresearchCore.parseContextBlock(description)
      const specBlock = autoresearchCore.parseSpecBlock(description)
      const nodeId = String(args.nodeId ?? '').trim() || (contextBlock.ok ? contextBlock.state.nodeId : '') || (specBlock?.nodeId ?? '')
      const comments = await linearCore.listComments(issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 })
      const relations = await linearCore.listIssueRelations(issueId, (request) => transport(request, exec, baseDir), { maxPages: 10 })
      const fops = makeFops(baseDir)
      const evidenceStatus = contextBlock.ok ? await checkEvidenceRefs(fops, baseDir, contextBlock.state.evidenceRefs) : []
      const drift = []
      if (contextBlock.ok && String(snapshot.state?.type ?? snapshot.state?.name ?? '').toLowerCase() === 'completed' && contextBlock.state.status !== 'done') {
        drift.push('Linear state is completed but the context block status is ' + contextBlock.state.status)
      }
      if (!contextBlock.ok && specBlock?.contractDigest) {
        drift.push('the issue carries a node contract but no valid Current Node Context block; initialize it from the contract and latest comments')
      }
      let nodeIdMismatch = false
      if (contextBlock.ok && typeof args.nodeId === 'string' && args.nodeId.trim() && contextBlock.state.nodeId !== args.nodeId.trim()) {
        nodeIdMismatch = true
        drift.push('the issue\'s Current Node Context block belongs to node ' + contextBlock.state.nodeId + ', not the requested ' + args.nodeId.trim())
      }
      const composed = autoresearchCore.composeNodeWorkContext({
        issue: snapshot,
        contextBlock,
        specBlock,
        comments: comments.comments ?? [],
        relations: { relations: relations.relations ?? [], inverseRelations: relations.inverseRelations ?? [] },
        evidenceStatus,
        drift,
      })
      const result = { ...composed, nodeIdMismatch, issue: { id: snapshot.id, identifier: snapshot.identifier ?? '', title: snapshot.title ?? '', url: snapshot.url ?? '', state: snapshot.state?.name ?? snapshot.state?.id ?? '' } }
      if (args.projectId && nodeId && fops) {
        const cache = await linearCore.readRecoveryCache(fops, baseDir, String(args.projectId), nodeId)
        if (cache && cache.status === 'pending') result.recoveryCache = { nodeId: cache.nodeId, issueId: cache.issueId, expectedContextDigest: cache.expectedContextDigest, contextDigest: cache.contextDigest, createdAt: cache.createdAt, status: cache.status }
      }
      if (!contextBlock.ok) result.repairHint = 'No valid owned Current Node Context block: repair it with linear_update_node_context from the latest verified Linear comments and the node contract before any node work starts (plan §7.4).'
      return result
    })

    tool('linear_update_node_context', 'Coordinator-only: update the issue\'s owned Current Node Context block through the plan §7.6 write path — fresh read, expected-digest CAS (a concurrent change returns LINEAR_CONTEXT_CONCURRENT with the live state instead of overwriting), user text outside the block preserved, crash-safe recovery cache + WAL/outbox intent, owned-block-only description update, structural read-back, digest confirmation. Pass expectedContextDigest from a fresh linear_get_node_context (empty string when initializing a block that does not exist yet).', null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      const issueId = String(args.issueId ?? '').trim()
      const projectId = String(args.projectId ?? '').trim()
      const nodeId = String(args.nodeId ?? '').trim()
      if (!issueId || !projectId || !nodeId) throw new Error('issueId, projectId, and nodeId are required')
      if (!args.state || typeof args.state !== 'object' || Array.isArray(args.state)) throw new Error('state (the owned node context object) is required')
      const expectedContextDigest = typeof args.expectedContextDigest === 'string' ? args.expectedContextDigest.trim() : ''
      const fops = makeFops(baseDir)
      if (!fops) throw new Error('fs service unavailable; cannot persist Linear recovery cache/WAL')
      // 1. Read the latest issue.
      const snapshot = await requireIssueSnapshot(exec, baseDir, issueId)
      const currentDescription = String(snapshot.description ?? '')
      // 2. Compute the expected prior digest from the live block. A block that
      //      exists but whose digest no longer matches its content (a concurrent
      //      human edit) still carries a parseable state + computed digest, so it
      //      is surfaced for a fresh reduce instead of being reported as absent.
      const live = autoresearchCore.parseContextBlock(currentDescription)
      let liveState = null
      let liveDigest = ''
      if (live.ok) {
        liveState = live.state
        liveDigest = autoresearchCore.contextBlockDigest(live.state)
      } else if (live.state) {
        liveState = live.state
        liveDigest = live.actual ?? ''
      }
      // 3. Validate + normalize the new state.
      const state = autoresearchCore.normalizeContextState(args.state)
      if (state.nodeId !== nodeId) throw new Error('state.nodeId (' + state.nodeId + ') does not match the target node (' + nodeId + ')')
      // The LIVE block must belong to this node too: updating a block owned
      // by another node (or another issue) is never allowed (plan §7.2).
      if (liveState !== null && typeof liveState.nodeId === 'string' && liveState.nodeId && liveState.nodeId !== nodeId) {
        throw Object.assign(new Error('LINEAR_CONTEXT_NODE_MISMATCH: the issue\'s Current Node Context block belongs to node ' + liveState.nodeId + ', not ' + nodeId + '.'), { code: 'LINEAR_CONTEXT_NODE_MISMATCH' })
      }
      // 4. CAS: never overwrite a concurrently changed block.
      if (liveState !== null && expectedContextDigest !== liveDigest) {
        throw Object.assign(new Error('LINEAR_CONTEXT_CONCURRENT: the issue\'s context block changed after your query (live digest ' + liveDigest.slice(0, 12) + '... vs expected ' + (expectedContextDigest ? expectedContextDigest.slice(0, 12) + '...' : '(none)') + '). Re-run linear_get_node_context, reduce again, and retry with the live expectedContextDigest. The user-authored text was not modified.'), { code: 'LINEAR_CONTEXT_CONCURRENT', liveState, liveDigest })
      }
      if (liveState === null && expectedContextDigest !== '') {
        throw Object.assign(new Error('LINEAR_CONTEXT_CONCURRENT: expected a live context block (' + expectedContextDigest.slice(0, 12) + '...) but the issue carries none. Re-run linear_get_node_context and retry.'), { code: 'LINEAR_CONTEXT_CONCURRENT', liveState: null, liveDigest: '' })
      }
      // 5. Render + upsert (user text outside the block is preserved).
      const contextDigest = autoresearchCore.contextBlockDigest(state)
      const newState = { ...state, lastVerified: { at: new Date().toISOString(), contextDigest } }
      const newDescription = linearCore.buildContextDescription(currentDescription, newState)
      // 6. Crash-safe intent.
      await linearCore.writeRecoveryCache(fops, baseDir, projectId, nodeId, { issueId, expectedContextDigest: liveDigest, contextDigest, description: newDescription, state: newState })
      // 7. WAL event + outbox record + attempt. The expected PRIOR digest is
      // persisted in the payload so a crash replay can CAS against the live
      // block instead of overwriting newer machine updates or human edits.
      const payload = { issueId, contextDigest, description: newDescription, nodeId, expectedContextDigest: liveDigest }
      const root = linearCore.syncRoot(baseDir, projectId)
      const head = await fops.readJson(pathutil.join(root, 'head.json'))
      const event = linearCore.makeSyncEvent({ prevDigest: head?.digest ?? '', projectId, nodeId, operation: 'node.context.update', payload })
      await linearCore.persistSyncEvent(fops, baseDir, projectId, event)
      const outbox = linearCore.makeOutboxRecord({ event, mutation: { operation: 'node.context.update', payload } })
      const queued = await linearCore.persistOutboxRecord(fops, baseDir, projectId, outbox)
      if (['confirmed', 'dead'].includes(queued.record.status)) return { ok: queued.record.status === 'confirmed', skipped: true, outboxStatus: queued.record.status, contextDigest }
      const recordPath = pathutil.join(root, 'outbox', outbox.mutationKey + '.json')
      const attempted = linearCore.transitionOutbox(queued.record, 'attempt')
      await fops.writeJson(recordPath, attempted)
      try {
        // 8. Update only the owned block.
        const remote = await linearCore.updateIssueDescription(issueId, newDescription, (request) => transport(request, exec, baseDir))
        if (!linearCore.mutationSucceeded('node.context.update', remote)) throw Object.assign(new Error('Linear context description mutation returned success:false'), { code: 'LINEAR_MUTATION_FAILED' })
        // 9. Read back + structural parse + digest confirmation.
        const readBack = await requireIssueSnapshot(exec, baseDir, issueId)
        const readBackBlock = autoresearchCore.parseContextBlock(String(readBack.description ?? ''))
        if (!readBackBlock.ok || autoresearchCore.contextBlockDigest(readBackBlock.state) !== contextDigest) {
          throw Object.assign(new Error('Linear context read-back did not confirm the requested digest'), { code: 'LINEAR_CONFIRMATION_FAILED' })
        }
        // 10. Confirm + settle the recovery cache (confirmed intent is
        // deleted; it is intent-only and must not accumulate).
        const confirmed = linearCore.transitionOutbox(attempted, 'confirm', { remote: { issue: readBack } })
        await fops.writeJson(recordPath, confirmed)
        const cache = await linearCore.markRecoveryCacheConfirmed(fops, baseDir, projectId, nodeId)
        if (cache.ok && cache.cache?.status === 'confirmed' && cache.cache?.contextDigest === contextDigest) await linearCore.clearRecoveryCache(fops, baseDir, projectId, nodeId)
        return { ok: true, issueId, nodeId, contextDigest, eventDigest: event.digest, mutationKey: outbox.mutationKey, outboxStatus: confirmed.status, recoveryCache: cache.ok ? 'cleared' : 'absent', markdown: autoresearchCore.renderContextBlock(readBackBlock.state) }
      } catch (error) {
        const retry = linearCore.transitionOutbox(attempted, 'retry', { error: error?.message ?? String(error) })
        await fops.writeJson(recordPath, retry)
        throw error
      }
    })

    tool('linear_post_evidence_event', 'Coordinator-only: post one idempotent linear-evidence-event comment for a decision-relevant milestone (plan §7.3) through the WAL/outbox. Replays with the same event digest are deduplicated by marker — repeated projection creates no duplicate comments. Evidence comments support the current block; they are not a substitute for it.', null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      const issueId = String(args.issueId ?? '').trim()
      const projectId = String(args.projectId ?? '').trim()
      const nodeId = String(args.nodeId ?? '').trim()
      if (!issueId || !projectId || !nodeId) throw new Error('issueId, projectId, and nodeId are required')
      const event = autoresearchCore.makeEvidenceEvent({ projectId, nodeId, type: args.type, summary: args.summary, evidence: args.evidence, completes: args.completes, finding: args.finding, source: args.source, requiredChange: args.requiredChange, at: args.at })
      const comment = autoresearchCore.renderEvidenceComment(event)
      const fops = makeFops(baseDir)
      if (!fops) throw new Error('fs service unavailable; cannot persist Linear WAL')
      const payload = { issueId, body: comment.body, idempotencyMarker: comment.marker }
      const root = linearCore.syncRoot(baseDir, projectId)
      const head = await fops.readJson(pathutil.join(root, 'head.json'))
      const walEvent = linearCore.makeSyncEvent({ prevDigest: head?.digest ?? '', projectId, nodeId, operation: 'comment', payload, expect: { kind: 'comment-marker', marker: comment.marker } })
      await linearCore.persistSyncEvent(fops, baseDir, projectId, walEvent)
      const outbox = linearCore.makeOutboxRecord({ event: walEvent, mutation: { operation: 'comment', payload }, confirms: { kind: 'comment-marker', marker: comment.marker } })
      const queued = await linearCore.persistOutboxRecord(fops, baseDir, projectId, outbox)
      if (['confirmed', 'dead'].includes(queued.record.status)) return { ok: queued.record.status === 'confirmed', skipped: true, outboxStatus: queued.record.status, event: { digest: event.digest, type: event.type }, marker: comment.marker }
      const recordPath = pathutil.join(root, 'outbox', outbox.mutationKey + '.json')
      const attempted = linearCore.transitionOutbox(queued.record, 'attempt')
      await fops.writeJson(recordPath, attempted)
      try {
        // Idempotent: a comment with the marker already exists → confirm.
        const existing = await linearCore.listComments(issueId, (request) => transport(request, exec, baseDir), { maxPages: 20 })
        const hit = (existing.comments ?? []).find((item) => linearCore.confirmationMatches({ kind: 'comment-marker', marker: comment.marker }, item))
        let remote
        if (hit) remote = { ok: true, success: true, skipped: true, commentId: hit.id }
        else remote = await executeLinear('createComment', { id: issueId, body: comment.body }, exec, baseDir)
        if (!linearCore.mutationSucceeded('comment', remote)) throw Object.assign(new Error('Linear evidence comment mutation returned success:false'), { code: 'LINEAR_MUTATION_FAILED' })
        const confirmed = linearCore.transitionOutbox(attempted, 'confirm', { remote })
        await fops.writeJson(recordPath, confirmed)
        return { ok: true, skipped: Boolean(hit), commentId: remote.comment?.id ?? hit?.id ?? null, event: { digest: event.digest, type: event.type }, marker: comment.marker, eventDigest: walEvent.digest, mutationKey: outbox.mutationKey, outboxStatus: confirmed.status }
      } catch (error) {
        const retry = linearCore.transitionOutbox(attempted, 'retry', { error: error?.message ?? String(error) })
        await fops.writeJson(recordPath, retry)
        throw error
      }
    })

    tool('linear_update_issue', "Update a Linear issue's state (stateId from linear_workspace_metadata).", null, async (args, exec) => {
      assertCoordinator(exec)
      return await executeLinear('updateIssue', { id: args.id, stateId: args.stateId }, exec, baseDirOf(exec, args))
    })

    // ── project mode (plan §3 C1–C2, §4.5 spec projection) ────────────────

    tool('linear_create_project', "Create a Linear project for an approved AutoResearch plan. Auto-approved by default (config linear.approval: 'auto'); set linear.approval: 'ask' to require approval prompts. Reconciles by marker, never by name alone.", null, async (args, exec) => {
      assertCoordinator(exec)
      return await linearCore.createProjectFlow(
        args,
        (request) => transport(request, exec, baseDirOf(exec, args)),
        (reason) => requireApproval(exec, 'linear_create_project', reason, baseDirOf(exec, args)),
      )
    })

    tool('linear_create_issue', "Create or reconcile one Linear issue for an approved plan node. The generated specification block is rendered from the approved plan (node contract digest, kind, artifact format, roles, budget, plan revision) — never from caller prose; user-authored text outside the block is preserved. Replaying synchronizes only the generated block and appends one idempotent scope note per plan revision. The node marker embeds the stable AutoResearch project id. Auto-approved by default; set linear.approval: 'ask' to require approval prompts.", null, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      const fops = makeFops(baseDir)
      let description = args.description
      let block = null
      let scopeNote = ''
      if (typeof args.autoresearchProjectId === 'string' && args.autoresearchProjectId.trim() && typeof args.nodeId === 'string' && args.nodeId.trim()) {
        const plan = await loadApprovedPlan(fops, baseDir, args.autoresearchProjectId.trim())
        const validation = autoresearchCore.validatePlan(plan)
        if (!validation.ok) {
          throw new Error('Linear projection blocked: the approved plan is invalid for projection: ' + validation.errors.slice(0, 5).join('; ') + '. Run autoresearch_plan_validate / autoresearch_migration_diagnostic first.')
        }
        const contract = validation.contracts[args.nodeId.trim()]
        if (!contract) throw new Error('Unknown plan node id for Linear projection: ' + args.nodeId)
        block = autoresearchCore.renderSpecBlock(contract, { projectDigest: validation.digest })
        scopeNote = 'autoresearch-scope-note:' + args.autoresearchProjectId.trim() + ':' + validation.revision
        description = typeof description === 'string' && description.trim()
          ? description.trim() + '\n\n' + block
          : block
      }
      const result = await linearCore.createIssueFlow(
        { ...args, description },
        (request) => transport(request, exec, baseDir),
        (reason) => requireApproval(exec, 'linear_create_issue', reason, baseDir),
      )
      if (result.reconciled && result.issue && block) {
        const current = String(result.issue.description ?? '')
        const synchronized = autoresearchCore.upsertSpecBlock(current, block)
        if (synchronized !== current || !synchronized.includes(scopeNote)) {
          const finalDescription = synchronized.includes(scopeNote) ? synchronized : synchronized + '\n\n' + scopeNote
          const update = await executeLinear('updateIssueDescription', { id: result.issue.id, description: finalDescription }, exec, baseDir)
          result.issue = update.issue
          result.specBlockSynchronized = true
          if (!synchronized.includes(scopeNote)) result.scopeNoteAppended = true
        }
      }
      if (block) {
        result.specBlock = block
        result.scopeNote = scopeNote
      }
      return result
    })

    tool('linear_build_probe', 'Report the mounted Linear entry generation, expected/actual aggregate build ID, and graphMatches against the build manifest. Both preset entries must report the same candidate aggregate ID and graphMatches:true after a remount.', null, async (args, exec) => {
      assertCallingAgent(exec)
      if (subprocess === undefined) throw new Error('subprocess service unavailable; cannot run the build probe')
      const baseDir = baseDirOf(exec, args)
      return await runBuildProbe(subprocess, baseDir)
    })

    return undefined
  },
}

export default LINEAR_PLUGIN

// Libraries exposed for the external test harness. The plugin loader consumes
// only the default export.
export const createLibraries = {
  pathutil,
  util,
  linearCore,
  core: autoresearchCore,
  helpers: {
    runBuildProbe,
    absPath,
  },
}
