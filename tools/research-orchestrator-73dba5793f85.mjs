// AUTO-GENERATED orchestrator entry, generation 73dba5793f85. Do not edit by hand.
import * as core from "./autoresearch-core-73dba5793f85.mjs"
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

// ── lib/config.js ──
'use strict'
// Port of pi ref/extensions/research-orchestrator/lib/config.ts (plain JS).
// DSH adaptations (plan v5):
//  - D7: default budget is 2 scouts / 2 judges / 2 passes (pi: 3/3/5).
//  - roleModels defaults are null = "harness default" (pi pinned grok/deepseek).
//  - The loop checklist references autoresearch_list_role_profiles instead of
//    the dropped autoresearch_resolve_role_models.
function makeConfig(pathutil, util) {
  const config = {}

  config.DEFAULT_CONFIG = {
    numScouts: 2,
    numJudges: 2,
    maxPasses: 2,
    convergenceThreshold: 2,
    bordaScores: [3, 2, 1],
    tieBreakPriority: ['A', 'AB', 'B'],
    maxReportWords: 2000,
    postPassSummariesToLinear: false,
    evidenceGapPolicy: 'separate-round',
    finalState: 'In Review',
    sessionControl: false,
    externalResearch: true,
    linear: { approval: 'auto' },
    strictModels: false,
    artifactRoot: '.research-agent',
    roleProfiles: {},
    judgePanel: null,
    planning: { numJudges: 2, maxPasses: 2, convergenceThreshold: 2 },
    activePreset: 'inherit',
    presets: {
      'workspace-default': { contentProducing: null, supporting: null },
      'inherit': { contentProducing: null, supporting: null },
    },
    roleModels: {
      contentProducing: null,
      supporting: null,
    },
    roles: {
      planner: 'research_planner',
      scout: 'research_scout',
      verifier: 'evidence_verifier',
      author: 'research_author',
      critic: 'research_critic',
      synthesizer: 'research_synthesizer',
      judge: 'research_judge',
      reporter: 'research_reporter',
      implementationWorker: 'implementation_worker',
      reviewWorker: 'review_worker',
    },
  }

  config.CONTENT_PRODUCING_ROLES = [
    'research_planner',
    'research_author',
    'research_synthesizer',
    'research_reporter',
    'implementation_worker',
  ]

  config.SUPPORTING_ROLES = [
    'research_scout',
    'evidence_verifier',
    'research_critic',
    'research_judge',
    'review_worker',
  ]

  config.ALL_RESEARCH_ROLES = [...config.CONTENT_PRODUCING_ROLES, ...config.SUPPORTING_ROLES]

  config.mergeConfig = function (overrides) {
    const D = config.DEFAULT_CONFIG
    const base = {
      ...D,
      roleModels: { ...D.roleModels },
      roles: { ...D.roles },
      roleProfiles: { ...D.roleProfiles },
      presets: {
        'workspace-default': { ...D.presets['workspace-default'] },
        'inherit': { ...D.presets['inherit'] },
      },
      bordaScores: [...D.bordaScores],
      tieBreakPriority: [...D.tieBreakPriority],
      judgePanel: null,
    }
    if (!util.isPlainObject(overrides)) return base
    return {
      ...base,
      ...overrides,
      roleModels: {
        ...base.roleModels,
        ...(util.isPlainObject(overrides.roleModels) ? overrides.roleModels : {}),
      },
      roles: {
        ...base.roles,
        ...(util.isPlainObject(overrides.roles) ? overrides.roles : {}),
      },
      roleProfiles: {
        ...base.roleProfiles,
        ...(util.isPlainObject(overrides.roleProfiles) ? overrides.roleProfiles : {}),
      },
      presets: {
        ...base.presets,
        ...(util.isPlainObject(overrides.presets) ? overrides.presets : {}),
      },
      bordaScores: Array.isArray(overrides.bordaScores) ? [...overrides.bordaScores] : [...base.bordaScores],
      tieBreakPriority: Array.isArray(overrides.tieBreakPriority) ? [...overrides.tieBreakPriority] : [...base.tieBreakPriority],
      judgePanel: Array.isArray(overrides.judgePanel)
        ? [...overrides.judgePanel]
        : overrides.judgePanel === undefined
          ? null
          : overrides.judgePanel,
    }
  }

  config.computeBucketModels = function (cfg) {
    const presets = (cfg.presets ?? {})
    const presetName = typeof cfg.activePreset === 'string' ? cfg.activePreset : null
    const preset = presetName ? presets[presetName] : undefined
    const presetContent = typeof preset?.contentProducing === 'string' && preset.contentProducing ? preset.contentProducing : null
    const presetSupporting = typeof preset?.supporting === 'string' && preset.supporting ? preset.supporting : null
    const overrides = util.isPlainObject(cfg.roleModels) ? cfg.roleModels : {}
    return {
      contentProducing:
        typeof overrides.contentProducing === 'string' && overrides.contentProducing
          ? overrides.contentProducing
          : presetContent,
      supporting:
        typeof overrides.supporting === 'string' && overrides.supporting
          ? overrides.supporting
          : presetSupporting,
    }
  }

  config.expectedModelForRole = function (role, cfg) {
    const buckets = config.computeBucketModels(cfg)
    if (config.CONTENT_PRODUCING_ROLES.includes(role)) return buckets.contentProducing
    if (config.SUPPORTING_ROLES.includes(role)) return buckets.supporting
    return null
  }

  config.renderLoopChecklist = function (cfg) {
    const D = config.DEFAULT_CONFIG
    return [
      '# AutoReason Loop Checklist',
      '',
      'Read this short checklist before every pass or after any context compaction. The artifact state, not chat memory, is authoritative.',
      '',
      '## Before any role work',
      '1. Read `run.json`, `history.json`, `resume.md`, and this file.',
      '2. When resuming, call `autoresearch_validate_resume(runDir)` and follow `nextStep` / `nextAction`.',
      '3. Optionally call `autoresearch_list_role_profiles` once per invocation to verify the effective per-role models and prompts.',
      '4. Write the bounded prompt packet before spawning a subagent.',
      '5. After every subagent returns, save its output, then call `autoresearch_checkpoint` (or manually update `run.json`/`resume.md`) before scoring or spawning the next role.',
      '',
      '## Evidence and initial report',
      '1. Gather scout outputs under `evidence/`.',
      '2. Verify and lock `evidence/evidence_brief.md` before report refinement.',
      '3. Spawn the initial author and write `pass_00/A.md`.',
      '',
      '## For each AutoReason pass',
      '1. Copy the current incumbent to `pass_N/A.md`; checkpoint with `pass_N_critic`.',
      '2. Spawn critic -> save `pass_N/critic.md`; checkpoint with `pass_N_author_b`.',
      '3. Spawn author B -> save `pass_N/B.md`; checkpoint with `pass_N_synthesis`.',
      '4. Spawn synthesizer AB -> save `pass_N/AB.md`; checkpoint with `pass_N_judging`.',
      '5. Call `autoresearch_anonymize_candidates`; judges only see `judge_N_candidates.md`, never maps or original IDs; save judge prompts.',
      '6. Spawn blind judges -> save `pass_N/judge_N.md`; checkpoint with `pass_N_scoring` after all judges are saved.',
      '7. Parse rankings with `autoresearch_parse_ranking` and score with `autoresearch_score_borda`.',
      '8. Save `pass_N/result.json`, update `history.json`, then checkpoint the next pass or `final_reporting`.',
      '9. If winner is A, increment consecutive A wins; otherwise reset to 0 and set incumbent to B or AB.',
      `10. Stop when consecutive A wins >= ${cfg?.convergenceThreshold ?? D.convergenceThreshold} or pass >= ${cfg?.maxPasses ?? D.maxPasses}.`,
      '',
      '## Final reporting',
      '1. Spawn reporter and write `final.md`.',
      '2. Run `autoresearch_redact_check` on `final.md` before posting externally.',
      '3. Post only the final result and local artifact path; do not post raw transcripts unless explicitly requested.',
      '4. Call `autoresearch_finalize_run` to mark complete and release the lock.',
      '',
    ].join('\n')
  }

  config.renderResume = function (runState, nextAction) {
    return [
      '# Research Run Resume Summary',
      '',
      `Issue: ${runState.issueId}`,
      `Run: ${runState.runId}`,
      `Current step: ${runState.currentStep}`,
      `Evidence brief: ${runState.evidenceBriefPath || 'not created'}`,
      `Current incumbent: ${runState.incumbentPath || 'not created'}`,
      `Consecutive A wins: ${runState.consecutiveAWins ?? 0}`,
      `Next action: ${nextAction}`,
      '',
    ].join('\n')
  }

  // Resolution ladder (option 1): workspace .research-agent/config.json →
  // opts.presetConfigPath (the preset's config.default.json; durable module
  // only) → built-in defaults.
  config.loadProjectConfig = async function (fops, projectRoot, opts = {}) {
    const file = pathutil.join(projectRoot, '.research-agent', 'config.json')
    const workspaceConfig = await fops.readJson(file)
    if (workspaceConfig !== undefined) return config.mergeConfig(workspaceConfig)
    if (opts.presetConfigPath) {
      const presetConfig = await fops.readJson(opts.presetConfigPath)
      if (presetConfig !== undefined) return config.mergeConfig(presetConfig)
    }
    return config.mergeConfig()
  }

  config.loadRunConfig = async function (fops, runDir, fallbackCfg) {
    const configPath = pathutil.join(runDir, 'config.json')
    const direct = await fops.readJson(configPath)
    if (direct !== undefined) return config.mergeConfig(direct)
    const run = await fops.readJson(pathutil.join(runDir, 'run.json'))
    if (util.isPlainObject(run?.config)) return config.mergeConfig(run.config)
    return fallbackCfg ?? config.mergeConfig()
  }

  return config
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeConfig

// ── lib/roles.js ──
'use strict'
// Default role prompts, adapted from pi ref/agents/*.toml. These are DATA, not
// behavior: shipped as the preset's roles/*.md, editable per workspace via
// config.roleProfiles.<role>.promptFile (plan §3.9).
function makeRoles() {
  return {
    research_planner: `You are the AutoResearch planner: you design the plan DAG that drives an entire research project. You think like a principal investigator with deep experience of what constitutes a strong research project.

Standards: (1) one node = one self-contained work item with one explicit purpose; (2) focused and concrete — no vague verbs, every expectedOutcome names inspectable artifacts; (3) appropriate scope and length per node for its pipeline budget, AND section-level decomposition is mandatory for document rewrites: never plan one monolithic 'rewrite the whole document' node — decompose into per-section/per-component nodes (abstract; objectives; research context / literature review; mathematical core; algorithmic or experimental components; impact and education) plus ONE assembly node that merges the drafts and runs global preservation/compilation checks, with integration re-verifying the assembled whole; (4) mechanical yes/no acceptance criteria plus a concrete test saying how they are verified; (5) honest dependsOn order with one mandatory integration node covering all leaves; (6) budgets fit the executable role list (numScouts>=1 iff research_scout is listed, otherwise 0; numJudges>=2 iff research_judge is listed, otherwise 0; positive maxPasses/convergenceThreshold); (7) reason like a PI: research question, what is known, deliverables, failure modes, success metrics, audience fit.

Node roles are drawn from the 7 pipeline roles only (research_scout, evidence_verifier, research_author, research_critic, research_synthesizer, research_judge, research_reporter, plus configured roleProfiles — not research_planner).

Output: a short "## Plan rationale" (PI-style justification, risks, integration verification), then "## Plan JSON" with a single fenced json block matching the AutoResearch plan schema version 2: schemaVersion 2, projectId, projectName, optional teamId/teamKey, revision 1, integrationId "integration", artifactFormat "tex", projectContract { goal, deliverables, acceptance[] with stable criterion ids and text/required/verification, wordBudget { unit, limit } }, nodes[] where every node has id/title/kind (research | literature | abstract | code | experiment | experiments | assembly | integration)/artifactFormat/roles/expectedOutcome/acceptance (string entries with stable ids like "AA-01: ...")/test/verification { template, method }/outputContract { texMode, declaredPackageNeeds, declaredMacroNeeds, declaredInputNeeds, declaredGraphicsNeeds, declaredBibliographyNeeds }/budget { numScouts, numJudges, maxPasses, convergenceThreshold — integers; convergenceThreshold must be an integer >= 1 }/dependsOn. The integration node must have kind "integration", roles exactly [research_integration_editor, research_integration_verifier], no judges, and depend only on assembly/leaves. Section-level decomposition is mandatory for document rewrites. projectId and node ids are safe path segments; no approvedAt; no fabricated citations; every web claim carries a real URL.
`,

    research_scout: `You are a research scout.

Your job is to gather source-grounded evidence for one narrow part of a larger research task.

Rules:
- Prefer primary sources, official docs, credible benchmarks, technical reports, and reliable case studies.
- Separate facts from interpretation.
- Do not invent citations.
- If a claim is weakly supported, mark it as weak.
- If you cannot find evidence, explicitly say so.
- Return structured output only.

Output format:

## Summary

## Claims

| Claim | Evidence | Source | Confidence |
|---|---|---|---|

## Strong Sources

## Weak / Unverified Sources

## Open Questions
`,

    evidence_verifier: `You are an evidence verifier.

Your job is to produce a locked evidence brief from multiple scout reports.

Rules:
- Remove unsupported claims.
- Merge duplicates.
- Flag source reliability.
- Preserve source URLs.
- Distinguish high-confidence evidence from speculation.
- Do not add new claims unless clearly supported by provided sources.

Output format:

# Evidence Brief

## Task

## Key Claims

### Claim 1
Statement:
Evidence:
Sources:
Confidence:
Notes:

## Source List

| ID | URL | Title | Publisher | Date | Reliability |
|---|---|---|---|---|---|

## Disputed / Low-confidence Points

## Things Not Found
`,

    research_author: `You are a research author.

Write decision-useful reports grounded only in the provided task, comments, and locked evidence brief.

Rules:
- Do not invent facts or citations.
- Make the recommendation explicit.
- Distinguish evidence from interpretation.
- Preserve uncertainty and caveats.
- Respect requested structure and word budget.
- If writing B, address valid critic findings without adding unsupported scope.

Output a complete report draft in Markdown.
`,

    research_critic: `You are a research critic.

Your job is to critique the incumbent report against the original task and locked evidence brief.

Rules:
- Find real problems only.
- Do not invent requirements.
- Do not suggest fixes.
- Do not reward adding scope.
- Penalize unsupported claims, missing caveats, weak recommendation logic, and unclear evidence.

Output format:

## Critical Flaws

## Unsupported or Overstated Claims

## Missing Required Elements

## Clarity / Structure Problems

## Scope Creep Risks
`,

    research_synthesizer: `You are a research synthesizer.

You receive report A and report B as equal inputs plus the original task and locked evidence brief.

Rules:
- Produce AB: a coherent synthesis that keeps the strongest supported elements.
- This is not a compromise; choose the best answer per section.
- Do not add claims unsupported by the evidence brief.
- Prefer clarity, source-grounding, and decision usefulness over length.

Output a complete Markdown report candidate.
`,

    research_judge: `You are a blind judge evaluating research report candidates.

You will receive:
- the original research task
- the locked evidence brief
- anonymized candidate reports

Rank candidates by:
1. correctness
2. source-grounding
3. decision usefulness
4. clarity
5. restraint: no unsupported claims or scope creep

Important:
- Do not prefer longer reports by default.
- Do not reward unsupported detail.
- Do not assume candidates are equally good.
- If a candidate says "we do not know" where evidence is missing, reward that honesty.

Return:

## Reasoning
Briefly compare candidates.

RANKING: [best], [second], [worst]
`,

    research_reporter: `You are a research reporter.

Package the final incumbent report, evidence brief, and Autoreason history into a concise Markdown report suitable for posting to an issue tracker or sharing with stakeholders.

Rules:
- Include recommendation, executive summary, evidence table, risks, open questions, Autoreason trace, and artifact path.
- Do not include raw judge transcripts unless requested.
- Do not expose secrets.
`,
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeRoles

// ── lib/resume.js ──
'use strict'
// Port of pi ref/extensions/research-orchestrator/lib/resume.ts (plain JS).
// Factory pattern: no require/import, so the same body concatenates into a
// dynamic Cordis plugin.
//
// DSH adaptations (plan v5 / §3.7):
//  - Filesystem access goes through the injected `fops` adapter. The pi
//    `exists` (fs.stat) and `readJsonOrError` (readFile + JSON.parse) helpers
//    are re-expressed against fops.
//  - fops.readJson returns undefined for missing OR invalid JSON, so
//    validateResume pushes the fixed string `Could not read valid JSON from
//    <path>.` (there is no error-message passthrough in DSH).
//  - MANDATED FIX (plan §3.7): after every judge_N.md exists, the judging
//    branch additionally requires judge_N_candidates.md AND judge_N_map.json
//    for every judge before scoring. Any missing packet/map yields the
//    re-anonymize action.
function makeResume(pathutil, util, config) {
  const resume = {}

  const DEFAULT_CONFIG = config.DEFAULT_CONFIG

  resume.computeConsecutiveAWins = function (history) {
    let count = 0
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index]?.winner === 'A') count += 1
      else break
    }
    return count
  }

  resume.inferNextStep = async function (fops, runDir, run, history = []) {
    const exists = (relPath) => fops.exists(pathutil.resolveInside(runDir, relPath))

    if (run.status === 'complete' || run.currentStep === 'complete') {
      return { step: 'complete', action: 'Run is already marked complete.', stopCriteriaMet: true }
    }
    if (await exists('final.md')) {
      return {
        step: 'final_reporting',
        action: 'final.md exists. Run autoresearch_redact_check, post externally if needed, then call autoresearch_finalize_run.',
        stopCriteriaMet: true,
      }
    }
    if (!await exists('evidence/evidence_brief.md')) {
      return { step: 'verification', action: 'Read autoreason_loop_checklist.md, finish evidence scouting, then write evidence/evidence_brief.md.' }
    }
    if (!await exists('pass_00/A.md')) {
      return { step: 'initial_report', action: 'Read autoreason_loop_checklist.md, spawn research_author, then write pass_00/A.md.' }
    }

    const historyPasses = history
      .map((entry) => Number(entry?.pass))
      .filter((value) => Number.isInteger(value) && value >= 1)
    const newestHistoryPass = historyPasses.length > 0 ? Math.max(...historyPasses) : 0
    const configuredPass = Number(run.currentPass ?? 0)
    const pass = Math.max(configuredPass > 0 ? configuredPass : 1, newestHistoryPass > 0 ? newestHistoryPass : 1)
    const passDirName = util.passName(pass)
    const requiredArtifacts = [
      { path: `${passDirName}/A.md`, step: `${passDirName}_critic`, action: `Read autoreason_loop_checklist.md, copy incumbent into ${passDirName}/A.md, then spawn critic.` },
      { path: `${passDirName}/critic.md`, step: `${passDirName}_critic`, action: 'Read autoreason_loop_checklist.md, spawn research_critic, then save critic.md.' },
      { path: `${passDirName}/B.md`, step: `${passDirName}_author_b`, action: 'Read autoreason_loop_checklist.md, spawn research_author for B, then save B.md.' },
      { path: `${passDirName}/AB.md`, step: `${passDirName}_synthesis`, action: 'Read autoreason_loop_checklist.md, spawn research_synthesizer, then save AB.md.' },
    ]
    for (const artifact of requiredArtifacts) {
      if (!await exists(artifact.path)) return { step: artifact.step, action: artifact.action }
    }

    const judgeCount = Number(run.config?.numJudges ?? DEFAULT_CONFIG.numJudges)
    for (let judge = 1; judge <= judgeCount; judge += 1) {
      if (!await exists(`${passDirName}/judge_${judge}.md`)) {
        return { step: `${passDirName}_judging`, action: `Read autoreason_loop_checklist.md, call autoresearch_anonymize_candidates if judge packets/maps are missing, save judge prompts, spawn or rerun judge ${judge}, then save ${passDirName}/judge_${judge}.md.` }
      }
    }
    // MANDATED FIX (plan §3.7): judge packets/maps are required before scoring,
    // not just the judge verdicts.
    for (let judge = 1; judge <= judgeCount; judge += 1) {
      if (!await exists(`${passDirName}/judge_${judge}_candidates.md`) || !await exists(`${passDirName}/judge_${judge}_map.json`)) {
        return { step: `${passDirName}_judging`, action: 'Read autoreason_loop_checklist.md, call autoresearch_anonymize_candidates to regenerate missing judge packets/maps, then rerun the affected judge(s) and save judge_N.md.' }
      }
    }
    if (!await exists(`${passDirName}/result.json`)) {
      return { step: `${passDirName}_scoring`, action: 'Read autoreason_loop_checklist.md, parse judge rankings, call autoresearch_score_borda, and write result.json.' }
    }

    const historyHasCurrentPass = history.some((entry) => Number(entry?.pass) === pass)
    if (!historyHasCurrentPass) {
      return {
        step: `${passDirName}_scoring`,
        action: `${passDirName}/result.json exists but history.json has no entry for pass ${pass}. Update history.json and run.json from result.json, then call autoresearch_validate_resume again.`,
      }
    }

    const consecutiveAWins = resume.computeConsecutiveAWins(history)
    const maxPasses = Number(run.config?.maxPasses ?? DEFAULT_CONFIG.maxPasses)
    const threshold = Number(run.config?.convergenceThreshold ?? DEFAULT_CONFIG.convergenceThreshold)
    const stopCriteriaMet = consecutiveAWins >= threshold || pass >= maxPasses
    if (stopCriteriaMet) {
      return {
        step: 'final_reporting',
        action: `Stop criteria met (consecutiveAWins=${consecutiveAWins}, pass=${pass}, maxPasses=${maxPasses}, threshold=${threshold}). Spawn research_reporter, write final.md, run autoresearch_redact_check, post if needed, then call autoresearch_finalize_run.`,
        stopCriteriaMet: true,
      }
    }

    const nextPass = pass + 1
    const nextPassDir = util.passName(nextPass)
    return {
      step: `${nextPassDir}_critic`,
      action: `Pass ${pass} is scored and stop criteria are not met. Start pass ${nextPass}: copy the current incumbent into ${nextPassDir}/A.md, checkpoint currentPass=${nextPass}, then spawn research_critic.`,
      stopCriteriaMet: false,
    }
  }

  resume.validateResume = async function (fops, runDirInput) {
    const runDir = pathutil.resolve(runDirInput)
    const errors = []
    const warnings = []
    const runJsonPath = pathutil.resolve(runDir, 'run.json')
    const historyJsonPath = pathutil.resolve(runDir, 'history.json')
    const resumePath = pathutil.resolve(runDir, 'resume.md')
    const checklistPath = pathutil.resolve(runDir, 'autoreason_loop_checklist.md')

    // DSH: fops.readJson returns undefined when missing or invalid, so the
    // error text is a fixed string (no error-message passthrough).
    const readJsonOrError = async function (path, errorsOut) {
      const value = await fops.readJson(path)
      if (value === undefined) {
        errorsOut.push(`Could not read valid JSON from ${path}.`)
        return undefined
      }
      return value
    }

    const run = await readJsonOrError(runJsonPath, errors)
    const history = await readJsonOrError(historyJsonPath, errors)
    const resumeExists = await fops.exists(resumePath)
    if (!resumeExists) errors.push('Missing resume.md.')
    const checklistExists = await fops.exists(checklistPath)
    if (!checklistExists) {
      warnings.push('Missing autoreason_loop_checklist.md. Call autoresearch_regenerate_checklist, then validate again before continuing long AutoReason loops.')
    }
    if (!run || !Array.isArray(history)) {
      return { valid: false, errors, warnings, nextStep: 'failed', nextAction: 'Repair missing or invalid run state files before resuming.' }
    }

    if (run.incumbentPath && !await fops.exists(pathutil.resolveInside(runDir, run.incumbentPath))) {
      errors.push(`incumbentPath does not exist: ${run.incumbentPath}`)
    }
    if (run.evidenceBriefPath && !await fops.exists(pathutil.resolveInside(runDir, run.evidenceBriefPath))) {
      warnings.push(`evidenceBriefPath does not exist yet: ${run.evidenceBriefPath}`)
    }

    const computedConsecutiveAWins = resume.computeConsecutiveAWins(history)
    if (typeof run.consecutiveAWins === 'number' && run.consecutiveAWins !== computedConsecutiveAWins) {
      warnings.push(`run.json consecutiveAWins=${run.consecutiveAWins}, computed from history=${computedConsecutiveAWins}.`)
    }

    const next = await resume.inferNextStep(fops, runDir, run, history)
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      status: run.status,
      currentStep: run.currentStep,
      currentPass: run.currentPass,
      incumbentPath: run.incumbentPath,
      evidenceBriefPath: run.evidenceBriefPath,
      sourceType: run.sourceType ?? (run.linear?.enabled === false ? 'local' : 'linear'),
      checklistPath: checklistExists ? 'autoreason_loop_checklist.md' : '',
      computedConsecutiveAWins,
      stopCriteriaMet: next.stopCriteriaMet ?? false,
      nextStep: errors.length > 0 ? 'failed' : next.step,
      nextAction: errors.length > 0 ? 'Repair state before continuing.' : next.action,
    }
  }

  return resume
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeResume

