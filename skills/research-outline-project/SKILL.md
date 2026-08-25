---
name: research-outline-project
description: "Run AutoResearch from a substantial user-supplied outline, staged plan, table of contents, work breakdown, or specification: preserve its structure through a traceable v2 plan, then use the standard research-project execution pipeline unchanged."
whenToUse: "Use when the user supplies a substantial outline or plan and asks AutoResearch to execute it. Use research-project for vague briefs."
---

# AutoResearch Outline-Led Project Mode

Use this skill when the user supplies a substantial outline, staged plan, table of contents, work breakdown, specification, or other concrete decomposition and asks AutoResearch to execute it.

This is a planning specialization, not a second execution workflow. It shares the existing `research-project` pipeline after planning: approved v2 `plan.json`, Linear issue reconciliation, dependency-ordered per-node AutoReason loops, integration preflight/editor/verifier, acceptance receipts, redaction, and finalization all remain unchanged.

## Mode boundary

- Treat the user's outline as an authoritative planning input. Treat it as intent and structure, not as approval: still produce a plan draft, refine it, validate it, and present it through `exit_plan_mode`.
- Do not silently replace, broaden, or compress the outline. Preserve every required deliverable, section, milestone, constraint, ordering rule, and acceptance condition in the resulting DAG, or explicitly surface why a transformation is required.
- The immutable approved `plan.json` remains the sole execution specification. Linear remains a derived view. After approval, follow the normal `research-project` skill without special outline behavior.
- This mode changes only Phase 1 planning. Do not alter node execution, role semantics, budgets, integration, revision routing, or finalization.

## Outline intake

Before spawning the planner:

1. Read the complete brief and supplied outline, including headings, numbered items, dependencies, exclusions, source requirements, format limits, and explicit acceptance tests.
2. Normalize the outline into `.research-agent/planning/<projectId>/outline-traceability.md`. Each outline item must map to an intended node ID, node acceptance-criterion ID, or `projectContract` acceptance-criterion ID. Record any item intentionally combined, split, or represented only as a dependency. This is a planning audit artifact, not runtime state.
3. Ask the user only about material ambiguity that cannot be resolved from the outline and repository. Ask before choosing between conflicting deliverables, incompatible scope or length constraints, or an unspecified artifact format that materially changes the work. Do not ask permission to use the outline itself.
4. If the outline conflicts with the brief or repository facts, report the exact conflict and ask which requirement governs. Never hide the conflict in planner prose.
5. Complete the standard `research-project` Step 0 planning-budget confirmation, including `config.planning`, before the first planning role is spawned.

## Planner task

Run `research_planner` with the full brief, verbatim outline, and traceability checklist. Restate these requirements in the task because a workspace-seeded planner prompt may predate this preset version:

- preserve outline order where it expresses information flow, while introducing only dependencies needed for correctness;
- create one node per independently reviewable deliverable or section/component, splitting an outline item only when it contains separate outputs or parallel work;
- create an assembly node when multiple outline components form one document, then the mandatory integration node;
- retain all outline constraints as node acceptance criteria, project acceptance criteria, `expectedOutcome`, `test`, or `outputContract` fields;
- ensure every outline item has a traceable disposition and no node owns unapproved extra scope;
- distinguish user-mandated structure from planner recommendations in the rationale;
- return schemaVersion 2 only, with stable IDs and a complete DAG accepted by `autoresearch_plan_validate`.

The planner must include `## Outline traceability` after `## Plan rationale` and before `## Plan JSON`, listing every outline item and its target node or criterion IDs. The JSON remains the machine-readable source of truth.

## Outline-aware refinement

Use the same planning AutoReason loop and budgets as `research-project`. Pass the outline and traceability checklist to the critic, revising planner, synthesizer, and judges. Add these checks to the planning critic task:

- no outline item is omitted, weakened, or silently renamed;
- node boundaries reflect independently deliverable outline units;
- dependencies preserve required ordering without serializing independent work;
- all constraints and acceptance tests are mechanically represented;
- the integration node depends on every leaf, and assembly is present when required;
- proposed additions are labeled as recommendations and require user approval when they change scope.

After every planning pass, extract and run `autoresearch_plan_validate`. Before presentation, reconcile `outline-traceability.md` against the winning plan and require every referenced node and criterion ID to resolve. If a required item has no mapping, do not present the plan; ask the user or run another planner refinement pass.

## Handoff

After approval, write the same approved v2 `plan.json` and empty `state.json`, create or reconcile Linear issues one per node, and continue with the standard `research-project` execution procedure. Do not create a second executor, alternate issue schema, or outline-specific runtime state.
