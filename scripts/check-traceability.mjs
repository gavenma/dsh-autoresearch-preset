#!/usr/bin/env node
// Phase 0 gate: the committed traceability matrix (docs/traceability-matrix.md)
// must classify every P-* report in docs/reported_bugs_0908.md, name an owning
// section and regression fixture for every preset-relevant row, mark
// project-specific rows excluded, and reference only fixtures that actually
// exist under tests/. A plan-section proposal is not enough: the gate verifies
// the named fixture file is present so coverage claims cannot drift.
//
// Usage: node scripts/check-traceability.mjs
// Exit 0 when the matrix is complete; 1 with the first violation otherwise.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const bugFile = read('docs/reported_bugs_0908.md')
const matrix = read('docs/traceability-matrix.md')
const plan = read('docs/autoresearch-canonical-linear-reliability-plan.md')

const failures = []
const fail = (message) => failures.push(message)

// 1. Every P-* in the bug file must appear in the matrix.
const bugReports = [...new Set([...bugFile.matchAll(/^#{2,3} (P-\d{3}(?:a)?)/gm)].map((m) => m[1]))]
// P-020a appears in a non-heading paragraph; scan body occurrences too.
for (const id of ['P-020a']) if (bugFile.includes(id)) bugReports.push(id)
bugReports.sort()
if (bugReports.length === 0) fail('no P-* reports found in docs/reported_bugs_0908.md — did the file move?')
const matrixRows = new Map()
for (const row of matrix.split('\n')) {
  if (!row.startsWith('| P-')) continue
  const ids = [...row.matchAll(/P-\d{3}(?:a)?/g)].map((m) => m[0])
  for (const id of ids) if (!matrixRows.has(id)) matrixRows.set(id, row)
}
for (const id of bugReports) {
  if (!matrixRows.has(id)) fail(`P-* report ${id} is not classified in docs/traceability-matrix.md`)
}
// Every classified id must actually come from the bug file (no stale rows).
for (const id of matrixRows.keys()) {
  if (!bugReports.includes(id) && !id.startsWith('LC-')) {
    if (!bugFile.includes(id)) fail(`matrix row for ${id} references a report that is not in the bug file`)
  }
}

// 2/3. Row-by-row classification and fixture rules.
for (const [id, row] of matrixRows) {
  const classification = /common-preset-defect|external-harness-behavior|benign-behavior|project-specific/.test(row)
  if (!classification) fail(`${id}: row has no recognized classification`)
  if (/project-specific/.test(row)) {
    if (!/excluded/.test(row)) fail(`${id}: project-specific row must be marked excluded`)
    continue
  }
  if (/\|\s*n\/a\b/.test(row) && !/project-specific/.test(row)) fail(`${id}: non-excluded row lacks a regression fixture`)
  const fixtureCells = [...row.matchAll(/`tests\/[a-z0-9.-]+\.test\.mjs`/g)].map((m) => m[0])
  if (fixtureCells.length === 0) fail(`${id}: row names no regression fixture under tests/`)
  const section = /§\d+(\.\d+)?/.test(row)
  if (!section) fail(`${id}: row names no owning plan section (use §n.n)`)
}

// 4. Every fixture named in the matrix must exist under tests/.
const testDir = path.join(root, 'tests')
const existingTests = new Set(fs.readdirSync(testDir).map((name) => 'tests/' + name))
const referenced = new Set([...matrix.matchAll(/`tests\/([a-z0-9.-]+\.test\.mjs)`/g)].map((m) => 'tests/' + m[1]))
for (const fixture of referenced) {
  if (!existingTests.has(fixture)) {
    fail(`${fixture} is referenced by the matrix but does not exist under tests/`)
  }
}

// 5. External-harness rows must carry a routing note.
for (const [id, row] of matrixRows) {
  if (/external-harness-behavior/.test(row) && !/rout|document/.test(row)) {
    fail(`${id}: external-harness-behavior row must state that the preset detects and routes it (harness owner)`)
  }
}

if (failures.length > 0) {
  console.error('traceability gate FAILED:')
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
console.log(`traceability gate passed: ${bugReports.length} P-* reports classified, ${referenced.size} fixtures referenced`)