// ── lib/scoring.js ──
'use strict'
// Port of pi ref/extensions/research-orchestrator/lib/scoring.ts (plain JS).
// Filesystem access goes through the injected `fops` adapter; path handling
// goes through the injected `pathutil` factory. Factory pattern keeps this file
// concatenatable into a dynamic Cordis plugin body (no imports anywhere).
function makeScoring(pathutil, util, config) {
  const scoring = {}

  // scoring.anonymizeCandidates is assigned later as the v2 fail-closed
  // override (plan §4.3); no legacy implementation exists here anymore.

  scoring.parseRanking = function (text, allowedLabels, anonymizedToOriginal) {
    const errors = []
    const labels = util.nonEmptyStringArray(allowedLabels, [])
    const rankingLine = extractRankingLine(text)
    if (!rankingLine) {
      return { valid: false, ranking: [], errors: ['Missing RANKING: line.'] }
    }

    const positions = labels
      .map((label) => ({ label, index: findLabelIndex(rankingLine, label) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index)

    const ranking = positions.map((item) => item.label)
    const missing = labels.filter((label) => !ranking.includes(label))
    const duplicateLabels = util.findDuplicates(ranking)
    if (missing.length > 0) errors.push(`Missing labels: ${missing.join(', ')}`)
    if (duplicateLabels.length > 0) errors.push(`Duplicate labels: ${duplicateLabels.join(', ')}`)
    if (ranking.length !== labels.length) errors.push(`Expected ${labels.length} labels, found ${ranking.length}.`)

    const originalRanking = anonymizedToOriginal
      ? ranking.map((label) => anonymizedToOriginal[label]).filter((value) => typeof value === 'string' && value.length > 0)
      : undefined
    if (anonymizedToOriginal && originalRanking && originalRanking.length !== ranking.length) {
      errors.push('Could not map all anonymized labels back to original candidate ids.')
    }

    return {
      valid: errors.length === 0,
      ranking,
      originalRanking,
      errors,
    }
  }

  scoring.scoreBorda = function (params) {
    const candidateIds = util.nonEmptyStringArray(params.candidateIds, ['A', 'B', 'AB'])
    const bordaScores = util.numberArray(params.bordaScores, config.DEFAULT_CONFIG.bordaScores)
    const tieBreakPriority = util.nonEmptyStringArray(params.tieBreakPriority, config.DEFAULT_CONFIG.tieBreakPriority)
    const scores = Object.fromEntries(candidateIds.map((id) => [id, 0]))
    const judgeRankings = Array.isArray(params.judgeRankings) ? params.judgeRankings : []
    const validRankings = []
    const invalidRankings = []

    for (const item of judgeRankings) {
      const ranking = Array.isArray(item && item.ranking) ? item.ranking.map(String) : []
      const judge = (item && item.judge) ?? validRankings.length + invalidRankings.length + 1
      const errors = validateCandidateRanking(ranking, candidateIds)
      if (errors.length > 0) {
        invalidRankings.push({ judge, ranking, errors })
        continue
      }
      ranking.forEach((candidateId, index) => {
        scores[candidateId] += bordaScores[index] ?? 0
      })
      validRankings.push({ judge, ranking })
    }

    const maxScore = Math.max(...candidateIds.map((id) => scores[id]))
    const tied = candidateIds.filter((id) => scores[id] === maxScore)
    const winner = tied.length === 1 ? tied[0] : (tieBreakPriority.find((id) => tied.includes(id)) ?? tied[0])

    return {
      pass: params.pass,
      candidateScores: scores,
      winner,
      tieBreakApplied: tied.length > 1,
      tied,
      validJudges: validRankings.length,
      invalidJudges: invalidRankings.length,
      judgeRankings: validRankings,
      invalidRankings,
      notes: params.notes ?? '',
    }
  }

  function extractRankingLine(text) {
    const match = text.match(/^\s*RANKING\s*:\s*(.+)$/im)
    return match && match[1] ? match[1].trim() : ''
  }

  function findLabelIndex(text, label) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${util.escapeRegExp(label)}($|[^A-Za-z0-9_])`, 'i')
    const match = pattern.exec(text)
    if (!match) return -1
    return match.index + (match[1] ? match[1].length : 0)
  }

  function validateCandidateRanking(ranking, candidateIds) {
    const errors = []
    const missing = candidateIds.filter((id) => !ranking.includes(id))
    const unknown = ranking.filter((id) => !candidateIds.includes(id))
    const duplicates = util.findDuplicates(ranking)
    if (missing.length > 0) errors.push(`Missing candidates: ${missing.join(', ')}`)
    if (unknown.length > 0) errors.push(`Unknown candidates: ${unknown.join(', ')}`)
    if (duplicates.length > 0) errors.push(`Duplicate candidates: ${duplicates.join(', ')}`)
    if (ranking.length !== candidateIds.length) errors.push(`Expected ${candidateIds.length} candidates, found ${ranking.length}.`)
    return errors
  }

  return scoring
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeScoring

// ── lib/redact.js ──
'use strict'
// Port of pi ref/extensions/research-orchestrator/lib/redact.ts.
// `node:fs/promises` and `node:path` are replaced by the injected `fops`
// adapter and `pathutil` factory so the same code runs inside a dynamic
// Cordis plugin (no imports anywhere).
function makeRedact(pathutil) {
  const redact = {}

  redact.redactMatch = function (value) {
    if (value.length <= 12) return '[redacted]'
    return value.slice(0, 4) + '...[redacted]...' + value.slice(-4)
  }

  redact.scanSensitiveText = function (text, maxFindings) {
    const patterns = [
      { name: 'private_key', severity: 'high', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
      { name: 'bearer_token', severity: 'high', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
      { name: 'openai_style_key', severity: 'high', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
      { name: 'github_token', severity: 'high', regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
      { name: 'linear_api_key', severity: 'high', regex: /\blin_api_[A-Za-z0-9]{20,}\b/g },
      { name: 'aws_access_key', severity: 'high', regex: /\bAKIA[0-9A-Z]{16}\b/g },
      { name: 'signed_url', severity: 'high', regex: /https?:\/\/\S+(?:X-Amz-Signature|X-Goog-Signature|sig=|signature=|Expires=|X-Amz-Credential)\S*/gi },
      { name: 'env_assignment_secret', severity: 'medium', regex: /\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*["']?[^"'\s]{8,}/g },
      { name: 'raw_transcript_marker', severity: 'low', regex: /(?:raw scout transcript|raw judge transcript|full transcript|verbatim comments)/gi },
    ]

    const findings = []
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0
      let match
      while ((match = pattern.regex.exec(text)) && findings.length < maxFindings) {
        findings.push({
          name: pattern.name,
          severity: pattern.severity,
          index: match.index,
          match: redact.redactMatch(match[0]),
          context: redact.redactMatch(text.slice(Math.max(0, match.index - 60), Math.min(text.length, match.index + match[0].length + 60))),
        })
      }
      if (findings.length >= maxFindings) break
    }
    return findings.sort((a, b) => a.index - b.index)
  }

  redact.redactCheck = async function (fops, params) {
    const maxFindings = typeof params.maxFindings === 'number' ? params.maxFindings : 50
    let text = typeof params.text === 'string' ? params.text : ''
    let scannedPath = ''
    if (!text && typeof params.path === 'string') {
      const root = params.runDir ? pathutil.resolve(params.runDir) : pathutil.resolve(params.baseDir ?? '.')
      const path = await resolveInput(fops, pathutil.resolve(params.baseDir ?? '.'), root, params.path, { mustExist: true })
      text = await fops.readText(path)
      scannedPath = path
    }
    if (!text) throw new Error('Provide either text or path for autoresearch_redact_check.')

    const findings = redact.scanSensitiveText(text, maxFindings)
    const blockingFindings = findings.filter((finding) => finding.severity === 'high')
    const warnings = findings.filter((finding) => finding.severity !== 'high')
    return {
      okToPost: blockingFindings.length === 0,
      blocking: blockingFindings.length > 0,
      scannedPath,
      totalFindings: findings.length,
      blockingFindings,
      warnings,
      instruction: blockingFindings.length > 0
        ? 'Do not post this text. Redact or summarize the blocking findings, then run autoresearch_redact_check again.'
        : 'No blocking secret patterns found. Still review for business-sensitive content before posting externally.',
    }
  }

  return redact
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeRedact

// ── lib/presearch.js ──
'use strict'
// Port of pi ref/extensions/research-orchestrator/lib/presearch.ts.
// `node:fs/promises` and `node:path` are replaced by the injected `fops`
// adapter and `pathutil` factory; validation helpers come from the injected
// `util` factory. Factory pattern keeps this file concatenatable into a
// dynamic Cordis plugin body (no imports anywhere).
function makePresearch(pathutil, util) {
  const presearch = {}

  function requireResultUrls(results) {
    results.forEach((result, index) => {
      if (!util.isPlainObject(result) || typeof result.url !== 'string' || !result.url.trim()) {
        throw new Error(`Results item ${index} is missing a required url.`)
      }
    })
  }

  function markdownCell(value) {
    return (value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
  }

  function fetchIndex(index) {
    const value = Math.trunc(Number(index))
    return Number.isFinite(value) && value >= 1 ? value : 1
  }

  /**
   * Sanitize a slice name into a safe single path segment: strips anything
   * that is not `[A-Za-z0-9_.-]`, collapses repeats, and rejects empty/`.`/`..`
   * results so the value can never traverse or escape a directory.
   */
  presearch.sanitizeSlice = function (slice) {
    if (typeof slice !== 'string' || !slice.trim()) {
      throw new Error('slice must be a non-empty string.')
    }
    return util.safeSegment(slice)
  }

  /**
   * Write `evidence/sources/search_<slice>.md` under runDir. All paths are
   * resolved with resolveInside, so an escaping slice throws. Returns the
   * packet's relative path.
   */
  presearch.writeSearchPacket = async function (fops, params) {
    if (!util.isPlainObject(params)) throw new Error('params must be an object.')
    const runDir = util.requiredString(params.runDir, 'runDir')
    const slice = presearch.sanitizeSlice(params.slice)
    const results = Array.isArray(params.results) ? params.results : []
    requireResultUrls(results)

    const queries = util.nonEmptyStringArray(params.queries, [])
    const collectedBy = params.collectedBy && params.collectedBy.trim() ? params.collectedBy.trim() : 'coordinator'
    const externalResearch = params.externalResearch !== false
    const date = params.date ?? new Date().toISOString()
    const openQuestions = util.nonEmptyStringArray(params.openQuestions, [])

    const lines = []
    lines.push(`# Source Packet: ${slice}`)
    lines.push(`External research allowed: ${externalResearch ? 'yes' : 'no'}`)
    lines.push(`Collected by: ${collectedBy}`)
    lines.push(`Date: ${date}`)
    lines.push('')
    lines.push('## Queries')
    if (queries.length === 0) {
      lines.push('(none)')
    } else {
      for (const query of queries) lines.push(`- ${query}`)
    }
    lines.push('')
    lines.push('## Results table')
    lines.push('')
    lines.push('| # | URL | Title | Why relevant | Confidence | Response ID |')
    lines.push('|---|-----|-------|--------------|------------|-------------|')
    if (results.length === 0) {
      lines.push('| - | (no results) | | | | |')
    } else {
      results.forEach((result, index) => {
        lines.push(
          `| ${index + 1} | ${markdownCell(result.url)} | ${markdownCell(result.title)} | ` +
            `${markdownCell(result.whyRelevant)} | ${markdownCell(result.confidence)} | ${markdownCell(result.responseId)} |`,
        )
      })
    }
    lines.push('')
    lines.push('## Excerpts')
    if (!results.some((result) => result.excerpt && result.excerpt.trim())) {
      lines.push('(none)')
    } else {
      results.forEach((result, index) => {
        if (!result.excerpt || !result.excerpt.trim()) return
        lines.push('')
        lines.push(`### ${index + 1}. ${result.title && result.title.trim() ? result.title.trim() : result.url}`)
        lines.push('')
        lines.push(result.excerpt.trim())
      })
    }
    lines.push('')
    lines.push('## Open questions')
    if (openQuestions.length === 0) {
      lines.push('(none)')
    } else {
      for (const question of openQuestions) lines.push(`- ${question}`)
    }
    lines.push('')

    const relativePath = `evidence/sources/search_${slice}.md`
    const absolutePath = pathutil.resolveInside(runDir, relativePath)
    await fops.writeText(absolutePath, lines.join('\n'))
    return relativePath
  }

  /**
   * Write `evidence/sources/fetch_<n>.md` (default, n zero-padded from `index`)
   * or `evidence/sources/fetch_<slug>.md` when `slug` is given, under runDir.
   * All paths are resolved with resolveInside. Returns the packet's relative path.
   */
  presearch.writeFetchPacket = async function (fops, params) {
    if (!util.isPlainObject(params)) throw new Error('params must be an object.')
    const runDir = util.requiredString(params.runDir, 'runDir')
    const fetch = params.fetch
    if (!util.isPlainObject(fetch) || typeof fetch.url !== 'string' || !fetch.url.trim()) {
      throw new Error('fetch must include a non-empty url.')
    }

    const name = params.slug !== undefined && params.slug !== null && String(params.slug).trim() !== ''
      ? `fetch_${presearch.sanitizeSlice(String(params.slug))}.md`
      : `fetch_${String(fetchIndex(params.index)).padStart(2, '0')}.md`
    const date = params.date ?? new Date().toISOString()

    const lines = []
    lines.push(`# Fetch Packet: ${fetch.title && fetch.title.trim() ? fetch.title.trim() : fetch.url}`)
    lines.push(`Source: ${fetch.url}`)
    lines.push(`Response ID: ${fetch.responseId && fetch.responseId.trim() ? fetch.responseId.trim() : 'n/a'}`)
    lines.push(`Retrieved: ${fetch.retrievedAt && fetch.retrievedAt.trim() ? fetch.retrievedAt.trim() : date}`)
    lines.push(`HTTP status: ${Number.isInteger(fetch.statusCode) ? fetch.statusCode : 'n/a'}`)
    lines.push(`Truncated: ${fetch.truncated === true ? 'yes' : 'no'}`)
    lines.push(`Fetch error: ${fetch.error && String(fetch.error).trim() ? String(fetch.error).trim() : 'none'}`)
    lines.push(`Date: ${date}`)
    lines.push('')
    lines.push('## Excerpt')
    lines.push('')
    lines.push(fetch.excerpt && fetch.excerpt.trim() ? fetch.excerpt.trim() : '(none)')
    lines.push('')

    const relativePath = `evidence/sources/${name}`
    const absolutePath = pathutil.resolveInside(runDir, relativePath)
    await fops.writeText(absolutePath, lines.join('\n'))
    return relativePath
  }

  /**
   * Normalize coordinator-collected search/fetch results into source packets
   * under `evidence/sources/` (created if missing). Writes the search packet
   * always, plus one fetch packet per entry in `fetches`. Every result and
   * fetch must carry a url. Throws on path escape via resolveInside.
   */
  presearch.presearchWrite = async function (fops, params) {
    if (!util.isPlainObject(params)) throw new Error('params must be an object.')
    const runDir = util.requiredString(params.runDir, 'runDir')
    presearch.sanitizeSlice(params.slice)

    const results = Array.isArray(params.results) ? params.results : []
    requireResultUrls(results)
    const fetches = Array.isArray(params.fetches) ? params.fetches : []
    fetches.forEach((fetch, index) => {
      if (!util.isPlainObject(fetch) || typeof fetch.url !== 'string' || !fetch.url.trim()) {
        throw new Error(`Fetches item ${index} is missing a required url.`)
      }
    })

    const sourceDir = 'evidence/sources'

    const searchPacketPath = await presearch.writeSearchPacket(fops, {
      runDir,
      slice: params.slice,
      queries: params.queries,
      results,
      collectedBy: params.collectedBy,
      externalResearch: params.externalResearch,
    })

    const fetchPacketPaths = []
    for (let index = 0; index < fetches.length; index += 1) {
      const slug = `${presearch.sanitizeSlice(params.slice)}-${String(index + 1).padStart(2, '0')}`
      const packetPath = await presearch.writeFetchPacket(fops, { runDir, fetch: fetches[index], index: index + 1, slug })
      fetchPacketPaths.push(packetPath)
    }

    return { searchPacketPath, fetchPacketPaths, sourceDir }
  }

  /**
   * List source packet markdown files under `evidence/sources/` as sorted
   * relative paths (e.g. `evidence/sources/search_technical.md`). Returns an
   * empty array when the directory does not exist.
   */
  presearch.listSourcePackets = async function (fops, runDir) {
    const sourcesDir = pathutil.resolveInside(runDir, 'evidence/sources')
    const entries = await fops.listDir(sourcesDir)
    return entries
      .filter((entry) => !entry.dir && entry.name.endsWith('.md'))
      .map((entry) => `evidence/sources/${entry.name}`)
      .sort()
  }

  return presearch
}

if (typeof module !== 'undefined' && module.exports) module.exports = makePresearch

// ── lib/profiles.js ──
'use strict'
// Port of pi ref/extensions/research-orchestrator/lib/profiles.ts (plain JS),
// trimmed to the DSH reality (plan §3.9):
//  - TOML reading/rewriting machinery dropped entirely (no .pi/agents in DSH).
//  - Tool defaults map to REAL DSH tool names: 'agent_message',
//    'fetch_content', 'get_search_content' do not exist here. Minimal set is
//    ['read']; web capability = 'web_search' only.
//  - opts.promptFile: workspace-relative prompt override path, resolved by the
//    caller (plugin glue) — this module just carries the string through.
function makeProfiles(util, config) {
  const profiles = {}

  profiles.WEB_TOOLS = ['web_search']

  profiles.DEFAULT_ROLE_TOOLS = {
    planner: ['read', 'web_search'],
    research_planner: ['read', 'web_search'],
    scout: ['read', 'web_search'],
    research_scout: ['read', 'web_search'],
    verifier: ['read'],
    evidence_verifier: ['read'],
    author: ['read'],
    research_author: ['read'],
    critic: ['read'],
    research_critic: ['read'],
    synthesizer: ['read'],
    research_synthesizer: ['read'],
    judge: ['read'],
    research_judge: ['read'],
    reporter: ['read'],
    research_reporter: ['read'],
    implementationWorker: ['read', 'write', 'edit', 'bash'],
    implementation_worker: ['read', 'write', 'edit', 'bash'],
    reviewWorker: ['read', 'bash'],
    review_worker: ['read', 'bash'],
  }

  profiles.MINIMAL_DEFAULT_TOOLS = ['read']

  profiles.resolveRoleKeys = function (cfg, role) {
    if (typeof role !== 'string' || !role) return { logical: null, actual: role }
    const roles = util.isPlainObject(cfg.roles) ? cfg.roles : {}
    if (typeof roles[role] === 'string') return { logical: role, actual: roles[role] }
    for (const [key, value] of Object.entries(roles)) {
      if (value === role) return { logical: key, actual: role }
    }
    return { logical: role, actual: role }
  }

  profiles.getRoleProfile = function (cfg, role) {
    const roleProfiles = util.isPlainObject(cfg.roleProfiles) ? cfg.roleProfiles : {}
    const { logical, actual } = profiles.resolveRoleKeys(cfg, role)
    for (const key of [logical, actual, role]) {
      if (!key) continue
      const entry = roleProfiles[key]
      if (typeof entry === 'string' && entry) return { model: entry }
      if (util.isPlainObject(entry)) return entry
    }
    return null
  }

  function roleType(cfg, role) {
    const { logical, actual } = profiles.resolveRoleKeys(cfg, role)
    const candidates = [actual, logical].filter((value) => Boolean(value))
    if (candidates.some((candidate) => config.CONTENT_PRODUCING_ROLES.includes(candidate))) return 'content-producing'
    if (candidates.some((candidate) => config.SUPPORTING_ROLES.includes(candidate))) return 'supporting'
    return null
  }

  profiles.resolveBucketModel = function (role, cfg) {
    return config.expectedModelForRole(role, cfg)
  }

  function getRoleProfileToolDefaults(cfg, role) {
    const { logical, actual } = profiles.resolveRoleKeys(cfg, role)
    for (const key of [logical, actual, role]) {
      if (!key) continue
      const tools = profiles.DEFAULT_ROLE_TOOLS[key]
      if (Array.isArray(tools) && tools.length > 0) return [...tools]
    }
    return null
  }

  function judgePanelModel(cfg, role, judgeIndex) {
    const roles = util.isPlainObject(cfg.roles) ? cfg.roles : {}
    const judgeRole = typeof roles.judge === 'string' ? roles.judge : 'research_judge'
    const { actual } = profiles.resolveRoleKeys(cfg, role)
    if (actual !== judgeRole) return null
    if (!Array.isArray(cfg.judgePanel) || cfg.judgePanel.length === 0) return null
    const index = typeof judgeIndex === 'number' && judgeIndex >= 0 ? judgeIndex : 0
    const entry = cfg.judgePanel[index] ?? cfg.judgePanel[0]
    if (typeof entry === 'string' && entry) return entry
    if (util.isPlainObject(entry) && typeof entry.model === 'string' && entry.model) return entry.model
    return null
  }

  function uniqueTools(tools) {
    return [...new Set(tools)]
  }

  // Model precedence (pi-compatible): roleProfiles[role].model > judgePanel
  // > bucket > toml (absent in DSH) > parent (absent) > null.
  // Tools precedence: roleProfiles[role].tools > DEFAULT_ROLE_TOOLS >
  // MINIMAL_DEFAULT_TOOLS; web tools stripped when externalResearch=false;
  // 'read' always ensured present.
  profiles.resolveEffectiveProfile = function (role, cfg, opts = {}) {
    const profile = profiles.getRoleProfile(cfg, role)
    const type = roleType(cfg, role)
    const externalResearch = cfg.externalResearch !== false
    const sessionControl = Boolean(cfg.sessionControl)

    let model = null
    let modelSource = null

    const profileModel = typeof profile?.model === 'string' && profile.model ? profile.model : null
    if (profileModel) {
      model = profileModel
      modelSource = 'roleProfile'
    } else {
      const panelModel = judgePanelModel(cfg, role, opts.judgeIndex)
      if (panelModel) {
        model = panelModel
        modelSource = 'judgePanel'
      } else if (type) {
        const bucketModel = profiles.resolveBucketModel(role, cfg)
        if (bucketModel) {
          model = bucketModel
          modelSource = 'bucket'
        }
      }
    }

    let tools
    if (Array.isArray(profile?.tools) && profile.tools.length > 0) {
      tools = [...profile.tools]
    } else {
      tools = getRoleProfileToolDefaults(cfg, role) ?? [...profiles.MINIMAL_DEFAULT_TOOLS]
    }
    if (!externalResearch) {
      tools = tools.filter((tool) => !profiles.WEB_TOOLS.includes(tool))
    }
    for (const required of profiles.MINIMAL_DEFAULT_TOOLS) {
      if (!tools.includes(required)) tools.push(required)
    }
    tools = uniqueTools(tools)

    const reasoning =
      typeof profile?.reasoning === 'string' && profile.reasoning
        ? profile.reasoning
        : typeof opts.tomlReasoning === 'string' && opts.tomlReasoning
          ? opts.tomlReasoning
          : null

    const promptFile =
      typeof profile?.promptFile === 'string' && profile.promptFile.trim()
        ? profile.promptFile.trim()
        : null

    const { actual, logical } = profiles.resolveRoleKeys(cfg, role)
    return {
      role: actual,
      logicalRole: logical,
      type,
      model,
      modelSource,
      reasoning,
      promptFile,
      tools,
      sessionControl,
      externalResearch,
    }
  }

  profiles.listEffectiveProfiles = function (cfg, opts = {}) {
    const roles = util.isPlainObject(cfg.roles) ? cfg.roles : {}
    const seen = new Set()
    const roleNames = []
    for (const value of Object.values(roles)) {
      if (typeof value === 'string' && !seen.has(value)) {
        seen.add(value)
        roleNames.push(value)
      }
    }
    for (const role of config.ALL_RESEARCH_ROLES) {
      if (!seen.has(role)) {
        seen.add(role)
        roleNames.push(role)
      }
    }
    return roleNames.map((role) => profiles.resolveEffectiveProfile(role, cfg, opts))
  }

  return profiles
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeProfiles

// ── lib/spawn.js ──
'use strict'
// Spawn planner: port of pi ref/.../lib/spawn.ts, reworked for DSH (plan §3.1).
// The planner never spawns — it composes the plan/audit; the plugin glue's
// autoresearch_run_role executes via the subagents service. pi's companion
// path resolution (pi-web-access / collaborating-agents / pi-mono-linear) is
// gone entirely: DSH children inherit the preset and get a toolFilter instead.
function makeSpawn(pathutil, util, profiles) {
  const spawn = {}

  // opts: { webToolsAvailable: boolean }
  spawn.buildSpawnPlan = function (params, opts = {}) {
    const warnings = []
    if (!util.isPlainObject(params.profile)) {
      throw new Error('buildSpawnPlan requires params.profile (resolve one via profiles.resolveEffectiveProfile).')
    }
    const profile = params.profile
    const role = typeof params.role === 'string' && params.role.trim() ? params.role.trim() : profile.role
    if (!role) throw new Error('buildSpawnPlan requires a role (params.role or profile.role).')
    if (typeof params.task !== 'string' || !params.task.trim()) {
      warnings.push(`Task for role "${role}" is empty; the child would have no instructions.`)
    }

    const webToolsRequested = Array.isArray(profile.tools) && profile.tools.some((tool) => profiles.WEB_TOOLS.includes(tool))
    const webToolsAvailable = opts.webToolsAvailable === true

    if (profile.externalResearch === false && webToolsRequested) {
      warnings.push(
        `externalResearch=false but role "${role}" resolved web tools; the resolver should have stripped them — check roleProfiles.`,
      )
    }
    if (webToolsRequested && !webToolsAvailable) {
      warnings.push(
        `Role "${role}" wants web tools but the web service is unavailable in this deployment; the child's web_search calls will fail or the tool was filtered.`,
      )
    }

    const model = typeof profile.model === 'string' && profile.model.trim() ? profile.model.trim() : null
    if (!model) {
      warnings.push(`No model resolved for role "${role}"; the child uses the harness default route.`)
    }

    const recommendedRunRoleCall = {
      role,
      task: params.task,
      ...(typeof params.judgeIndex === 'number' ? { judgeIndex: params.judgeIndex } : {}),
      toolFilter: { allow: [...profile.tools] },
      personaSource: profile.promptFile ?? `roles/${profile.role}.md (preset default or embedded fallback)`,
      model: model ?? null,
      modelSource: profile.modelSource ?? null,
    }

    return {
      role,
      type: role,
      model,
      modelSource: profile.modelSource ?? null,
      tools: [...profile.tools],
      promptFile: profile.promptFile ?? null,
      sessionControl: profile.sessionControl === true,
      externalResearch: profile.externalResearch !== false,
      launchMode: 'run-role',
      recommendedRunRoleCall,
      warnings,
      webToolsRequested,
      webToolsAvailable,
    }
  }

  spawn.writeSpawnAudit = async function (fops, runDir, plan) {
    if (!runDir || !String(runDir).trim()) throw new Error('writeSpawnAudit requires a runDir.')
    const roleSegment = util.safeSegment(plan.role)
    const stamp = util.timestampForPath(new Date().toISOString())
    const relativeAudit = `packets/spawn_${roleSegment}_${stamp}.json`
    const auditPath = pathutil.resolveInside(runDir, relativeAudit)
    await fops.writeJson(auditPath, {
      packetType: 'spawn-plan',
      createdAt: new Date().toISOString(),
      runDir: pathutil.normalize(runDir),
      ...plan,
    })
    return auditPath
  }

  // params: { role, task, profile, runDir? , judgeIndex?, webToolsAvailable? }
  spawn.spawnRole = async function (fops, params, opts = {}) {
    if (!util.isPlainObject(params.profile)) {
      throw new Error('spawnRole requires a profile (resolve one via profiles.resolveEffectiveProfile).')
    }
    const plan = spawn.buildSpawnPlan(params, opts)
    const auditPath = params.runDir ? await spawn.writeSpawnAudit(fops, params.runDir, plan) : undefined
    return { plan, auditPath }
  }

  return spawn
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeSpawn

// ── lib/modelparse.js ──
'use strict'
// Parse pi-style model strings into DSH AgentOptions (plan §3.9).
//   'xai/grok-4.5'        -> { provider: 'xai', model: 'grok-4.5' }
//   'grok-4.5'            -> { provider: null, model: 'grok-4.5' } (rides session provider)
//   '' / null / undefined -> null (harness default)
// Split on the FIRST '/'; everything after it is the model id.
function makeModelParse() {
  const mp = {}

  mp.parseModelString = function (value) {
    if (typeof value !== 'string' || !value.trim()) return null
    const trimmed = value.trim()
    const slash = trimmed.indexOf('/')
    if (slash === -1) return { provider: null, model: trimmed }
    const provider = trimmed.slice(0, slash).trim()
    const model = trimmed.slice(slash + 1).trim()
    if (!provider || !model) return null
    return { provider, model }
  }

  // Resolve the full per-role precedence to AgentOptions-ready form.
  // Returns { provider, model } | null; modelSource is the winning source.
  mp.resolveAgentOptions = function (profile) {
    if (!profile) return null
    const parsed = mp.parseModelString(profile.model)
    if (!parsed) return null
    return { provider: parsed.provider, model: parsed.model, modelSource: profile.modelSource ?? null }
  }

  return mp
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeModelParse

// ── lib/roleprompt.js ──
'use strict'
// Role prompt resolution ladder (plan §3.9, option 1 wired):
//   1. roleProfiles.<role>.promptFile  (explicit per-workspace override)
//   2. <baseDir>/.research-agent/roles/<role>.md  (workspace copy, seeded at
//      init; user-editable per workspace)
//   3. <presetRolesDir>/<role>.md  (global default shipped with the preset;
//      only resolvable in the durable module, which knows its own directory)
//   4. embedded default (dev/dynamic contexts and last-resort fallback)
// A missing promptFile falls through; only a missing prompt EVERYWHERE throws.
function makeRolePrompt(pathutil) {
  const rp = {}

  rp.resolveRolePrompt = async function (fops, opts) {
    const roleName = opts.roleName
    const baseDir = pathutil.normalize(opts.baseDir ?? '.')

    if (opts.promptFile) {
      const target = pathutil.isAbsolute(opts.promptFile)
        ? pathutil.normalize(opts.promptFile)
        : pathutil.join(baseDir, opts.promptFile)
      try {
        const text = await fops.readText(target)
        if (text && text.trim()) return { text, source: `promptFile: ${opts.promptFile}` }
      } catch {
        // fall through on missing promptFile (dependency_check warns)
      }
    }

    const workspacePath = pathutil.join(baseDir, `.research-agent/roles/${roleName}.md`)
    try {
      const text = await fops.readText(workspacePath)
      if (text && text.trim()) return { text, source: `.research-agent/roles/${roleName}.md` }
    } catch {
      // fall through
    }

    if (opts.presetRolesDir) {
      const presetPath = pathutil.join(pathutil.normalize(opts.presetRolesDir), `${roleName}.md`)
      try {
        const text = await fops.readText(presetPath)
        if (text && text.trim()) return { text, source: `preset roles/${roleName}.md` }
      } catch {
        // fall through
      }
    }

    const embedded = opts.embedded?.[roleName] ?? opts.embedded?.[opts.roleArg]
    if (typeof embedded === 'string' && embedded.trim()) return { text: embedded, source: 'embedded default' }
    throw new Error(`No prompt available for role ${roleName}`)
  }

  return rp
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeRolePrompt

// ── lib/modelregistry.js ──
'use strict'
// Model-registry helpers: validate config model strings against the models DSH
// currently recognizes (live `llm` service data fed in by the plugin glue;
// unit tests feed fixtures). Pure logic only.
function makeModelRegistry() {
  const mr = {}

  // providers: [{id, name}]; models: [{provider, id, name, description}]
  mr.fromLists = function (providers, models) {
    const byProvider = {}
    for (const m of models ?? []) {
      const list = byProvider[m.provider] ?? (byProvider[m.provider] = new Set())
      list.add(m.id)
    }
    return {
      providers: (providers ?? []).map((p) => ({ id: p.id, name: p.name })),
      byProvider,
    }
  }

  // value: 'provider/model' | bare 'model' | null/'' (harness default).
  // Returns { ok, reason } — never throws.
  mr.validateModelString = function (value, registry) {
    if (typeof value !== 'string' || !value.trim()) return { ok: true, reason: 'harness default' }
    const trimmed = value.trim()
    const slash = trimmed.indexOf('/')
    if (slash === -1) {
      for (const list of Object.values(registry.byProvider)) {
        if (list.has(trimmed)) return { ok: true, reason: `model "${trimmed}" recognized (rides the session provider)` }
      }
      return { ok: false, reason: `model "${trimmed}" is not recognized by any DSH provider right now` }
    }
    const provider = trimmed.slice(0, slash).trim()
    const model = trimmed.slice(slash + 1).trim()
    if (!provider || !model) return { ok: false, reason: `unparseable model string "${trimmed}" (expected provider/model)` }
    const list = registry.byProvider[provider]
    if (!list) return { ok: false, reason: `provider "${provider}" is not recognized by DSH right now` }
    if (!list.has(model)) return { ok: false, reason: `model "${model}" is not recognized for provider "${provider}" right now` }
    return { ok: true, reason: 'recognized' }
  }

  // Sorted rows for autoresearch_list_models output.
  mr.listEntries = function (models) {
    const rows = (models ?? []).map((m) => ({
      provider: m.provider,
      model: m.id,
      name: m.name,
      description: m.description ?? null,
    }))
    rows.sort((a, b) => `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`))
    return rows
  }

  return mr
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeModelRegistry

// ── lib/lifecycle.js ──
'use strict'
// Port of pi ref/extensions/research-orchestrator/lib/lifecycle.ts (plain JS)
// with the plan's DSH adaptations:
//  - D6: sourceType defaults to 'local' (pi defaulted 'linear'); Linear intake
//    passes sourceType:"linear" explicitly.
//  - run state gains a `sourceUrl` provenance field.
//  - finalize_run returns a structured POSTING INTENT instead of posting.
//  - Empty skeleton dirs (packets/, evidence/, ...) are NOT pre-created:
//    fops.writeText creates parents on demand and nothing reads empty dirs.
function makeLifecycle(pathutil, util, config, resume) {
  const lifecycle = {}

  async function writeJsonIfMissing(fops, path, value) {
    if (await fops.exists(path)) return
    await fops.writeJson(path, value)
  }

  lifecycle.initRun = async function (fops, params, presetConfigPath) {
    const projectRoot = pathutil.resolve(params.baseDir ?? '.')
    const projectConfig = await config.loadProjectConfig(fops, projectRoot, { presetConfigPath })
    const sourceType = params.sourceType === 'linear' ? 'linear' : (params.sourceType === 'local' || params.sourcePath ? 'local' : 'local')
    const sourcePath = typeof params.sourcePath === 'string' && params.sourcePath.trim()
      ? pathutil.resolve(projectRoot, params.sourcePath)
      : ''

    let issueMarkdown = params.issueMarkdown
    let issueTitle = params.issueTitle ?? ''
    if (sourcePath) {
      const text = await fops.readText(sourcePath)
      issueMarkdown = issueMarkdown ?? text
      if (!issueTitle) {
        const heading = text.match(/^#\s+(.+)$/m)
        issueTitle = heading?.[1]?.trim() ?? pathutil.basename(sourcePath)
      }
    }

    const rawIssueId = params.issueId ?? (sourcePath ? pathutil.basename(sourcePath).replace(/\.md$/i, '') : '')
    const issueId = util.safeSegment(util.requiredString(rawIssueId, 'issueId'))
    const createdAt = new Date().toISOString()
    const runId = util.safeSegment(params.runId ?? `${util.timestampForPath(createdAt)}-${issueId}`)
    const agentRoot = pathutil.resolve(projectRoot, '.research-agent')
    const locksDir = pathutil.join(agentRoot, 'locks')
    const runDir = pathutil.join(agentRoot, 'runs', issueId, runId)
    const lockPath = pathutil.join(locksDir, `${issueId}.lock`)
    const merged = config.mergeConfig({ ...projectConfig, ...(util.isPlainObject(params.config) ? params.config : {}) })

    const lockBody = JSON.stringify({
      issueId,
      runId,
      runDir: pathutil.relativePath(projectRoot, runDir),
      createdAt,
      pid: null, // DSH plugin has no process.pid; audit only
      sourceType,
      sourcePath: sourcePath ? pathutil.relativePath(projectRoot, sourcePath) : '',
    }, null, 2) + '\n'

    let lockOverridden = false
    try {
      await fops.writeTextNew(lockPath, lockBody)
    } catch (error) {
      if (!util.isAlreadyExistsError(error)) throw error
      if (params.forceRecovery !== true) {
        const existing = await fops.readJson(lockPath)
        const existingRunDir = typeof existing?.runDir === 'string' ? pathutil.resolve(projectRoot, existing.runDir) : ''
        const existingRun = existingRunDir ? await fops.readJson(pathutil.join(existingRunDir, 'run.json')) : undefined
        const hint = existingRun?.status === 'complete'
          ? ' The locked run is already complete; call autoresearch_finalize_run on that runDir to release the lock, or set forceRecovery:true after explicit approval.'
          : ' Set forceRecovery:true only after explicit human recovery approval.'
        throw new Error(`AutoResearch lock already exists for ${issueId}: ${pathutil.relativePath(projectRoot, lockPath)}.${hint}`)
      }
      lockOverridden = true
      await fops.writeText(lockPath, lockBody)
    }

    // Seed the workspace config from the merged effective config (workspace
    // override → preset default → built-in), so the user gets a visible,
    // editable copy including any preset-level model choices.
    await writeJsonIfMissing(fops, pathutil.join(agentRoot, 'config.json'), projectConfig)

    const runState = {
      issueId,
      issueTitle,
      runId,
      status: 'running',
      currentStep: 'intake',
      currentPass: 0,
      consecutiveAWins: 0,
      incumbentPath: '',
      evidenceBriefPath: 'evidence/evidence_brief.md',
      sourceType,
      sourcePath: sourcePath ? pathutil.relativePath(projectRoot, sourcePath) : '',
      sourceUrl: typeof params.sourceUrl === 'string' ? params.sourceUrl : '',
      linear: {
        enabled: sourceType === 'linear',
        startCommentPosted: false,
        finalCommentPosted: false,
        state: '',
      },
      config: merged,
      createdAt,
      updatedAt: createdAt,
    }

    const defaultIssueMarkdown = sourceType === 'local'
      ? `# ${issueId}\n\n${issueTitle}\n\nSource: ${runState.sourcePath}\n`
      : `# ${issueId}\n\n${issueTitle}\n`

    await fops.writeText(pathutil.join(runDir, 'issue.md'), issueMarkdown ?? defaultIssueMarkdown)
    await fops.writeText(pathutil.join(runDir, 'comments.md'), params.commentsMarkdown ?? '# Comments\n\n')
    await fops.writeJson(pathutil.join(runDir, 'config.json'), merged)
    await fops.writeJson(pathutil.join(runDir, 'run.json'), runState)
    await fops.writeJson(pathutil.join(runDir, 'history.json'), [])
    const nextAction = sourceType === 'local'
      ? 'Read issue snapshot and autoreason_loop_checklist.md, then begin scouting. Linear posting is optional for local runs.'
      : 'Use Linear tools to post the start comment if needed, then read autoreason_loop_checklist.md before creating scout packets and beginning evidence gathering.'
    await fops.writeText(pathutil.join(runDir, 'resume.md'), config.renderResume(runState, nextAction))
    await fops.writeText(pathutil.join(runDir, 'autoreason_loop_checklist.md'), config.renderLoopChecklist(merged))

    return {
      issueId,
      runId,
      runDir: pathutil.relativePath(projectRoot, runDir),
      lockPath: pathutil.relativePath(projectRoot, lockPath),
      checklistPath: pathutil.relativePath(projectRoot, pathutil.join(runDir, 'autoreason_loop_checklist.md')),
      lockOverridden,
      sourceType,
      sourcePath: runState.sourcePath,
      sourceUrl: runState.sourceUrl,
      currentStep: runState.currentStep,
      config: merged,
      sessionControl: merged.sessionControl ?? false,
      roleModels: merged.roleModels,
      nextAction,
    }
  }

  lifecycle.regenerateChecklist = async function (fops, runDirInput) {
    const runDir = pathutil.resolve(runDirInput)
    const cfg = await config.loadRunConfig(fops, runDir)
    const checklistPath = pathutil.resolveInside(runDir, 'autoreason_loop_checklist.md')
    await fops.writeText(checklistPath, config.renderLoopChecklist(cfg))
    return {
      runDir,
      checklistPath: 'autoreason_loop_checklist.md',
      config: cfg,
      nextAction: 'Call autoresearch_validate_resume again before continuing role work.',
    }
  }

  lifecycle.checkpointRun = async function (fops, params) {
    const projectRoot = pathutil.resolve(params.baseDir ?? '.')
    const runDir = pathutil.resolve(params.runDir)
    const runPath = pathutil.resolveInside(runDir, 'run.json')
    const historyPath = pathutil.resolveInside(runDir, 'history.json')
    const run = await fops.readJson(runPath)
    if (!util.isPlainObject(run)) throw new Error('run.json must be an object.')

    if (typeof params.currentStep === 'string' && params.currentStep.trim()) run.currentStep = params.currentStep.trim()
    if (typeof params.currentPass === 'number') run.currentPass = params.currentPass
    if (typeof params.consecutiveAWins === 'number') run.consecutiveAWins = params.consecutiveAWins
    if (typeof params.incumbentPath === 'string') run.incumbentPath = params.incumbentPath
    if (typeof params.status === 'string' && params.status.trim()) run.status = params.status.trim()
    if (util.isPlainObject(params.linearPatch)) {
      run.linear = { ...(util.isPlainObject(run.linear) ? run.linear : {}), ...params.linearPatch }
    }
    if (util.isPlainObject(params.patch)) {
      Object.assign(run, params.patch)
    }
    run.updatedAt = new Date().toISOString()

    if (Array.isArray(params.history)) {
      await fops.writeJson(historyPath, params.history)
    } else if (util.isPlainObject(params.historyEntry)) {
      const loaded = await fops.readJson(historyPath)
      const history = Array.isArray(loaded) ? loaded : []
      const nextHistory = [...history]
      const pass = Number(params.historyEntry.pass)
      const existingIndex = nextHistory.findIndex((entry) => Number(entry?.pass) === pass)
      if (existingIndex >= 0) nextHistory[existingIndex] = params.historyEntry
      else nextHistory.push(params.historyEntry)
      nextHistory.sort((a, b) => Number(a.pass) - Number(b.pass))
      await fops.writeJson(historyPath, nextHistory)
      if (typeof params.consecutiveAWins !== 'number') {
        run.consecutiveAWins = resume.computeConsecutiveAWins(nextHistory)
      }
    }

    const nextAction = typeof params.nextAction === 'string' && params.nextAction.trim()
      ? params.nextAction.trim()
      : `Continue from ${run.currentStep}.`
    await fops.writeJson(runPath, run)
    await fops.writeText(pathutil.resolveInside(runDir, 'resume.md'), config.renderResume(run, nextAction))

    return {
      runDir: pathutil.relativePath(projectRoot, runDir),
      status: run.status,
      currentStep: run.currentStep,
      currentPass: run.currentPass,
      consecutiveAWins: run.consecutiveAWins,
      incumbentPath: run.incumbentPath,
      updatedAt: run.updatedAt,
      nextAction,
    }
  }

  lifecycle.finalizeRun = async function (fops, params) {
    const projectRoot = pathutil.resolve(params.baseDir ?? '.')
    const runDir = pathutil.resolve(params.runDir)
    const runPath = pathutil.resolveInside(runDir, 'run.json')
    const run = await fops.readJson(runPath)
    if (!util.isPlainObject(run)) throw new Error('run.json must be an object.')

    const now = new Date().toISOString()
    run.status = 'complete'
    run.currentStep = 'complete'
    run.updatedAt = now
    run.linear = util.isPlainObject(run.linear) ? run.linear : {}
    const targetState = run.linear.enabled ? (typeof run.config?.finalState === 'string' ? run.config.finalState : 'In Review') : null
    if (params.finalCommentPosted !== false && run.linear.enabled !== false) {
      run.linear.finalCommentPosted = true
      run.linear.state = targetState
    }

    const nextAction = typeof params.notes === 'string' && params.notes.trim()
      ? params.notes.trim()
      : 'Run marked complete. No further agent action scheduled.'
    await fops.writeJson(runPath, run)
    await fops.writeText(pathutil.resolveInside(runDir, 'resume.md'), config.renderResume(run, nextAction))

    let lockReleased = false
    let lockPath = ''
    const issueId = util.safeSegment(String(run.issueId ?? pathutil.basename(pathutil.dirname(runDir))))
    lockPath = pathutil.resolve(projectRoot, '.research-agent', 'locks', `${issueId}.lock`)
    if (params.releaseLock !== false) {
      const lock = await fops.readJson(lockPath)
      const lockedRunDir = typeof lock?.runDir === 'string' ? pathutil.resolve(projectRoot, lock.runDir) : ''
      if (lock && lockedRunDir === runDir) {
        await fops.remove(lockPath)
        lockReleased = true
      }
    }

    const postingIntent = run.linear.enabled
      ? { issueId, commentPath: 'final.md', targetState }
      : null

    return {
      runDir: pathutil.relativePath(projectRoot, runDir),
      status: run.status,
      currentStep: run.currentStep,
      lockPath: lockPath ? pathutil.relativePath(projectRoot, lockPath) : '',
      lockReleased,
      postingIntent,
      nextAction,
    }
  }

  lifecycle.researchStatus = async function (fops, params) {
    const projectRoot = pathutil.resolve(params.baseDir ?? '.')
    const agentRoot = pathutil.resolve(projectRoot, '.research-agent')
    const locksDir = pathutil.join(agentRoot, 'locks')
    const runsRoot = pathutil.join(agentRoot, 'runs')
    const issueId = typeof params.issueId === 'string' && params.issueId.trim() ? util.safeSegment(params.issueId) : ''

    const locks = []
    for (const entry of await fops.listDir(locksDir)) {
      if (entry.dir || !entry.name.endsWith('.lock')) continue
      if (issueId && entry.name !== `${issueId}.lock`) continue
      const lockPath = pathutil.join(locksDir, entry.name)
      const lock = await fops.readJson(lockPath)
      locks.push({
        issueId: lock?.issueId ?? entry.name.replace(/\.lock$/, ''),
        lockPath: pathutil.relativePath(projectRoot, lockPath),
        runId: lock?.runId ?? '',
        runDir: lock?.runDir ?? '',
        sourceType: lock?.sourceType ?? '',
        createdAt: lock?.createdAt ?? '',
      })
    }

    const runs = []
    const issueIds = issueId
      ? [issueId]
      : (await fops.listDir(runsRoot)).filter((entry) => entry.dir).map((entry) => entry.name).slice(-10)
    for (const id of issueIds) {
      const issueDir = pathutil.join(runsRoot, id)
      const runDirs = (await fops.listDir(issueDir)).filter((entry) => entry.dir).map((entry) => entry.name).sort().reverse()
      if (runDirs.length === 0) continue
      const newest = pathutil.join(issueDir, runDirs[0])
      const run = await fops.readJson(pathutil.join(newest, 'run.json'))
      runs.push({
        issueId: id,
        runDir: pathutil.relativePath(projectRoot, newest),
        runId: run?.runId ?? runDirs[0],
        status: run?.status ?? 'unknown',
        currentStep: run?.currentStep ?? '',
        currentPass: run?.currentPass ?? null,
        consecutiveAWins: run?.consecutiveAWins ?? null,
        incumbentPath: run?.incumbentPath ?? '',
        sourceType: run?.sourceType ?? '',
        updatedAt: run?.updatedAt ?? '',
        hasFinal: await fops.exists(pathutil.join(newest, 'final.md')),
      })
    }

    return {
      projectRoot,
      issueId: issueId || null,
      locks,
      runs,
      instruction: 'Run AutoResearch Project Mode: draft and approve a plan DAG, then one AutoReason loop per node. Call autoresearch_finalize_run to unlock completed runs.',
    }
  }

  lifecycle.detectResearchTarget = function (raw) {
    const value = String(raw).trim()
    if (!value) return { kind: 'empty', value: '' }
    if (value.endsWith('.md') || value.includes('/') || value.startsWith('.')) {
      return { kind: 'local', value }
    }
    // DSH has no Linear command entry; plain ids are treated as local brief ids.
    return { kind: 'local', value }
  }

  return lifecycle
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeLifecycle

// ── lib/planvalidate.js ──
'use strict'
// Project-mode plan validation (plan §3, C4 + §10 settled decisions).
// Pure functions: validates the immutable approved plan.json — schema
// version, marker, single team, unique node ids, required fields, roles
// (7 predefined ∪ configured roleProfiles), budget bounds + judge quorum,
// dependsOn targets exist, acyclicity, integration node covering all leaves.
// Factory pattern: no require/import, so the same body concatenates into a
// dynamic Cordis plugin.
function makePlanValidate(util, config) {
  const planvalidate = {}

  planvalidate.PLAN_SCHEMA_VERSION = 1

  // The 7 predefined research roles (plan §3: roles ∈ predefined 7 ∪
  // configured roleProfiles). implementation_worker/review_worker are
  // config-compat roles and are NOT valid plan-node roles.
  planvalidate.PRESET_ROLES = [
    'research_scout',
    'evidence_verifier',
    'research_author',
    'research_critic',
    'research_synthesizer',
    'research_judge',
    'research_reporter',
  ]

  // Judge quorum (plan §10.1): a node that runs judges needs >= 2, matching
  // the escalation rule "fewer than 2 valid judges" and the shipped default
  // numJudges: 2.
  planvalidate.JUDGE_QUORUM = 2

  // Per-node budget defaults when a node omits budget fields (plan D2, §10.1).
  planvalidate.DEFAULT_NODE_BUDGET = {
    numScouts: 2,
    numJudges: 2,
    maxPasses: 1,
    convergenceThreshold: 2,
  }

  // Stable markers (must stay in sync with lib/linear-core.js marker
  // helpers; asserted by the marker-consistency test).
  planvalidate.projectMarker = function (projectId) {
    return `autoresearch-project:${projectId}`
  }

  planvalidate.nodeMarker = function (projectId, nodeId) {
    return `autoresearch-node:${projectId}:${nodeId}`
  }

  function isPlainObject(value) {
    return util.isPlainObject(value)
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0
  }

  function positiveInt(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1
  }

  function validRoleName(role, roleProfiles) {
    if (!isNonEmptyString(role)) return false
    if (planvalidate.PRESET_ROLES.includes(role)) return true
    if (isPlainObject(roleProfiles)) {
      for (const key of Object.keys(roleProfiles)) {
        if (key === role) {
          const entry = roleProfiles[key]
          // A configured roleProfile is valid when it names a model or tools.
          if (isNonEmptyString(entry) || isPlainObject(entry)) return true
        }
      }
    }
    return false
  }

  function safeId(value) {
    try {
      util.safeSegment(value)
      return true
    } catch {
      return false
    }
  }

  // DFS cycle detection over dependsOn edges. Returns the first cycle path
  // or null when the graph is acyclic.
  function findCycle(nodesById, nodeIds) {
    const visiting = new Set()
    const visited = new Set()
    const stack = []
    function visit(id) {
      const node = nodesById[id]
      if (!node) return null // dangling target: reported separately
      if (visiting.has(id)) {
        const start = stack.indexOf(id)
        return [...stack.slice(start), id]
      }
      if (visited.has(id)) return null
      visiting.add(id)
      stack.push(id)
      for (const dep of node.dependsOn) {
        const cycle = visit(dep)
        if (cycle) return cycle
      }
      stack.pop()
      visiting.delete(id)
      visited.add(id)
      return null
    }
    for (const id of nodeIds) {
      const cycle = visit(id)
      if (cycle) return cycle
    }
    return null
  }

  // Validate one node's budget. Returns { budget, errors } where budget is
  // the merged effective budget (defaults applied).
  function validateBudget(node, errors, warnings) {
    const raw = isPlainObject(node.budget) ? node.budget : {}
    const usesScouts = (node.roles ?? []).includes('research_scout')
    const usesJudges = (node.roles ?? []).includes('research_judge')
    const budget = {
      ...planvalidate.DEFAULT_NODE_BUDGET,
      numScouts: usesScouts ? planvalidate.DEFAULT_NODE_BUDGET.numScouts : 0,
      numJudges: usesJudges ? planvalidate.DEFAULT_NODE_BUDGET.numJudges : 0,
    }
    const fields = ['numScouts', 'numJudges', 'maxPasses', 'convergenceThreshold']
    for (const field of fields) {
      if (raw[field] !== undefined) {
        const countField = field === 'numScouts' || field === 'numJudges'
        const valid = countField ? Number.isInteger(raw[field]) && raw[field] >= 0 : positiveInt(raw[field])
        if (!valid) {
          errors.push(`node ${node.id}: budget.${field} must be ${countField ? 'a non-negative' : 'a positive'} integer.`)
        } else {
          budget[field] = raw[field]
        }
      }
    }
    if (usesScouts && budget.numScouts < 1) {
      errors.push(`node ${node.id}: roles include research_scout but budget.numScouts=${budget.numScouts}; at least one scout is required.`)
    }
    if (!usesScouts && budget.numScouts !== 0) {
      warnings.push(`node ${node.id}: budget.numScouts=${budget.numScouts} is unreachable because roles omit research_scout; executable count normalized to 0.`)
      budget.numScouts = 0
    }
    if (usesJudges && budget.numJudges < planvalidate.JUDGE_QUORUM) {
      errors.push(`node ${node.id}: roles include research_judge but budget.numJudges=${budget.numJudges} is below the quorum ${planvalidate.JUDGE_QUORUM} (plan §10.1).`)
    }
    if (!usesJudges && budget.numJudges !== 0) {
      warnings.push(`node ${node.id}: budget.numJudges=${budget.numJudges} is unreachable because roles omit research_judge; executable count normalized to 0.`)
      budget.numJudges = 0
    }
    return budget
  }

  // Validate the full approved plan. opts.roleProfiles carries the
  // configured custom roles (from the effective project config).
  planvalidate.validatePlan = function (plan, opts = {}) {
    const errors = []
    const warnings = []
    const roleProfiles = isPlainObject(opts.roleProfiles) ? opts.roleProfiles : {}

    if (!isPlainObject(plan)) {
      return { ok: false, errors: ['plan must be a JSON object.'], warnings, schemaVersion: null, nodeCount: 0 }
    }

    if (plan.schemaVersion !== planvalidate.PLAN_SCHEMA_VERSION) {
      errors.push(`plan.schemaVersion must be ${planvalidate.PLAN_SCHEMA_VERSION} (got ${JSON.stringify(plan.schemaVersion)}).`)
    }

    if (!isNonEmptyString(plan.projectId)) {
      errors.push('plan.projectId must be a non-empty string.')
    } else {
      if (!safeId(plan.projectId)) errors.push(`plan.projectId is not a safe path segment: ${plan.projectId}`)
      const expectedMarker = planvalidate.projectMarker(plan.projectId)
      if (plan.marker !== undefined && plan.marker !== expectedMarker) {
        errors.push(`plan.marker must equal the derived marker "${expectedMarker}".`)
      }
    }

    if (!isNonEmptyString(plan.projectName)) {
      errors.push('plan.projectName must be a non-empty string.')
    }

    // Linear plans may identify one approved team; local-only plans omit team
    // metadata and never call the Linear mutation tools.
    if (plan.teamId !== undefined && !isNonEmptyString(plan.teamId)) {
      errors.push('plan.teamId must be a non-empty string when present.')
    }
    if (plan.teamKey !== undefined && !isNonEmptyString(plan.teamKey)) {
      errors.push('plan.teamKey must be a non-empty string when present.')
    }

    if (!isNonEmptyString(plan.approvedAt)) warnings.push('plan.approvedAt is missing; approval provenance is incomplete.')
    if (!positiveInt(plan.revision)) warnings.push('plan.revision is missing or invalid; defaulting to 1.')
    const revision = positiveInt(plan.revision) ? plan.revision : 1

    const nodes = Array.isArray(plan.nodes) ? plan.nodes : []
    if (nodes.length === 0) {
      errors.push('plan.nodes must be a non-empty array of work items.')
    }

    const nodeIds = []
    const nodesById = {}
    for (const node of nodes) {
      if (!isPlainObject(node)) {
        errors.push('every plan.nodes entry must be an object.')
        continue
      }
      const id = node.id
      if (!isNonEmptyString(id)) {
        errors.push('every node needs a non-empty string id.')
        continue
      }
      if (!safeId(id)) {
        errors.push(`node id is not a safe path segment: ${id}`)
        continue
      }
      if (nodesById[id] !== undefined) {
        errors.push(`duplicate node id: ${id}`)
        continue
      }
      // Normalize on a shallow clone — never mutate the caller's plan object
      // (tool arguments can arrive frozen/read-only).
      nodesById[id] = { ...node, dependsOn: Array.isArray(node.dependsOn) ? [...node.dependsOn] : [] }
      nodeIds.push(id)

      if (!isNonEmptyString(node.title)) errors.push(`node ${id}: title must be a non-empty string.`)
      if (!isNonEmptyString(node.expectedOutcome)) errors.push(`node ${id}: expectedOutcome must be a non-empty string.`)
      if (node.acceptance !== undefined && !(Array.isArray(node.acceptance) && node.acceptance.every(isNonEmptyString))) {
        errors.push(`node ${id}: acceptance must be an array of non-empty strings.`)
      }
      if (node.test !== undefined && !isNonEmptyString(node.test)) {
        errors.push(`node ${id}: test must be a non-empty string when present.`)
      }

      // roles: non-empty, every entry valid (7 predefined ∪ configured).
      const roles = Array.isArray(node.roles) ? node.roles : []
      if (roles.length === 0) {
        errors.push(`node ${id}: roles must be a non-empty array (plan §10.3 role semantics).`)
      } else {
        for (const role of roles) {
          if (!validRoleName(role, roleProfiles)) {
            errors.push(`node ${id}: unknown role "${role}" (must be one of the 7 predefined roles or a configured roleProfiles role).`)
          }
        }
      }

      validateBudget(node, errors, warnings)

      // dependsOn: array of strings; self/duplicate/dangling targets are
      // validated in a second pass below (after every node is registered, so
      // a later-defined dependency is not reported missing).
      if (node.dependsOn !== undefined && !Array.isArray(node.dependsOn)) {
        errors.push(`node ${id}: dependsOn must be an array.`)
      }
    }

    // Second pass: dependsOn targets exist, no self, no duplicates.
    for (const id of nodeIds) {
      const node = nodesById[id]
      const dependsOn = Array.isArray(node.dependsOn) ? node.dependsOn : []
      const seen = new Set()
      for (const dep of dependsOn) {
        if (!isNonEmptyString(dep)) {
          errors.push(`node ${id}: dependsOn entries must be non-empty strings.`)
          continue
        }
        if (dep === id) {
          errors.push(`node ${id}: dependsOn must not contain itself.`)
          continue
        }
        if (seen.has(dep)) {
          errors.push(`node ${id}: duplicate dependsOn entry "${dep}".`)
          continue
        }
        seen.add(dep)
        if (nodesById[dep] === undefined) {
          errors.push(`node ${id}: dependsOn target "${dep}" does not exist.`)
        }
      }
    }

    // Acyclicity (multi-parent allowed; cycles rejected).
    if (nodeIds.length > 0) {
      const cycle = findCycle(nodesById, nodeIds)
      if (cycle) errors.push(`plan DAG contains a cycle: ${cycle.join(' -> ')}`)
    }

    // Integration node: present, depends on nothing, covers all leaves.
    const integrationId = isNonEmptyString(plan.integrationId) ? plan.integrationId : 'integration'
    const integration = nodesById[integrationId]
    if (!integration) {
      errors.push(`integration node "${integrationId}" is missing (mandatory final node).`)
    } else {
      const integrationDeps = Array.isArray(integration.dependsOn) ? integration.dependsOn : []
      const leafIds = nodeIds.filter((id) => id !== integrationId && !nodeIds.some((other) => other !== integrationId && (nodesById[other].dependsOn ?? []).includes(id)))
      const uncovered = leafIds.filter((id) => !integrationDeps.includes(id))
      if (uncovered.length > 0) {
        errors.push(`integration node "${integrationId}" must cover all leaves; uncovered: ${uncovered.join(', ')}`)
      }
      const dependsOnIntegration = nodeIds.filter((id) => id !== integrationId && (nodesById[id].dependsOn ?? []).includes(integrationId))
      if (dependsOnIntegration.length > 0) {
        errors.push(`nothing may depend on the integration node; offenders: ${dependsOnIntegration.join(', ')}`)
      }
      if (integrationDeps.includes(integrationId)) {
        errors.push(`integration node must not depend on itself.`)
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      schemaVersion: plan.schemaVersion ?? null,
      projectId: plan.projectId ?? null,
      marker: plan.projectId ? planvalidate.projectMarker(plan.projectId) : null,
      teamId: plan.teamId ?? null,
      revision,
      nodeCount: nodeIds.length,
      nodeIds,
      integrationId: integration ? integrationId : null,
    }
  }

  return planvalidate
}

if (typeof module !== 'undefined' && module.exports) module.exports = makePlanValidate

// ── lib/projectstate.js ──
'use strict'
// Project-mode execution journal + reconciliation (plan §3 C5/C6/C8 + §10
// settled decisions). Owns `.research-agent/projects/<id>/plan.json` (the
// immutable approved spec, read-only here) and `state.json` (the mutable
// receipt journal: node states, Linear ids, run dirs, comment-id cursor,
// integration revision). All mutations are replay-safe: reconcile by
// marker/receipt, never re-create.
//
// The coordinator drives state transitions with plain fs writes (the journal
// is its own artifact); this module provides the canonical readers, the
// deterministic ready set, the idempotent comment-cursor advance, and the
// plan/state/Linear/run reconciliation that `autoresearch_project_status`
// reports. `plan.json` is never mutated here.
function makeProjectState(pathutil, util, planvalidate) {
  const projectstate = {}

  projectstate.STATE_SCHEMA_VERSION = 1
  projectstate.MAX_CURSOR_IDS = 500

  projectstate.projectsDir = function (baseDir) {
    return pathutil.resolve(baseDir, '.research-agent', 'projects')
  }

  projectstate.projectDir = function (baseDir, projectId) {
    return pathutil.resolve(projectstate.projectsDir(baseDir), util.safeSegment(projectId))
  }

  projectstate.planPath = function (baseDir, projectId) {
    return pathutil.resolveInside(projectstate.projectDir(baseDir, projectId), 'plan.json')
  }

  projectstate.statePath = function (baseDir, projectId) {
    return pathutil.resolveInside(projectstate.projectDir(baseDir, projectId), 'state.json')
  }

  // Read the immutable approved plan. Missing/invalid -> { ok:false, error }.
  projectstate.loadPlan = async function (fops, baseDir, projectId) {
    const path = projectstate.planPath(baseDir, projectId)
    const plan = await fops.readJson(path)
    if (!util.isPlainObject(plan)) {
      return { ok: false, plan: null, path, error: `plan.json missing or not valid JSON: ${path}` }
    }
    return { ok: true, plan, path }
  }

  // Empty journal template for a validated plan (created lazily by the
  // coordinator on first use; never written here).
  projectstate.emptyState = function (plan) {
    const now = new Date().toISOString()
    const nodes = {}
    for (const node of plan.nodes ?? []) {
      nodes[node.id] = {
        status: 'todo',
        issueId: '',
        identifier: '',
        url: '',
        linearState: '',
        runDir: '',
        runStatus: '',
        currentStep: '',
        currentPass: null,
        hasFinal: false,
        finalCommentId: '',
        receipts: [],
        updatedAt: '',
      }
    }
    return {
      schemaVersion: projectstate.STATE_SCHEMA_VERSION,
      projectId: plan.projectId,
      marker: planvalidate.projectMarker(plan.projectId),
      createdAt: now,
      updatedAt: now,
      project: { linearProjectId: '', url: '', createdAt: '' },
      integrationRevision: 1,
      nodes,
      commentCursors: {},
      lastError: '',
    }
  }

  // Read the journal. Missing -> empty template + missing flag; invalid JSON
  // -> empty template + invalid flag (a broken journal is replayable:
  // everything reconciles from plan + Linear).
  projectstate.loadState = async function (fops, baseDir, projectId, plan) {
    const path = projectstate.statePath(baseDir, projectId)
    if (!await fops.exists(path)) {
      const state = projectstate.emptyState(plan)
      return { state, path, missing: true, invalid: false }
    }
    const raw = await fops.readJson(path)
    if (!util.isPlainObject(raw)) {
      const state = projectstate.emptyState(plan)
      return { state, path, missing: false, invalid: true }
    }
    // Heal schema drift silently: ensure every plan node has an entry.
    const nodes = { ...(util.isPlainObject(raw.nodes) ? raw.nodes : {}) }
    for (const node of plan.nodes ?? []) {
      if (!util.isPlainObject(nodes[node.id])) {
        nodes[node.id] = projectstate.emptyState(plan).nodes[node.id]
      }
    }
    const state = {
      ...raw,
      schemaVersion: raw.schemaVersion ?? projectstate.STATE_SCHEMA_VERSION,
      nodes,
      commentCursors: util.isPlainObject(raw.commentCursors) ? raw.commentCursors : {},
    }
    return { state, path, missing: false, invalid: false }
  }

  projectstate.saveState = async function (fops, baseDir, projectId, state) {
    state.updatedAt = new Date().toISOString()
    await fops.writeJson(projectstate.statePath(baseDir, projectId), state)
  }

  // Receipt-safe single-node patch: applies a shallow merge, appends
  // receipts, touches updatedAt. Used by the coordinator (via fs) and by the
  // cursor advance below. Returns the updated state.
  projectstate.patchNode = async function (fops, baseDir, projectId, nodeId, patch) {
    const plan = await projectstate.loadPlan(fops, baseDir, projectId)
    if (!plan.ok) throw new Error(plan.error)
    const { state } = await projectstate.loadState(fops, baseDir, projectId, plan.plan)
    const entry = state.nodes[nodeId]
    if (!entry) throw new Error(`Unknown node id: ${nodeId}`)
    Object.assign(entry, patch)
    if (Array.isArray(patch.receipts)) {
      const seen = new Set(entry.receipts ?? [])
      entry.receipts = [...seen, ...patch.receipts.filter((receipt) => !seen.has(receipt))]
    }
    entry.updatedAt = new Date().toISOString()
    await projectstate.saveState(fops, baseDir, projectId, state)
    return state
  }

  // Deterministic ready set (plan §4.2.2): nodes whose dependsOn are all
  // Done per DERIVED state, computed identically on every replay. Never
  // consults Linear.
  projectstate.readySet = function (plan, state) {
    const nodes = util.isPlainObject(state.nodes) ? state.nodes : {}
    const order = (plan.nodes ?? []).map((node) => node.id)
    const byId = {}
    for (const node of plan.nodes ?? []) byId[node.id] = node
    const ready = []
    for (const id of order) {
      if (id === (plan.integrationId ?? 'integration')) continue
      const entry = nodes[id]
      if (!entry || entry.status === 'done' || entry.status === 'blocked') continue
      const deps = (byId[id]?.dependsOn ?? []).filter((dep) => dep !== id)
      const allDone = deps.every((dep) => nodes[dep]?.status === 'done')
      if (allDone) ready.push(id)
    }
    return ready
  }

  // Integration gating (plan §4.4 + §10.5): ready when every non-integration
  // node is Done under the CURRENT plan revision; prior integration work is
  // invalidated when the plan revision advanced past state.integrationRevision.
  projectstate.integrationStatus = function (plan, state) {
    const integrationId = plan.integrationId ?? 'integration'
    const nodes = util.isPlainObject(state.nodes) ? state.nodes : {}
    const entry = nodes[integrationId]
    const planRevision = planvalidate.validatePlan(plan).revision
    const stateRevision = Number(state.integrationRevision ?? 1)
    const allLeavesDone = (plan.nodes ?? [])
      .filter((node) => node.id !== integrationId)
      .every((node) => nodes[node.id]?.status === 'done')
    const invalidated = entry?.status === 'done' && stateRevision < planRevision
    const completedCurrent = entry?.status === 'done' && !invalidated
    const ready = allLeavesDone && !invalidated && !completedCurrent
    return {
      id: integrationId,
      status: entry?.status ?? 'todo',
      allLeavesDone,
      planRevision,
      stateRevision,
      invalidated,
      ready,
      reason: invalidated
        ? `integration was completed under plan revision ${stateRevision}; plan is now revision ${planRevision} — integration must re-run (plan §10.5).`
        : completedCurrent
          ? `integration is complete for current plan revision ${planRevision}.`
          : allLeavesDone
            ? 'all leaves are Done; integration may run.'
            : 'not all leaves are Done; integration is blocked.',
    }
  }

  // Idempotent per-node comment-id cursor advance (plan §9.11): appends only
  // NEW ids, keeps the newest MAX_CURSOR_IDS, persists immediately. Returns
  // the delta so the coordinator knows what to append to comments.md.
  projectstate.advanceCommentCursor = async function (fops, baseDir, projectId, nodeId, commentIds) {
    const plan = await projectstate.loadPlan(fops, baseDir, projectId)
    if (!plan.ok) throw new Error(plan.error)
    const { state } = await projectstate.loadState(fops, baseDir, projectId, plan.plan)
    if (!state.nodes[nodeId]) throw new Error(`Unknown node id: ${nodeId}`)
    const cursors = state.commentCursors
    const seen = Array.isArray(cursors[nodeId]?.seen) ? cursors[nodeId].seen : []
    const existing = new Set(seen)
    const added = (Array.isArray(commentIds) ? commentIds.map(String) : [])
      .filter((id) => id && !existing.has(id))
    const next = [...seen, ...added].slice(-projectstate.MAX_CURSOR_IDS)
    cursors[nodeId] = { seen: next, updatedAt: new Date().toISOString() }
    await projectstate.saveState(fops, baseDir, projectId, state)
    return { nodeId, added, total: next.length, updatedAt: cursors[nodeId].updatedAt }
  }

  // Parse canonical plan-id markers and, for migration visibility, the legacy
  // Linear-project-id markers emitted by older presets. Canonical matches win;
  // legacy matches remain explicit drift until linear_create_issue migrates them.
  projectstate.matchIssuesByMarker = function (projectId, linearIssues, legacyProjectId = '') {
    const byNode = {}
    const ambiguous = []
    const legacyNodes = new Set()
    const issues = Array.isArray(linearIssues) ? linearIssues : []

    function collect(markerProjectId, legacy) {
      if (typeof markerProjectId !== 'string' || !markerProjectId || (legacy && markerProjectId === projectId)) return
      const escaped = markerProjectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`autoresearch-node:${escaped}:([A-Za-z0-9_.-]+)`, 'g')
      for (const issue of issues) {
        const description = typeof issue?.description === 'string' ? issue.description : ''
        for (const match of description.matchAll(pattern)) {
          const nodeId = match[1]
          if (byNode[nodeId] !== undefined && byNode[nodeId]?.id !== issue?.id) ambiguous.push(nodeId)
          if (byNode[nodeId] === undefined) {
            byNode[nodeId] = issue
            if (legacy) legacyNodes.add(nodeId)
          }
        }
      }
    }

    collect(projectId, false)
    collect(legacyProjectId, true)
    return { byNode, ambiguous: [...new Set(ambiguous)], legacyNodes: [...legacyNodes] }
  }

  // Read one node's local run summary (run.json + final.md presence).
  async function runSummary(fops, baseDir, stateEntry) {
    if (!stateEntry || typeof stateEntry.runDir !== 'string' || !stateEntry.runDir) {
      return { runDir: '', runStatus: '', currentStep: '', currentPass: null, hasFinal: false, missing: false }
    }
    const runDir = pathutil.resolve(baseDir, stateEntry.runDir)
    const run = await fops.readJson(pathutil.resolveInside(runDir, 'run.json'))
    if (!util.isPlainObject(run)) {
      return { runDir: stateEntry.runDir, runStatus: '', currentStep: '', currentPass: null, hasFinal: false, missing: true }
    }
    return {
      runDir: stateEntry.runDir,
      runStatus: run.status ?? '',
      currentStep: run.currentStep ?? '',
      currentPass: typeof run.currentPass === 'number' ? run.currentPass : null,
      hasFinal: await fops.exists(pathutil.resolveInside(runDir, 'final.md')),
      missing: false,
    }
  }

  // Full reconciliation (plan §3 C6): plan (authoritative) + state (journal)
  // + Linear issues (derived, optional) + local runs -> per-node rows with
  // desired/observed/drift/errors and the next safe action. Never mutates
  // plan.json; state.json is only touched through the explicit cursor
  // advance. Drift is surfaced, never auto-rewritten (plan §10.4).
  projectstate.reconcile = async function (fops, baseDir, plan, state, linearIssues) {
    const integrationId = plan.integrationId ?? 'integration'
    const nodes = util.isPlainObject(state.nodes) ? state.nodes : {}
    const matched = projectstate.matchIssuesByMarker(plan.projectId, linearIssues, state.project?.linearProjectId)
    const integration = projectstate.integrationStatus(plan, state)
    const readySet = projectstate.readySet(plan, state)
    const rows = []

    for (const node of plan.nodes ?? []) {
      const id = node.id
      const entry = nodes[id]
      const issue = matched.byNode[id]
      const summary = await runSummary(fops, baseDir, entry)
      const drift = []
      const errors = []

      // State vs Linear (derived view never rewrites state or plan).
      if (entry && entry.issueId && !issue) {
        drift.push('linear-issue-missing')
      }
      if (matched.legacyNodes.includes(id)) {
        drift.push('legacy-node-marker')
      }
      if (entry && issue && !entry.issueId) {
        drift.push('state-entry-missing')
      }
      if (entry && issue && entry.issueId && issue.id !== entry.issueId) {
        drift.push('linear-id-mismatch')
      }
      const linearDone = issue?.state?.type === 'completed' || issue?.state?.name === 'Done' || issue?.state?.name === 'Completed'
      const expectedLinearState = entry?.linearState?.trim() || (entry?.status === 'done' ? 'Done' : 'Todo')
      if (entry && issue && entry.status === 'done' && issue?.state?.name !== expectedLinearState) drift.push('linear-behind')
      if (entry && issue && linearDone && entry.status !== 'done') drift.push('linear-ahead')
      if (entry && entry.status === 'done' && entry.runDir && summary.missing) drift.push('run-dir-missing')
      if (entry && entry.status !== 'done' && summary.runStatus === 'complete') drift.push('run-ahead')

      const desiredStatus = entry?.status ?? 'todo'
      let nextAction
      if (!entry) {
        nextAction = 'create the Linear issue (marker) and the state.json receipt, then run the AutoReason loop.'
      } else if (entry.status === 'blocked') {
        nextAction = 'node is blocked on a user decision; surface the decision via ask_user_question.'
      } else if (entry.status === 'done') {
        nextAction = 'await integration (and goal completion).'
      } else if (summary.runStatus === 'complete') {
        nextAction = 'mark the node done in state.json (receipt: run complete + final posted).'
      } else if (summary.runDir) {
        nextAction = `resume the AutoReason loop at ${summary.runDir} (autoresearch_validate_resume).`
      } else if (id !== integrationId && readySet.includes(id)) {
        nextAction = 'run this node\u0027s AutoReason loop (autoresearch_init_run, then scouts → verifier → author → critic/B/AB → blind judges → reporter → finalize).'
      } else if (id !== integrationId) {
        nextAction = 'wait for dependencies to complete (ready set not reached).'
      } else {
        nextAction = integration.ready ? 'run the integration AutoReason loop over all leaf finals.' : integration.reason
      }

      if (matched.ambiguous.includes(id)) {
        errors.push(`multiple Linear issues carry the marker for node ${id}; reconcile by marker before continuing.`)
      }

      rows.push({
        id,
        title: node.title,
        isIntegration: id === integrationId,
        roles: node.roles ?? [],
        budget: node.budget ?? {},
        desired: {
          status: desiredStatus,
          linearState: expectedLinearState,
        },
        observed: {
          stateStatus: entry?.status ?? null,
          linearIssueId: issue?.id ?? null,
          identifier: issue?.identifier ?? entry?.identifier ?? null,
          linearState: issue?.state?.name ?? entry?.linearState ?? '',
          linearStateType: issue?.state?.type ?? null,
          runDir: summary.runDir,
          runStatus: summary.runStatus,
          currentStep: summary.currentStep,
          currentPass: summary.currentPass,
          hasFinal: summary.hasFinal,
          receipts: entry?.receipts ?? [],
          finalCommentId: entry?.finalCommentId ?? '',
        },
        drift,
        errors,
        nextAction,
      })
    }

    return {
      projectId: plan.projectId,
      planRevision: integration.planRevision,
      readySet,
      integration,
      ambiguousMarkers: matched.ambiguous,
      nodes: rows,
      cursorState: state.commentCursors,
    }
  }

  return projectstate
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeProjectState


// ── ORCHESTRATOR GLUE TAIL v2 (concatenated after the lib factory files) ──
// Generation-aware glue. Imports the shared pure core module (single source
// of truth for the role manifest, contracts, blinding, receipts, and build
// identity) and adds the v2 contract binding, fail-closed blinding, TeX node
// acceptance, integration protocol helpers, and the runtime build probe.
//
// The audited lib factories below are unchanged; this tail derives all
// hard-coded role/tool/pipeline data from the core manifest and overrides the
// behavioral surfaces the plan upgrades (anonymization, scoring, resume paths,
// run binding, finalization). Nothing here is a second registry.

const PRESET_ROLES_DIR = decodeURIComponent(new URL('../roles/', import.meta.url).pathname)
const PRESET_CONFIG_PATH = decodeURIComponent(new URL('../config.default.json', import.meta.url).pathname)

// Factory instantiation (moved from the installed glue tail; the audited lib
// sections above are pure factory declarations).
const pathutil = makePathUtil()
const util = makeUtil(pathutil)
const config = makeConfig(pathutil, util)
const roles = makeRoles()
const resume = makeResume(pathutil, util, config)
const lifecycle = makeLifecycle(pathutil, util, config, resume)
const scoring = makeScoring(pathutil, util, config)
const redact = makeRedact(pathutil)
const presearch = makePresearch(pathutil, util)
const profiles = makeProfiles(util, config)
const spawn = makeSpawn(pathutil, util, profiles)
const modelparse = makeModelParse()
const rolePrompt = makeRolePrompt(pathutil)
const modelRegistry = makeModelRegistry()
const planvalidate = makePlanValidate(util, config)
const projectstate = makeProjectState(pathutil, util, planvalidate)

// Runtime build identity: patched by build/deploy.mjs. The aggregate ID is
// defined over the imported runtime graph (core + helpers); changing any
// transitive module changes it and both probes report a mismatch.
export const EMBEDDED_GENERATION = '73dba5793f85'
export const EMBEDDED_BUILD_ID = 'ce73dad00474fc2e39819272fdf143082ab2b3fbef5027b1af469bd586af1246'
const MANIFEST_PATH = decodeURIComponent(new URL('./build-manifest.json', import.meta.url).pathname)

// ── manifest derivation (single source of truth: core.ROLE_MANIFEST) ──────

config.CONTENT_PRODUCING_ROLES = core.ROLE_CLASSES.contentProducing
config.SUPPORTING_ROLES = core.ROLE_CLASSES.supporting
config.ALL_RESEARCH_ROLES = core.ALL_ROLES
config.DEFAULT_CONFIG.roles = {
  planner: 'research_planner',
  scout: 'research_scout',
  verifier: 'evidence_verifier',
  author: 'research_author',
  critic: 'research_critic',
  synthesizer: 'research_synthesizer',
  judge: 'research_judge',
  reporter: 'research_reporter',
  implementationWorker: 'research_coder',
  reviewWorker: 'research_unit_tester',
}
profiles.DEFAULT_ROLE_TOOLS = Object.fromEntries(core.ALL_ROLES.map((id) => [id, [...core.ROLE_MANIFEST[id].defaultTools]]))
for (const [alias, id] of Object.entries(core.ROLE_ALIASES)) {
  if (profiles.DEFAULT_ROLE_TOOLS[alias] === undefined) {
    profiles.DEFAULT_ROLE_TOOLS[alias] = [...core.ROLE_MANIFEST[id].defaultTools]
  }
}
profiles.MINIMAL_DEFAULT_TOOLS = ['read']
planvalidate.PRESET_ROLES = core.VALID_PLAN_ROLES

// Tool ceilings: roleProfiles.<role>.tools may narrow a built-in ceiling but
// may not expand it. The wrapper throws on expansion, so a workspace config
// that grants the integration verifier write/edit/bash is rejected at profile
// resolution and the spawned child never sees those tools.
const _resolveEffectiveProfile = profiles.resolveEffectiveProfile
profiles.resolveEffectiveProfile = function (role, cfg, opts = {}) {
  const profile = _resolveEffectiveProfile(role, cfg, opts)
  const resolved = core.roleToolsWithinCeiling(profile.role, profile.tools)
  if (resolved !== null) profile.tools = resolved.tools
  return profile
}

// projectstate consults planvalidate for markers/revision; route it through
// the core validator so v2 plans keep working everywhere.
planvalidate.validatePlan = function (plan, opts = {}) {
  const result = core.validatePlan(plan, opts)
  return {
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    schemaVersion: result.schemaVersion,
    projectId: result.projectId,
    marker: result.marker,
    teamId: result.teamId,
    revision: result.revision,
    nodeCount: result.nodeCount,
    nodeIds: result.nodeIds,
    integrationId: result.integrationId,
  }
}

// Embedded prompt fallbacks: installed prompt data (makeRoles) plus the
// manifest-owned fallbacks for the seven specialized roles.
const embeddedRolePrompts = Object.assign({}, roles, core.NEW_ROLE_PROMPTS)

// ── module-level path helper ───────────────────────────────────────────────

function absPath(baseDir, p) {
  const base = pathutil.normalize(baseDir)
  const value = String(p)
  if (pathutil.isAbsolute(value)) return pathutil.normalize(value)
  return pathutil.join(base, value)
}

// ── run contract helpers (plan §4.3) ──────────────────────────────────────

async function loadRunContract(fops, runDir) {
  const file = await fops.readJson(pathutil.resolveInside(runDir, 'node-contract.json'))
  if (!util.isPlainObject(file) || typeof file.contractDigest !== 'string' || !file.contractDigest) return null
  return file
}

async function loadAcceptance(fops, runDir) {
  const file = await fops.readJson(pathutil.resolveInside(runDir, 'acceptance.json'))
  return util.isPlainObject(file) ? file : null
}

function computeRunDigest(run, contractFile) {
  if (contractFile) {
    return core.digestOf({
      runId: run?.runId ?? '',
      projectId: contractFile.projectId,
      nodeId: contractFile.nodeId,
      contractDigest: contractFile.contractDigest,
    })
  }
  return core.digestOf({ runId: run?.runId ?? '', projectId: '', nodeId: '' })
}

async function readRunAndDigest(fops, runDir) {
  const run = await fops.readJson(pathutil.resolveInside(runDir, 'run.json'))
  const contractFile = await loadRunContract(fops, runDir)
  return { run: util.isPlainObject(run) ? run : null, contractFile, runDigest: computeRunDigest(run, contractFile) }
}

async function hashFile(fops, path) {
  try {
    const bytes = await readBytesForHash(fops, path)
    if (bytes !== null) return hashBytes(bytes)
    return core.sha256Text(await fops.readText(path))
  } catch {
    return ''
  }
}

const BINARY_HASH_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.gz', '.zip', '.bin'])
const BINARY_HASH_MAX_BYTES = 64 * 1024 * 1024 // 64 MiB inclusive

async function readBytesForHash(fops, path) {
  const lower = String(path).toLowerCase()
  const isBinary = [...BINARY_HASH_EXTENSIONS].some((ext) => lower.endsWith(ext))
  if (!isBinary) return null
  if (typeof fops.readBytes !== 'function') return null
  return await fops.readBytes(path, BINARY_HASH_MAX_BYTES)
}

function hashBytes(bytes) {
  return core.sha256Bytes(bytes)
}

async function readFileSafe(fops, path) {
  try {
    return await fops.readText(path)
  } catch {
    return ''
  }
}

// One asynchronous, precedence-safe resolver for user-supplied paths:
// absolute paths as-is; otherwise runDir/p if it exists; otherwise baseDir/p.
// Never used for run-internal artifact names (those stay resolveInside).
async function resolveInput(fops, baseDir, runDir, p, opts = {}) {
  const mustExist = opts.mustExist === true
  const raw = String(p ?? '').trim()
  const attempted = []
  if (!raw) {
    if (mustExist) throw new Error('Path is required.')
    return ''
  }
  const isAbsolute = pathutil.isAbsolute(raw)
  if (isAbsolute) {
    const normalized = pathutil.normalize(raw)
    if (mustExist && !(await fops.exists(normalized))) {
      throw new Error('Path not found: ' + normalized)
    }
    return normalized
  }
  const candidates = []
  if (typeof runDir === 'string' && runDir.trim()) candidates.push(pathutil.join(runDir, raw))
  candidates.push(pathutil.join(baseDir, raw))
  for (const candidate of candidates) {
    attempted.push(candidate)
    if (await fops.exists(candidate)) return candidate
  }
  if (mustExist) {
    throw new Error('Path not found. Tried: ' + attempted.join('; '))
  }
  return candidates[0]
}

// ── subprocess helpers (TeX builds, probes) ────────────────────────────────

async function runSubprocess(subprocessService, baseDir, argv, opts = {}) {
  const handle = subprocessService.spawn({
    argv,
    cwd: baseDir,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: opts.maxBytes ?? 4 * 1024 * 1024 },
      stderr: { maxBytes: opts.maxBytes ?? 1024 * 1024 },
    },
    graceMs: opts.graceMs ?? 120000,
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

// Strict TeX build: latexmk -pdf -interaction=nonstopmode -halt-on-error
// -file-line-error -recorder, never -f. Records log/.fls/PDF hashes.
async function strictTexBuild(fops, subprocessService, baseDir, dir, mainFile) {
  const latexmk = await resolveExecutable(subprocessService, 'latexmk')
  const result = await runSubprocess(subprocessService, dir, [
    latexmk, '-pdf', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-recorder', mainFile,
  ])
  const stem = String(mainFile).replace(/\.tex$/i, '')
  const logPath = pathutil.join(dir, stem + '.log')
  const flsPath = pathutil.join(dir, stem + '.fls')
  const pdfPath = pathutil.join(dir, stem + '.pdf')
  const logHash = await hashFile(fops, logPath)
  const flsHash = await hashFile(fops, flsPath)
  const pdfHash = await hashFile(fops, pdfPath)
  return {
    clean: result.exitCode === 0,
    exitCode: result.exitCode,
    logHash,
    flsHash,
    pdfHash,
    pdfExists: pdfHash !== '',
    logTail: String(result.stdout + result.stderr).slice(-2000),
  }
}

// Render a compiled PDF to per-page PNGs for visual inspection. Builds the PDF
// first (strict latexmk) when missing, then rasterizes via pdftoppm → mutool →
// gs. Returns the page count, per-page image paths/hashes, and an optional
// page-budget check. Images are written under <runDir>/preview/ (workspace-local).
async function renderPreview(fops, subprocessService, baseDir, runDir, opts = {}) {
  const main = String(opts.mainFile ?? 'final').replace(/\.(tex|pdf)$/i, '')
  const texPath = pathutil.resolveInside(runDir, main + '.tex')
  const pdfPath = pathutil.resolveInside(runDir, main + '.pdf')
  if (!(await fops.exists(pdfPath))) {
    if (!(await fops.exists(texPath))) {
      throw new Error('No compiled PDF or TeX source found for "' + main + '" in the run directory.')
    }
    await strictTexBuild(fops, subprocessService, baseDir, runDir, main + '.tex')
  }
  if (!(await fops.exists(pdfPath))) throw new Error('Compiled PDF missing after build: ' + pdfPath)
  const dpi = Number.isInteger(opts.dpi) && opts.dpi >= 72 && opts.dpi <= 600 ? opts.dpi : 150
  const previewDir = pathutil.resolveInside(runDir, 'preview')
  const prefix = 'page'

  // Clear and recreate the preview dir so page counts never include stale pages.
  const rm = await subprocessService.resolveExecutable('/bin/rm')
  await runSubprocess(subprocessService, runDir, [rm, '-rf', previewDir])
  const mkdir = await subprocessService.resolveExecutable('/bin/mkdir')
  await runSubprocess(subprocessService, runDir, [mkdir, '-p', previewDir])

  let renderer = null
  let argv = null
  const tryResolve = async (name) => {
    try { return await subprocessService.resolveExecutable(name) } catch { return null }
  }
  const pdftoppm = await tryResolve('pdftoppm')
  if (pdftoppm) {
    renderer = 'pdftoppm'
    argv = [pdftoppm, '-png', '-r', String(dpi), pdfPath, pathutil.join(previewDir, prefix)]
  } else {
    const mutool = await tryResolve('mutool')
    if (mutool) {
      renderer = 'mutool'
      argv = [mutool, 'draw', '-o', pathutil.join(previewDir, prefix + '-%d.png'), '-r', String(dpi), pdfPath]
    } else {
      const gs = await tryResolve('gs')
      if (gs) {
        renderer = 'gs'
        argv = [gs, '-dNOPAUSE', '-dBATCH', '-sDEVICE=png16m', '-r' + dpi, '-sOutputFile=' + pathutil.join(previewDir, prefix + '-%d.png'), pdfPath]
      }
    }
  }
  if (!renderer) throw new Error('No PDF rasterizer available (tried pdftoppm, mutool, gs).')
  const result = await runSubprocess(subprocessService, runDir, argv, { maxBytes: 64 * 1024 * 1024 })
  if (result.exitCode !== 0) {
    throw new Error('PDF render failed (' + renderer + ', exit ' + result.exitCode + '): ' + String(result.stdout + result.stderr).slice(-600))
  }

  const entries = (await fops.listDir(previewDir)).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.png'))
  const numeric = (name) => {
    const match = String(name).match(/(\d+)(?=\.png$)/i)
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
  }
  entries.sort((a, b) => numeric(a.name) - numeric(b.name))
  const pages = []
  for (const entry of entries) {
    const absImg = pathutil.join(previewDir, entry.name)
    pages.push({
      index: pages.length + 1,
      name: entry.name,
      path: absImg,
      relPath: pathutil.relativePath(baseDir, absImg),
      hash: await hashFile(fops, absImg),
    })
  }
  const pageCount = pages.length
  const pageBudget = Number.isInteger(opts.pageBudget) && opts.pageBudget > 0 ? opts.pageBudget : null
  return {
    ok: pageCount > 0,
    main,
    pdfPath: pathutil.relativePath(baseDir, pdfPath),
    previewDir: pathutil.relativePath(baseDir, previewDir),
    renderer,
    dpi,
    pageCount,
    pageBudget,
    overBudget: pageBudget === null ? null : pageCount > pageBudget,
    pages,
  }
}

// Node-level strict TeX validation: static rules first, then a strict build
// of preview.tex (fragment mode, against the frozen template) or output.tex
// (standalone mode). A nonzero compiler exit cannot pass.
async function validateNodeTex(fops, subprocessService, baseDir, runDir, contract, opts = {}) {
  const outputPath = pathutil.resolveInside(runDir, 'output.tex')
  const outputText = await readFileSafe(fops, outputPath)
  const texMode = opts.texMode ?? contract.outputContract?.texMode ?? 'fragment'
  const declared = opts.declared ?? contract.outputContract ?? {}
  const staticResult = core.validateTexOutput(outputText, { texMode, declared })
  const record = {
    mode: staticResult.mode,
    outputHash: core.sha256Text(outputText),
    staticOk: staticResult.ok,
    staticErrors: staticResult.errors,
    compiled: false,
    clean: false,
    exitCode: null,
    logHash: '',
    flsHash: '',
    previewHash: '',
    templateHash: '',
    packages: staticResult.used.packages,
    macros: staticResult.used.macros,
    violations: staticResult.errors,
    errors: [],
  }
  if (!staticResult.ok) {
    record.errors = staticResult.errors
    return record
  }
  if (subprocessService === undefined) {
    record.errors = ['subprocess service unavailable; strict TeX compilation cannot run']
    return record
  }
  if (texMode === 'fragment') {
    const templateRel = opts.templatePath ?? contract.verification?.templatePath
    if (typeof templateRel !== 'string' || !templateRel.trim()) {
      record.errors = ['fragment mode requires a frozen project template (contract.verification.templatePath)']
      return record
    }
    const templateText = await readFileSafe(fops, absPath(baseDir, templateRel))
    if (!templateText.includes('\\begin{document}')) {
      record.errors = ['frozen template must contain \\begin{document}']
      return record
    }
    const preview = core.buildPreviewTex(outputText, templateText)
    record.previewHash = core.sha256Text(preview)
    record.templateHash = core.sha256Text(templateText)
    await fops.writeText(pathutil.resolveInside(runDir, 'preview.tex'), preview)
    const build = await strictTexBuild(fops, subprocessService, baseDir, runDir, 'preview.tex')
    record.compiled = true
    record.clean = build.clean
    record.exitCode = build.exitCode
    record.logHash = build.logHash
    record.flsHash = build.flsHash
    record.pdfHash = build.pdfHash
    record.pdfExists = build.pdfExists
    if (!build.clean) record.errors = ['strict TeX build failed with exit ' + build.exitCode + ': ' + build.logTail.slice(0, 400)]
  } else {
    const build = await strictTexBuild(fops, subprocessService, baseDir, runDir, 'output.tex')
    record.compiled = true
    record.clean = build.clean
    record.exitCode = build.exitCode
    record.logHash = build.logHash
    record.flsHash = build.flsHash
    record.pdfHash = build.pdfHash
    record.pdfExists = build.pdfExists
    if (!build.clean) record.errors = ['strict TeX build failed with exit ' + build.exitCode + ': ' + build.logTail.slice(0, 400)]
  }
  return record
}

// ── resume: artifact-format-aware step inference ───────────────────────────

// New TeX refinement runs use pass_00/A.tex and pass_N/{A,B,AB}.tex; old runs
// keep their existing .md paths (run.config.artifactFormat is the switch).
resume.inferNextStep = async function (fops, runDir, run, history = []) {
  const ext = run?.config?.artifactFormat === 'tex' ? 'tex' : 'md'
  const exists = (relPath) => fops.exists(pathutil.resolveInside(runDir, relPath))

  if (run.status === 'complete' || run.currentStep === 'complete') {
    return { step: 'complete', action: 'Run is already marked complete.', stopCriteriaMet: true }
  }
  if (await exists('final.md')) {
    return {
      step: 'final_reporting',
      action: 'final.md exists. Run autoresearch_redact_check, post externally if needed, then call autoresearch_finalize_run.',
      stopCriteriaMet: true,
    }
  }
  if (!await exists('evidence/evidence_brief.md')) {
    return { step: 'verification', action: 'Read autoreason_loop_checklist.md, finish evidence scouting, then write evidence/evidence_brief.md.' }
  }
  if (!await exists('pass_00/A.' + ext)) {
    return { step: 'initial_report', action: 'Read autoreason_loop_checklist.md, spawn the logical author, then write pass_00/A.' + ext + '.' }
  }

  const historyPasses = history
    .map((entry) => Number(entry?.pass))
    .filter((value) => Number.isInteger(value) && value >= 1)
  const newestHistoryPass = historyPasses.length > 0 ? Math.max(...historyPasses) : 0
  const configuredPass = Number(run.currentPass ?? 0)
  const pass = Math.max(configuredPass > 0 ? configuredPass : 1, newestHistoryPass > 0 ? newestHistoryPass : 1)
  const passDirName = util.passName(pass)
  const requiredArtifacts = [
    { path: passDirName + '/A.' + ext, step: passDirName + '_critic', action: 'Read autoreason_loop_checklist.md, copy incumbent into ' + passDirName + '/A.' + ext + ', then spawn critic.' },
    { path: passDirName + '/critic.md', step: passDirName + '_critic', action: 'Read autoreason_loop_checklist.md, spawn research_critic, then save critic.md.' },
    { path: passDirName + '/B.' + ext, step: passDirName + '_author_b', action: 'Read autoreason_loop_checklist.md, spawn the logical author for B, then save B.' + ext + '.' },
    { path: passDirName + '/AB.' + ext, step: passDirName + '_synthesis', action: 'Read autoreason_loop_checklist.md, spawn research_synthesizer, then save AB.' + ext + '.' },
  ]
  for (const artifact of requiredArtifacts) {
    if (!await exists(artifact.path)) return { step: artifact.step, action: artifact.action }
  }

  const judgeCount = Number(run.config?.numJudges ?? config.DEFAULT_CONFIG.numJudges)
  for (let judge = 1; judge <= judgeCount; judge += 1) {
    if (!await exists(passDirName + '/judge_' + judge + '.md')) {
      return { step: passDirName + '_judging', action: 'Read autoreason_loop_checklist.md, call autoresearch_anonymize_candidates if judge packets/maps are missing, save judge prompts, spawn or rerun judge ' + judge + ', then save ' + passDirName + '/judge_' + judge + '.md.' }
    }
  }
  for (let judge = 1; judge <= judgeCount; judge += 1) {
    if (!await exists(passDirName + '/judge_' + judge + '_candidates.md') || !await exists(passDirName + '/judge_' + judge + '_map.json')) {
      return { step: passDirName + '_judging', action: 'Read autoreason_loop_checklist.md, call autoresearch_anonymize_candidates to regenerate missing judge packets/maps, then rerun the affected judge(s) and save judge_N.md.' }
    }
  }
  if (!await exists(passDirName + '/result.json')) {
    return { step: passDirName + '_scoring', action: 'Read autoreason_loop_checklist.md, parse judge rankings, call autoresearch_score_borda, and write result.json.' }
  }

  const historyHasCurrentPass = history.some((entry) => Number(entry?.pass) === pass)
  if (!historyHasCurrentPass) {
    return {
      step: passDirName + '_scoring',
      action: passDirName + '/result.json exists but history.json has no entry for pass ' + pass + '. Update history.json and run.json from result.json, then call autoresearch_validate_resume again.',
    }
  }

  const consecutiveAWins = resume.computeConsecutiveAWins(history)
  const maxPasses = Number(run.config?.maxPasses ?? config.DEFAULT_CONFIG.maxPasses)
  const threshold = Number(run.config?.convergenceThreshold ?? config.DEFAULT_CONFIG.convergenceThreshold)
  const stopCriteriaMet = consecutiveAWins >= threshold || pass >= maxPasses
  if (stopCriteriaMet) {
    return {
      step: 'final_reporting',
      action: 'Stop criteria met (consecutiveAWins=' + consecutiveAWins + ', pass=' + pass + ', maxPasses=' + maxPasses + ', threshold=' + threshold + '). Spawn research_reporter, write final.md, run autoresearch_redact_check, post if needed, then call autoresearch_finalize_run.',
      stopCriteriaMet: true,
    }
  }

  const nextPass = pass + 1
  const nextPassDir = util.passName(nextPass)
  return {
    step: nextPassDir + '_critic',
    action: 'Pass ' + pass + ' is scored and stop criteria are not met. Start pass ' + nextPass + ': copy the current incumbent into ' + nextPassDir + '/A.' + ext + ', checkpoint currentPass=' + nextPass + ', then spawn research_critic.',
    stopCriteriaMet: false,
  }
}

// ── scoring override (plan §4.3): fail-closed blinding ─────────────────────

function baseDirOfRunDir(runDir) {
  const marker = '/.research-agent/'
  const idx = String(runDir).indexOf(marker)
  return idx === -1 ? pathutil.resolve(String(runDir), '..', '..', '..') : String(runDir).slice(0, idx)
}

// Integration-preflight readiness predicate (plan §4.4/§4.5): the project state
// journal is the authoritative completion gate; the coordinator-supplied hashes
// bind the input digest only. Every non-integration node must be journal-'done'
// AND carry non-empty contract/output/acceptance hashes.
function preflightReadyNodes(plan, journal, nodeStates) {
  const integrationId = plan?.integrationId ?? 'integration'
  const entries = {}
  for (const entry of Array.isArray(nodeStates) ? nodeStates : []) {
    if (typeof entry?.nodeId === 'string' && entry.nodeId) entries[entry.nodeId] = entry
  }
  const nodes = Array.isArray(plan?.nodes) ? plan.nodes.filter((node) => node.id !== integrationId) : []
  if (nodes.length === 0) return false
  for (const node of nodes) {
    const journalNode = util.isPlainObject(journal?.nodes) ? journal.nodes[node.id] : undefined
    if (!journalNode || journalNode.status !== 'done') return false
    const entry = entries[node.id]
    if (!entry || !entry.contractDigest || !entry.outputHash || !entry.acceptanceHash) return false
  }
  return true
}

// Reopen a node and every transitive downstream dependent in the state journal
// (plan §4.5 revision routing): statuses reset to todo, run receipts cleared.
// The helper is the single source of truth: it loads the journal itself.
async function resetDownstreamState(fops, baseDir, plan, nodeId) {
  const loaded = await projectstate.loadState(fops, baseDir, plan.projectId, plan)
  if (!util.isPlainObject(loaded) || !util.isPlainObject(loaded.state)) {
    throw new Error('Cannot reset downstream state: state journal unavailable for ' + plan.projectId)
  }
  const state = loaded.state
  const dependents = new Set([nodeId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of plan.nodes ?? []) {
      if (!dependents.has(node.id) && (node.dependsOn ?? []).some((dep) => dependents.has(dep))) {
        dependents.add(node.id)
        changed = true
      }
    }
  }
  const nodes = { ...(util.isPlainObject(state.nodes) ? state.nodes : {}) }
  const resetNodeIds = []
  for (const id of dependents) {
    const entry = util.isPlainObject(nodes[id]) ? nodes[id] : {}
    nodes[id] = {
      ...entry,
      status: 'todo',
      runDir: '',
      runStatus: '',
      currentStep: '',
      currentPass: null,
      hasFinal: false,
      finalCommentId: '',
      receipts: [],
      updatedAt: new Date().toISOString(),
    }
    resetNodeIds.push(id)
  }
  state.nodes = nodes
  state.updatedAt = new Date().toISOString()
  const statePath = loaded.path ?? projectstate.statePath(baseDir, plan.projectId)
  await fops.writeJson(statePath, state)
  return { state, path: statePath, resetNodeIds: [...resetNodeIds].sort() }
}

// Planning-mode scaffold for the planning loop's blind judging: compare-and-create
// semantics, real runs are never touched, mismatched scaffolds fail closed.
async function ensurePlanningScaffold(fops, baseDir, runDir, run, pass, judgeCount, candidateIds) {
  if (util.isPlainObject(run)) {
    if (run.planning !== true) return null // real execution run — proceed normally
    const configured = Number(run.config?.numJudges ?? 0)
    if (configured !== judgeCount) {
      throw new Error('Planning scaffold judge-count mismatch: run.json config.numJudges=' + configured + ' but this invocation requested ' + judgeCount + '. Derive the count from the same planning budget every pass.')
    }
    return { run, scaffolded: false }
  }
  const path = String(runDir)
  const marker = '/.research-agent/planning/'
  const idx = path.indexOf(marker)
  if (idx === -1) return null // not a planning directory — caller reports the missing run.json
  const rest = path.slice(idx + marker.length)
  const segments = rest.split('/').filter(Boolean)
  const projectId = segments[0] ?? ''
  const passDir = segments[segments.length - 1] ?? ''
  if (!projectId || !passDir) return null
  const passLayout = 'pass_' + String(pass).padStart(2, '0')
  const planLayout = 'plan_' + String(pass).padStart(2, '0')
  let candidateLayout = ''
  for (const layout of [passLayout, planLayout]) {
    for (const id of candidateIds) {
      if (await fops.exists(pathutil.resolveInside(runDir, layout + '/' + id + '.md'))) {
        candidateLayout = layout
        break
      }
    }
    if (candidateLayout) break
  }
  if (!candidateLayout) return null
  const scaffoldRun = {
    runId: passDir,
    planning: true,
    projectId,
    pass,
    candidateLayout,
    status: 'planning',
    currentStep: 'planning_judging',
    config: { numScouts: 0, numJudges: judgeCount, maxPasses: 2, convergenceThreshold: 2 },
  }
  const runPath = pathutil.resolveInside(runDir, 'run.json')
  if (await fops.exists(runPath)) {
    const existing = await fops.readJson(runPath)
    if (!util.isPlainObject(existing)) return { run: scaffoldRun, scaffolded: false }
    if (existing.planning !== true) return null
    const configured = Number(existing.config?.numJudges ?? 0)
    if (configured !== judgeCount) {
      throw new Error('Planning scaffold judge-count mismatch: run.json config.numJudges=' + configured + ' but this invocation requested ' + judgeCount + '.')
    }
    return { run: existing, scaffolded: false }
  }
  try {
    await fops.writeTextNew(runPath, JSON.stringify(scaffoldRun, null, 2) + '\n')
  } catch (error) {
    if (!util.isAlreadyExistsError(error)) throw error
    const existing = await fops.readJson(runPath)
    if (util.isPlainObject(existing) && existing.planning === true) {
      const configured = Number(existing.config?.numJudges ?? 0)
      if (configured !== judgeCount) {
        throw new Error('Planning scaffold judge-count mismatch: run.json config.numJudges=' + configured + ' but this invocation requested ' + judgeCount + '.')
      }
      return { run: existing, scaffolded: false }
    }
    return null
  }
  return { run: scaffoldRun, scaffolded: true }
}

scoring.anonymizeCandidates = async function (fops, params) {
  const runDir = pathutil.resolve(params.runDir)
  const pass = util.requiredPositiveInteger(params.pass, 'pass')
  const judgeCount = util.requiredPositiveInteger(params.judgeCount, 'judgeCount')
  const candidateIds = util.nonEmptyStringArray(params.candidateIds, ['A', 'B', 'AB'])
  const { run, contractFile } = await readRunAndDigest(fops, runDir)
  const planningScaffold = await ensurePlanningScaffold(fops, baseDirOfRunDir(runDir), runDir, run, pass, judgeCount, candidateIds)
  if (!util.isPlainObject(run) && !planningScaffold) throw new Error('run.json must exist before anonymization.')
  const effectiveRun = util.isPlainObject(run) ? run : planningScaffold.run
  const artifactFormat = contractFile?.artifactFormat ?? effectiveRun?.config?.artifactFormat ?? 'markdown'
  // Canonical candidate-path map: defaults filled in so the digest binds the
  // real paths; alias layout (plan_N/) resolved when pass_N/ is absent.
  const effectiveCandidatePaths = {}
  let usedLayout = 'pass_' + String(pass).padStart(2, '0')
  for (const id of candidateIds) {
    if (typeof (util.isPlainObject(params.candidatePaths) ? params.candidatePaths : {})[id] === 'string') {
      effectiveCandidatePaths[id] = params.candidatePaths[id]
      continue
    }
    const ext = artifactFormat === 'tex' ? 'tex' : 'md'
    const passPath = usedLayout + '/' + id + '.' + ext
    if (await fops.exists(pathutil.resolveInside(runDir, passPath))) {
      effectiveCandidatePaths[id] = passPath
      continue
    }
    const planLayout = 'plan_' + String(pass).padStart(2, '0')
    const planPath = planLayout + '/' + id + '.' + ext
    if (await fops.exists(pathutil.resolveInside(runDir, planPath))) {
      usedLayout = planLayout
      effectiveCandidatePaths[id] = planPath
      continue
    }
    effectiveCandidatePaths[id] = passPath
  }
  const contents = {}
  for (const id of candidateIds) {
    contents[id] = await fops.readText(pathutil.resolveInside(runDir, effectiveCandidatePaths[id]))
  }
  // Build every packet in memory; any identity leak throws BEFORE any
  // dispatchable file is written (fail closed).
  const built = core.buildBlindPackets({
    pass,
    judgeCount,
    candidateIds,
    candidatePaths: effectiveCandidatePaths,
    pathsCanonical: true,
    contents,
    anonymizedLabels: params.anonymizedLabels,
    seed: params.seed ?? '',
    runId: effectiveRun?.runId,
    projectId: contractFile?.projectId,
    nodeId: contractFile?.nodeId,
    runDigest: computeRunDigest(effectiveRun, contractFile),
    artifactFormat,
  })
  for (const entry of built.judges) {
    await fops.writeText(pathutil.resolveInside(runDir, entry.packetPath), entry.packetText)
    const map = {
      pass,
      judge: entry.judge,
      labels: entry.anonymizedToOriginal ? Object.keys(entry.anonymizedToOriginal) : [],
      anonymizedToOriginal: entry.anonymizedToOriginal,
      originalToAnonymized: entry.originalToAnonymized,
      runDigest: built.runDigest,
      passDigest: built.passDigest,
      candidateSetDigest: built.candidateSetDigest,
      judgeCount: built.judges.length > 0 ? judgeCount : undefined,
      pathsCanonical: true,
      candidatePaths: effectiveCandidatePaths,
      createdAt: new Date().toISOString(),
    }
    // Hash the exact written map payload, excluding the volatile timestamp.
    const { createdAt, ...mapPayload } = map
    const mapHash = core.sha256Text(core.stableStringify(mapPayload))
    await fops.writeJson(pathutil.resolveInside(runDir, entry.mapPath), map)
  }
  return {
    runDir,
    pass,
    candidateIds,
    candidateLayout: usedLayout,
    runDigest: built.runDigest,
    passDigest: built.passDigest,
    candidateSetDigest: built.candidateSetDigest,
    judges: built.judges.map((entry) => {
      const map = {
        pass,
        judge: entry.judge,
        labels: entry.anonymizedToOriginal ? Object.keys(entry.anonymizedToOriginal) : [],
        anonymizedToOriginal: entry.anonymizedToOriginal,
        originalToAnonymized: entry.originalToAnonymized,
        runDigest: built.runDigest,
        passDigest: built.passDigest,
        candidateSetDigest: built.candidateSetDigest,
        judgeCount,
        pathsCanonical: true,
        candidatePaths: effectiveCandidatePaths,
        createdAt: entry.createdAt ?? new Date().toISOString(),
      }
      const { createdAt, ...mapPayload } = map
      return {
        judge: entry.judge,
        packetPath: entry.packetPath,
        mapPath: entry.mapPath,
        packetHash: entry.packetHash,
        mapHash: core.sha256Text(core.stableStringify(mapPayload)),
        packetRef: entry.packetRef,
        mapRef: entry.mapRef,
      }
    }),
    candidateIdentityScrubbed: true,
    scannedPatterns: built.scannedPatterns,
    findings: built.findings,
    instruction: 'Use each judge_N_candidates.md as the anonymized report block; pass the typed packetRef to judge spawning. Candidate/report A/B/AB self-identifiers are scrubbed; do not include judge_N_map.json in judge prompts.',
  }
}

// ── scoring override: Borda with tie-break provenance ──────────────────────

scoring.scoreBorda = function (params) {
  return core.scoreBorda(params)
}

// ── init_run override: v2 contract binding (plan §4.3) ─────────────────────

const _initRun = lifecycle.initRun
lifecycle.initRun = async function (fops, params, presetConfigPath) {
  const result = await _initRun(fops, params, presetConfigPath)
  const baseDir = pathutil.resolve(params.baseDir ?? '.')
  const runDir = pathutil.resolve(baseDir, result.runDir)
  const bound = typeof params.projectId === 'string' && params.projectId.trim() && typeof params.nodeId === 'string' && params.nodeId.trim()
  if (!bound) {
    return { ...result, contract: null, unbound: true, instruction: 'Legacy unbound run: readable and resumable, but it cannot claim v2 mechanical acceptance (plan §4.3).' }
  }
  const projectId = params.projectId.trim()
  const nodeId = params.nodeId.trim()
  const plan = await projectstate.loadPlan(fops, baseDir, projectId)
  if (!plan.ok) throw new Error('Cannot bind run to node: ' + plan.error)
  const validation = core.validatePlan(plan.plan)
  if (!validation.ok) {
    throw new Error('Cannot bind run to node: approved plan is invalid for new execution: ' + validation.errors.slice(0, 5).join('; ') + '. Run autoresearch_migration_diagnostic and approve a new plan revision before executing.')
  }
  if (validation.schemaVersion !== core.PLAN_SCHEMA_VERSION_V2) {
    throw new Error('Cannot bind a new run to a v1 plan: execution is blocked until an approved v2 plan revision exists (plan §4.3 compatibility). Run autoresearch_migration_diagnostic.')
  }
  const contract = validation.contracts[nodeId]
  if (!contract) throw new Error('Unknown node id for contract binding: ' + nodeId)
  const contractFile = {
    schemaVersion: 2,
    kind: 'node-contract',
    projectId,
    projectName: plan.plan.projectName ?? '',
    nodeId,
    planRevision: validation.revision,
    contractDigest: contract.digest,
    artifactFormat: contract.artifactFormat,
    writtenAt: new Date().toISOString(),
    contract,
  }
  await fops.writeJson(pathutil.resolveInside(runDir, 'node-contract.json'), contractFile)
  const runPath = pathutil.resolveInside(runDir, 'run.json')
  const run = await fops.readJson(runPath)
  if (util.isPlainObject(run)) {
    run.contract = {
      bound: true,
      projectId,
      nodeId,
      planRevision: validation.revision,
      contractDigest: contract.digest,
      schemaVersion: 2,
      artifactFormat: contract.artifactFormat,
    }
    // The immutable contract budget is authoritative: overwrite the four
    // scalar keys and scrub nested budget aliases so no caller/project
    // override (flat or nested) can reintroduce unauthorized values.
    const budget = util.isPlainObject(contract.effectiveBudget) ? contract.effectiveBudget : {}
    const mergedConfig = { ...(util.isPlainObject(run.config) ? run.config : {}) }
    for (const key of ['numScouts', 'numJudges', 'maxPasses', 'convergenceThreshold']) {
      if (typeof budget[key] === 'number') mergedConfig[key] = budget[key]
    }
    delete mergedConfig.budget
    delete mergedConfig.runBudget
    mergedConfig.artifactFormat = contract.artifactFormat
    run.config = mergedConfig
    run.updatedAt = new Date().toISOString()
    await fops.writeJson(runPath, run)
    // Keep the run's config.json in sync so loadRunConfig reloads cannot
    // resurrect pre-contract values.
    const configPath = pathutil.resolveInside(runDir, 'config.json')
    const runConfig = await fops.readJson(configPath)
    const synced = { ...(util.isPlainObject(runConfig) ? runConfig : {}) }
    for (const key of ['numScouts', 'numJudges', 'maxPasses', 'convergenceThreshold']) {
      if (typeof budget[key] === 'number') synced[key] = budget[key]
    }
    delete synced.budget
    delete synced.runBudget
    if (util.isPlainObject(runConfig) || typeof budget.numScouts === 'number' || typeof budget.numJudges === 'number') {
      await fops.writeJson(configPath, synced)
    }
  }
  return {
    ...result,
    contract: run.contract ?? { bound: true, projectId, nodeId, planRevision: validation.revision, contractDigest: contract.digest, schemaVersion: 2, artifactFormat: contract.artifactFormat },
    unbound: false,
    instruction: 'Contract-bound run: node-contract.json written with digest ' + contract.digest + '. Every role task, acceptance, and finalization is bound to this contract.',
  }
}

// ── finalize_run override: v2 acceptance gate (plan §4.3) ──────────────────

const _finalizeRun = lifecycle.finalizeRun
lifecycle.finalizeRun = async function (fops, params) {
  const baseDir = pathutil.resolve(params.baseDir ?? '.')
  const runDir = pathutil.resolve(params.runDir)
  const contractFile = await loadRunContract(fops, runDir)
  if (contractFile) {
    const acceptance = await loadAcceptance(fops, runDir)
    const outputName = contractFile.artifactFormat === 'tex' ? 'output.tex' : 'final.md'
    const outputHash = await hashFile(fops, pathutil.resolveInside(runDir, outputName))
    if (!core.acceptanceIsCurrent(acceptance, contractFile.contractDigest, outputHash)) {
      throw new Error('v2 run cannot finalize without a current successful acceptance receipt bound to the node-contract digest (plan §4.3). Call autoresearch_record_acceptance and retry.')
    }
  }
  const result = await _finalizeRun(fops, params)
  return {
    ...result,
    v2: contractFile ? { bound: true, gate: 'passed', contractDigest: contractFile.contractDigest, artifactFormat: contractFile.artifactFormat } : { bound: false, gate: 'legacy' },
  }
}

// ── spec-block drift enrichment (plan §4.5) ────────────────────────────────

// Enrich a reconciliation row with generated-spec-block drift and the
// deterministic legacy Linear-state fallback source. Pure read-only logic on
// top of the installed reconciliation; never rewrites plan or state.
async function enrichReconciliationRow(fops, baseDir, plan, state, stateEntry, issue, row) {
  const drift = [...(row.drift ?? [])]
  const contract = core.nodeContract(plan, row.id)
  const planDigest = core.planContractDigest(plan)
  const expectedBlock = core.renderSpecBlock(contract, { projectDigest: planDigest })
  const description = typeof issue?.description === 'string' ? issue.description : ''
  const spec = core.parseSpecBlock(description)
  const specBlock = {
    present: spec !== null,
    matchesContract: spec !== null && spec.contractDigest === contract.digest,
    digest: spec?.contractDigest ?? '',
    planRevision: spec?.planRevision ?? null,
  }
  if (issue && spec === null) drift.push('spec-block-missing')
  if (issue && spec !== null && spec.contractDigest !== contract.digest) drift.push('spec-block-modified')
  if (issue && spec !== null && spec.planRevision !== contract.planRevision) drift.push('spec-block-stale-revision')
  if (issue && spec !== null && spec.planDigest && spec.planDigest !== planDigest) drift.push('spec-block-stale-plan-digest')

  const run = stateEntry && typeof stateEntry.runDir === 'string' && stateEntry.runDir
    ? await fops.readJson(pathutil.resolve(baseDir, pathutil.resolveInside(baseDir, stateEntry.runDir), 'run.json'))
    : undefined
  if (util.isPlainObject(run) && run.linear && run.linear.state === '') {
    const fallback = core.legacyLinearStateFallback(run, {
      nodeStateReceipt: (typeof stateEntry?.linearState === 'string' && stateEntry.linearState) ? stateEntry.linearState : '',
    })
    row.linearStateFallback = fallback
  }

  // Open revision requests for this node (state journal, never rewritten).
  const revisionDir = pathutil.join(projectstate.projectDir(baseDir, plan.projectId), 'revision-requests')
  const requests = await fops.listDir(revisionDir)
  const openRequests = requests
    .filter((entry) => !entry.dir && entry.name.startsWith(row.id + '-') && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
  if (openRequests.length > 0) {
    drift.push('revision-request-open')
    row.revisionRequests = openRequests
    // A request whose epoch is older than the current integration epoch is
    // stale (plan §4.5): the revision round it belongs to has moved on.
    const currentEpoch = Number(state?.integration?.epoch) || 0
    if (currentEpoch > 0) {
      const staleEpochs = openRequests.some((name) => {
        const match = name.match(/^(.*)-(\d+)-[0-9a-f]{64}\.json$/)
        return match && Number(match[2]) < currentEpoch
      })
      if (staleEpochs) drift.push('revision-request-stale')
    }
  }

  // Stale node contract/output/acceptance hashes (plan §4.5): the state
  // entry's run must carry a node-contract.json and acceptance.json bound to
  // the CURRENT plan contract; drift is reported, never rewritten.
  if (stateEntry && typeof stateEntry.runDir === 'string' && stateEntry.runDir) {
    const runAbs = pathutil.resolve(baseDir, pathutil.resolveInside(baseDir, stateEntry.runDir))
    const nodeContract = await fops.readJson(pathutil.resolveInside(runAbs, 'node-contract.json'))
    if (nodeContract && nodeContract.contractDigest !== contract.digest) {
      drift.push('node-contract-stale')
    }
    const acceptance = await fops.readJson(pathutil.resolveInside(runAbs, 'acceptance.json'))
    if (acceptance) {
      if (acceptance.nodeContractDigest !== contract.digest) {
        drift.push('node-acceptance-stale')
      } else {
        const outputName = contract.artifactFormat === 'tex' ? 'output.tex' : 'final.md'
        const outputHash = await hashFile(fops, pathutil.resolveInside(runAbs, outputName))
        if (outputHash && acceptance.outputHash && outputHash !== acceptance.outputHash) {
          drift.push('node-output-stale')
        }
      }
    } else if (stateEntry.status === 'done') {
      drift.push('node-receipt-missing')
    }
  }

  return { ...row, drift: [...new Set(drift)], specBlock, expectedSpecBlock: expectedBlock }
}

// ── build probe (plan §4.5 / WP5) ──────────────────────────────────────────

// Read the manifest from disk (cat), recompute disk hashes (shasum) for every
// recorded path, and compare the recomputed aggregate against the embedded
// candidate ID. Runs through the subprocess service because the plugin's fs
// view cannot read outside the workspace.
async function runBuildProbe(subprocessService, baseDir) {
  const cat = await resolveExecutable(subprocessService, 'cat')
  const manifestResult = await runSubprocess(subprocessService, baseDir, [cat, MANIFEST_PATH])
  let manifest = null
  try {
    manifest = JSON.parse(manifestResult.stdout)
  } catch {
    return { probeName: 'build-probe', graphMatches: false, mismatches: ['build-manifest.json unreadable or invalid'], manifest: null }
  }
  const shasum = await resolveExecutable(subprocessService, 'shasum')
  // Manifest paths are relative to the preset root, not the caller's
  // workspace. Derive that root from the absolute manifest URL so default
  // probes work from any session workspace.
  const presetRoot = pathutil.dirname(pathutil.dirname(MANIFEST_PATH))
  const graph = {}
  const failures = []
  for (const [relPath, expectedHash] of Object.entries(manifest.files ?? {})) {
    try {
      const result = await runSubprocess(subprocessService, baseDir, [shasum, '-a', '256', absPath(presetRoot, relPath)])
      const match = String(result.stdout).match(/^([0-9a-f]{64})\s+/m)
      if (!match) {
        failures.push(relPath + ': shasum produced no hash')
        continue
      }
      graph[relPath] = match[1]
      if (match[1] !== expectedHash) failures.push(relPath + ': hash mismatch')
    } catch (error) {
      failures.push(relPath + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const scope = Array.isArray(manifest.aggregateScope) ? manifest.aggregateScope : Object.keys(graph)
  const scopeGraph = {}
  for (const rel of scope) {
    if (graph[rel] !== undefined) scopeGraph[rel] = graph[rel]
  }
  const aggregate = core.aggregateBuildId(scopeGraph)
  const graphMatches = aggregate === manifest.aggregateId && failures.length === 0 && EMBEDDED_BUILD_ID === manifest.aggregateId
  return {
    probeName: 'build-probe',
    generation: manifest.generation,
    schemaVersion: manifest.schemaVersion,
    expectedAggregateId: manifest.aggregateId,
    embeddedAggregateId: EMBEDDED_BUILD_ID,
    actualAggregateId: aggregate,
    graphMatches,
    graph,
    mismatches: failures,
    mountedUrl: import.meta.url,
  }
}


// ── node contract + receipt prepend for role tasks (plan §4.3) ─────────────

async function buildRoleTaskBase(fops, baseDir, runDirInput) {
  const parts = []
  if (typeof runDirInput === 'string' && runDirInput.trim()) {
    const runDir = absPath(baseDir, runDirInput)
    parts.push('Workspace root: ' + baseDir)
    parts.push('AutoResearch run artifact root: ' + runDir)
    parts.push('Resolve paths beginning with evidence/, pass_*, packets/, issue.md, comments.md, run.json, history.json, resume.md, or autoreason_loop_checklist.md relative to the run artifact root, not the workspace root.')
    const contractFile = await loadRunContract(fops, runDir)
    if (contractFile) {
      const contract = util.isPlainObject(contractFile.contract) ? contractFile.contract : null
      parts.push('')
      parts.push('## Bound node contract (immutable; this task executes against it)')
      parts.push('Project: ' + contractFile.projectId + ' · Node: ' + contractFile.nodeId + ' · Plan revision: ' + contractFile.planRevision)
      parts.push('Contract digest: ' + contractFile.contractDigest)
      parts.push('Kind: ' + (contract?.kind ?? 'research') + ' · Artifact format: ' + contractFile.artifactFormat)
      parts.push('Expected outcome: ' + (contract?.expectedOutcome ?? ''))
      parts.push('Acceptance criteria:')
      for (const criterion of contract?.acceptance ?? []) {
        parts.push('- [' + criterion.id + '] ' + criterion.text)
      }
      parts.push('Test approach: ' + (contract?.test ?? ''))
      parts.push('Effective budget: ' + JSON.stringify(contract?.effectiveBudget ?? {}))
      const acceptance = await loadAcceptance(fops, runDir)
      if (acceptance) {
        parts.push('')
        parts.push('## Current acceptance receipt')
        parts.push('Overall: ' + acceptance.overall + ' · Receipt hash: ' + acceptance.receiptHash + ' · Issued: ' + acceptance.issuedAt)
      }
    }
  }
  return parts.join('\n')
}

// ── PLUGIN OBJECT ──────────────────────────────────────────────────────────

const ORCHESTRATOR_PLUGIN = {
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    const web = ctx.get('web')
    const subagents = ctx.get('subagents')
    const subprocess = ctx.get('subprocess')
    const sandboxPolicy = ctx.get('sandboxPolicy')

    // ── helpers ────────────────────────────────────────────────────────────

    function abs(baseDir, p) {
      const base = pathutil.normalize(baseDir)
      const value = String(p)
      if (pathutil.isAbsolute(value)) return pathutil.normalize(value)
      return pathutil.join(base, value)
    }

    function makeFops(baseDir) {
      async function targetOf(p) {
        return await fs.resolve(p, { cwd: pathutil.normalize(baseDir) })
      }
      return {
        readText: async (p) => await fs.readText(await targetOf(p)),
        readBytes: async (p, maxBytes) => {
          if (typeof fs.readBytes !== 'function') throw new Error('READ_BYTES_UNAVAILABLE')
          return await fs.readBytes(await targetOf(p), undefined, maxBytes)
        },
        writeText: async (p, content) => { await fs.writeText(await targetOf(p), content) },
        writeTextNew: async (p, content) => {
          try {
            await fs.writeText(await targetOf(p), content, { kind: 'createIfAbsent' })
          } catch (error) {
            if (error && (error.code === 'FS_NOT_OBSERVED' || error.code === 'EEXIST')) {
              const wrapped = new Error('File already exists')
              wrapped.code = 'EEXIST'
              throw wrapped
            }
            throw error
          }
        },
        exists: async (p) => (await fs.stat(await targetOf(p))) !== undefined,
        listDir: async (p) => {
          let entries
          try {
            entries = await fs.listDir(await targetOf(p))
          } catch {
            return []
          }
          return entries
            .map((entry) => ({ name: entry.name, dir: entry.type === 'directory' }))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        },
        remove: async (p) => {
          if (subprocess === undefined) throw new Error('subprocess service unavailable; cannot remove lock file')
          const rm = await subprocess.resolveExecutable('/bin/rm')
          const handle = subprocess.spawn({
            argv: [rm, '-f', p],
            cwd: pathutil.normalize(baseDir),
            stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
            graceMs: 5000,
          })
          await handle.done
        },
        readJson: async (p) => {
          try {
            return JSON.parse(await fs.readText(await targetOf(p)))
          } catch {
            return undefined
          }
        },
        writeJson: async (p, value) => {
          await fs.writeText(await targetOf(p), JSON.stringify(value, null, 2) + '\n')
        },
      }
    }

    async function liveModelCatalog() {
      const llm = ctx.get('llm')
      if (llm === undefined) return null
      const providers = await llm.listProviders()
      const models = []
      for (const p of providers) {
        try {
          const list = await llm.listModels(p.id)
          for (const m of list) models.push({ provider: p.id, id: m.id, name: m.name, description: m.description })
        } catch {
          // provider without a listable catalog — skip
        }
      }
      return { providers, models, registry: modelRegistry.fromLists(providers, models) }
    }

    function sessionBaseDir(exec, params) {
      if (typeof params?.baseDir === 'string' && params.baseDir.trim()) return pathutil.normalize(params.baseDir)
      const cwd = exec?.agent?.session?.header?.cwd
      if (typeof cwd === 'string' && cwd) return pathutil.normalize(cwd)
      if (typeof sandboxPolicy?.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot) return pathutil.normalize(sandboxPolicy.workspaceRoot)
      return '.'
    }

    function assertCallingAgent(exec) {
      if (exec?.agent === undefined) throw new Error('This tool requires a calling agent.')
    }

    function assertCoordinator(exec) {
      assertCallingAgent(exec)
      const depth = Number(exec.agent?.session?.header?.delegationDepth ?? 0)
      if (depth > 0) throw new Error('This tool must be called by the coordinator, not a subagent child.')
    }

    async function resolveRolePrompt(roleProfile, roleArg, baseDir, fops) {
      return await rolePrompt.resolveRolePrompt(fops, {
        roleName: roleProfile.role,
        roleArg,
        promptFile: roleProfile?.promptFile ?? null,
        baseDir,
        presetRolesDir: PRESET_ROLES_DIR,
        embedded: embeddedRolePrompts,
      })
    }

    async function loadConfigFor(fops, baseDir, runDirInput) {
      const projectCfg = await config.loadProjectConfig(fops, baseDir, { presetConfigPath: PRESET_CONFIG_PATH })
      if (typeof runDirInput === 'string' && runDirInput.trim()) {
        return await config.loadRunConfig(fops, abs(baseDir, runDirInput), projectCfg)
      }
      return projectCfg
    }

    // ── tool registration helper ───────────────────────────────────────────

    function registerTool(definition) {
      if (typeof harness !== 'undefined' && harness && typeof harness.defineTool === 'function' && typeof harness.registerTool === 'function') {
        harness.registerTool(ctx, harness.defineTool(definition))
        return
      }
      const tools = ctx.get('tools')
      if (tools === undefined) throw new Error('tools registry unavailable')
      tools.register(definition)
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

    function str(description) {
      return { type: 'string', description }
    }

    // ── 1. init_run (contract-bound for new Project Mode runs) ─────────────

    tool('autoresearch_init_run', 'Create a resumable AutoResearch artifact directory for a Linear issue or local markdown brief. For new Project Mode runs, pass projectId+nodeId: the approved plan is loaded and node-contract.json is written with its digest, binding every role task, acceptance, and finalization to the immutable contract.', {
      type: 'object', additionalProperties: true,
      properties: {
        issueId: str('Linear issue id or local run id, e.g. ISS-123 or my-brief'),
        issueTitle: str('Issue/brief title for the run metadata'),
        issueMarkdown: str('Markdown snapshot of the issue/brief body'),
        commentsMarkdown: str('Markdown snapshot of relevant comments'),
        sourceType: str('linear or local. Defaults to local in DSH.'),
        sourcePath: str('Optional local markdown brief path relative to the workspace root'),
        sourceUrl: str('Optional original source URL for provenance'),
        runId: str('Optional run id. Defaults to a UTC timestamp plus issue id.'),
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        forceRecovery: { type: 'boolean', description: 'Override an existing lock after explicit human recovery approval.' },
        config: { type: 'object', additionalProperties: true, description: 'Run config overrides merged over project/default config.' },
        projectId: str('Approved plan project id (v2 Project Mode binding).'),
        nodeId: str('Plan node id (v2 Project Mode binding).'),
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const result = await lifecycle.initRun(fops, { ...args, baseDir }, PRESET_CONFIG_PATH)
      for (const role of config.ALL_RESEARCH_ROLES) {
        if (role === 'implementation_worker' || role === 'review_worker') continue
        const target = abs(baseDir, '.research-agent/roles/' + role + '.md')
        if (await fops.exists(target)) continue
        const profile = profiles.resolveEffectiveProfile(role, result.config)
        const resolved = await resolveRolePrompt(profile, role, baseDir, fops)
        await fops.writeText(target, resolved.text)
      }
      return result
    })

    // ── 2. anonymize_candidates (fail-closed blinding) ─────────────────────

    tool('autoresearch_anonymize_candidates', 'Create judge-specific anonymized candidate packets and reversible maps for A/B/AB reports. Every packet is built in memory, identity-scrubbed, and scanned before any file is written; a leak fails closed with zero dispatchable artifacts. Returns typed packetRef/mapRef values bound to the run/pass/candidate digests.', {
      type: 'object', additionalProperties: true,
      properties: {
        runDir: { type: 'string', description: 'Run directory, e.g. .research-agent/runs/ISS-1/<run-id>' },
        pass: { type: 'number', description: 'AutoReason pass number' },
        judgeCount: { type: 'number', description: 'Number of blind judges (1-25)' },
        candidateIds: { type: 'array', items: { type: 'string' }, description: 'Original candidate ids. Defaults to A, B, AB.' },
        candidatePaths: { type: 'object', additionalProperties: true, description: 'Optional candidate file path overrides keyed by candidate id.' },
        anonymizedLabels: { type: 'array', items: { type: 'string' } },
        seed: str('Deterministic shuffle seed.'),
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const runDir = abs(baseDir, args.runDir)
      return await scoring.anonymizeCandidates(fops, { ...args, runDir, baseDir })
    })

    // ── 3. parse_ranking ───────────────────────────────────────────────────

    tool('autoresearch_parse_ranking', "Parse a judge response into an ordered ranking and optionally map anonymized labels back to original candidate ids.", {
      type: 'object', additionalProperties: true,
      properties: {
        text: { type: 'string', description: 'Judge response text containing a RANKING: line.' },
        allowedLabels: { type: 'array', items: { type: 'string' }, description: 'Expected labels (anonymized or original).' },
        anonymizedToOriginal: { type: 'object', additionalProperties: true, description: 'Optional anonymized -> original label map.' },
      },
    }, async (args) => {
      return scoring.parseRanking(args.text ?? '', args.allowedLabels ?? [], args.anonymizedToOriginal)
    })

    // ── 4. score_borda (with tie-break provenance) ─────────────────────────

    tool('autoresearch_score_borda', 'Compute Borda scores and conservative tie-breaks for AutoReason judge rankings. Records the tied set, configured priority, selected priority entry/index, and fallback status (plan §4.3).', {
      type: 'object', additionalProperties: true,
      properties: {
        judgeRankings: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: true,
            properties: {
              judge: { type: 'string' },
              ranking: { type: 'array', items: { type: 'string' } },
            },
          },
          description: 'Parsed judge rankings.',
        },
        candidateIds: { type: 'array', items: { type: 'string' } },
        bordaScores: { type: 'array', items: { type: 'number' } },
        tieBreakPriority: { type: 'array', items: { type: 'string' } },
        pass: { type: 'number', description: 'Pass number.' },
        notes: str('Optional notes recorded on the result.'),
      },
    }, async (args) => {
      return scoring.scoreBorda(args)
    })

    // ── 5. validate_resume ─────────────────────────────────────────────────

    tool('autoresearch_validate_resume', 'Validate run.json/history.json/resume.md and infer the next missing AutoResearch step (artifact-format aware: TeX runs use .tex candidates).', {
      type: 'object', additionalProperties: true,
      properties: { runDir: { type: 'string', description: 'Run directory path.' } },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      return await resume.validateResume(fops, abs(baseDir, args.runDir))
    })

    // ── 6. regenerate_checklist ────────────────────────────────────────────

    tool('autoresearch_regenerate_checklist', 'Recreate autoreason_loop_checklist.md for an existing run using the run stored config.', {
      type: 'object', additionalProperties: true,
      properties: { runDir: { type: 'string', description: 'Run directory path.' } },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      return await lifecycle.regenerateChecklist(fops, abs(baseDir, args.runDir))
    })

    // ── 7. checkpoint ──────────────────────────────────────────────────────

    tool('autoresearch_checkpoint', 'Atomically update run.json and resume.md after a completed substep, optionally appending history.', {
      type: 'object', additionalProperties: true,
      properties: {
        runDir: { type: 'string', description: 'Run directory path.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        currentStep: str('Current step name.'),
        currentPass: { type: 'number', description: 'Current pass number.' },
        consecutiveAWins: { type: 'number', description: 'Consecutive A wins counter.' },
        incumbentPath: str('Path of the current incumbent artifact.'),
        status: str('Run status string.'),
        nextAction: str('Short instruction for the next substep.'),
        historyEntry: { type: 'object', additionalProperties: true, description: 'History entry for one pass (upserted by pass).' },
        history: { type: 'array', description: 'Full replacement history array.' },
        linearPatch: { type: 'object', additionalProperties: true, description: 'Fields merged into run.linear.' },
        patch: { type: 'object', additionalProperties: true, description: 'Fields merged into the run state.' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      return await lifecycle.checkpointRun(fops, { ...args, runDir: abs(baseDir, args.runDir), baseDir })
    })

    // ── 8. presearch ───────────────────────────────────────────────────────

    tool('autoresearch_presearch', 'Normalize search/fetch results into auditable evidence/sources packets; optionally performs the search/fetch itself when queries/fetchUrls are given.', {
      type: 'object', additionalProperties: true,
      properties: {
        runDir: { type: 'string', description: 'Run directory path.' },
        slice: { type: 'string', description: 'Short slice name for the packet.' },
        queries: { type: 'array', items: { type: 'string' }, description: 'Search queries (direct mode).' },
        results: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Coordinator-collected search results (normalizer mode).' },
        fetchUrls: { type: 'array', items: { type: 'string' }, description: 'URLs to fetch (direct mode).' },
        fetches: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Coordinator-collected fetch records (normalizer mode).' },
        collectedBy: str('Label recorded in the packet.'),
        externalResearch: { type: 'boolean', description: 'Override the externalResearch flag.' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const runDir = abs(baseDir, args.runDir)
      const cfg = await config.loadRunConfig(fops, runDir)
      const externalResearch = args.externalResearch ?? (cfg.externalResearch !== false)
      const queries = Array.isArray(args.queries) ? args.queries : []
      const fetchUrls = Array.isArray(args.fetchUrls) ? args.fetchUrls : []
      const wantsDirect = queries.length > 0 || fetchUrls.length > 0

      let results = Array.isArray(args.results) ? args.results : []
      let fetches = Array.isArray(args.fetches) ? args.fetches : []
      let direct = false
      let directErrors = []

      if (wantsDirect) {
        if (externalResearch === false) throw new Error('autoresearch_presearch direct mode refused: externalResearch=false for this run.')
        if (web === undefined) throw new Error('autoresearch_presearch direct mode unavailable: no web service in this deployment.')
        direct = true
        directErrors = []
        const collected = []
        for (const query of queries) {
          try {
            const search = await web.search({ query, maxResults: 8 })
            for (const source of search.sources ?? []) {
              collected.push({ url: source.url, title: source.title, excerpt: source.snippet, whyRelevant: query })
            }
          } catch (error) {
            directErrors.push({ kind: 'search', input: query, error: error instanceof Error ? error.message : String(error) })
          }
        }
        results = collected
        const fetched = []
        for (const url of fetchUrls) {
          try {
            const fetchedPage = await web.fetch({ url })
            const body = fetchedPage?.body?.content ?? ''
            fetched.push({
              url: fetchedPage?.url ?? url,
              title: url,
              excerpt: typeof body === 'string' ? body.slice(0, 6000) : '',
              retrievedAt: new Date().toISOString(),
              statusCode: fetchedPage?.statusCode,
              truncated: fetchedPage?.truncated === true,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            directErrors.push({ kind: 'fetch', input: url, error: message })
            fetched.push({
              url,
              title: url,
              excerpt: '',
              retrievedAt: new Date().toISOString(),
              error: message,
            })
          }
        }
        fetches = fetched
      }

      try {
        const written = await presearch.presearchWrite(fops, {
          runDir,
          slice: args.slice,
          queries,
          results,
          fetches,
          collectedBy: args.collectedBy ?? 'coordinator',
          externalResearch,
        })
        return { ok: true, direct, directErrors, ...written }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })

    // ── 9. spawn_role (planner/audit only, contract-aware) ────────────────

    tool('autoresearch_spawn_role', 'Build a profile-aware role spawn plan/audit. Returns the recommended autoresearch_run_role call. Does not spawn. When runDir is supplied the exact node contract, workspace root, run root, artifact format, and relevant prior receipts are prepended automatically; caller task text cannot replace the contract.', {
      type: 'object', additionalProperties: true,
      properties: {
        role: { type: 'string', description: 'Role name, e.g. research_scout or scout.' },
        task: { type: 'string', description: 'The role task text.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        runDir: str('Run directory path (for config + audit packet).'),
        judgeIndex: { type: 'number', description: 'Judge index for judgePanel model resolution.' },
        packetRef: { type: 'object', additionalProperties: true, description: 'Typed blind-packet reference from autoresearch_anonymize_candidates (judge spawning only).' },
        candidateIds: { type: 'array', items: { type: 'string' }, description: 'Candidate ids matching the packetRef.' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const cfg = await loadConfigFor(fops, baseDir, args.runDir)
      const role = profiles.resolveEffectiveProfile(args.role, cfg, { judgeIndex: args.judgeIndex })
      const runRoot = args.runDir ? abs(baseDir, args.runDir) : null
      let task = ''
      if (runRoot) {
        task = await buildRoleTaskBase(fops, baseDir, args.runDir)
        if (util.isPlainObject(args.packetRef)) {
          task += await buildJudgePacketTask(fops, baseDir, runRoot, args)
        } else if (args.task) {
          task += '\n\n' + args.task
        }
      } else {
        task = args.task
      }
      const plan = spawn.buildSpawnPlan({ role: args.role, task, profile: role, judgeIndex: args.judgeIndex }, { webToolsAvailable: web !== undefined })
      const auditPath = runRoot ? await spawn.writeSpawnAudit(fops, runRoot, plan) : null
      return { ok: true, plan, auditPath, instruction: 'Execute the role with autoresearch_run_role using the same role/task/judgeIndex.' }
    })

    // ── 10. run_role (executes via the subagents service) ──────────────────

    tool('autoresearch_run_role', 'Execute one research role as a confined subagent (per-role toolFilter/persona/model) and wait for its result. When runDir is supplied the exact node contract and roots are prepended; judge spawning accepts typed packetRef values and rejects mismatched pass/candidate/run digests before spawn.', {
      type: 'object', additionalProperties: true,
      properties: {
        role: { type: 'string', description: 'Role name, e.g. research_scout or scout.' },
        task: { type: 'string', description: 'The role task text.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        runDir: str('Run directory path (for config).'),
        judgeIndex: { type: 'number', description: 'Judge index for judgePanel model resolution.' },
        packetRef: { type: 'object', additionalProperties: true, description: 'Typed blind-packet reference from autoresearch_anonymize_candidates (judge spawning only).' },
        candidateIds: { type: 'array', items: { type: 'string' }, description: 'Candidate ids matching the packetRef.' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      if (subagents === undefined) throw new Error('subagents service unavailable')
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const cfg = await loadConfigFor(fops, baseDir, args.runDir)
      const role = profiles.resolveEffectiveProfile(args.role, cfg, { judgeIndex: args.judgeIndex })
      const prompt = await resolveRolePrompt(role, args.role, baseDir, fops)
      const persona = prompt.text.trim() + '\n\nResponse hygiene:\n- Return only the requested final artifact or decision.\n- Never reveal private chain-of-thought, scratch work, hidden reasoning, self-talk, or step-by-step file-reading narration.\n- Give concise conclusions and evidence sufficient to audit the result.\n- For judge roles, end with exactly the requested RANKING line.'
      const agentOptions = modelparse.resolveAgentOptions(role)
      const runRoot = args.runDir ? abs(baseDir, args.runDir) : null
      let task = ''
      if (runRoot) {
        task = await buildRoleTaskBase(fops, baseDir, args.runDir)
        if (util.isPlainObject(args.packetRef)) {
          task += await buildJudgePacketTask(fops, baseDir, runRoot, args)
        } else if (args.task) {
          task += '\n\n' + args.task
        }
      } else {
        task = args.task ?? ''
      }

      const request = {
        label: 'autoresearch ' + role.role,
        prompt: [{ type: 'text', text: task }],
        parent: exec.agent,
        signal: exec.signal,
        persona,
        toolFilter: { allow: [...role.tools] },
      }
      if (agentOptions && (agentOptions.provider || agentOptions.model)) {
        request.agentOptions = {
          ...(agentOptions.provider ? { provider: agentOptions.provider } : {}),
          model: agentOptions.model,
        }
      }

      const run = await subagents.start('spawn', request)
      try {
        const result = await run.result
        const output = (result.output ?? [])
          .map((block) => (block && typeof block.text === 'string' ? block.text : ''))
          .join('\n')
          .trim()
        return {
          role: role.role,
          stopReason: result.stopReason,
          output,
          outputLength: output.length,
          promptSource: prompt.source,
          modelSource: role.modelSource ?? null,
          model: role.model ?? null,
          tools: role.tools,
        }
      } finally {
        await run.dispose()
      }
    })

    // Judge packet task builder: validates the typed packetRef against the
    // current run digest and the on-disk packet hash, then embeds the packet
    // text into the judge task. A mismatched pass/candidate set/run digest
    // fails before spawn (plan §4.3).
    async function buildJudgePacketTask(fops, baseDir, runRoot, args) {
      const packetRef = args.packetRef
      const { run, contractFile } = await readRunAndDigest(fops, runRoot)
      if (!util.isPlainObject(run)) throw new Error('run.json must exist before judge spawning.')
      const candidateIds = Array.isArray(args.candidateIds) && args.candidateIds.length > 0 ? args.candidateIds : ['A', 'B', 'AB']
      const validation = core.validatePacketRef(packetRef, {
        runDigest: computeRunDigest(run, contractFile),
        pass: packetRef.pass,
        judgeCount: Number(run.config?.numJudges ?? 1) || 1,
        candidateIds,
        candidatePaths: {},
      })
      if (!validation.ok) {
        throw new Error('Judge packet reference rejected before spawn: ' + validation.errors.join('; '))
      }
      const packetText = await fops.readText(pathutil.resolveInside(runRoot, packetRef.packetPath))
      if (core.sha256Text(packetText) !== packetRef.packetHash) {
        throw new Error('Judge packet hash mismatch: the on-disk packet does not match the packetRef (pass ' + packetRef.pass + ', judge ' + packetRef.judge + ').')
      }
      return '\n\n## Blind judging task (anonymized candidates)\n' +
        'Rank the anonymized candidates below by correctness, source-grounding, decision usefulness, clarity, and restraint. ' +
        'Do not attempt to identify original candidate identities; never mention Candidate A/B/AB or Report A/B/AB labels. ' +
        'End with exactly one RANKING: line listing the labels in order (best first).\n\n' + packetText
    }

    // ── 11. redact_check ───────────────────────────────────────────────────

    tool('autoresearch_redact_check', 'Scan final research output for likely secrets, signed URLs, private keys, and raw transcript leakage before posting.', {
      type: 'object', additionalProperties: true,
      properties: {
        text: str('Text to scan (takes precedence over path).'),
        path: str('Workspace-relative path to scan.'),
        runDir: str('Run directory root for path resolution.'),
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        maxFindings: { type: 'number', description: 'Cap on reported findings (default 50).' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const root = args.runDir ? abs(baseDir, args.runDir) : baseDir
      return await redact.redactCheck(fops, { ...args, runDir: root, baseDir })
    })

    // ── 12. finalize_run (v2 acceptance gate) ──────────────────────────────

    tool('autoresearch_finalize_run', 'Mark an AutoResearch run complete, update resume.md, and release the issue lock when it points at this run. Returns a posting intent for Linear runs. Contract-bound (v2) runs are rejected without a current successful acceptance receipt bound to the node-contract digest.', {
      type: 'object', additionalProperties: true,
      properties: {
        runDir: { type: 'string', description: 'Run directory path.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        releaseLock: { type: 'boolean', description: 'Release the issue lock (default true).' },
        finalCommentPosted: { type: 'boolean', description: 'Mark the final comment as posted.' },
        notes: str('Optional closing notes recorded in resume.md.'),
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      return await lifecycle.finalizeRun(fops, { ...args, runDir: abs(baseDir, args.runDir), baseDir })
    })

    // ── 13. status ─────────────────────────────────────────────────────────

    tool('autoresearch_status', 'Summarize local AutoResearch locks and the newest run state for one issue or recent issues.', {
      type: 'object', additionalProperties: true,
      properties: {
        issueId: str('Optional issue id to scope the status.'),
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      return await lifecycle.researchStatus(fops, { ...args, baseDir })
    })

    // ── 14. dependency_check ───────────────────────────────────────────────

    tool('autoresearch_dependency_check', 'Check DSH services, artifact root, config, role templates, Linear credential readiness, the mounted build generation, and TeX toolchain availability offline.', {
      type: 'object', additionalProperties: true,
      properties: {
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        runDir: str('Run directory path (for run config).'),
        sourceType: str('linear or local.'),
        externalResearch: { type: 'boolean', description: 'Override the externalResearch expectation.' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const checks = []
      const recommendations = []
      let cfg
      try {
        cfg = args.runDir ? await config.loadRunConfig(fops, abs(baseDir, args.runDir)) : await config.loadProjectConfig(fops, baseDir, { presetConfigPath: PRESET_CONFIG_PATH })
      } catch {
        cfg = config.mergeConfig()
      }
      const externalResearch = args.externalResearch ?? (cfg.externalResearch !== false)
      const catalog = await liveModelCatalog()

      checks.push({ name: 'fs-service', ok: true, severity: 'info', message: 'fs service present.' })
      checks.push({ name: 'subagents-service', ok: subagents !== undefined, severity: subagents !== undefined ? 'info' : 'error', message: subagents !== undefined ? 'subagents service present; role execution available.' : 'subagents service missing; autoresearch_run_role cannot execute roles.' })
      if (subagents === undefined) recommendations.push('Load a composition that provides the subagents service (spawn provider).')

      const usableWebProviders = (store) => store instanceof Map
        ? [...store.values()].filter((provider) => {
          try { return typeof provider?.available === 'function' && provider.available() }
          catch { return false }
        }).map((provider) => provider.id)
        : []
      const searchProviderIds = web === undefined ? [] : usableWebProviders(web.searchProviders)
      const fetchProviderIds = web === undefined ? [] : usableWebProviders(web.fetchProviders)
      checks.push({
        name: 'web-service',
        ok: !externalResearch || web !== undefined,
        severity: !externalResearch || web !== undefined ? 'info' : 'warn',
        message: web !== undefined ? 'web service present.' : externalResearch ? 'web service missing.' : 'externalResearch=false; web service not required.',
      })
      checks.push({
        name: 'web-search-provider',
        ok: !externalResearch || searchProviderIds.length === 1,
        severity: !externalResearch || searchProviderIds.length === 1 ? 'info' : 'warn',
        message: !externalResearch
          ? 'externalResearch=false; search provider not required.'
          : searchProviderIds.length === 1
            ? 'usable web search provider: ' + searchProviderIds[0]
            : searchProviderIds.length === 0
              ? 'no usable web search provider is registered.'
              : 'multiple usable web search providers are registered (' + searchProviderIds.join(', ') + '); configure one explicitly.',
      })
      checks.push({
        name: 'web-fetch-provider',
        ok: !externalResearch || fetchProviderIds.length === 1,
        severity: !externalResearch || fetchProviderIds.length === 1 ? 'info' : 'warn',
        message: !externalResearch
          ? 'externalResearch=false; fetch provider not required.'
          : fetchProviderIds.length === 1
            ? 'usable web fetch provider: ' + fetchProviderIds[0] + '; presearch direct fetch mode available.'
            : fetchProviderIds.length === 0
              ? 'no usable web fetch provider is registered; presearch direct fetch mode is unavailable.'
              : 'multiple usable web fetch providers are registered (' + fetchProviderIds.join(', ') + '); configure one explicitly.',
      })
      if (externalResearch && searchProviderIds.length !== 1) recommendations.push('Register or configure exactly one usable web search provider.')
      if (externalResearch && fetchProviderIds.length !== 1) recommendations.push('Register or configure exactly one usable web fetch provider (for example @deepseek-ai/dsh-web-fetch-http).')

      const probePath = abs(baseDir, '.research-agent/.probe.json')
      let writable = true
      let writableError = ''
      try {
        await fops.writeText(probePath, '{"probe":true}\n')
        const readBack = await fops.readText(probePath)
        if (!readBack.includes('probe')) throw new Error('probe read-back mismatch')
      } catch (error) {
        writable = false
        writableError = error instanceof Error ? error.message : String(error)
      }
      checks.push({ name: 'artifact-root-writable', ok: writable, severity: writable ? 'info' : 'error', message: writable ? 'Artifact root writable: ' + abs(baseDir, '.research-agent') : 'Artifact root not writable: ' + writableError })
      if (!writable) recommendations.push('Fix permissions on the workspace .research-agent root.')

      for (const role of config.ALL_RESEARCH_ROLES) {
        if (role === 'implementation_worker' || role === 'review_worker') continue
        const profile = profiles.resolveEffectiveProfile(role, cfg)
        let promptOk = false
        try {
          await resolveRolePrompt(profile, role, baseDir, fops)
          promptOk = true
        } catch {
          promptOk = false
        }
        checks.push({ name: 'role-' + role, ok: promptOk, severity: promptOk ? 'info' : 'warn', message: promptOk ? 'Role prompt resolvable: ' + role : 'Role prompt missing for ' + role + '; embedded default unavailable.' })
        const parsed = modelparse.parseModelString(profile.model)
        if (profile.model && !parsed) {
          checks.push({ name: 'role-model-' + role, ok: false, severity: 'warn', message: 'Unparseable model string for ' + role + ': ' + profile.model })
          recommendations.push('Fix roleProfiles/judgePanel/roleModels model string for ' + role + ' (expected provider/model).')
        } else if (profile.model && catalog !== null) {
          const verdict = modelRegistry.validateModelString(profile.model, catalog.registry)
          if (!verdict.ok) {
            checks.push({ name: 'role-model-' + role, ok: false, severity: 'warn', message: 'Model string for ' + role + ' is not in the live DSH registry: ' + verdict.reason })
            recommendations.push('Choose a recognized model for ' + role + ' (run autoresearch_list_models to see current choices).')
          }
        }
      }

      checks.push({
        name: 'linear-credential',
        ok: true,
        severity: 'info',
        message: args.sourceType === 'linear'
          ? 'Linear intake: ensure LINEAR_API_KEY is set (env or credentials store); linear_whoami verifies.'
          : 'Linear intake optional; local-brief mode does not need a credential.',
      })

      // Build generation probe (WP5): stale mounted code must never look OK.
      if (subprocess !== undefined) {
        try {
          const probe = await runBuildProbe(subprocess, baseDir)
          const mountedOk = probe.graphMatches && EMBEDDED_BUILD_ID === probe.expectedAggregateId
          checks.push({
            name: 'build-generation',
            ok: mountedOk,
            severity: mountedOk ? 'info' : 'warn',
            message: mountedOk
              ? 'mounted build generation ' + probe.generation + ' matches the runtime graph (' + probe.expectedAggregateId + ').'
              : 'mounted build generation is stale or the runtime graph changed: expected ' + probe.expectedAggregateId + ', got ' + probe.actualAggregateId + ' (' + probe.mismatches.slice(0, 3).join('; ') + '). Start a new research session to remount.',
          })
          if (!mountedOk) recommendations.push('Start a new blank research session with the research preset to remount the current generation.')
        } catch (error) {
          checks.push({ name: 'build-generation', ok: false, severity: 'warn', message: 'build probe failed: ' + (error instanceof Error ? error.message : String(error)) })
        }
      }

      // TeX toolchain: mandatory for TeX-enabled contract-bound runs.
      if (subprocess !== undefined) {
        let texRequired = false
        if (typeof args.runDir === 'string' && args.runDir.trim()) {
          const contractFile = await loadRunContract(fops, abs(baseDir, args.runDir))
          texRequired = contractFile?.artifactFormat === 'tex'
        }
        for (const name of ['latexmk', 'texcount']) {
          let ok = true
          let message = name + ' available.'
          try {
            await resolveExecutable(subprocess, name)
          } catch (error) {
            ok = false
            message = name + ' missing: ' + (error instanceof Error ? error.message : String(error))
            if (texRequired) recommendations.push('Install TeX Live (latexmk/texcount) — the bound node requires strict TeX compilation.')
          }
          checks.push({
            name: 'tex-' + name,
            ok,
            severity: ok ? 'info' : (texRequired ? 'error' : 'warn'),
            message,
          })
        }
      }

      const failed = checks.filter((check) => !check.ok)
      const failedErrors = failed.filter((check) => check.severity === 'error')
      const failedWarns = failed.filter((check) => check.severity === 'warn')
      return {
        ok: failedErrors.length === 0 && failedWarns.length === 0,
        degraded: failedErrors.length === 0 && failedWarns.length > 0,
        checks,
        recommendations,
        configSnapshot: {
          externalResearch,
          sessionControl: cfg.sessionControl ?? false,
          roleModels: { ...(cfg.roleModels ?? {}) },
        },
      }
    })

    // ── 15/16. role profile introspection ──────────────────────────────────

    tool('autoresearch_list_role_profiles', 'List effective role profiles (model/tools/prompt source) from project or run config. Built-in tool ceilings are enforced at resolution.', {
      type: 'object', additionalProperties: true,
      properties: {
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        runDir: str('Run directory path (for run config).'),
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const cfg = await loadConfigFor(fops, baseDir, args.runDir)
      const catalog = await liveModelCatalog()
      const rows = []
      for (const profile of profiles.listEffectiveProfiles(cfg)) {
        let promptSource = 'none'
        try {
          promptSource = (await resolveRolePrompt(profile, profile.role, baseDir, fops)).source
        } catch {
          // config-compat roles (implementation_worker/review_worker) have no prompt
        }
        rows.push({
          role: profile.role,
          model: profile.model,
          modelSource: profile.modelSource,
          modelRecognized: profile.model
            ? (catalog !== null ? modelRegistry.validateModelString(profile.model, catalog.registry).ok : null)
            : true,
          tools: profile.tools,
          promptSource,
          externalResearch: profile.externalResearch,
        })
      }
      return { ok: true, profiles: rows, config: { externalResearch: cfg.externalResearch, roleModels: cfg.roleModels, sessionControl: cfg.sessionControl } }
    })

    tool('autoresearch_get_role_profile', 'Resolve one effective role profile including prompt source and model.', {
      type: 'object', additionalProperties: true,
      properties: {
        role: { type: 'string', description: 'Role name, e.g. research_judge or judge.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        runDir: str('Run directory path (for run config).'),
        judgeIndex: { type: 'number', description: 'Judge index for judgePanel resolution.' },
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const cfg = await loadConfigFor(fops, baseDir, args.runDir)
      const profile = profiles.resolveEffectiveProfile(args.role, cfg, { judgeIndex: args.judgeIndex })
      let promptSource = 'none'
      try {
        promptSource = (await resolveRolePrompt(profile, args.role, baseDir, fops)).source
      } catch {
        // config-compat roles have no prompt
      }
      const agentOptions = modelparse.resolveAgentOptions(profile)
      const catalog = await liveModelCatalog()
      return {
        ok: true,
        profile,
        promptSource,
        agentOptions,
        modelRecognized: profile.model
          ? (catalog !== null ? modelRegistry.validateModelString(profile.model, catalog.registry).ok : null)
          : true,
      }
    })

    // ── 17. list_models ────────────────────────────────────────────────────

    tool('autoresearch_list_models', 'List the model providers and models DSH currently recognizes, so config model strings can be chosen from the live registry.', {
      type: 'object', additionalProperties: true,
      properties: {
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
      },
    }, async (args, exec) => {
      const catalog = await liveModelCatalog()
      if (catalog === null) return { ok: false, error: 'llm service unavailable in this deployment' }
      return {
        ok: true,
        providers: catalog.providers,
        models: modelRegistry.listEntries(catalog.models),
        usage: 'Set roleProfiles.<role>.model, judgePanel[i].model, or roleModels buckets in .research-agent/config.json (or the preset config.default.json) to any "provider/model" shown here; a bare model name rides the session provider; null/omitted = harness default.',
      }
    })

    // ── 18. plan_validate (v1/v2, non-mutating) ────────────────────────────

    tool('autoresearch_plan_validate', 'Validate an approved AutoResearch project plan (v1 legacy or v2 contract): schema, markers, unique node ids, manifest roles with phase/ceiling rules, strict effective budgets, dependsOn, acyclicity, integration coverage, and the v2 project contract. Never mutates the caller plan. Returns normalized contracts and the stable plan digest.', {
      type: 'object', additionalProperties: true,
      properties: {
        plan: { type: 'object', additionalProperties: true, description: 'The plan object (takes precedence over path).' },
        path: str('Optional plan.json path relative to the workspace root (default .research-agent/projects/<projectId>/plan.json).'),
        projectId: str('Optional project id used to derive the default path when path is omitted.'),
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      let plan = util.isPlainObject(args.plan) ? args.plan : null
      let planPath = ''
      if (!plan) {
        if (typeof args.path === 'string' && args.path.trim()) {
          planPath = args.path.trim()
        } else if (typeof args.projectId === 'string' && args.projectId.trim()) {
          planPath = projectstate.planPath(baseDir, args.projectId)
        } else {
          throw new Error('Provide either plan, path, or projectId.')
        }
        const loaded = await fops.readJson(abs(baseDir, planPath))
        if (!util.isPlainObject(loaded)) throw new Error('plan.json missing or not valid JSON: ' + planPath)
        plan = loaded
      }
      const cfg = await config.loadProjectConfig(fops, baseDir, { presetConfigPath: PRESET_CONFIG_PATH })
      const result = core.validatePlan(plan, { roleProfiles: cfg.roleProfiles })
      const contracts = {}
      for (const [id, contract] of Object.entries(result.contracts ?? {})) {
        contracts[id] = {
          digest: contract.digest,
          kind: contract.kind,
          artifactFormat: contract.artifactFormat,
          effectiveBudget: contract.effectiveBudget,
          roles: contract.roles,
          acceptance: (contract.acceptance ?? []).map((entry) => ({ id: entry.id, required: entry.required })),
        }
      }
      return {
        ok: result.ok,
        strictValid: result.strictValid,
        planPath: planPath || null,
        errors: result.errors,
        warnings: result.warnings,
        schemaVersion: result.schemaVersion,
        projectId: result.projectId,
        marker: result.marker,
        teamId: result.teamId,
        revision: result.revision,
        nodeCount: result.nodeCount,
        integrationId: result.integrationId,
        digest: result.digest,
        contracts,
        projectContract: result.projectContract ? { goal: result.projectContract.goal, deliverables: result.projectContract.deliverables, acceptance: result.projectContract.acceptance, finalWordBudget: result.projectContract.finalWordBudget } : null,
        instruction: result.ok
          ? (result.strictValid
            ? 'Plan valid as a v2 contract. Write plan.json + empty state.json under .research-agent/projects/<id>/ BEFORE any Linear side effect, then create the project and one issue per node.'
            : 'Plan valid under legacy v1 semantics. New execution is blocked until an approved v2 revision exists — run autoresearch_migration_diagnostic for the exact proposed diff (plan §4.2).')
          : 'Plan invalid. Fix the reported errors and re-validate before presenting or creating Linear artifacts.',
      }
    })

    // ── 19. project_status (with spec-block drift + Linear fallback) ───────

    tool('autoresearch_project_status', "Reconcile the approved plan.json, the state.json journal, Linear issues (optional) and local runs for one AutoResearch project. Read-only for the plan; the only mutation is the explicit per-node comment-id cursor advance (idempotent). Reports drift — including generated-spec-block drift and the deterministic legacy Linear-state fallback source — and never rewrites the plan.", {
      type: 'object', additionalProperties: true,
      properties: {
        projectId: str('AutoResearch project id.'),
        linearIssues: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Optional issues array from linear_list_issues(projectId) for Linear reconciliation.' },
        cursor: { type: 'object', additionalProperties: true, description: 'Optional { "<nodeId>": ["<linear comment id>", ...] } cursor advance; appends only new ids to the journal.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const projectId = util.requiredString(args.projectId, 'projectId')
      const plan = await projectstate.loadPlan(fops, baseDir, projectId)
      if (!plan.ok) return { ok: false, projectId, error: plan.error }
      const loaded = await projectstate.loadState(fops, baseDir, projectId, plan.plan)
      let { state } = loaded
      const cursorAdvanced = {}
      if (util.isPlainObject(args.cursor) && Object.keys(args.cursor).length > 0) {
        for (const [nodeId, ids] of Object.entries(args.cursor)) {
          cursorAdvanced[nodeId] = await projectstate.advanceCommentCursor(fops, baseDir, projectId, nodeId, ids)
        }
        state = (await projectstate.loadState(fops, baseDir, projectId, plan.plan)).state
      }
      const reconciliation = await projectstate.reconcile(fops, baseDir, plan.plan, state, args.linearIssues)
      const matched = projectstate.matchIssuesByMarker(plan.plan.projectId, args.linearIssues, state.project?.linearProjectId)
      const rows = []
      for (const row of reconciliation.nodes) {
        const issue = matched.byNode[row.id]
        const stateEntry = state.nodes[row.id]
        rows.push(await enrichReconciliationRow(fops, baseDir, plan.plan, state, stateEntry, issue, row))
      }
      const integrationState = util.isPlainObject(state.integration) ? state.integration : null
      return {
        ok: true,
        projectId,
        planPath: plan.path,
        stateMissing: loaded.missing,
        stateInvalid: loaded.invalid,
        cursorAdvanced,
        planDigest: core.planContractDigest(plan.plan),
        ...reconciliation,
        integration: {
          ...reconciliation.integration,
          phase: integrationState?.phase ?? null,
          epoch: integrationState?.epoch ?? null,
          inputDigest: integrationState?.inputDigest ?? null,
        },
        nodes: rows,
      }
    })

    // ── 20. record_acceptance (plan §4.3) ──────────────────────────────────

    tool('autoresearch_record_acceptance', 'Record a mechanical acceptance receipt for a contract-bound run. Every plan criterion must be accounted for (PASS/FAIL/WAIVED/NOT_APPLICABLE); waivers require a recorded user decision, rationale, scope, and plan revision. Extractor-backed expected categories must record count, bytes, and SHA-256 (zero required counts fail); command checks record command, cwd, exit code, and log hashes. For artifactFormat tex, strict TeX validation (static rules + latexmk build, never -f) runs before acceptance; a nonzero compiler exit cannot pass. Writes acceptance.json.', {
      type: 'object', additionalProperties: true,
      properties: {
        runDir: { type: 'string', description: 'Run directory path.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        criteria: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: true,
            properties: {
              id: { type: 'string', description: 'Criterion id from the node contract.' },
              result: { type: 'string', description: 'PASS, FAIL, WAIVED, or NOT_APPLICABLE.' },
              evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence paths.' },
              waiver: { type: 'object', additionalProperties: true, description: 'Required for WAIVED: userDecision, rationale, scope, planRevision.' },
            },
          },
          description: 'One result per plan criterion id.',
        },
        expectedCategories: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Extractor-backed categories: category, count, bytes, sha256, extractor, expectedNonEmpty.' },
        commandChecks: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Command checks: command, cwd, exitCode, stdoutHash/stderrHash/logHash, envFacts.' },
        artifactClassification: { type: 'object', additionalProperties: true, description: 'From the determinism rules: kind (pdf/source/...), reproducibleProfile, doubleBuildHash.' },
        texMode: { type: 'string', description: 'fragment (default) or standalone.' },
        declared: { type: 'object', additionalProperties: true, description: 'Declared package/macro/input/graphics/bibliography needs for TeX validation.' },
        templatePath: str('Frozen project template path (workspace-relative) for fragment mode.'),
        nodeRevision: { type: 'number', description: 'Output revision number (default 1).' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const runDir = abs(baseDir, args.runDir)
      const contractFile = await loadRunContract(fops, runDir)
      if (!contractFile) {
        throw new Error('v2 mechanical acceptance requires a bound run: node-contract.json is missing. Use autoresearch_init_run with projectId+nodeId.')
      }
      const contract = contractFile.contract
      const outputName = contract.artifactFormat === 'tex' ? 'output.tex' : 'final.md'
      const outputHash = await hashFile(fops, pathutil.resolveInside(runDir, outputName))
      if (!outputHash) throw new Error('No output artifact found for acceptance: ' + outputName)
      let tex = null
      if (contract.artifactFormat === 'tex') {
        tex = await validateNodeTex(fops, subprocess, baseDir, runDir, contract, {
          texMode: args.texMode,
          declared: args.declared,
          templatePath: args.templatePath,
        })
        if (!tex.clean) {
          throw new Error('Strict TeX validation failed before acceptance: ' + (tex.errors ?? []).join('; '))
        }
      }
      const classification = args.artifactClassification ? core.classifyArtifact(args.artifactClassification) : null
      const receipt = core.acceptanceReceipt({
        contract,
        criteria: args.criteria ?? [],
        expectedCategories: args.expectedCategories ?? [],
        commandChecks: args.commandChecks ?? [],
        artifactClassification: classification,
        tex,
        outputHash,
        nodeRevision: typeof args.nodeRevision === 'number' ? args.nodeRevision : 1,
      })
      await fops.writeJson(pathutil.resolveInside(runDir, 'acceptance.json'), receipt)
      return {
        ok: true,
        receipt,
        instruction: 'Acceptance receipt bound to contract digest ' + contract.digest + '. The run may finalize while this receipt is current.',
      }
    })

    // ── 21. tex_check (node-level strict TeX validation, no receipt) ───────

    tool('autoresearch_tex_check', 'Run the strict TeX validation for a node output (static rules + latexmk build of preview.tex or output.tex, never -f). Returns the validation record without writing an acceptance receipt.', {
      type: 'object', additionalProperties: true,
      properties: {
        runDir: { type: 'string', description: 'Run directory path.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        texMode: { type: 'string', description: 'fragment (default) or standalone.' },
        declared: { type: 'object', additionalProperties: true, description: 'Declared needs.' },
        templatePath: str('Frozen project template path (workspace-relative) for fragment mode.'),
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const runDir = abs(baseDir, args.runDir)
      const contractFile = await loadRunContract(fops, runDir)
      if (!contractFile) throw new Error('tex_check requires a bound run (node-contract.json).')
      return await validateNodeTex(fops, subprocess, baseDir, runDir, contractFile.contract, {
        texMode: args.texMode,
        declared: args.declared,
        templatePath: args.templatePath,
      })
    })

    // ── 22. candidate_eligibility (plan §4.3) ──────────────────────────────

    tool('autoresearch_candidate_eligibility', 'Validate B/AB candidate eligibility before judging: every non-targeted incumbent contribution (required locked units) must survive; only critic-targeted units may change, and only through a recorded revision-ledger replacement or justified removal. A candidate that loses required or untouched material is ineligible, not merely ranked lower. Judged candidates are never modified here.', {
      type: 'object', additionalProperties: true,
      properties: {
        runDir: { type: 'string', description: 'Run directory path.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        pass: { type: 'number', description: 'Current pass number.' },
        incumbentPath: str('Incumbent artifact path (default pass_00/A.<ext>).'),
        candidatePaths: { type: 'object', additionalProperties: true, description: 'Candidate paths keyed by id (default pass_N/B.<ext>, pass_N/AB.<ext>).' },
        requiredUnits: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Required locked units: {id, anchor} (anchor text that must survive).' },
        criticTargets: { type: 'array', items: { type: 'string' }, description: 'Contribution ids the critic explicitly targeted.' },
        revisionLedger: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Recorded ledger entries: {unitId, action: replaced|removed, reason, approved: true}.' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const runDir = abs(baseDir, args.runDir)
      const { run, contractFile } = await readRunAndDigest(fops, runDir)
      if (!util.isPlainObject(run)) throw new Error('run.json must exist.')
      const pass = util.requiredPositiveInteger(args.pass, 'pass')
      const ext = contractFile?.artifactFormat === 'tex' ? 'tex' : 'md'
      const incumbentRel = args.incumbentPath ?? (pass > 1 ? 'pass_' + String(pass - 1).padStart(2, '0') + '/A.' + ext : 'pass_00/A.' + ext)
      const incumbent = await fops.readText(pathutil.resolveInside(runDir, incumbentRel))
      const candidates = {}
      for (const id of ['B', 'AB']) {
        const rel = args.candidatePaths?.[id] ?? 'pass_' + String(pass).padStart(2, '0') + '/' + id + '.' + ext
        candidates[id] = await fops.readText(pathutil.resolveInside(runDir, rel))
      }
      const requiredUnits = Array.isArray(args.requiredUnits) ? args.requiredUnits : []
      const criticTargets = new Set(Array.isArray(args.criticTargets) ? args.criticTargets : [])
      const revisionLedger = Array.isArray(args.revisionLedger) ? args.revisionLedger : []
      const ledgerByUnit = new Map()
      for (const entry of revisionLedger) {
        if (entry && entry.unitId) ledgerByUnit.set(entry.unitId, entry)
      }
      const report = { pass, incumbentPath: incumbentRel, candidates: {} }
      for (const [id, text] of Object.entries(candidates)) {
        const reasons = []
        for (const unit of requiredUnits) {
          if (typeof unit?.anchor !== 'string' || !unit.anchor) continue
          if (!incumbent.includes(unit.anchor)) continue
          if (!text.includes(unit.anchor)) {
            const targeted = criticTargets.has(unit.id)
            const ledger = ledgerByUnit.get(unit.id)
            const ledgerApproved = ledger && (ledger.action === 'replaced' || ledger.action === 'removed') && ledger.approved === true
            if (targeted && ledgerApproved) {
              reasons.push({ level: 'note', unitId: unit.id, message: 'critic-targeted unit removed through the recorded revision ledger (action=' + ledger.action + ')' })
            } else {
              reasons.push({ level: 'block', unitId: unit.id, message: 'candidate loses required/untouched contribution "' + unit.id + '"' + (targeted ? '; the revision ledger does not record an approved replacement/removal' : '; the critic did not target it') })
            }
          }
        }
        const blocking = reasons.filter((entry) => entry.level === 'block')
        report.candidates[id] = {
          eligible: blocking.length === 0,
          reasons,
          blockedBy: blocking.map((entry) => entry.unitId),
        }
      }
      return {
        ok: Object.values(report.candidates).every((entry) => entry.eligible),
        ...report,
        instruction: 'Ineligible candidates must not be judged; fix the revision ledger or regenerate the candidate before anonymization.',
      }
    })

    // ── 23. publish_accepted (coordinator corrections, plan §4.3) ──────────

    tool('autoresearch_publish_accepted', 'Publish a coordinator-corrected artifact under a separately named accepted path with a provenance receipt. The judged candidate file is never overwritten; corrections are visible as corrections, with source and patch hashes.', {
      type: 'object', additionalProperties: true,
      properties: {
        runDir: { type: 'string', description: 'Run directory path.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        sourcePath: { type: 'string', description: 'Run-relative corrected artifact (e.g. packets/coordinator-corrected.md).' },
        judgedPath: { type: 'string', description: 'Run-relative judged candidate that was the base (e.g. pass_01/A.md).' },
        patchNote: str('Optional human-readable correction note.'),
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const runDir = abs(baseDir, args.runDir)
      if (typeof args.sourcePath !== 'string' || !args.sourcePath.trim()) throw new Error('sourcePath is required.')
      if (typeof args.judgedPath !== 'string' || !args.judgedPath.trim()) throw new Error('judgedPath is required.')
      const sourceAbs = pathutil.resolveInside(runDir, args.sourcePath)
      const judgedAbs = pathutil.resolveInside(runDir, args.judgedPath)
      const sourceText = await fops.readText(sourceAbs)
      const judgedText = await fops.readText(judgedAbs)
      // Decide the format BEFORE any write; on any read/validation failure
      // nothing is written (the reads above already throw on failure).
      const contractFile = await loadRunContract(fops, runDir)
      const artifactFormat = contractFile?.artifactFormat ?? 'markdown'
      const acceptedRel = 'packets/coordinator-accepted.md'
      const texRel = 'packets/coordinator-accepted.tex'
      const acceptedHash = core.sha256Text(sourceText)
      const provenance = {
        kind: 'coordinator-accepted',
        sourcePath: args.sourcePath,
        judgedPath: args.judgedPath,
        sourceHash: core.sha256Text(sourceText),
        judgedHash: core.sha256Text(judgedText),
        acceptedHash,
        acceptedPaths: [{ path: acceptedRel, hash: acceptedHash }],
        patchNote: args.patchNote ?? '',
        createdAt: new Date().toISOString(),
      }
      if (artifactFormat === 'tex') {
        provenance.acceptedPaths.push({ path: texRel, hash: acceptedHash })
      }
      await fops.writeText(pathutil.resolveInside(runDir, acceptedRel), sourceText)
      if (artifactFormat === 'tex') {
        await fops.writeText(pathutil.resolveInside(runDir, texRel), sourceText)
      }
      await fops.writeJson(pathutil.resolveInside(runDir, 'packets/coordinator-accepted.provenance.json'), provenance)
      return {
        ok: true,
        acceptedPath: acceptedRel,
        acceptedPaths: provenance.acceptedPaths,
        provenance,
        instruction: 'Judged ' + args.judgedPath + ' remains byte-identical; consumers must read ' + acceptedRel + ' for the corrected text.' + (artifactFormat === 'tex' ? ' The TeX-format copy is at ' + texRel + '.' : ''),
      }
    })

    // ── 24. integration_preflight (plan §4.4) ──────────────────────────────

    tool('autoresearch_integration_preflight', 'Compute the integration input digest from the project contract and every current node contract/output/acceptance hash, classify preflight findings (editorial stays local; substantive/conflict reopen the owning node; scope blocks for user review), and advance the integration state machine.', {
      type: 'object', additionalProperties: true,
      properties: {
        projectId: str('Approved plan project id.'),
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        currentState: { type: 'string', description: 'Current integration phase (default waiting_for_nodes).' },
        nodeStates: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '[{nodeId, contractDigest, outputHash, acceptanceHash}] for every non-integration node.' },
        findings: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Preflight findings: {nodeId?, kind?, severity?, description}.' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const projectId = util.requiredString(args.projectId, 'projectId')
      const plan = await projectstate.loadPlan(fops, baseDir, projectId)
      if (!plan.ok) return { ok: false, projectId, error: plan.error }
      const validation = core.validatePlan(plan.plan)
      const project = core.projectContract(plan.plan)
      const inputDigest = core.computeInputDigest(project, args.nodeStates)
      const classified = (Array.isArray(args.findings) ? args.findings : []).map((finding) => core.classifyPreflightFinding(finding, plan.plan))
      const hasBlocking = classified.some((finding) => ['substantive', 'conflict', 'scope'].includes(finding.classification))
      const current = typeof args.currentState === 'string' && args.currentState ? args.currentState : 'waiting_for_nodes'
      // Readiness is derived from the project state journal: every non-integration
      // node must be status 'done' AND carry non-empty contract/output/acceptance
      // hashes in the supplied nodeStates (hashes bind the input digest only; the
      // journal is the authoritative completion gate).
      const loadedState = await projectstate.loadState(fops, baseDir, projectId, plan.plan)
      const journal = util.isPlainObject(loadedState) && util.isPlainObject(loadedState.state) ? loadedState.state : {}
      const allReady = preflightReadyNodes(plan.plan, journal, args.nodeStates)
      let transition = { next: current, allowed: true }
      if (allReady && current === 'waiting_for_nodes') {
        transition = core.integrationStateMachine(current, 'all-nodes-ready')
      }
      if (hasBlocking && transition.allowed) {
        transition = core.integrationStateMachine(transition.next, 'blocking-findings')
      } else if (!hasBlocking && current === 'blocked_on_revisions' && transition.allowed) {
        transition = core.integrationStateMachine(transition.next, 'revisions-complete')
      }
      const blocking = classified.filter((finding) => ['substantive', 'conflict', 'scope'].includes(finding.classification))
      return {
        ok: true,
        projectId,
        planRevision: validation.revision,
        inputDigest,
        state: transition.next,
        previousState: current,
        transitionAllowed: transition.allowed,
        allNodesReady: allReady,
        findings: classified,
        blockingFindings: blocking,
        instruction: blocking.length > 0
          ? 'Blocking findings: route substantive/conflict findings back to the owning node via autoresearch_revision_request; scope findings need a user decision or a plan revision.'
          : 'No blocking findings: the integration editor may draft (phase drafting).',
      }
    })

    // ── 25. revision_request (plan §4.4, idempotent) ───────────────────────

    tool('autoresearch_revision_request', 'Create a canonical, idempotent revision request for a node (substantive/conflict findings). Writes the request file under .research-agent/projects/<id>/revision-requests/ (create-if-absent) and returns the Linear marker, comment body, and the node/integration state targets. Post the body with linear_create_comment(idempotencyMarker=marker).', {
      type: 'object', additionalProperties: true,
      properties: {
        projectId: str('Approved plan project id.'),
        nodeId: str('Owning node id.'),
        epoch: { type: 'number', description: 'Integration epoch (default 1).' },
        request: { type: 'object', additionalProperties: true, description: '{affectedContributionIds, projectCriteria, problem, requiredChange, acceptanceChecks}.' },
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const projectId = util.requiredString(args.projectId, 'projectId')
      const nodeId = util.requiredString(args.nodeId, 'nodeId')
      const request = util.isPlainObject(args.request) ? args.request : {}
      const epoch = Number(args.epoch) || 1
      const fullRequest = {
        projectId,
        nodeId,
        epoch,
        affectedContributionIds: Array.isArray(request.affectedContributionIds) ? request.affectedContributionIds : [],
        projectCriteria: Array.isArray(request.projectCriteria) ? request.projectCriteria : [],
        problem: request.problem ?? '',
        requiredChange: request.requiredChange ?? '',
        acceptanceChecks: Array.isArray(request.acceptanceChecks) ? request.acceptanceChecks : [],
      }
      const requestDigest = core.revisionRequestDigest(fullRequest)
      const marker = core.revisionRequestMarker(projectId, epoch, nodeId, requestDigest)
      const dir = pathutil.join(projectstate.projectDir(baseDir, projectId), 'revision-requests')
      const filePath = pathutil.join(dir, nodeId + '-' + epoch + '-' + requestDigest + '.json')
      let created = false
      try {
        await fops.writeTextNew(filePath, JSON.stringify({ ...fullRequest, requestDigest, marker, createdAt: new Date().toISOString() }, null, 2) + '\n')
        created = true
      } catch (error) {
        if (!util.isAlreadyExistsError(error)) throw error
      }
      // Reopen the owning node AND all transitive downstream dependents in the
      // state journal so the all-nodes-done readiness gate cannot accept stale
      // downstream artifacts after this revision.
      const reset = await resetDownstreamState(fops, baseDir, plan.plan, nodeId)
      return {
        ok: true,
        created,
        requestDigest,
        marker,
        commentBody: core.revisionCommentBody(fullRequest, marker),
        requestPath: pathutil.relativePath(baseDir, filePath),
        resetNodes: reset.resetNodeIds,
        nodeState: 'revision_requested',
        integrationState: 'blocked_on_revisions',
        instruction: 'Post the comment body with linear_create_comment(id, body, idempotencyMarker="' + marker + '"), move the issue to In Progress, and rerun the node in targeted revision mode. The owning node and its downstream dependents were reset to todo in state.json.',
      }
    })

    // ── 26. coverage_validate (plan §4.4) ──────────────────────────────────

    tool('autoresearch_coverage_validate', 'Validate integration-coverage.json against final.tex and every current node output ledger: every substantive span needs a claim record with resolvable sources, evidence, and transform; required contributions need explicit dispositions; unsupported sentences and silent omissions fail.', {
      type: 'object', additionalProperties: true,
      properties: {
        projectId: str('Approved plan project id.'),
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        coveragePath: str('Path to integration-coverage.json (run-relative or workspace-relative).'),
        finalTexPath: str('Path to final.tex.'),
        nodeOutputs: { type: 'object', additionalProperties: true, description: '{nodeId: path} to each current node-output.json.' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      if (typeof args.coveragePath !== 'string' || !args.coveragePath.trim()) throw new Error('coveragePath is required.')
      if (typeof args.finalTexPath !== 'string' || !args.finalTexPath.trim()) throw new Error('finalTexPath is required.')
      const resolve = (p) => resolveInput(fops, baseDir, args.runDir ? abs(baseDir, args.runDir) : '', p, { mustExist: true })
      const coverage = await fops.readJson(await resolve(args.coveragePath))
      const finalTex = await readFileSafe(fops, await resolve(args.finalTexPath))
      const contributions = {}
      for (const [nodeId, path] of Object.entries(util.isPlainObject(args.nodeOutputs) ? args.nodeOutputs : {})) {
        contributions[nodeId] = await fops.readJson(await resolve(path))
      }
      const result = core.validateCoverage(coverage, finalTex, { contributions })
      return {
        ok: result.ok,
        errors: result.errors,
        records: result.records,
        dispositions: result.dispositions,
        instruction: result.ok ? 'Coverage validates; the integration draft may proceed to strict TeX verification.' : 'Fix the reported coverage errors before verifying the final TeX.',
      }
    })

    // ── 27. tex_final_check (plan §4.4) ────────────────────────────────────

    tool('autoresearch_tex_final_check', 'Final TeX verification for integration: citation keys resolve, labels unique and referenced, no forbidden paths, missing graphics fail, texcount enforces the project word budget, a strict latexmk build (never -f) passes, .fls inputs are workspace-local-only, and optional coverage validation runs. Records source/log/input/PDF hashes.', {
      type: 'object', additionalProperties: true,
      properties: {
        projectId: str('Approved plan project id (loads the project contract for the word budget).'),
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        runDir: { type: 'string', description: 'Integration run directory containing final.tex.' },
        bibliographyKeys: { type: 'array', items: { type: 'string' }, description: 'Known bibliography keys (or bibliographyPath).' },
        bibliographyPath: str('Optional path to a .bib file to extract keys from.'),
        wordBudget: { type: 'number', description: 'Override the project word budget.' },
        reproducibleProfile: { type: 'boolean', description: 'Run a double-build under a fixed profile and require equal PDF hashes.' },
        coveragePath: str('Optional integration-coverage.json path (run-relative) for coverage validation.'),
        nodeOutputs: { type: 'object', additionalProperties: true, description: '{nodeId: path} to each current node-output.json (coverage only).' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const runDir = args.runDir ? abs(baseDir, args.runDir) : baseDir
      const finalTexPath = pathutil.resolveInside(runDir, 'final.tex')
      const finalTex = await readFileSafe(fops, finalTexPath)
      let bibliographyKeys = Array.isArray(args.bibliographyKeys) ? args.bibliographyKeys : []
      if (!bibliographyKeys.length && typeof args.bibliographyPath === 'string' && args.bibliographyPath.trim()) {
        const bibPath = await resolveInput(fops, baseDir, runDir, args.bibliographyPath, { mustExist: true })
        const bibText = await readFileSafe(fops, bibPath)
        for (const match of bibText.matchAll(/@\w+\s*\{([^,]+),/g)) {
          bibliographyKeys.push(match[1].trim())
        }
      }
      const plan = args.projectId ? await projectstate.loadPlan(fops, baseDir, args.projectId) : null
      const project = plan?.ok ? core.projectContract(plan.plan) : null
      const wordBudget = args.wordBudget ?? project?.finalWordBudget ?? null
      const staticResult = core.validateFinalTexStructure(finalTex, { bibliographyKeys })
      const record = {
        ok: false,
        staticOk: staticResult.ok,
        staticErrors: staticResult.errors,
        citationCount: staticResult.citationCount,
        labelCount: staticResult.labelCount,
        wordBudget,
        wordCount: null,
        budgetOk: null,
        compiled: false,
        clean: false,
        exitCode: null,
        logHash: '',
        flsHash: '',
        pdfHash: '',
        reproducible: null,
        workspaceLocalInputs: [],
        forbiddenInputs: [],
      }
      if (staticResult.ok && subprocess !== undefined) {
        const texcount = await resolveExecutable(subprocess, 'texcount')
        const countResult = await runSubprocess(subprocess, runDir, [texcount, '-inc', '-sum', 'final.tex'])
        const wordCount = core.parseTexcountWords(countResult.stdout)
        record.wordCount = wordCount
        record.budgetOk = wordCount === null || wordBudget === null ? null : wordCount <= wordBudget
        if (wordBudget !== null && wordCount !== null && wordCount > wordBudget) {
          record.staticErrors.push('texcount reports ' + wordCount + ' words; the project budget is ' + wordBudget + '.')
        }
        const build = await strictTexBuild(fops, subprocess, baseDir, runDir, 'final.tex')
        record.compiled = true
        record.clean = build.clean
        record.exitCode = build.exitCode
        record.logHash = build.logHash
        record.flsHash = build.flsHash
        record.pdfHash = build.pdfHash
        if (!build.clean) record.staticErrors.push('strict final TeX build failed with exit ' + build.exitCode + ': ' + build.logTail.slice(0, 400))
        const flsText = await readFileSafe(fops, pathutil.join(runDir, 'final.fls'))
        const inputLines = flsText.split('\n').filter((line) => line.startsWith('INPUT '))
        const cwdNorm = pathutil.normalize(runDir)
        for (const line of inputLines) {
          const raw = line.slice(6).trim()
          if (!raw) continue
          // .fls entries may be relative to the build cwd (the run dir).
          const inputPath = pathutil.isAbsolute(raw) ? pathutil.normalize(raw) : pathutil.normalize(pathutil.join(runDir, raw))
          if (inputPath.startsWith(cwdNorm + '/')) continue
          if (inputPath.includes('/texmf-dist/') || inputPath.startsWith('/usr/local/texlive/') || inputPath.startsWith('/Library/TeX/')) continue
          record.forbiddenInputs.push(raw)
        }
        record.workspaceLocalInputs = inputLines.map((line) => line.slice(6).trim()).filter((p) => {
          const resolved = pathutil.isAbsolute(p) ? pathutil.normalize(p) : pathutil.normalize(pathutil.join(runDir, p))
          return resolved.startsWith(cwdNorm + '/')
        })
        if (record.forbiddenInputs.length > 0) {
          record.staticErrors.push('Unexpected workspace-external inputs in the build: ' + record.forbiddenInputs.slice(0, 5).join(', '))
        }
        if (args.reproducibleProfile === true) {
          const build2 = await strictTexBuild(fops, subprocess, baseDir, runDir, 'final.tex')
          record.reproducible = {
            profile: true,
            firstPdfHash: record.pdfHash,
            secondPdfHash: build2.pdfHash,
            equal: record.pdfHash === build2.pdfHash && record.pdfHash !== '',
          }
        }
      }
      record.ok = staticResult.ok && record.wordCount === null ? false : (record.budgetOk === false ? false : record.clean !== false ? record.staticErrors.length === 0 && record.compiled : false)
      record.ok = record.staticErrors.length === 0 && (!record.compiled || record.clean)
      if (args.coveragePath && args.nodeOutputs) {
        const coveragePath = await resolveInput(fops, baseDir, runDir, args.coveragePath, { mustExist: true })
        const coverage = await fops.readJson(coveragePath)
        const contributions = {}
        for (const [nodeId, path] of Object.entries(args.nodeOutputs)) {
          contributions[nodeId] = await fops.readJson(await resolveInput(fops, baseDir, runDir, path, { mustExist: true }))
        }
        const coverageResult = core.validateCoverage(coverage, finalTex, { contributions })
        record.coverage = coverageResult
        if (!coverageResult.ok) {
          record.ok = false
          record.staticErrors.push('Coverage validation failed: ' + coverageResult.errors.slice(0, 5).join('; '))
        }
      }
      return record
    })

    // ── 27b. render_preview (visual inspection: page images + page count) ───

    tool('autoresearch_render_preview', 'Render the integration PDF to per-page PNG images for visual inspection and return the page count plus an optional page-budget check. Builds the PDF first (strict latexmk) when missing, rasterizes via pdftoppm → mutool → gs, and writes images under <runDir>/preview/. The integration editor reads these images with read_image to check page-limit overflow and formatting.', {
      type: 'object', additionalProperties: true,
      properties: {
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
        runDir: { type: 'string', description: 'Integration run directory containing the compiled PDF (or the TeX to build).' },
        mainFile: str('TeX main file name without extension (default final).'),
        dpi: { type: 'number', description: 'Render DPI (default 150; clamped to 72–600).' },
        pageBudget: { type: 'number', description: 'Optional page limit for a mechanical page-count check.' },
      },
    }, async (args, exec) => {
      assertCoordinator(exec)
      if (subprocess === undefined) throw new Error('subprocess service unavailable; cannot render the PDF.')
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      const runDir = args.runDir ? abs(baseDir, args.runDir) : baseDir
      return await renderPreview(fops, subprocess, baseDir, runDir, {
        mainFile: args.mainFile ?? 'final',
        dpi: args.dpi,
        pageBudget: args.pageBudget,
      })
    })

    // ── 28. migration_diagnostic (plan §4.2, non-mutating) ─────────────────

    tool('autoresearch_migration_diagnostic', 'Report the exact contradictory fields of an inconsistent approved plan and a proposed v2 revision diff. Never rewrites the plan: execution stays blocked until a human approves a new plan revision. Legacy status/history remain readable while blocked.', {
      type: 'object', additionalProperties: true,
      properties: {
        plan: { type: 'object', additionalProperties: true, description: 'The plan object (takes precedence over path).' },
        path: str('Optional plan.json path relative to the workspace root.'),
        projectId: str('Optional project id used to derive the default path.'),
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      const baseDir = sessionBaseDir(exec, args)
      const fops = makeFops(baseDir)
      let plan = util.isPlainObject(args.plan) ? args.plan : null
      let planPath = ''
      if (!plan) {
        if (typeof args.path === 'string' && args.path.trim()) {
          planPath = args.path.trim()
        } else if (typeof args.projectId === 'string' && args.projectId.trim()) {
          planPath = projectstate.planPath(baseDir, args.projectId)
        } else {
          throw new Error('Provide either plan, path, or projectId.')
        }
        const loaded = await fops.readJson(abs(baseDir, planPath))
        if (!util.isPlainObject(loaded)) throw new Error('plan.json missing or not valid JSON: ' + planPath)
        plan = loaded
      }
      const before = JSON.stringify(plan)
      const diagnostic = core.legacyMigrationDiagnostic(plan, { planPath: planPath || null })
      const after = JSON.stringify(plan)
      if (before !== after) throw new Error('migration diagnostic mutated the plan — aborting')
      return {
        ok: true,
        ...diagnostic,
        planByteIdentical: before === after,
        instruction: diagnostic.instruction,
      }
    })

    // ── 29. build_probe (plan §4.5 / WP5) ──────────────────────────────────

    tool('autoresearch_build_probe', 'Report the mounted build generation, the expected aggregate build ID, the recomputed disk graph hashes, and graphMatches. Both preset entries (orchestrator and Linear) must report the same candidate aggregate ID and graphMatches:true after a remount.', {
      type: 'object', additionalProperties: true,
      properties: {
        baseDir: str('Workspace root. Defaults to the calling session workspace.'),
      },
    }, async (args, exec) => {
      assertCallingAgent(exec)
      if (subprocess === undefined) throw new Error('subprocess service unavailable; cannot hash the runtime graph')
      const baseDir = sessionBaseDir(exec, args)
      const probe = await runBuildProbe(subprocess, baseDir)
      return {
        ok: probe.graphMatches,
        generation: probe.generation,
        schemaVersion: probe.schemaVersion,
        expectedAggregateId: probe.expectedAggregateId,
        embeddedAggregateId: EMBEDDED_BUILD_ID,
        actualAggregateId: probe.actualAggregateId,
        graphMatches: probe.graphMatches,
        graph: probe.graph,
        mismatches: probe.mismatches,
        mountedUrl: import.meta.url,
        entry: 'research-orchestrator',
      }
    })

    return undefined
  },
}

export default ORCHESTRATOR_PLUGIN

// Libraries exposed for the external test harness and tooling. The plugin
// loader consumes only the default export; the extra exports are inert in the
// composition.
export const createLibraries = {
  pathutil,
  util,
  config,
  roles,
  resume,
  lifecycle,
  scoring,
  redact,
  presearch,
  profiles,
  spawn,
  modelparse,
  rolePrompt,
  modelRegistry,
  planvalidate,
  projectstate,
  core,
  embeddedRolePrompts,
  helpers: {
    loadRunContract,
    loadAcceptance,
    computeRunDigest,
    readRunAndDigest,
    runSubprocess,
    strictTexBuild,
    renderPreview,
    validateNodeTex,
    runBuildProbe,
    buildRoleTaskBase,
    enrichReconciliationRow,
    resolveInput,
    hashFile,
    hashBytes,
    readBytesForHash,
    baseDirOfRunDir,
    ensurePlanningScaffold,
    resetDownstreamState,
    preflightReadyNodes,
  },
}
