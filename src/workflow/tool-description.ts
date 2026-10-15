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
 * recipes you can ask for by name. The long-form authoring reference ships as
 * the `writing-subagent-workflows` skill in this package, which the prose names
 * — a dangling reference wherever skills are disabled, so every contract the
 * runtime enforces stays inline rather than only in the skill.
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
 * Rendered with `{{agentNames}}` substituted. Keep the prose accurate to what the
 * runtime actually implements — documenting a global we do not ship is worse
 * than documenting nothing, because the script only fails once it is running.
 * `workflow-tool-description.test.ts` pins the parts that can drift: the
 * `agent()` option set, the `resume` exclusions, the effort levels, the caps,
 * and that every example here uses options the runtime actually accepts.
 *
 * The floor the trim cannot go below: the opt-in gate, the `meta` literal, one
 * `agent(prompt, {...})` literal for the test's example parser to check, all
 * nine option names in one run-on line per `resume`'s exclusion sentence, the
 * three cap figures, and one canonical pattern carrying `${f.title}`.
 */
export const fullWorkflowToolDescription = `Execute a workflow script that orchestrates multiple subagents deterministically. Returns a task ID immediately; the run continues in the background and notifies you on completion. Watch progress in /agents → Workflows.

ONLY call this when the user explicitly opted into multi-agent orchestration — in their own words ("use a workflow", "fan out agents", "orchestrate this with subagents"), via a skill or slash command that says to, or by naming a saved workflow. Workflows can spawn dozens of agents and cost a lot of tokens, so the user must ask for that scale. Otherwise use the Agent tool, or say what a workflow could do and roughly what it would cost, and ask.

Pass the script inline via \`script\` — do not Write it to a file first. Every invocation persists its script under the session directory and returns the path, so iterating means editing that file and re-invoking with \`{scriptPath: "<path>"}\`. A script you will re-run belongs in \`.pi/workflows/<name>.js\` (or \`.agents/workflows/\`, the agent dir, or a directory an installed pi package declares), called with \`name: "<name>"\`.

Every script must begin with \`export const meta = {...}\` — a PURE LITERAL, with no variables, function calls, spreads or template interpolation:
  export const meta = {
    name: 'find-flaky-tests',
    description: 'Find flaky tests and propose fixes',   // one-line, shown in permission dialog
    phases: [{ title: 'Scan', detail: 'grep test logs for retries' }],   // one entry per phase() call
  }
  // body: agent()/parallel()/pipeline()/phase()/log()
  phase('Scan')
  const flaky = await agent('grep CI logs for retry markers', {schema: FLAKY_SCHEMA})
  ...

Required: \`name\`, \`description\`. Optional: \`whenToUse\`, \`phases\`, \`model\` per phase entry; phase titles must match the \`phase()\` calls exactly.

Script body hooks:
- agent(prompt, opts?): Promise<any> — spawn a subagent; returns its final text, or the validated object with opts.schema. opts.label is the UI label; opts.phase assigns a progress group (needed inside pipeline()/parallel() stages, where the global phase() races); opts.model overrides the model; opts.effort overrides the reasoning effort for this agent call ('minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'), defaulting to the agent's level then the parent's; opts.isolation: 'worktree' gives it a git worktree (removed on settle, changes kept on a branch); opts.gate: '<command>' verifies the child by running a command, failing on a non-zero exit; opts.agentType picks a registered type instead of the default; opts.resume: '<label>' continues the child from that label, and excludes opts.agentType, opts.model, opts.isolation, opts.effort, opts.schema and opts.gate, which the resumed child keeps from its first run. Unknown options throw. Types for opts.agentType:
{{agentNames}}
- pipeline(items, ...stages): run each item through all stages independently, with no barrier between them — wall-clock is the slowest chain; a throwing stage drops its item to \`null\`. Prefer this.
- parallel(thunks): run thunks concurrently and wait for all of them; a throwing thunk resolves to \`null\` (filter out with \`.filter(Boolean)\`), except a fatal run error, which propagates.
- log(message), phase(title): a progress line; a progress group for the agent() calls that follow.
- args: the object passed as SubagentWorkflow's \`args\`, verbatim — pass JSON values, never a JSON-encoded string.
- budget: {total, spent(), remaining()} — total is always null (pi has no token target), spent() is this run's output tokens, remaining() is Infinity.
- workflow(nameOrRef, args?): run another workflow inline, sharing caps, agent counter, abort signal and budget; nesting is one level only.

Scripts are plain JavaScript, not TypeScript, and run in an async context. No \`Date.now()\`, \`Math.random()\`, argless \`new Date()\`, \`eval\`, \`Function(...)\`, filesystem or Node.js APIs — pass timestamps in via \`args\` and vary randomness by index.

Caps: concurrency min(16, available CPUs - 2) per workflow; a run's lifetime capped at 1000 agents; one pipeline()/parallel() call accepts at most 4096 items.

Canonical pattern:
  const results = await pipeline(
    [{key: 'bugs', prompt: '...'}, {key: 'perf', prompt: '...'}],
    d => agent(d.prompt, {label: \`review:\${d.key}\`, phase: 'Review', schema: FINDINGS_SCHEMA}),
    review => parallel(review.findings.map(f => () =>
      agent(\`Adversarially verify: \${f.title}\`, {label: \`verify:\${f.file}\`, phase: 'Verify'})
        .then(v => ({...f, verdict: v}))
    ))
  )
  return { confirmed: results.flat().filter(Boolean).filter(f => f.verdict?.isReal) }

Scale the fan-out to the ask. For determinism, \`resumeFromRunId\` replay and the orchestration recipes, see the \`writing-subagent-workflows\` skill.
`;
