/**
 * agent-tool-description.ts — the model-facing `Agent` tool description, and the
 * agent catalogue the `list_agents` tool returns.
 *
 * Kept out of index.ts for the same reason `src/workflow/tool-description.ts` is:
 * the prose is large and re-sent on every turn, and trimming it means reading it
 * next to the catalogue renderer it depends on instead of 1,500 lines into the
 * extension factory.
 *
 * Everything here is a pure function of its inputs. The roster arrives as
 * accessors rather than an array so listing order and liveness stay the
 * registry's business; the two feature gates arrive as booleans, because they
 * are read once at tool registration and the prose each one decides has to
 * vanish together with the parameter it describes.
 */

import { homedir } from "node:os";
import { basename, dirname, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
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
 * The one-character scope badge a catalogue row carries.
 *
 * Built-in scope only: extension tools are resolved when the agent runs
 * (extensions can register asynchronously), so they cannot be enumerated while
 * the catalogue is built. That is why an agent with `tools: "*, ext:mcp/search"`
 * reads `w` and always has.
 *
 * Three distinctions are capability claims the orchestrator acts on, and each
 * keeps its own badge:
 *
 * - `w` — the agent can edit: it holds `write` or `edit`, or it never narrowed
 *   its tools (`builtinToolNames: undefined`, the shipped defaults) and so has
 *   every built-in. Treating absent as "read-only" would tell the orchestrator an
 *   agent cannot write when it can.
 * - `r` vs `s` — no `write`/`edit` does NOT mean an agent cannot change the
 *   repository: `bash` can, and agents that hold `bash` while holding no editing
 *   tool are ordinary. `r` is a claim that the agent only reads, so shell-only
 *   agents get `s` instead of inheriting it.
 * - `e` vs `-` — zero built-ins is not zero tools: `tools: none` alongside
 *   `extensions:` still surfaces every extension tool (see
 *   test/fixtures/.pi/agents/tools-none.md, which expects three). Calling that
 *   `-` would route work away from the only agent that could do it, so `-` is
 *   reserved for agents that genuinely can call nothing: `isolated` agents and
 *   those with `extensions: false`, which the runner treats the same way.
 */
export type ScopeTag = "r" | "s" | "w" | "e" | "-";

export function scopeTag(cfg: AgentConfig | undefined): ScopeTag {
  const tools = cfg?.builtinToolNames;
  if (!tools) return "w";
  if (tools.length === 0) {
    const noExtensionTools = cfg?.isolated === true || cfg?.extensions === false;
    return noExtensionTools ? "-" : "e";
  }
  if (tools.includes("write") || tools.includes("edit")) return "w";
  return tools.includes("bash") ? "s" : "r";
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
 * This is what the every-turn descriptions carry. A row per agent — its
 * description, its file and its scope — is the catalogue below: ~2 KB per call
 * here and rendered into this extension's tool spec twice if it were inlined,
 * so it is built on demand rather than paid for on every turn.
 */
function rosterNames(roster: AgentRoster): string {
  return roster.availableTypes().join(", ");
}

/**
 * Where the catalogue resolves directory addresses: the ambient paths are the
 * defaults so the legend can be rendered deterministically by a test.
 */
export interface CataloguePaths {
  /** A directory here or below reads `~/…`. */
  home: string;
  /** A directory here or below drops the prefix and reads relative. */
  cwd: string;
}

/** `~/…` under home, relative under cwd, absolute otherwise. */
function abbreviateDir(dir: string, paths: CataloguePaths): string {
  if (dir === paths.cwd || dir.startsWith(paths.cwd + sep)) {
    return dir.slice(paths.cwd.length + 1) || ".";
  }
  if (dir === paths.home || dir.startsWith(paths.home + sep)) {
    return `~${dir.slice(paths.home.length)}`;
  }
  return dir;
}

/** What each `scope:` badge means, in the order the badges run from most to least capable. */
const SCOPE_LEGEND =
  "scope: r=read-only, s=shell (can write via bash), w=write/edit, e=extension tools only, -=no tools";

/**
 * The catalogue: two legend lines, then one row per agent.
 *
 * A row is `- <dir> <scope> <name>: <description>`, both one-letter tags
 * resolving against the legend. Repeating a path or a tool list per row costs
 * more than the legend that replaces them, and the description is the only part
 * whose length varies with what an author wrote — so it is capped by `summarize`
 * and everything else is fixed-width.
 *
 * Reached on demand only: the `list_agents` tool returns it. An empty registry
 * renders empty rather than a legend with no rows under it.
 */
export function buildAgentCatalogue(
  roster: AgentRoster,
  paths: CataloguePaths = { home: homedir(), cwd: process.cwd() },
): string {
  const names = roster.availableTypes();
  if (names.length === 0) return "";

  // Directories are numbered in the order the rows first mention them; 0 is for
  // the embedded defaults, which have no file of their own.
  const dirs = new Map<string, number>();
  let hasEmbedded = false;
  const dirIndexOf = (cfg: AgentConfig | undefined): number => {
    const path = cfg?.sourcePath;
    if (!path) {
      hasEmbedded = true;
      return 0;
    }
    const dir = abbreviateDir(dirname(path), paths);
    const existing = dirs.get(dir);
    if (existing !== undefined) return existing;
    const index = dirs.size + 1;
    dirs.set(dir, index);
    return index;
  };

  const rows = names.map((name) => {
    const cfg = roster.agentConfig(name);
    const dir = dirIndexOf(cfg);
    // The legend names a row's file as `<dir>/<type>.md`, which is what the loader
    // derives the type from. A file whose frontmatter `name:` overrides its
    // filename loads under the declared name, so that row prints its own filename
    // instead — the alternative is naming a path the reader cannot open.
    const file = cfg?.sourcePath ? basename(cfg.sourcePath) : undefined;
    const fileHint = file && file !== `${name}.md` ? ` (file: ${file})` : "";
    return `- ${dir} ${scopeTag(cfg)} ${name}: ${summarize(cfg?.description ?? name)}${fileHint}`;
  });

  const legend = [...dirs].map(([dir, index]) => `${index}=${dir}`);
  if (hasEmbedded) legend.unshift("0=built-in (no file)");
  const fileLegend = dirs.size > 0 ? "  (each agent's file: <dir>/<type>.md)" : "";
  return [`dirs: ${legend.join(" ")}${fileLegend}`, SCOPE_LEGEND, ...rows].join("\n");
}

export interface AgentToolDescriptionInput {
  roster: AgentRoster;
  /** `toolDescriptionMode`, read once at tool registration. */
  mode: ToolDescriptionMode;
  /**
   * Both gates are read once at registration, and both decide prose that must
   * disappear together with the schema field it describes. Left in, the prose
   * would teach the model to pass a parameter that is no longer declared:
   * accepted (TypeBox sets no `additionalProperties: false`), then silently
   * dropped by the resolver.
   */
  schedulingEnabled: boolean;
  worktreeIsolationEnabled: boolean;
}

/**
 * Build the Agent tool description for one registration.
 *
 * The mode picks between two sources: `compact` swaps in a ~70% smaller
 * description for small/local models (#91); anything else is the `full`
 * description. Only the prose is swappable; the parameter schema stays
 * code-owned.
 */
export function createAgentToolDescription(input: AgentToolDescriptionInput): string {
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

  return mode === "compact" ? compactAgentToolDescription : fullAgentToolDescription;
}
