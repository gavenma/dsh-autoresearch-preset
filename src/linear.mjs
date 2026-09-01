// Source entry for the AutoResearch Linear adapter. The build script emits a versioned runtime bundle.
import * as core from "./autoresearch-core.mjs"
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
    workspaceMetadata: `query { teams { nodes { id name key states { nodes { id name type } } } } }`,
    getIssue: `query Issue($id: String!) {
      issue(id: $id) {
        id identifier title description
        state { id name type }
        labels { nodes { name } }
        assignee { name }
        url
      }
    }`,
    listComments: `query Issue($id: String!) {
      issue(id: $id) {
        comments { nodes { id body createdAt user { name } } }
      }
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
          teams: (data.teams?.nodes ?? []).map((team) => ({
            id: team.id,
            name: team.name,
            key: team.key,
            states: (team.states?.nodes ?? []).map((state) => ({ id: state.id, name: state.name, type: state.type })),
          })),
        }
      case 'getIssue': {
        const issue = data.issue
        if (!issue) throw Object.assign(new Error('Issue not found'), { code: 'LINEAR_NOT_FOUND' })
        const labels = (issue.labels?.nodes ?? []).map((label) => label.name)
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
            state: issue.state ? { name: issue.state.name, type: issue.state.type } : null,
            labels,
            assignee: issue.assignee?.name ?? null,
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
          })),
        }
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

  // Paginated project listing (plan C3): never assumes one page.
  core.listProjectIssues = async function (projectId, transport, opts = {}) {
    const first = typeof opts.first === 'number' ? opts.first : 50
    const maxPages = typeof opts.maxPages === 'number' ? opts.maxPages : 10
    let after = null
    const issues = []
    let pages = 0
    for (;;) {
      pages += 1
      const variables = { id: projectId, first, ...(after ? { after } : {}) }
      const page = await core.execute('listProjectIssues', variables, transport)
      for (const issue of page.issues ?? []) issues.push(issue)
      if (!page.pageInfo?.hasNextPage || !page.pageInfo?.endCursor) break
      if (pages >= maxPages) break
      after = page.pageInfo.endCursor
    }
    return { ok: true, projectId, issues, pages, truncated: pages >= maxPages }
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
  // from the stable AutoResearch plan id embedded in node markers. It also
  // detects the legacy marker shape produced when those two ids were conflated.
  core.reconcileIssueCandidates = async function (linearProjectId, autoresearchProjectId, nodeId, transport, opts = {}) {
    const marker = core.nodeMarker(autoresearchProjectId, nodeId)
    const legacyMarker = core.nodeMarker(linearProjectId, nodeId)
    const { issues } = await core.listProjectIssues(linearProjectId, transport, opts)
    const canonicalMatches = issues.filter((issue) => (issue.description ?? '').includes(marker))
    const legacyMatches = marker === legacyMarker
      ? []
      : issues.filter((issue) => (issue.description ?? '').includes(legacyMarker))
    if (canonicalMatches.length > 1 || legacyMatches.length > 1 || (canonicalMatches.length === 1 && legacyMatches.length === 1 && canonicalMatches[0].id !== legacyMatches[0].id)) {
      throw Object.assign(new Error(`Multiple Linear issues carry canonical or legacy markers for node "${nodeId}"; reconcile before creating.`), { code: 'LINEAR_AMBIGUOUS' })
    }
    return {
      marker,
      legacyMarker,
      canonical: canonicalMatches[0] ?? null,
      legacy: legacyMatches[0] ?? null,
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
  // id embedded in markers. Legacy UUID-keyed markers migrate in place.
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
      return { created: false, reconciled: true, migrated: false, issue: matches.canonical, team: teamReceipt, reason: 'existing issue with the same marker' }
    }
    if (matches.legacy) {
      await approver(`migrate Linear issue ${matches.legacy.identifier ?? matches.legacy.id} to canonical AutoResearch marker ${matches.marker}`)
      const description = String(matches.legacy.description ?? '').split(matches.legacyMarker).join(matches.marker)
      const result = await core.execute('updateIssueDescription', { id: matches.legacy.id, description }, transport)
      if (result.success !== true || !result.issue) {
        throw Object.assign(new Error('Linear issueUpdate marker migration reported failure'), { code: 'LINEAR_MUTATION_FAILED' })
      }
      return {
        created: false,
        reconciled: true,
        migrated: true,
        issue: result.issue,
        team: teamReceipt,
        reason: 'migrated legacy Linear-project-id marker to the canonical AutoResearch project id',
        receipt: {
          marker: matches.marker,
          legacyMarker: matches.legacyMarker,
          teamId: team.id,
          projectId: linearProjectId,
          autoresearchProjectId,
          issueId: result.issue.id,
          identifier: result.issue.identifier,
          url: result.issue.url ?? '',
          migratedAt: new Date().toISOString(),
        },
      }
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
      migrated: false,
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
  for (const [relPath, expectedHash] of Object.entries(manifest.files ?? {})) {
    try {
      const result = await runSubprocess(subprocessService, baseDir, [shasum, '-a', '256', absPath(presetRoot, relPath)])
      const match = String(result.stdout).match(/^([0-9a-f]{64})\s+/m)
      if (!match) {
        mismatches.push(relPath + ': shasum produced no hash')
        continue
      }
      graph[relPath] = match[1]
      if (match[1] !== expectedHash) mismatches.push(relPath + ': hash mismatch')
    } catch (error) {
      mismatches.push(relPath + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const scope = Array.isArray(manifest.aggregateScope) ? manifest.aggregateScope : Object.keys(graph)
  const scopeGraph = {}
  for (const rel of scope) {
    if (graph[rel] !== undefined) scopeGraph[rel] = graph[rel]
  }
  const aggregate = core.aggregateBuildId(scopeGraph)
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
      }
    }

    // Load the approved plan from the calling workspace (plan §4.5): Linear
    // projection derives from the canonical contract, never from caller
    // prose.
    async function loadApprovedPlan(fops, baseDir, autoresearchProjectId) {
      if (!fops) throw new Error('fs service unavailable; cannot load the approved plan from the workspace')
      const candidates = [
        absPath(baseDir, 'research-agent/projects/' + autoresearchProjectId + '/plan.json'),
        absPath(baseDir, '.research-agent/projects/' + autoresearchProjectId + '/plan.json'),
      ]
      for (const planPath of candidates) {
        const plan = await fops.readJson(planPath)
        if (util.isPlainObject(plan)) return plan
      }
      throw new Error('Approved plan not readable at ' + candidates.join(' or ') + '; Linear projection is blocked (plan §4.5).')
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

    function tool(name, description, paramsSchema, executor) {
      registerTool({
        name,
        description,
        parameters: paramsSchema,
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

    tool('linear_whoami', 'Verify Linear authentication and list the viewer + organization. Run this first on any Linear workflow.', {
      type: 'object', additionalProperties: true,
      properties: { baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' } },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('whoami', {}, exec, baseDirOf(exec, args))
    })

    tool('linear_workspace_metadata', 'List teams with their issue states and labels. Required before any issue state transition.', {
      type: 'object', additionalProperties: true,
      properties: { baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' } },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('workspaceMetadata', {}, exec, baseDirOf(exec, args))
    })

    tool('linear_get_issue', 'Fetch one Linear issue as a structured snapshot plus init_run-ready markdown.', {
      type: 'object', additionalProperties: true,
      properties: {
        id: { type: 'string', description: 'Issue identifier, e.g. ISS-123.' },
        baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('getIssue', { id: args.id }, exec, baseDirOf(exec, args))
    })

    tool('linear_list_comments', 'List comments on one Linear issue.', {
      type: 'object', additionalProperties: true,
      properties: {
        id: { type: 'string', description: 'Issue identifier, e.g. ISS-123.' },
        baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('listComments', { id: args.id }, exec, baseDirOf(exec, args))
    })

    tool('linear_list_issues', 'List recent Linear issues ordered by update time; pass projectId to list one project\'s issues (paginated, marker-bearing).', {
      type: 'object', additionalProperties: true,
      properties: {
        first: { type: 'number', description: 'Max issues per page.' },
        projectId: str('Optional Linear project id: list that project\'s issues (paginated).'),
        maxPages: { type: 'number', description: 'Optional pagination cap (default 10 pages).' },
        baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      if (typeof args.projectId === 'string' && args.projectId.trim()) {
        return await linearCore.listProjectIssues(args.projectId.trim(), (request) => transport(request, exec, baseDirOf(exec, args)), args)
      }
      return await executeLinear('listIssues', { first: typeof args.first === 'number' ? args.first : 25 }, exec, baseDirOf(exec, args))
    })

    tool('linear_search_issues', 'Search Linear issues by term.', {
      type: 'object', additionalProperties: true,
      properties: {
        term: { type: 'string', description: 'Search term.' },
        baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      return await executeLinear('searchIssues', { term: args.term }, exec, baseDirOf(exec, args))
    })

    tool('linear_create_comment', 'Post a comment on a Linear issue. Pass idempotencyMarker to make posting idempotent: when a comment already contains the marker, the call skips creation and returns the existing comment (revision-protocol replay converges without duplicates).', {
      type: 'object', additionalProperties: true,
      properties: {
        id: { type: 'string', description: 'Issue identifier, e.g. ISS-123.' },
        body: { type: 'string', description: 'Comment body (markdown).' },
        idempotencyMarker: str('Optional marker: if any existing comment contains it, no comment is created.'),
        baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      if (typeof args.idempotencyMarker === 'string' && args.idempotencyMarker.trim()) {
        const existing = await executeLinear('listComments', { id: args.id }, exec, baseDir)
        const hit = (existing.comments ?? []).find((comment) => String(comment.body ?? '').includes(args.idempotencyMarker))
        if (hit) {
          return { ok: true, skipped: true, commentId: hit.id, reason: 'an idempotent comment with the marker already exists' }
        }
      }
      const result = await executeLinear('createComment', { id: args.id, body: args.body }, exec, baseDir)
      return { ok: true, ...result, skipped: false }
    })

    tool('linear_update_issue', "Update a Linear issue's state (stateId from linear_workspace_metadata).", {
      type: 'object', additionalProperties: true,
      properties: {
        id: { type: 'string', description: 'Issue identifier, e.g. ISS-123.' },
        stateId: { type: 'string', description: 'Target state id from linear_workspace_metadata.' },
        baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      return await executeLinear('updateIssue', { id: args.id, stateId: args.stateId }, exec, baseDirOf(exec, args))
    })

    // ── project mode (plan §3 C1–C2, §4.5 spec projection) ────────────────

    tool('linear_create_project', "Create a Linear project for an approved AutoResearch plan. Auto-approved by default (config linear.approval: 'auto'); set linear.approval: 'ask' to require approval prompts. Reconciles by marker, never by name alone.", {
      type: 'object', additionalProperties: true,
      properties: {
        name: str('Project name.'),
        projectId: str('Stable AutoResearch project id used in the marker (matches plan.projectId).'),
        description: str('Optional project description; the AutoResearch marker is appended.'),
        teamId: str('Approved Linear team id (resolved against workspace_metadata).'),
        teamKey: str('Alternative to teamId: the team key to resolve.'),
        priority: { type: 'number', description: 'Optional Linear priority.' },
        startDate: str('Optional start date (YYYY-MM-DD).'),
        targetDate: str('Optional target date (YYYY-MM-DD).'),
        baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      return await linearCore.createProjectFlow(
        args,
        (request) => transport(request, exec, baseDirOf(exec, args)),
        (reason) => requireApproval(exec, 'linear_create_project', reason, baseDirOf(exec, args)),
      )
    })

    tool('linear_create_issue', "Create or reconcile one Linear issue for an approved plan node. The generated specification block is rendered from the approved plan (node contract digest, kind, artifact format, roles, budget, plan revision) — never from caller prose; user-authored text outside the block is preserved. Replaying synchronizes only the generated block and appends one idempotent scope note per plan revision. Migrates legacy UUID-keyed markers in place. Auto-approved by default; set linear.approval: 'ask' to require approval prompts.", {
      type: 'object', additionalProperties: true,
      required: ['projectId', 'autoresearchProjectId', 'nodeId', 'title'],
      properties: {
        projectId: str('Linear project id (from linear_create_project). Selects the Linear container.'),
        autoresearchProjectId: str('Stable AutoResearch project id encoded in the node marker (matches plan.projectId).'),
        nodeId: str('Plan node id; encoded in the stable node marker.'),
        title: str('Issue title.'),
        description: str('Optional user-authored issue description; the generated spec block and the node marker are appended.'),
        teamId: str('Approved Linear team id (resolved against workspace_metadata).'),
        teamKey: str('Alternative to teamId: the team key to resolve.'),
        parentId: str('Optional display-only parent issue id (Linear parentId is advisory; plan.json is the authoritative DAG).'),
        stateId: str('Optional initial state id.'),
        estimate: { type: 'number', description: 'Optional estimate.' },
        baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = baseDirOf(exec, args)
      const fops = makeFops(baseDir)
      let description = args.description
      let block = null
      let scopeNote = ''
      if (typeof args.autoresearchProjectId === 'string' && args.autoresearchProjectId.trim() && typeof args.nodeId === 'string' && args.nodeId.trim()) {
        const plan = await loadApprovedPlan(fops, baseDir, args.autoresearchProjectId.trim())
        const validation = core.validatePlan(plan)
        if (!validation.ok) {
          throw new Error('Linear projection blocked: the approved plan is invalid for projection: ' + validation.errors.slice(0, 5).join('; ') + '. Run autoresearch_plan_validate / autoresearch_migration_diagnostic first.')
        }
        const contract = validation.contracts[args.nodeId.trim()]
        if (!contract) throw new Error('Unknown plan node id for Linear projection: ' + args.nodeId)
        block = core.renderSpecBlock(contract, { projectDigest: validation.digest })
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
        const synchronized = core.upsertSpecBlock(current, block)
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

    tool('linear_build_probe', 'Report the mounted Linear entry generation, expected/actual aggregate build ID, and graphMatches against the build manifest. Both preset entries must report the same candidate aggregate ID and graphMatches:true after a remount.', {
      type: 'object', additionalProperties: true,
      properties: {
        baseDir: { type: 'string', description: 'Workspace root. Defaults to the calling session workspace.' },
      },
    }, async (args, exec) => {
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
  core,
  helpers: {
    runBuildProbe,
    absPath,
  },
}
