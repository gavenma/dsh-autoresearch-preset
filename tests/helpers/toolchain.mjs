import fsSync from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/**
 * Whether a usable TeX toolchain is present in THIS environment.
 *
 * The code under test resolves executables through `PATH` (the subprocess
 * service), so the probe must resolve the same way. An earlier version
 * hardcoded `/usr/bin/latexmk`, which reports a toolchain the host does not
 * actually offer: on a machine where that exact path exists but `latexmk`
 * cannot run — or where the binary lives elsewhere on `PATH` — the tests took
 * the "compiler present" branch while the strict build failed with a raw
 * transport error, which is the failure the toolchain-aware branches exist to
 * prevent.
 *
 * Resolution and a real invocation must both succeed, so a stub on `PATH` that
 * exits non-zero counts as absent rather than as an available compiler.
 */
export const texAvailable = (() => {
  const findOnPath = (name) => {
    for (const dir of String(process.env.PATH ?? '').split(':')) {
      if (!dir) continue
      try { fsSync.accessSync(path.join(dir, name), fsSync.constants.X_OK); return true } catch { /* keep looking */ }
    }
    return false
  }
  if (!findOnPath('latexmk') || !findOnPath('pdflatex')) return false
  try {
    execFileSync('latexmk', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
