# Contributing

## Development model

This repository begins as a runnable snapshot of the installed AutoResearch
preset. The generation-suffixed entries in `tools/` are generated runtime
artifacts and must remain internally consistent with `tools/build-manifest.json`.
Do not edit the installed preset under `~/.dsh` as a development workflow.

For a change:

1. Create a branch and keep the change scoped to the preset, documentation, or
   portable build tooling.
2. Add synthetic tests or fixtures. Never commit `.research-agent/` contents,
   real Linear issues, model transcripts, credentials, fetched copyrighted
   content, or user briefs unless redistribution is explicitly authorized.
3. Run `node scripts/verify-snapshot.mjs` before opening a pull request.
4. State whether the change updates the runtime generation, manifest, role
   prompts, skill contract, or public documentation.

## Testing requirements

Tests must run with temporary directories and fake services by default. Network,
Linear, and model-provider checks must be opt-in and must not run in ordinary
CI without explicitly configured secrets. Preserve the invariant that an
approved `plan.json` is immutable, `state.json` is a mutable receipt journal,
and Linear is a derived view.

## Prompt and workflow changes

Role prompts and skills are public interface. When changing them, document the
behavioral contract, preserve blind judging where applicable, and avoid claims
that a model's causal attribution proves a root cause. The causal-backtracking
design is documented in `docs/causal-backtracking-plan.zh-CN.md` and remains a
design document until implemented and tested.
