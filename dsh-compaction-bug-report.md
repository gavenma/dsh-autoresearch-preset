**Bug: compaction policy never reserves headroom for the model's output budget — context-window errors after repeated compactions**

DSH version: 0.1.2-rc.1 (via npx), `@deepseek-ai/dsh-compaction-basic` 0.1.2-rc.1

**Reproduction**

1. Any pi-ai route (openai-completions) whose `maxTokens` is a large fraction of `contextWindow`. My setup: local Qwen 27B, `contextWindow: 262144`, `maxTokens: 60000` in `settings.yaml` (same behavior observed at `49152`).
2. Long tool-heavy session, default compaction policy (`thresholdRatio: 0.8`, `retainRatio: 0.16`, summarization `maxTokens: 8192`, `maxOverflowRetries: 1`).
3. After a few automatic compactions, the turn fails with a provider context-window error: the reserved output plus the (still over-threshold) compacted input exceed the window.

**Why it fails** (verified in the `dsh-compaction-basic` source)

- `resolveCompactSpec()` computes `thresholdTokens = floor(window * thresholdRatio)` and `retainTokens = floor(window * retainRatio)`; the only invariant checked is `retainTokens < thresholdTokens`. Proactive compaction stops once total tokens drop below `thresholdTokens` (80% of the window).
- Nothing in the spec, the compaction target, or the validation references the model's output budget. The next request still reserves the full configured `maxTokens`, so the real constraint `input + system/tools + maxTokens <= window` is never enforced: `0.8 + 60000/262144 (= 0.229) = 1.029` of the window — mathematically unfillable. At `49152` (`0.187`) it is `0.987`: it only fits if the token estimate is accurate to under 1.3% across ~210k tokens, so any meter-vs-provider tokenizer gap overflows.
- Overflow recovery (fires on `CONTEXT_WINDOW_EXCEEDED`, one retry by default) compacts again, but there is no knob to target `window - maxTokens - margin`; when the remaining floor (system prompt + tools + checkpoint summary) or a failed summarization call (README: it "proceeds with the full over-budget history") keeps the estimate high, the original request error is preserved and the turn fails.
- `modelPolicies` can tune `thresholdRatio`/`retainRatio` per route but cannot express output headroom; the invariant `thresholdRatio + maxTokens/window <= 1` is neither computed nor validated anywhere.

**Suggested fix**

Make the compaction target output-budget-aware (`contextWindow - outputBudget - margin`), or validate/warn the invariant per route at load, or add a `reserveTokens` policy field with per-model override via `modelPolicies`.
