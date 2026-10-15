/**
 * agent-tool-description.ts — the model-facing `Agent` tool description, and the
 * roster renderer it is built from.
 *
 * Kept out of index.ts for the same reason `src/workflow/tool-description.ts` is:
 * the prose is large and re-sent on every turn, and trimming it means reading it
 * next to the roster renderer it depends on instead of 1,500 lines into the
 * extension factory.
 *
 * Everything here is a pure function of its inputs. The roster arrives as
 * accessors rather than an array so listing order and liveness stay the
 * registry's business; the two feature gates arrive as booleans, because they
 * are read once at tool registration and the prose each one decides has to
 * vanish together with the parameter it describes (see `{{isolationGuideline}}`
 * / `{{scheduleGuideline}}` below).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOL_NAMES } from "./agent-types.js";
import type { ToolDescriptionMode } from "./settings.js";
import type { AgentConfig } from "./types.js";

/** How the roster renderers reach the live agent registry. */
export interface AgentRoster {
  /** Every type pi can currently spawn, in listing order. */
  availableTypes: () => string[];
  /** That type's config, or undefined when it has none registered. */
  agentConfig: (type: string) => AgentConfig | undefined;
}

/**
 * Format an agent's tool scope for the Agent tool description.
 *
 * This suffix describes BUILT-IN scope only — extension tools are resolved when
 * the agent runs (extensions can register asynchronously), so they cannot be
 * enumerated while the description is being built. That is why an agent with
 * `tools: "*, ext:mcp/search"` renders "*" and always has.
 *
 * Two distinctions matter, both of them capability claims the orchestrator acts on:
 *
 * - absent vs empty. `builtinToolNames: undefined` means the agent never narrowed
 *   its tools (the shipped defaults); `[]` is what `tools: none` and an `ext:`-only
 *   `tools:` parse to, and the runtime really does hand those agents no built-ins.
 *   Rendering both "*" tells the orchestrator a tool-less agent can run `bash`.
 * - empty-with-extensions vs empty-without. Zero built-ins does NOT imply zero
 *   tools: `tools: none` alongside `extensions:` still surfaces every extension
 *   tool (see test/fixtures/.pi/agents/tools-none.md, which expects three). Calling
 *   that "none" understates the agent instead of overstating it — better, but still
 *   wrong, and it would route work away from the only agent able to do it. "none"
 *   is therefore reserved for agents that genuinely can call nothing: `isolated`
 *   agents and those with `extensions: false`.
 */
export function formatToolsSuffix(cfg: AgentConfig | undefined): string {
  const tools = cfg?.builtinToolNames;
  if (!tools) return "*";
  if (tools.length === 0) {
    // `isolated` overrides extensions to false in the runner, so both mean the
    // agent has no extension tools either — and then it truly has nothing.
    const noExtensionTools = cfg?.isolated === true || cfg?.extensions === false;
    return noExtensionTools ? "none" : "no built-ins, extension tools only";
  }
  const isFullSet =
    tools.length === BUILTIN_TOOL_NAMES.length
    && BUILTIN_TOOL_NAMES.every((t) => tools.includes(t));
  return isFullSet ? "*" : tools.join(", ");
}

/** Derive a short model label from a model string. */
export function getModelLabelFromConfig(model: string): string {
  // Strip provider prefix (e.g. "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6")
  const name = model.includes("/") ? model.split("/").pop()! : model;
  // Strip trailing date suffix (e.g. "claude-haiku-4-5-20251001" → "claude-haiku-4-5")
  return name.replace(/-\d{8}$/, "");
}

/** First sentence of an agent description, whitespace-flattened. */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s|$)/s);
  return (match ? match[0] : text).replace(/\s+/g, " ").trim();
}

/**
 * Character cap for one catalogue row's description.
 *
 * 80 keeps the "what it is" clause, which is what routes work, and drops the
 * "use when" clause that usually follows it. The shipped agents run from 146 to
 * 544 characters, so without a cap a row's length is whatever its author wrote.
 */
export const ROSTER_ROW_MAX = 80;

/**
 * One catalogue row's worth of an agent description: its first sentence, capped.
 *
 * `firstSentence` alone is not a bound — a description with no internal `.`, `!`
 * or `?` passes through whole, and real ones run to 544 characters. This is the
 * bound.
 */
