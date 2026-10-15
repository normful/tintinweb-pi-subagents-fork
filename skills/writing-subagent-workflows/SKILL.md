---
name: writing-subagent-workflows
description: "Use when authoring or editing a SubagentWorkflow script — pi-subagents' JS orchestration DSL: meta, agent() options, pipeline/parallel, caps, resume. Not the `workflow` tool's DSL."
---

# SubagentWorkflow Script Authoring Reference

A workflow script is a **plain JavaScript string** run in a worker thread inside a `vm` context with code generation off. The body is an async function body: top-level `await` and a bare `return` are both allowed.

> **Two other systems share this vocabulary and are NOT this one.** The `workflow` tool (when installed) has `dag()`, `tier`, `checkpoint()`, `verify()`, `judgePanel()`, `loopUntilDry()`, `contextMode` and `tools` — none of those exist here: `dag` is a `ReferenceError`, and `tier` throws as an unrecognised option. `@juicesharp/rpiv-workflow`'s `/wf` DSL (`defineWorkflow`, `produces`, `acts`) is a third, unrelated runtime. This file documents only `SubagentWorkflow`.

## 1. Invoking the tool

| Parameter | Notes |
|---|---|
| `script` | Inline source. Must open with `export const meta = { name, description }`. Limit 512 KiB (524288 chars). |
| `scriptPath` | A script file, absolute or project-relative. **Wins over `script`** — this is how an edited script is re-run. |
| `name` | A saved workflow. **Lowest precedence.** |
| `args` | Exposed to the script as the `args` global, verbatim. Must be JSON-shaped. |
| `resumeFromRunId` | `^wf_[a-z0-9-]{6,}$`. Same session only, and the run must have finished. |

At least one of `script` / `scriptPath` / `name` is required; precedence is `scriptPath` > `script` > `name`. Passing only `resumeFromRunId` re-runs that run's own script. `title` and `description` are not parameters — the `meta` block names the workflow, and an undeclared key is ignored rather than rejected.

Saved workflows resolve first-hit-wins through `<cwd>/.pi/workflows/` → `<cwd>/.agents/workflows/` → `<agentDir>/workflows/` → directories an installed pi package declares. A file counts only if it carries an `export const meta =` declaration; nothing is executed to decide that. The declaration is a stop sign rather than a filter: a `<name>.js` that the first-hit root holds **without** one fails the lookup with that path named, instead of falling through to a lower root's workflow of the same name.

The tool returns immediately with a task id and the run continues in the background. Its script is persisted to the session's temp directory and reported on a `Script:` line — edit that file and re-invoke with `scriptPath` to iterate.

## 2. `meta` — a pure literal, read before the script runs

```js
export const meta = {
  name: 'find-flaky-tests',          // required, non-empty
  description: 'Find flaky tests',   // required, non-empty; shown on the card
  whenToUse: 'When CI logs exist',   // optional, display only
  phases: [                          // optional; one entry per phase() call
    { title: 'Scan', detail: 'grep for retries', model: 'provider/model-id' },
  ],
}
```

`phases[].title` is required; `detail` and `model` are carried for display only — the runtime never reads them, and today's card and inspector render only the title. A `phase()` call whose title matches no declared entry simply gets its own group. Matching is fuzzy on purpose: `phase("Review")` and a declared `{ title: "Review changed files" }` are the same phase, because the titles are trimmed, lower-cased, and either being a prefix of the other counts. A declared phase that never gets a `phase()` call renders as a not-started placeholder, which is the reason to declare them at all.

The declaration is located by a string-, comment- and regex-aware brace scan, then the fragment is evaluated in an **empty** vm context under a 100 ms timeout. Keep it a plain literal — strings, numbers, booleans, arrays, plain objects. A reference to any outside binding throws `ReferenceError`, and template interpolation is rejected even when self-contained: `${...}` needs no globals and still fails. What is enforced is *evaluation*, not AST purity — a self-contained IIFE, a spread of an inline literal, and a computed key whose expression is itself a literal all evaluate here, so do not rely on the rule to stop you. Move anything dynamic into the body.

## 3. `agent(prompt, opts?)`

Spawns one real subagent — its own context window, tools and model — and resolves to:

| Case | Result |
|---|---|
| No `schema` | The agent's final text |
| `schema` given | The validated object (the host re-checks it against the schema) |
| Terminal failure, or the user skipped it from the inspector | `null` — the two are indistinguishable |
| A `schema` call whose answer missed the schema | `null` |
| Fatal: agent cap, unknown `resume` label, unusable `schema`, missing host capability | Throws; `parallel`/`pipeline` rethrow instead of folding it to `null` |

`opts` keys are a **closed allowlist** — any other key throws, naming the key. The full set:

| Option | Semantics |
|---|---|
| `label` | Display name in the progress tree, **and** the handle `resume` addresses. Defaults to the prompt's first line (≤60 chars). |
| `phase` | File this agent under a named group **without moving the ambient phase**. Use it inside `pipeline`/`parallel` stages, where the ambient `phase()` races. |
| `model` | `provider/modelId`, or a fuzzy name. |
| `agentType` | A registered agent type; defaults to `general-purpose` (built-ins `general-purpose`, `Explore`, `Plan`, plus custom agents). The name is **not** checked here — an unknown one resolves through the `fallbackSubagent` setting instead: `general-purpose` when unset, the configured agent when set to a name, and a refused spawn (`agent()` → `null`) when it is `none`. |
| `effort` | `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max`. Unset, the agent definition's level decides, then the parent's. |
| `isolation` | Exactly `"worktree"`. Per-call only — an agent file's `isolation:` does **not** apply to workflow children. |
| `gate` | A shell command run after the agent finishes. A non-zero exit fails the agent and folds the command's output into its error (10-minute timeout). For an isolated child it runs inside that child's worktree before cleanup. A gate that passes is stripped from the result. |
| `resume` | Continue the child that ran under that label, instead of starting fresh. |
| `schema` | A JSON Schema with `type: "object"` at its root, ≤64 KiB serialized. Becomes the child's `StructuredOutput` tool. |

**Combination rules.** `resume` cannot be combined with `agentType`, `model`, `isolation`, `effort`, `schema` or `gate` — a resumed child keeps the agent type, model, tree and tool contract it was started with. A `resume` label that never completed in this run is fatal and lists the known labels.

A blank `prompt`, `label` or `phase`, a non-object `opts`, a non-object `schema`, and an `effort` outside the list all throw where they are written — at top level that fails the run, and inside a stage it drops that item to `null` like any other stage throw.

**Model precedence:** `agent({ model })` > the `agentType` file's `model` > the parent session's model. A model the *script* names that cannot be resolved fails that one agent (`null`); a bad one only the agent file names falls back to the parent silently. Pin `model` explicitly when it matters.

## 4. `parallel` / `pipeline` / `workflow`

```js
await parallel(thunks)            // BARRIER: waits for every thunk
await pipeline(items, ...stages)  // no barrier: each item walks its own chain
```

- **`parallel` takes functions, not promises** — always `() => agent(...)`. A thunk that throws becomes `null` without taking its siblings down.
- **`parallel` is a barrier.** Every fast agent idles until the slowest finishes. Use it only when a later prompt genuinely needs *all* the prior results at once: deduplicating across the whole set, an early exit on a zero total, or a prompt that compares one result against the others. Flattening, mapping and filtering are not reasons — do those inside a stage.
- **`pipeline` has no barrier.** Each stage receives `(previousStageResult, originalItem, index)`, so later stages still see the original item and its index. A stage that throws drops that item to `null` and skips its remaining stages. Wall-clock is the slowest single chain.
- **Default to `pipeline`.**

```js
await workflow('repo-map', { root })   // or workflow({ scriptPath: '...' })
```

Runs another workflow inline, in the same worker and vm context, so it shares this run's concurrency cap, agent counter, abort signal, journal and budget by construction. Its phases render under their own `▸ <name>` group. **One level deep only** — a `workflow()` inside a child throws saying so. An unknown name, an unreadable path, a child with no `meta` or a child that will not parse all throw into the calling script, so `try`/`catch` to carry on.

## 5. `phase`, `log`, `args`, `budget`

- `phase(title)` — start a progress group; the `agent()` calls that follow join it. Inside `pipeline`/`parallel` stages, set `agent({ phase })` instead.
- `log(message)` — a progress line under the tree; `console.log/info/warn/error/debug` all alias to it. It goes to the run's progress log for the human reading the card, not to the tool result.
- `args` — the tool's `args`, verbatim; `undefined` when none was passed.
- `budget` — `{ total, spent(), remaining() }`. `total` is **always `null`** (pi has no token-target directive), so `while (budget.total && ...)` guards correctly never fire. `remaining()` is `Infinity`. `spent()` is real: output tokens this run's agents used, failed and skipped ones included.

## 6. Determinism and the JSON boundary

Read the clock or the RNG and the run can no longer be replayed from its journal, so `Date.now()`, `Math.random()` and argless `new Date()` **throw** (`Date.parse` and `Date.UTC` still work). There is no `import`/`require`, no filesystem, no network, no `setTimeout`, and no `eval`/`Function` (code generation is off in the vm, so both throw `EvalError`). The script is JavaScript, not TypeScript. Pass timestamps in through `args`, and derive ids from a loop index.

