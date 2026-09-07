# Compaction summarization omits `reasoningEffort`: checkpoint quality and `maxTokens` semantics silently diverge per model route

**Packages observed:** `@deepseek-ai/dsh-compaction-basic@0.1.2-rc.1`, `@deepseek-ai/dsh-llm-deepseek@0.1.2-rc.1`, vendored pi-ai (OpenAI-compatible completions path).

## Summary

The automatic compaction summarization call in `dsh-compaction-basic` builds its `llm.stream()` options **without a `reasoningEffort`**. Because reasoning-budget handling is adapter-specific, the same `BasicCompactionConfig.maxTokens` value means different things depending on the route:

- **Native DeepSeek:** the adapter sends one shared `max_tokens` and, when the request omits an effort, falls back to the deployment's default reasoning effort. Reasoning and the answer share the cap.
- **pi-ai OpenAI-compatible routes:** pi-ai's own code documents the hazard — "Reasoning and the answer share max_tokens here, so an uncapped reasoning phase can consume the whole response and leave no answer and no tool call" — and its answer-room guard (`thinking_token_budget`) only activates when `options.reasoningEffort` is present. The compaction call never passes it, so the guard never fires.
- **Qwen thinking dialect in pi-ai:** with no effort on the request, `enable_thinking = !!options.reasoningEffort` becomes `false`, so on the current code path the checkpoint is produced with thinking silently disabled.

The operator therefore cannot express "compact with low reasoning, summary text ≤ 8192 tokens". What they actually get — a shared pool where reasoning can eat the summary cap, or silently disabled reasoning — is chosen by the route, not by policy.

## Why this matters

Compaction quality is the foundation of long-running agents: every checkpoint determines what the agent still remembers. A route-dependent, undocumented divergence in whether and how much the summarizer reasons means:

1. Identical preset configuration produces different checkpoint quality per model — a correctness/portability bug in the compaction seam, not a tuning issue.
2. `maxTokens` is documented as a generation cap for the summary, but in practice bounds either summary+reasoning or a thinking-disabled call. The policy table has `summarizationProvider`, `summarizationModel`, and `maxTokens`, but **no summarization reasoning effort**.
3. The failure mode is silent: summaries truncate ("incomplete checkpoint") or degrade without any error.
4. It is hard to diagnose from durable events: `compaction/summary` records `maxTokens` and `usage` (which includes `reasoning_tokens` on the DeepSeek route) but not the effective reasoning effort of the summarize call.

## Evidence

1. **Summarize call carries no effort** — `dsh-compaction-basic/lib/index.js`, `summarizeWithLlm()`:
   ```js
   const options = {
     provider, model, messages,
     system, tools,
     maxTokens: config.maxTokens,
     sessionId,
     purpose: "compaction",
     signal,
   }
   ```
   No `reasoningEffort` field.

2. **The config surface has no field for it** — `dsh-compaction-basic/lib/types/types.d.ts`, `CompactionPolicyConfig`:
   `thresholdRatio`, `retainRatio`, `retainTokens`, `summarizationProvider`, `summarizationModel`, `maxTokens`, `compactionRetries`, `maxOverflowRetries`. No reasoning-effort option exists.

3. **pi-ai documents the shared-cap hazard and gates the fix on the missing field** — `@earendil-works/pi-ai/dist/api/openai-completions.js`:
   - Comment above the budget emission: "Reasoning and the answer share max_tokens here, so an uncapped reasoning phase can consume the whole response and leave no answer and no tool call."
   - `resolveClampedThinkingBudget()`: `if (!options?.reasoningEffort || !model.reasoning) return undefined`
   - Qwen dialect: `params.enable_thinking = !!options?.reasoningEffort`

4. **Native DeepSeek adapter has no budget split** — `dsh-llm-deepseek/lib/index.js`, `requestWithMessages()`: sends `max_tokens` only. `resolveThinking()` falls back to `defaults.reasoningEffort` when the request omits one (the adapter's own fallback chain ends at HIGH when thinking is enabled). Usage parsing confirms reasoning lives inside completion usage: `usage.completion_tokens_details.reasoning_tokens`.

## Real-world impact

On a long-running research preset using local Qwen with xhigh reasoning, the default 8192 summary cap was consumed by reasoning tokens, truncating every checkpoint in the final stretch ("incomplete checkpoint" warnings) — losing late-run context exactly when it matters most. The workaround in use is blunt: raise the policy `maxTokens` to 32768, enlarging the shared pool instead of fixing the split, which accepts oversized checkpoints and reduced context headroom.

## Proposed fix

1. Add a `reasoningEffort` option to the compaction summarization policy (sensible default: inherit the conversation's latest effort, or a conservative `low`), and pass it on the summarize call.
2. With the effort present, pi-ai's thinking-budget guard activates and reserves answer room, so `maxTokens` again means the summary-text budget. For native DeepSeek, an explicit effort removes the deployment-default ambiguity.
3. Record the effective reasoning effort on the `compaction/summary` event so cross-route divergence becomes auditable.

This is a small, contained change in `dsh-compaction-basic` (one option field, one request field, one event field) that makes the policy expressible and the semantics uniform across adapters.