export function summarize(text: string, max = ROSTER_ROW_MAX): string {
  const flat = firstSentence(text);
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  // Break on a word boundary only when it keeps most of the budget: a first word
  // longer than half the cap would otherwise leave "A…" where a hard cut still
  // keeps a usable fragment.
  const head = boundary > max / 2 ? cut.slice(0, boundary) : cut;
  return `${head.trimEnd()}…`;
}

/**
 * The bare roster: every available type name, comma-separated, on one line.
 *
 * This is what the every-turn descriptions carry. A row per agent with its
 * description, model and tool scope is the catalogue below — 7.5 KB with 19
 * agents, and rendered into this extension's tool spec twice — so it is built on
 * demand rather than paid for on every turn.
 */
function rosterNames(roster: AgentRoster): string {
  return roster.availableTypes().join(", ");
}

/**
 * The catalogue: one row per agent, with a capped description, its model and its
 * tool scope.
 *
 * Rows are capped by `summarize` so that asking for the catalogue cannot itself
 * become the context problem it replaced. Reached on demand only: the `list_agents`
 * tool returns it, and a custom template reaches it through `{{typeList}}`.
 */
function buildTypeListText(roster: AgentRoster): string {
  return roster.availableTypes().map((name) => {
    const cfg = roster.agentConfig(name);
    const modelSuffix = cfg?.model ? ` (${getModelLabelFromConfig(cfg.model)})` : "";
    const toolsSuffix = ` (Tools: ${formatToolsSuffix(cfg)})`;
    return `- ${name}: ${summarize(cfg?.description ?? name)}${modelSuffix}${toolsSuffix}`;
  }).join("\n");
}

/** Compact type list: one line per agent, first sentence only. */
function buildCompactTypeListText(roster: AgentRoster): string {
  return roster.availableTypes().map((name) => {
    const cfg = roster.agentConfig(name);
    return `- ${name}: ${firstSentence(cfg?.description ?? name)} (Tools: ${formatToolsSuffix(cfg)})`;
  }).join("\n");
}

export interface AgentToolDescriptionInput {
  roster: AgentRoster;
  /** `toolDescriptionMode`, read once at tool registration. */
  mode: ToolDescriptionMode;
  /**
   * Both gates are read once at registration, and both decide prose that must
   * disappear together with the schema field it describes — see the note on
   * `{{isolationGuideline}}` in the README. Left in, the prose would teach the
   * model to pass a parameter that is no longer declared: accepted (TypeBox sets
   * no `additionalProperties: false`), then silently dropped by the resolver.
   */
  schedulingEnabled: boolean;
  worktreeIsolationEnabled: boolean;
}

export interface AgentToolDescriptions {
  /** The description the Agent tool registers. */
  agentToolDescription: string;
  /** `{{placeholder}}` substitution, reused for the workflow tool's description. */
  renderTemplate: (template: string) => string;
  /**
   * The catalogue, rendered live — what the `list_agents` tool returns.
   *
   * Function rather than string: the roster is read at call time, so an agent
   * added mid-session shows up without re-registering anything.
   */
  renderCatalogue: () => string;
}

/**
 * Build the Agent tool description for one registration.
 *
 * The mode picks among three sources: `compact` swaps in a ~70% smaller
 * description for small/local models (#91); `custom` registers a user-authored
 * `<cwd>/.pi/agent-tool-description.md` (project, then `<agentDir>`) whose
 * dynamic parts stay live via `{{placeholder}}` substitution; anything else —
 * including a `custom` mode with no usable file, which warns and falls back to
 * `full`, since a stale fallback beats a blank tool description. Only the prose
 * is customizable; the parameter schema stays code-owned.
 */
