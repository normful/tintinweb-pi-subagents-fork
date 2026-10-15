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
 * The long-form reference ships as the `workflow-authoring` skill
 * (`skills/workflow-authoring/SKILL.md`). `workflowToolExposure` decides how it
 * reaches the model: `"skill"` (the default) leaves the pointer below, `"inline"`
 * swaps the skill body in for the pointer so a model cannot skip it, and
 * `"deferred"` carries the inline body because the tool is only declared once
 * `tool_search` loads it.
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
 * `disallowedTools`, `agentError()`, the saved-workflow directories, and the
 * reject-unknown-options guarantee.
 * Parts omitted because pi has no such feature: the `ultracode` opt-in, MCP
 * tools reached through `ToolSearch`, the `agent-<id>.jsonl` resume fallback,
 * and the `/config` workflow-size guideline.
 *
 * Kept out of index.ts purely for size. The live agent type names are passed in
 * at registration, because a description that names no agents is a description
 * the model cannot call `agentType` against.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WorkflowToolExposureMode } from "../settings.js";

/**
 * The shipped skill, resolved from this module: `src/workflow/` and
 * `dist/workflow/` both sit two levels below the package root.
 */
export const WORKFLOW_SKILL_PATH = fileURLToPath(new URL("../../skills/workflow-authoring/SKILL.md", import.meta.url));

/** The one line that stands in for the reference; `inline` swaps the skill body in for it. */
const WORKFLOW_SKILL_POINTER =
  `Before writing a script, load the \`workflow-authoring\` skill (read \`${WORKFLOW_SKILL_PATH}\`) — `
  + "the workflow authoring reference: script API and gotchas, resume, quality patterns, worked examples.";

/**
 * Heads the inline body. pi lists the same skill in the system prompt, and
 * without this line a model read SKILL.md on top of the identical body.
 */
const WORKFLOW_SKILL_INLINE_LEAD = "Do not load the `workflow-authoring` skill: its full text follows.";

/**
 * Rendered with the live agent type names at the top of the `agentType` bullet.
 * Keep the prose, here and in the skill, accurate to what the runtime implements
 * — documenting a global we do not ship is worse than documenting nothing,
 * because the script only fails once it is running.
 *
 * `workflow-tool-description.test.ts` pins the parts that can drift: the
 * `agent()` option set, the `resume` exclusions, the effort levels, the caps,
 * and that every example here uses options the runtime actually accepts.
 * `workflow-skill.test.ts` pins the split between this text and the skill.
 *
 * The floor this cannot go below, and why each piece is load-bearing:
 *   - the opt-in gate — a policy the runtime cannot enforce for the user;
 *   - the pure-literal `meta` shape — the runtime rejects a non-literal;
 *   - one `agent(prompt, {...})` options literal — the test's only source of
 *     checkable examples. The canonical shape is written with brace-free option
 *     objects on purpose: the test's example parser uses `[^{}]*`, so an
 *     options object containing a `${…}` interpolation is invisible to it.
 *   - all ten option names, with `resume`'s seven exclusions on ONE physical
 *     line (the test matches `opts\.resume[^\n]*`), so that bullet is one long
 *     line no matter how the rest of the prose is wrapped;
 *   - the effort parenthetical verbatim, and the three cap figures;
 *   - the literal `${f.title}` — the sentinel for unescaped source templating;
 *   - `WORKFLOW_SKILL_POINTER` verbatim, because `inline` replaces it by value
 *     and a silent mismatch would ship the pointer with the body appended.
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
- agent(prompt, opts?): Promise<any> — spawn a subagent; returns its final text, or the object validated against opts.schema. opts.label names it in the UI and is the handle opts.resume addresses; opts.phase sets a progress group (use it inside pipeline()/parallel() stages, where the ambient phase() races); opts.model and opts.effort override the model and the reasoning effort for this agent call ('minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'), defaulting to the agent's level then the parent's; opts.isolation: 'worktree' gives it a git worktree (removed on settle, changes kept on a branch); opts.gate: '<command>' fails the child on a non-zero exit; opts.agentType picks a registered type over the default; opts.disallowedTools: ['Bash', ...] denies those tools on top of its type's own deny list; opts.resume: '<label>' continues that child, and excludes opts.agentType, opts.model, opts.isolation, opts.effort, opts.schema, opts.disallowedTools and opts.gate, which it keeps from its first run. Unknown options throw. Types for opts.agentType:
${agentNames}
- agentError(label): string | undefined — why the most recent agent() call with this label failed (capped at 500 characters), or undefined if it succeeded or none has settled yet. agent() still returns null; read agentError(label) after the null to report the reason. Use an explicit, unique label — concurrent calls sharing one overwrite each other.
- pipeline(items, ...stages): no barrier — each item walks its own chain, so wall-clock is the slowest one; a throwing stage drops its item to \`null\`, and only a fatal run error (a cap breach, an unusable schema, an unknown \`resume\` label) propagates. Default to this.
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

Scale the fan-out to the ask. \`meta\` also accepts \`whenToUse\`; for determinism, \`resumeFromRunId\` replay and the orchestration recipes, see the workflow authoring reference.

${WORKFLOW_SKILL_POINTER}
`;
}

/**
 * The description for the `workflowToolExposure` setting. `"skill"` (the
 * default) keeps the pointer, several thousand tokens lighter per session;
 * `"inline"` swaps the skill's body in for the pointer, headed by a line saying
 * not to load the listed skill as well, so the model cannot skip it; `"deferred"`
 * gets the inline body, because exposure rather than this text is what it saves.
 * Read from the shipped file, so the reference still has one source. A missing
 * or unreadable file falls back to the pointer, with a warning.
 */
export function workflowToolDescription(mode: WorkflowToolExposureMode, agentNames: string): string {
  const description = fullWorkflowToolDescription(agentNames);
  if (mode === "skill") return description;
  let body: string;
  try {
    body = readFileSync(WORKFLOW_SKILL_PATH, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  } catch (error) {
    console.warn(`[pi-subagents] workflowToolExposure is "${mode}" but ${WORKFLOW_SKILL_PATH} could not be read — using "skill": ${String(error)}`);
    return description;
  }
  return description.replace(WORKFLOW_SKILL_POINTER, () => `${WORKFLOW_SKILL_INLINE_LEAD}\n\n${body}`);
}
