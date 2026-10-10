/**
 * tool-description.ts — the model-facing description of the `SubagentWorkflow` tool.
 *
 * A port of Claude Code's `Workflow` tool description, trimmed hard. The tool
 * spec is re-sent on every turn, and the untrimmed text had grown to ~20 KB —
 * mostly duplicated examples and justification for advice that does not need
 * justifying at call time. What survives is what the runtime enforces or the
 * model cannot infer: the opt-in rule, the `meta` shape, the `agent()` option
 * set and its mutual exclusions, the hooks, the caps, and one canonical example.
 *
 * The orchestration patterns (adversarial verification, judge panels,
 * loop-until-dry, …) are deliberately not listed here any more: they are
 * methodology rather than tool API, and `docs/workflows.md` covers them as
 * recipes you can ask for by name.
 *
 * Clauses that deviate from Claude Code, each because its sentence would be
 * false about pi:
 *   - `schema` is pressure, not force — `toolChoice` is not plumbed through
 *     pi's `AgentSession`, so a child can decline and the call returns null.
 *   - `budget.total` is always null; pi has no token-target directive.
 *   - `parallel` propagates a fatal run error instead of folding it to null.
 *   - `effort` inherits the agent definition's level, then the parent's.
 *   - `isolation` removes the worktree on settle, changes kept on a branch.
 * Additions with no upstream counterpart: `gate`, `resume`, `effort: "minimal"`,
 * the saved-workflow directories, and the reject-unknown-options guarantee.
 * Parts omitted because pi has no such feature: the `ultracode` opt-in, MCP
 * tools reached through `ToolSearch`, the `agent-<id>.jsonl` resume fallback,
 * and the `/config` workflow-size guideline.
 *
 * Kept out of index.ts purely for size. `{{placeholder}}` tokens are rendered by
 * the same substitution pass the Agent tool's description uses, so a
 * user-authored override can interpolate the live agent roster.
 */

/**
 * Rendered with `{{typeList}}` substituted. Keep the prose accurate to what the
 * runtime actually implements — documenting a global we do not ship is worse
 * than documenting nothing, because the script only fails once it is running.
 * `workflow-tool-description.test.ts` pins the parts that can drift: the
 * `agent()` option set, the `resume` exclusions, the effort levels, the caps,
 * and that every example here uses options the runtime actually accepts.
 */
