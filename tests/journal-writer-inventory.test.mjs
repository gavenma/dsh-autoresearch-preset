import assert from 'node:assert/strict'

// The journal writer inventory: EVERY module that writes `state.json` must appear
// here, with the function that owns the write and the guard it relies on.
//
// This gate exists because self-enumeration is exactly what failed: an earlier
// inventory searched one pattern (`projectstate.*`) in one file (the orchestrator)
// and therefore could not see `markProjectionConfirmed`, which builds the journal
// path itself inside `linear.mjs`. Six writers escaped a gate that reported
// success. The scan below is deliberately dumb and broad - every `writeJson` whose
// target is a journal path, in every source module - so a new writer fails the
// build instead of quietly bypassing the entry point.
//
// Adding a row is a deliberate act. The `guard` column is documentation, not
// enforcement; enforcement is that the row must exist.
const INVENTORY = [
  // ── direct write sites: a `writeJson` that constructs the journal path ──────
  // The ONE write primitive. `mutateState` validates the state it is about to
  // persist and CASes against the version it read, so the mutations below inherit
  // the guard through it.
  { kind: 'site', file: 'research-orchestrator.mjs', fn: 'saveState', guard: 'primitive: called only by mutateState, after validation and CAS', reason: 'the single journal write primitive; a create/replace choice is made from the health and version probes' },
  // The cross-module writer. It CANNOT reach `mutateState`: it lives below the
  // orchestrator and builds its own journal path, so threading an orchestrator
  // service into a lower module would invert the dependency. It therefore carries
  // the validation half of the guard itself and refuses an invalid journal.
  { kind: 'site', file: 'linear.mjs', fn: 'markProjectionConfirmed', guard: 'validate-before-write (cannot reach mutateState)', reason: 'lower module; validates with the core it already imports and refuses PROJECT_STATE_INVALID' },

  // ── mutation functions: no direct write; they re-apply to the state
  //    `mutateState` read, so a concurrent writer loses the CAS ────────────────
  { kind: 'mutation', file: 'research-orchestrator.mjs', fn: 'patchNode' },
  { kind: 'mutation', file: 'research-orchestrator.mjs', fn: 'transitionNode' },
  { kind: 'mutation', file: 'research-orchestrator.mjs', fn: 'advanceCommentCursor' },
  { kind: 'mutation', file: 'research-orchestrator.mjs', fn: 'syncJournalNode' },
  { kind: 'mutation', file: 'research-orchestrator.mjs', fn: 'resetDownstreamState' },
  { kind: 'mutation', file: 'research-orchestrator.mjs', fn: 'recordLastKnownGood' },
  { kind: 'mutation', file: 'research-orchestrator.mjs', fn: 'autoresearch_submit_feedback' },
  { kind: 'mutation', file: 'research-orchestrator.mjs', fn: 'autoresearch_record_feedback_triage' },
  { kind: 'mutation', file: 'research-orchestrator.mjs', fn: 'autoresearch_close_feedback' },
]

// A write is a journal write when its target expression constructs the state path.
const JOURNAL_PATH = /[^\w]writeJson\(\s*(?:statePath\b|statePathOverride\b|projectstate\.statePath\()/

async function scan() {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const found = []
  for (const file of ['autoresearch-core.mjs', 'research-orchestrator.mjs', 'linear.mjs']) {
    const lines = (await fs.readFile(path.join(root, 'src', file), 'utf8')).split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (!JOURNAL_PATH.test(lines[i])) continue
      found.push({ file, line: i + 1, owner: enclosing(lines, i), text: lines[i].trim() })
    }
  }
  return found
}

// The nearest function-ish declaration at or above the write. Tool handlers are
// named by their `tool('autoresearch_...')` registration, which is how the
// feedback writers are reached.
function enclosing(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    const tool = lines[i].match(/tool\('(autoresearch_[a-z_]+)'/)
    if (tool) return tool[1]
    // A plain declaration, or an assignment whose target may be dotted —
    // `projectstate.saveState = async function` and
    // `core.markProjectionConfirmed = async function` are both declarations here,
    // and matching only the dotted-free form would report the WRONG owner (the
    // next function up the file) while looking authoritative.
    const decl = lines[i].match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)/)
    if (decl) return decl[1]
    const assigned = lines[i].match(/^\s*([A-Za-z0-9_.]+)\s*=\s*(?:async\s*)?function/)
    if (assigned) return assigned[1].split('.').pop()
    // A real arrow only. `name = (` is ALSO how a multi-line call is written, and
    // matching that reported a caller's variable name as the owner — an answer
    // that looked authoritative and was wrong.
    const arrow = lines[i].match(/^\s*([A-Za-z0-9_.]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/)
    if (arrow) return arrow[1].split('.').pop()
  }
  return '(unknown)'
}

const sites = await scan()
assert.ok(sites.length > 0, 'the scan must find journal writes at all - a scanner that matches nothing would pass every check')

// 1. Every DIRECT write site must be a declared row.
const siteRows = INVENTORY.filter((entry) => entry.kind === 'site')
const failures = []
for (const site of sites) {
  const row = siteRows.find((entry) => entry.file === site.file && entry.fn === site.owner)
  if (!row) failures.push(site.file + ':' + site.line + ' writes the journal from `' + site.owner + '`, which is NOT in the writer inventory. Route it through projectstate.mutateState, or add a reviewed row recording the guard it relies on. Line: ' + site.text)
}
assert.deepEqual(failures, [], 'every journal write must be a declared, guarded site: ' + failures.join(' | '))

// 2. No stale site rows: a row whose function no longer writes the journal is a
//    claim that has stopped being true, which is how an inventory starts lying.
const stale = []
for (const row of siteRows) {
  if (!sites.some((site) => site.file === row.file && site.owner === row.fn)) stale.push(row.file + ':' + row.fn)
}
assert.deepEqual(stale, [], 'site rows with no matching write (remove or re-point them): ' + stale.join(' | '))

// 3. Every MUTATION row must genuinely reach the entry point, so "mutateState" is
//    a measured fact rather than a note. A row claiming it whose function never
//    calls it would be the gate reporting success while the behaviour it forbids
//    continues - the exact failure this file exists to prevent.
{
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const omissions = []
  for (const row of INVENTORY.filter((entry) => entry.kind === 'mutation')) {
    const lines = (await fs.readFile(path.join(root, 'src', row.file), 'utf8')).split(String.fromCharCode(10))
    // Three declaration forms are used in this codebase: a plain function, a
    // dotted assignment (`projectstate.patchNode = async function`), and a tool
    // registration (`tool('autoresearch_submit_feedback', ...)` whose handler is an
    // arrow). Matching only the first form reported every mutation row as missing.
    const named = lines.findIndex((line) => new RegExp('(?:function|\\.)' + row.fn + '\\s*=').test(line) || new RegExp('function\\s+' + row.fn + '\\b').test(line))
    const toolAt = lines.findIndex((line) => line.includes("tool('" + row.fn + "'"))
    const start = named >= 0 ? named : toolAt
    if (start < 0) { omissions.push(row.fn + ' (declaration not found)'); continue }
    const body = lines.slice(start, start + 300).join('\n')
    if (!/projectstate\.mutateState/.test(body)) omissions.push(row.fn + ' is declared a mutation but never calls projectstate.mutateState')
  }
  assert.deepEqual(omissions, [], 'mutation rows whose stated guard is false: ' + omissions.join(' | '))
}

console.log('journal writer inventory gate passed: ' + sites.length + ' declared write sites across ' + new Set(sites.map((s) => s.file)).size + ' modules')
