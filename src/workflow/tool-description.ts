/**
 * tool-description.ts — the model-facing description of the `SubagentWorkflow` tool.
 *
 * A port of Claude Code's `Workflow` tool description, trimmed hard. The tool
 * spec is re-sent on every turn, and the untrimmed text had grown to ~20 KB —
 * mostly duplicated examples and justification for advice that does not need
 * justifying at call time. What survives is what the runtime enforces or the
 * model cannot infer: the opt-in rule, the `meta` shape, the `agent()` option
 * set and its mutual exclusions, the other globals, the caps, and one canonical
 * shape.
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
 * Kept out of index.ts purely for size. The live agent roster is passed in at
 * registration, because a description that names no agents is a description the
 * model cannot call `agentType` against.
 */

/**
 * Rendered with the live agent type names at the top of the `agentType` bullet.
 * Keep the prose accurate to what the runtime actually implements — documenting
 * a global we do not ship is worse than documenting nothing, because the script
 * only fails once it is running.
 * `workflow-tool-description.test.ts` pins the parts that can drift: the
 * `agent()` option set, the `resume` exclusions, the effort levels, the caps,
 * and that every example here uses options the runtime actually accepts.
 *
 * The floor this cannot go below, and why each piece is load-bearing:
 *   - the opt-in gate — a policy the runtime cannot enforce for the user;
 *   - the pure-literal `meta` shape — the runtime rejects a non-literal;
 *   - one `agent(prompt, {...})` options literal — the test's only source of
 *     checkable examples. The canonical shape is written with brace-free option
 *     objects on purpose: the test's example parser uses `[^{}]*`, so an
 *     options object containing a `${…}` interpolation is invisible to it.
 *   - all nine option names, with `resume`'s six exclusions on ONE physical
 *     line (the test matches `opts\.resume[^\n]*`), so that bullet is one long
 *     line no matter how the rest of the prose is wrapped;
 *   - the effort parenthetical verbatim, and the three cap figures;
 *   - the literal `${f.title}` — the sentinel for unescaped source templating.
 */
export function fullWorkflowToolDescription(agentNames: string): string {
  return `Execute a workflow script that orchestrates multiple subagents deterministically. Returns a task ID immediately; the run continues in the background and notifies you on completion (/agents → Workflows).

ONLY call this when the user explicitly opted into multi-agent orchestration — in their own words ("use a workflow", "fan out agents"), via a skill or slash command that says to, or by naming a saved workflow. A workflow can spawn dozens of agents and cost a lot of tokens, so the user must ask for that scale. Otherwise use the Agent tool, or say what a workflow could do and what it would cost, and ask.

Pass the script inline via \`script\`, as a file via \`scriptPath\` (wins over \`script\`), or as a saved \`name\` (lowest precedence; read from \`.pi/workflows/<name>.js\`, \`.agents/workflows/\`, the agent dir, or an installed pi package). Every invocation persists its script under the session directory and returns its path — edit that file and re-invoke with \`scriptPath\` to iterate.

Every script must begin with \`export const meta = {...}\` — a PURE LITERAL, with no variables, calls, spreads or interpolation:
  export const meta = {
    name: 'find-flaky-tests',         // required, non-empty
    description: 'Find flaky tests',  // required; shown on the run's card
    phases: [{ title: 'Scan' }],      // optional; one entry per phase() call
  }

Body globals:
- agent(prompt, opts?): Promise<any> — spawn a subagent; returns its final text, or the object validated against opts.schema. opts.label names it in the UI and is the handle opts.resume addresses; opts.phase sets a progress group (use it inside pipeline()/parallel() stages, where the ambient phase() races); opts.model and opts.effort override the model and the reasoning effort for this agent call ('minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'), defaulting to the agent's level then the parent's; opts.isolation: 'worktree' gives it a git worktree (removed on settle, changes kept on a branch); opts.gate: '<command>' fails the child on a non-zero exit; opts.agentType picks a registered type over the default; opts.resume: '<label>' continues that child, and excludes opts.agentType, opts.model, opts.isolation, opts.effort, opts.schema and opts.gate, which it keeps from its first run. Unknown options throw. Types for opts.agentType:
${agentNames}
- pipeline(items, ...stages): no barrier — each item walks its own chain, so wall-clock is the slowest one; a throwing stage drops its item to \`null\`. Default to this.
- parallel(thunks): a barrier that waits for all; a throwing thunk resolves to \`null\` (filter with \`.filter(Boolean)\`), except a fatal run error, which propagates.
- log(message), phase(title): a progress line for the human; a progress group for the agent() calls that follow.
- args: the object passed as \`args\`, verbatim — JSON values only, never a JSON-encoded string.
- budget: {total, spent(), remaining()} — total is always null, spent() is this run's output tokens, remaining() is Infinity.
- workflow(nameOrRef, args?): run another workflow inline, sharing caps, counter, abort signal and budget; one level of nesting only.

Plain JavaScript, not TypeScript, in an async context. No \`Date.now()\`, \`Math.random()\`, argless \`new Date()\`, \`eval\`, \`Function(...)\`, filesystem or Node.js APIs. Caps: concurrency min(16, available CPUs - 2), a lifetime capped at 1000 agents, at most 4096 items per pipeline()/parallel() call.

Canonical shape:
  const dims = ['bugs', 'perf']
  const results = await pipeline(dims,
    d => agent(\`Review for \${d}\`, {label: 'review', phase: 'Review', schema: FINDINGS}),
    review => parallel(review.findings.map(f => () =>
      agent(\`REFUTE \${f.title}\`, {label: 'verify', phase: 'Verify'}))))
  return results.filter(Boolean)

Scale the fan-out to the ask. For determinism, \`resumeFromRunId\` replay and the orchestration recipes, see the \`writing-subagent-workflows\` skill.
`;
}