export function createAgentToolDescription(input: AgentToolDescriptionInput): AgentToolDescriptions {
  const { roster, mode, schedulingEnabled, worktreeIsolationEnabled } = input;

  const scheduleGuideline = schedulingEnabled
    ? `\n- Use \`schedule\` only when the user explicitly asked for scheduled / recurring / delayed execution (e.g. "every Monday", "in an hour"). Don't auto-schedule from vague intent like "monitor X" — run once now or ask.`
    : "";

  const isolationGuideline = worktreeIsolationEnabled
    ? `\n- Use isolation: "worktree" to give the agent its own git worktree (safe parallel file modifications); leave it unset, or pass "off", for none. The worktree is removed when the agent finishes; if it made changes, they are committed to a branch and the branch is named in the result.`
    : "";

  const isolationCompactGuideline = worktreeIsolationEnabled
    ? `\n- isolation: "worktree" gives the agent its own git worktree (removed on completion); changes land on a branch named in the result.`
    : "";

  // Compact Agent tool description (#91, `toolDescriptionMode: "compact"`) —
  // the same load-bearing facts as the full version at ~70% fewer characters
  // (1.3 KB against 4.2 KB with the shipped agents), for small/local models.
  // Per-option details live in the param descriptions.
  const compactAgentToolDescription = `Launch an autonomous agent for complex, multi-step tasks. Agent types:
${rosterNames(roster)}

Custom agents: .pi/agents/<name>.md (project) or ${getAgentDir()}/agents/<name>.md (global). \`list_agents\` says what each type does.

Notes:
- description: 3-5 words. Prompts must be self-contained — the agent has not seen this conversation.
- Parallel work: one message, multiple Agent calls — they run concurrently.
- Background by default; you'll be notified when one completes. Pass run_in_background: false only when your next action depends on the result, and never fabricate or predict a pending agent's results.
- The result is not shown to the user — summarize it, and verify claimed code changes before reporting work done.
- resume continues a previous agent by ID; steer_subagent messages a running one.${isolationCompactGuideline}`;

  const fullAgentToolDescription = `Launch a new agent to handle complex, multi-step tasks autonomously. Each agent type has specific capabilities and tools available to it — \`list_agents\` says what each one does.

Available agent types:
${rosterNames(roster)}

Custom agents can be defined in .pi/agents/<name>.md (project) or ${getAgentDir()}/agents/<name>.md (global) — they are picked up automatically. Project-level agents override global ones; a file named after a default agent overrides it.

## Usage notes

- If the target is already known, use a direct tool — \`read\`, \`grep\`, \`find\`. Reserve this tool for open-ended work, or a task that matches an agent type's description.
- Send independent work as multiple Agent calls in one message; they run concurrently. Never repeat work you delegated.
- Agents run in the background by default and you are notified on completion — do not sleep, poll, or predict results. Pass \`run_in_background: false\` only when your next action needs the result and nothing else could usefully happen meanwhile.
- The result is not shown to the user — summarize it, and verify an agent's actual changes before reporting its work as done. The prompt must be self-contained: a new call has no memory of prior runs, so include the file paths, line numbers and constraints it needs. \`resume\` continues an earlier agent by ID, \`steer_subagent\` messages a running one, \`inherit_context\` forks this conversation into it, and \`model\` / \`thinking\` override its defaults.${isolationGuideline}${scheduleGuideline}

## Writing the prompt

Brief the agent like a smart colleague who just walked into the room — state the goal, what you already learned or ruled out, and the exact command for a lookup, rather than prescribed steps. Never delegate understanding: name the file, the line, and what specifically to change, because terse command-style prompts produce shallow work.`;

  const renderTemplate = (template: string): string => {
    const vars: Record<string, () => string> = {
      typeList: () => buildTypeListText(roster),
      compactTypeList: () => buildCompactTypeListText(roster),
      agentNames: () => rosterNames(roster),
      agentDir: getAgentDir,
      isolationGuideline: () => isolationGuideline,
      scheduleGuideline: () => scheduleGuideline,
    };
    // Replacement callback (not a string) — agent descriptions may contain `$&` etc.
    return template.replace(/\{\{(\w+)\}\}/g, (raw, name: string) => {
      if (vars[name]) return vars[name]();
      console.warn(`[pi-subagents] agent-tool-description.md: unknown placeholder ${raw} left as-is`);
      return raw;
    });
  };

  const loadCustomToolDescription = (): string | undefined => {
    for (const path of [
      join(process.cwd(), ".pi", "agent-tool-description.md"),
      join(getAgentDir(), "agent-tool-description.md"),
    ]) {
      try {
        if (!existsSync(path)) continue;
        const text = readFileSync(path, "utf-8").trim();
        if (text) return renderTemplate(text);
        console.warn(`[pi-subagents] ${path} is empty — ignoring`);
      } catch (err) {
        console.warn(`[pi-subagents] failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return undefined;
  };

  const agentToolDescription = (() => {
    if (mode === "compact") return compactAgentToolDescription;
    if (mode === "custom") {
      const custom = loadCustomToolDescription();
      if (custom) return custom;
      console.warn('[pi-subagents] toolDescriptionMode is "custom" but no agent-tool-description.md found — using "full"');
    }
    return fullAgentToolDescription;
  })();

  return { agentToolDescription, renderTemplate, renderCatalogue: () => buildTypeListText(roster) };
}