export const fullWorkflowToolDescription = `Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a task ID, and you are notified when the workflow completes. Use /agents → Workflows to watch live progress.

ONLY call this tool when the user has explicitly opted into multi-agent orchestration: in their own words ("use a workflow", "fan out agents", "orchestrate this with subagents"), via a skill or slash command that says to, or by asking for a named or saved workflow. Workflows can spawn dozens of agents and consume a large amount of tokens — the user must request that scale. Otherwise do NOT call it, even when a workflow would clearly help: use the Agent tool, or say what a workflow could do and roughly what it would cost, and ask.

The right move is often **hybrid**: scout inline first (list the files, find the channels, scope the diff) to discover the work-list, then pipeline over it. You do not need to know the shape of the work before the *task* — only before the *orchestration step*.

Pass the script inline via \`script\` — do not Write it to a file first. Every invocation persists its script under the session directory and returns the path, so iterating means editing that file and re-invoking with \`{scriptPath: "<path>"}\`. A script you will run more than once belongs in \`.pi/workflows/<name>.js\` (or \`.agents/workflows/\`, \`<agent dir>/workflows/\`), called with \`name: "<name>"\`.

Every script must begin with \`export const meta = {...}\` — a PURE LITERAL, with no variables, function calls, spreads or template interpolation:
  export const meta = {
    name: 'find-flaky-tests',
    description: 'Find flaky tests and propose fixes',   // one-line, shown in permission dialog
    phases: [                                            // one entry per phase() call
      { title: 'Scan', detail: 'grep test logs for retries' },
      { title: 'Fix', detail: 'one agent per flaky test' },
    ],
  }
  // body: agent()/parallel()/pipeline()/phase()/log()
  phase('Scan')
  const flaky = await agent('grep CI logs for retry markers', {schema: FLAKY_SCHEMA})
  ...

Required: \`name\`, \`description\`. Optional: \`whenToUse\`, \`phases\`, and \`model\` on a phase entry. Phase titles match the \`phase()\` calls exactly — an unmatched title just gets its own progress group.

Script body hooks:
- agent(prompt, opts?): Promise<any> — spawn a subagent and return its final text, or — with opts.schema, a JSON Schema — the validated object. opts.label is the display label; opts.phase assigns a progress group explicitly (do it inside pipeline()/parallel() stages, where the global phase() races); opts.model overrides the model for this call; opts.effort overrides the reasoning effort for this agent call ('minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'), defaulting to the agent definition's level and then the parent's; opts.isolation: 'worktree' gives the agent a git worktree (removed on settle, changes kept on a branch) — EXPENSIVE, so only for agents mutating files in parallel; opts.gate: '<command>' runs a shell command after the agent finishes and fails it on a non-zero exit; opts.agentType uses a registered agent type instead of the default workflow subagent; opts.resume: '<label>' continues the child that ran under that label, keeping its context. It excludes opts.agentType, opts.model, opts.isolation, opts.effort, opts.schema and opts.gate, which the resumed child keeps from its first run. Any other option is rejected by name at the call. Available types for opts.agentType:
{{typeList}}
- pipeline(items, stage1, stage2, ...): Promise<any[]> — run each item through all stages independently, NO barrier between stages; wall-clock is the slowest single chain. Stages receive (prevResult, originalItem, index), and a stage that throws drops its item to \`null\`. The DEFAULT for multi-stage work.
- parallel(thunks: Array<() => Promise<any>>): Promise<any[]> — run tasks concurrently: a BARRIER that awaits every thunk. A thunk that throws (or whose agent errors) resolves to \`null\` — \`.filter(Boolean)\` before use — except a fatal run error, which propagates; use ONLY when you genuinely need all results together.
- log(message: string): void — a progress line to the user.
- phase(title: string): void — group the agent() calls that follow under this title.
- args: any — the value passed as SubagentWorkflow's \`args\`, verbatim. Pass arrays and objects as JSON values, NOT as a JSON-encoded string — a stringified list arrives as one string, so \`args.filter\` throws.
- budget: {total, spent(), remaining()} — \`budget.total\` is always null here (pi has no token-target directive), so \`while (budget.total && ...)\` never fires; \`spent()\` is this run's output tokens, \`remaining()\` is \`Infinity\`.
- workflow(nameOrRef, args?): Promise<any> — run another workflow inline, sharing this run's caps, agent counter, abort signal and budget; its \`args\` are the child's. Nesting is one level only: workflow() inside a child throws.

A schema stage can still return \`null\`: the child gets one more prompt if it never answers through StructuredOutput, and a skipped or terminally-failed agent is null too — filter after every schema stage.

Scripts are plain JavaScript, NOT TypeScript — type annotations, interfaces and generics fail to parse — and the body runs in an async context. Standard JS built-ins are available, EXCEPT \`Date.now()\`/\`Math.random()\`/argless \`new Date()\` (they would break resume): pass timestamps in via \`args\` and vary randomness by index. \`eval\`, \`Function(...)\`, the filesystem and Node.js APIs are unavailable.

DEFAULT TO pipeline(). A barrier is justified only when stage N needs ALL of stage N-1's results at once — dedup or merge across the full set, an early exit on a total of zero, or a comparison against "the other findings". Flattening, mapping or filtering is NOT a reason: do it inside a stage. When in doubt: pipeline.

Concurrency is capped at min(16, available CPUs - 2) per workflow, so 100 items still finish with only ~10 agents running at any moment. A run's lifetime is capped at 1000 agents, and one parallel()/pipeline() call accepts at most 4096 items — more is an explicit error, not a silent truncation.

The canonical multi-stage pattern:
  const DIMENSIONS = [{key: 'bugs', prompt: '...'}, {key: 'perf', prompt: '...'}]
  const results = await pipeline(
    DIMENSIONS,
    d => agent(d.prompt, {label: \`review:\${d.key}\`, phase: 'Review', schema: FINDINGS_SCHEMA}),
    review => parallel(review.findings.map(f => () =>
      agent(\`Adversarially verify: \${f.title}\`, {label: \`verify:\${f.file}\`, phase: 'Verify', schema: VERDICT_SCHEMA})
        .then(v => ({...f, verdict: v}))
    ))
  )
  return { confirmed: results.flat().filter(Boolean).filter(f => f.verdict?.isReal) }

Run larger work as several workflows in sequence, reading each result before deciding the next, and scale the fan-out to the ask: a few finders for "find any bugs", a larger pool with a 3-5 vote verify and a synthesis stage for "thoroughly audit this".

## Resume

The tool result includes a runId: relaunch with SubagentWorkflow({scriptPath, resumeFromRunId}) to replay a paused, killed or edited run — the longest unchanged prefix of agent() calls returns cached results instantly, and everything from the first edited or new call onward runs live. It is a prefix, not a lookup: a later unchanged call is not reused once an earlier one changed. Same session only, and the run must have finished (stop it from /agents → Workflows first).
`;