The script's return value and its `args` cross a JSON boundary. Both reject cycles, `BigInt`, symbols, functions, non-finite numbers, sparse arrays, `undefined` (permitted only as a top-level `args` value and as a top-level `undefined` **result**), symbol keys and non-plain objects — `Map`, `Set`, `Date` and class instances included. Return something plain and useful: the caller sees your return value, not the individual agents' outputs.

## 7. Caps

| Limit | Value |
|---|---|
| Agents per run, total | 1000 (exceeding it is fatal) |
| Items per `parallel` / `pipeline` call | 4096 |
| Nested `workflow()` calls per run | 256 (exceeding it is fatal) |
| Script length | 512 KiB |
| Schema size | 64 KiB serialized |
| Agents running at once | `max(1, min(16, cpus - 2))` |
| `gate` timeout | 10 minutes |

Agents over the concurrency figure queue behind a semaphore and start as slots free, so a 100-item fan-out does not run 100 at once.

The script may not contain control characters other than tab, carriage return and newline. A dropped `await` fails the run: if the script returns while launches are unanswered, it fails with `unawaited agent launch(es)` rather than throwing the results away.

## 8. Resume

`resumeFromRunId` replays the **unchanged leading prefix** of `agent()` calls from that run's journal, and runs everything from the first changed-or-failed call onward live. It is a prefix, not a lookup: once a position misses, every later call runs live. A journaled failure ends the prefix — which is exactly what makes "resume the run that died at agent 5" retry agent 5.

It will not cross sessions, will not resume a run that is still going (stop it from `/agents → Workflows` first), will not resume a run that never journaled (the `--subagents-workflow-file` path answers `has no journal to resume from`), and will not replay a run that used `agent({ resume })` at all — a replayed agent is text from a file, so there is no conversation left for a later `resume` to continue. Replayed rows are annotated `from resume journal`.

## 9. Rules

1. Give every `agent()` a unique `label` — it is both the progress-tree key and the handle `resume` addresses, and a duplicate silently makes `resume` continue whichever child ran under it last.
2. Default to `pipeline`; earn a `parallel` barrier or don't use one.
3. Pass `phase` as an **option** inside `pipeline`/`parallel` stages.
4. `.filter(Boolean)` after every `parallel`/`pipeline` and after every `schema` stage — a skipped or failed agent is a `null`.
5. Never call `Date.now()`, `Math.random()` or `new Date()`; pass or stamp timestamps via `args`, and vary ids by index.
6. Keep `meta` a pure literal; put anything dynamic in the body.
7. Await every `agent()` — an unawaited launch fails the run.
8. Prefer `schema` for handoff between stages: the script has no filesystem, so a stage's return value is the only in-run channel.
9. Prefer `gate` over asking a second model whether work works — a test suite is a stronger signal than an opinion.
10. Pin `model` explicitly when the choice matters. A misspelled `agentType` is not caught here — it resolves through `fallbackSubagent`, which defaults to `general-purpose` and can be `none` to refuse the spawn instead.
11. Use `resume` to keep a child's context across a retry loop; it is cheaper than a fresh spawn with the same brief.
12. Return a JSON-safe value — the caller reads it, not your agents' outputs.

## 10. Canonical shape

```js
export const meta = {
  name: 'auth-audit',
  description: 'Find routes missing auth checks, then refute each finding',
  phases: [{ title: 'Scan' }, { title: 'Audit' }, { title: 'Verify' }],
}

const root = args?.root ?? 'src/routes/'

phase('Scan')
const listing = await agent(`List every file under ${root}. One path per line, nothing else.`)
const files = listing.split('\n').map(s => s.trim()).filter(Boolean)
log(`auditing ${files.length} files`)

const VERDICT = {
  type: 'object',
  properties: { isReal: { type: 'boolean' }, why: { type: 'string' } },
  required: ['isReal'],
}

phase('Audit')
const findings = await pipeline(
  files,
  file => agent(`Audit ${file} for missing auth checks. Report findings or "none".`, {
    label: `audit:${file}`,
  }),
  (found, file) => agent(`Try to REFUTE this finding about ${file}: ${found}`, {
    label: `verify:${file}`,
    phase: 'Verify',        // explicit: the ambient phase races inside a stage
    schema: VERDICT,
    effort: 'low',
  }),
)

return findings.filter(Boolean).filter(v => v.isReal)
```

Five runnable examples ship in the extension's `examples/workflows/`: `fan-out-audit.js` (fan-out over a discovered list), `structured-findings.js` (`schema` on every stage), `gated-fix.js` (`gate` + `resume` retry loop), `review-panel.js` (an earned `parallel` barrier), `compose.js` (nested `workflow()` with `args`).
