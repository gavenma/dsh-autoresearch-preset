// Live Linear check: the Current Node Context blocks Linear actually STORES
// must parse and re-sign their own digest.
//
// This is the one check the pure suite cannot make. Unit fixtures only prove
// the parser agrees with the renderer; they cannot prove the parser agrees
// with Linear's storage format, and Linear does not store what we write:
// it normalizes `- ` list bullets to `* ` while GFM task-list items
// (`- [ ]` / `- [x]`) survive verbatim. A stored block is therefore a MIX, and
// a parser that accepts only the renderer's token rejects every block that
// ever went through Linear — the failure that made linear_get_node_context
// report context-missing and linear_update_node_context fail its read-back
// confirmation while the stored block was perfectly well-formed.
//
// Policy (per AGENTS.md §5): this machine has the credentials and the network,
// so the test does not degrade into a skip. It runs against the real API and
// fails loudly when a block is stored that the preset cannot read back.
//
// Linear mutations are deliberately absent: this test only reads.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { core } from './helpers/canonical-fixtures.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HELPER = path.join(root, 'tools', 'linear-client.mjs')
// The three batch-1 nodes of the grf-2026 project: the issues whose stored
// blocks were unreadable when the bullet tolerance was missing. They are
// expected to carry a context block for the whole life of the project; a
// missing one is a real finding, not a reason to skip.
const LIVE_ISSUES = ['GAV-111', 'GAV-112', 'GAV-113']

// The credential is read from the DSH credentials store, the same source the
// linear plugin resolves LINEAR_API_KEY from. It is never printed or written.
async function resolveApiKey() {
  if (process.env.LINEAR_API_KEY?.trim()) return process.env.LINEAR_API_KEY.trim()
  const home = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
  let text
  try {
    text = await fs.readFile(path.join(home, '.credentials.yaml'), 'utf8')
  } catch {
    return null
  }
  const match = text.match(/LINEAR_API_KEY:\s*"?([^"\n]+)"?/)
  return match ? match[1].trim() : null
}

// One GraphQL request through the preset's own transport helper, so the test
// exercises the shipped client (retries, header handling) rather than a second
// HTTP path.
function graphql(query, variables, token) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HELPER], { env: { ...process.env, LINEAR_API_KEY: token }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('linear-client exited ' + code + ': ' + stderr.trim()))
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error('linear-client returned non-JSON: ' + stdout.slice(0, 200)))
      }
    })
    child.stdin.end(JSON.stringify({ query, variables }))
  })
}

const token = await resolveApiKey()
assert.ok(token, 'LINEAR_API_KEY must be set in the environment or ' + path.join(process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh'), '.credentials.yaml') + ': this check runs against the live Linear workspace by policy, it does not skip')

// One aliased lookup per identifier: `issue(id:)` accepts the `GAV-111` key
// form, while IssueFilter has no identifier field.
const query = 'query { ' + LIVE_ISSUES.map((identifier, index) => 'i' + index + ': issue(id: "' + identifier + '") { identifier url description }').join(' ') + ' }'
const response = await graphql(query, {}, token)
assert.equal(response.error, undefined, 'the Linear transport reported: ' + JSON.stringify(response.error ?? null))
assert.ok(response.statusCode >= 200 && response.statusCode < 300, 'Linear returned HTTP ' + response.statusCode + ': ' + String(response.bodyText ?? '').slice(0, 200))
const body = JSON.parse(response.bodyText)
assert.equal(body.errors, undefined, 'Linear GraphQL errors: ' + JSON.stringify(body.errors ?? null))
const issues = LIVE_ISSUES.map((identifier, index) => body.data?.['i' + index]).filter(Boolean)
assert.equal(issues.length, LIVE_ISSUES.length, 'every probed issue must exist in the workspace (resolved: ' + issues.map((issue) => issue.identifier).join(', ') + ')')

let checked = 0
for (const identifier of LIVE_ISSUES) {
  const issue = issues.find((item) => item.identifier === identifier)
  assert.ok(issue, identifier + ' must resolve from Linear')
  const description = String(issue.description ?? '')
  const declared = (description.match(/^context-digest: ([0-9a-f]{64})$/m) ?? [])[1]
  assert.ok(declared, identifier + ' carries a Current Node Context block with a signed digest (' + issue.url + ')')
  const parsed = core.parseContextBlock(description)
  assert.equal(parsed.ok, true, identifier + ': the block Linear stored must parse (' + (parsed.reason ?? '') + ') — ' + issue.url)
  const computed = core.contextBlockDigest(parsed.state)
  assert.equal(computed, declared, identifier + ': the rebuilt state must re-sign the stored digest — ' + issue.url)
  // The stored form is normalized by Linear, so the tolerance is what made the
  // parse above succeed. If Linear ever stops normalizing, this check should be
  // re-examined rather than silently hollowed out.
  assert.ok(description.includes('* Status: '), identifier + ': Linear stores visible headers with `* ` bullets — ' + issue.url)
  checked += 1
}

console.log('live Linear stored-context check passed for ' + checked + ' issue(s)')
