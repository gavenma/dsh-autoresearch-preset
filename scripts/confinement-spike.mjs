#!/usr/bin/env node
// Confinement attestation spike (plan Phase 0, §5.1 invariant 7).
//
// Probes, for the shell adapter as executed by the running harness:
//   (a) write scope  — can the shell write outside the declared work root?
//   (b) read scope   — can the shell read outside the declared read roots?
//   (c) shell egress — can the shell reach an external network destination?
//
// A scope is "enforced" only when the control case succeeds and the escape
// case fails. The result is a structured attestation receipt; the broad role
// tooling baseline ships ONLY when all three are enforced. Otherwise the
// preset must fail closed to the narrow least-privilege profile for the run
// and record `confinement-unattested`.
//
// Usage: node scripts/confinement-spike.mjs [--write-root <dir>] [--read-root <dir>]
// Exit code 0 when the run may be attested, 1 otherwise (both print JSON).

import { execFileSync, execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const cwd = process.cwd()
const writeRoot = path.resolve(argOf('--write-root', cwd))
const readRoot = path.resolve(argOf('--read-root', cwd))

const run = (command, cmdArgs, timeoutMs = 15000) => {
  return new Promise((resolve) => {
    let settled = false
    const finish = (stdout, stderr, code) => {
      if (!settled) {
        settled = true
        resolve({ code, stdout: String(stdout ?? '').trim(), stderr: String(stderr ?? '').trim() })
      }
    }
    try {
      execFile(command, cmdArgs, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        finish(stdout, stderr, error ? (typeof error.code === 'number' ? error.code : 1) : 0)
      })
    } catch (error) {
      finish('', error.message, 1)
    }
  })
}

const stamp = Date.now()
const token = crypto.randomBytes(4).toString('hex')

const probes = []

// (a) write scope: control (inside root) must succeed; escape (outside root)
// must fail. /tmp is a platform temp area the harness may allow; an escape
// target under it is still outside the declared write root and counts.
{
  const control = path.join(writeRoot, `.confinement-spike-${stamp}-${token}.txt`)
  const escape = path.join(os.tmpdir(), `.confinement-spike-${stamp}-${token}.txt`)
  const homeEscape = path.join(os.homedir(), `.confinement-spike-${stamp}-${token}.txt`)
  const controlProbe = await run('sh', ['-c', `printf x > ${JSON.stringify(control)} && printf ok`])
  const escapeProbe = await run('sh', ['-c', `printf x > ${JSON.stringify(escape)}`])
  const homeProbe = await run('sh', ['-c', `printf x > ${JSON.stringify(homeEscape)}`])
  for (const p of [control, escape, homeEscape]) {
    try { fs.unlinkSync(p) } catch { /* probe residue is benign */ }
  }
  const controlOk = controlProbe.code === 0
  const escapeBlocked = escapeProbe.code !== 0
  const homeBlocked = homeProbe.code !== 0
  const enforced = controlOk && escapeBlocked && homeBlocked
  probes.push({
    scope: 'write',
    enforced,
    control: { expected: 'allowed', observed: controlOk ? 'allowed' : `denied unexpectedly: ${controlProbe.stderr}` },
    escapes: [
      { target: escape, expected: 'blocked', observed: escapeBlocked ? 'blocked' : 'ALLOWED (write escaped declared root)' },
      { target: homeEscape, expected: 'blocked', observed: homeBlocked ? 'blocked' : 'ALLOWED (write escaped declared root)' },
    ],
  })
}

// (b) read scope: control (inside root) must succeed; escape (outside root)
// must fail.
{
  const control = path.join(readRoot, 'package.json')
  const escape = '/etc/hostname'
  const controlProbe = await run('sh', ['-c', `head -c 16 ${JSON.stringify(control)}`])
  const escapeProbe = await run('sh', ['-c', `cat ${JSON.stringify(escape)}`])
  const controlOk = controlProbe.code === 0
  const escapeBlocked = escapeProbe.code !== 0
  const enforced = controlOk && escapeBlocked
  probes.push({
    scope: 'read',
    enforced,
    control: { expected: 'allowed', observed: controlOk ? 'allowed' : `denied unexpectedly: ${controlProbe.stderr}` },
    escapes: [
      { target: escape, expected: 'blocked', observed: escapeBlocked ? 'blocked' : `ALLOWED (read outside declared roots): ${escapeProbe.stdout.slice(0, 64)}` },
    ],
  })
}

// (c) shell egress: with no declared network capability the shell must not
// reach an external destination.
{
  const escapeProbe = await run('sh', ['-c', `curl -sS -m 8 -o /dev/null -w '%{http_code}' http://example.com`], 20000)
  const blocked = escapeProbe.code !== 0
  const enforced = blocked
  probes.push({
    scope: 'egress',
    enforced,
    control: { expected: 'n/a (no declared network capability)', observed: 'n/a' },
    escapes: [
      { target: 'http://example.com', expected: 'blocked', observed: blocked ? `blocked (${escapeProbe.stderr.slice(0, 120) || 'non-zero exit'})` : `ALLOWED (HTTP ${escapeProbe.stdout})` },
    ],
  })
}

const attested = probes.every((probe) => probe.enforced)
const receipt = {
  kind: 'confinement-attestation',
  attested,
  status: attested ? 'confinement-attested' : 'confinement-unattested',
  probedAt: new Date().toISOString(),
  probeToken: token,
  declared: { writeRoot, readRoots: [readRoot], egress: 'none' },
  probes,
  unattestedScopes: probes.filter((probe) => !probe.enforced).map((probe) => probe.scope),
  consequence: attested
    ? 'broad role baseline (read, grep, glob, bash, write, edit) may be granted per declared roots'
    : 'fail closed: roles keep the narrow least-privilege profile for this run; no role manifest or prompt may claim confinement the adapter did not demonstrate',
}
receipt.digest = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex')
console.log(JSON.stringify(receipt, null, 2))
process.exit(attested ? 0 : 1)
