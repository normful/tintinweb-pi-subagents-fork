/**
 * tool-spec-budget.test.ts — the ceiling on what this extension costs per turn.
 *
 * Every string here is re-sent on every turn of every session: `description`
 * and `promptSnippet` and `promptGuidelines` all fold into the tool spec or the
 * system prompt, so a generous description is a per-turn tax. The refactor this
 * file guards took the shipped-default spec from ~32 KB to ~13 KB by (a) not
 * embedding the agent catalogue in the every-turn descriptions, (b) not
 * repeating the roster list in `subagent_type`, and (c) trimming prose. Each of
 * those three can silently come back — reinstating the catalogue is the easy
 * way to make the tool descriptions clearer, and it costs ~7 KB.
 *
 * So the assertions are structural where they can be, because structural ones
 * survive a legitimate rewrite: the catalogue's rows must not appear in the
 * every-turn text (they are `list_agents`' payload), no agent's own description
 * may be inlined, and the roster names must resolve. The absolute budgets are
 * the backstop, deliberately loose enough for a few more shipped agents and
 * tight enough to catch a re-embed.
 *
 * This file also owns the `scope:` badge assertions. They render through
 * `list_agents`, the real path — the badge is what the orchestrator reads before
 * choosing an agent, so it is asserted against a booted extension rather than a
 * unit-tested helper.
 */

import { describe, expect, it } from "vitest";
import { ROSTER_ROW_MAX, summarize } from "../src/agent-tool-description.js";
import { getAgentConfig, getAvailableTypes } from "../src/agent-types.js";
import subagentsExtension from "../src/index.js";
import { ctx, hermeticDir, makePi, textOf } from "./helpers/boot-extension.js";

/** The per-turn surface of one registered tool, in characters. */
function specOf(tool: any) {
  const description: string = tool.description ?? "";
  const snippet: string = tool.promptSnippet ?? "";
  const guidelines = JSON.stringify(tool.promptGuidelines ?? []);
  const parameters = JSON.stringify(tool.parameters ?? {});
  return {
    description,
    snippet,
    guidelines,
    parameters,
    total: description.length + snippet.length + guidelines.length + parameters.length,
  };
}

/**
 * Boot the real extension hermetically — temp cwd, temp agent dir, no settings —
 * so the roster is exactly the shipped defaults and cannot grow with whatever
 * `.pi/agents/` the developer happens to have.
 */
async function boot(agentFiles: Record<string, string> = {}) {
  const hermetic = hermeticDir({ agentFiles });
  const { pi, tools, lifecycle } = makePi();
  subagentsExtension(pi);
  const catalogue = async () =>
    textOf(await tools.get("list_agents").execute("id", {}, undefined, undefined, ctx()));
  return {
    tools,
    catalogue,
    async restore() {
      await lifecycle.get("session_shutdown")?.({}, { hasUI: false, ui: {} });
      hermetic.restore();
    },
  };
}

describe("per-turn tool-spec budget", () => {
  it("keeps every tool's description within its ceiling", async () => {
    const booted = await boot();
    try {
      const spec = (name: string) => specOf(booted.tools.get(name));
      // The roster adds ~18 characters per agent to the two descriptions that
      // carry it; these ceilings hold a couple dozen more shipped agents.
      expect(spec("Agent").description.length).toBeLessThanOrEqual(3000);
      expect(spec("SubagentWorkflow").description.length).toBeLessThanOrEqual(4400);
      expect(spec("list_agents").description.length).toBeLessThanOrEqual(400);
      expect(spec("list_agents").snippet.length).toBeLessThanOrEqual(80);
      expect(spec("get_subagent_result").description.length).toBeLessThanOrEqual(300);
      expect(spec("steer_subagent").description.length).toBeLessThanOrEqual(300);
    } finally {
      await booted.restore();
    }
  });

  it("keeps the whole per-turn spec within its ceiling", async () => {
    const booted = await boot();
    try {
      const total = [...booted.tools.values()].reduce((sum, t) => sum + specOf(t).total, 0);
      // ~12.2 KB with the three shipped defaults. The pre-refactor spec was
      // 31,945 characters with 18 agents, most of it the catalogue, twice.
      expect(total).toBeLessThanOrEqual(13800);
    } finally {
      await booted.restore();
    }
  });

  it("keeps the catalogue and its rows on demand, out of every every-turn description", async () => {
    const booted = await boot();
    try {
      const catalogue = await booted.catalogue();
      const everyTurn = ["Agent", "SubagentWorkflow"]
        .map(name => booted.tools.get(name).description as string)
        .join("\n");

      // (a) No catalogue row — the `- <name>: …` shape — is inlined. This is the
      // regression that costs the most: a row is 60-160 characters, and there is
      // one per agent, in two descriptions at once.
      const rows = catalogue.split("\n").filter(line => line.startsWith("- "));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(everyTurn).not.toContain(row);
      }

      // (b) No agent's own description is inlined. Stated separately because a
      // re-embed could use a different row format and still leak the payload.
      for (const type of getAvailableTypes()) {
        const description = getAgentConfig(type)?.description;
        if (!description || description.length < 40) continue;
        expect(everyTurn).not.toContain(description);
      }

      // (c) The roster itself is expected — names only, on one line.
      for (const type of getAvailableTypes()) {
        expect(everyTurn).toContain(type);
      }
    } finally {
      await booted.restore();
    }
  });

  it("caps every catalogue row's description at ROSTER_ROW_MAX", async () => {
    const booted = await boot();
    try {
      // The cap's magnitude is the contract, so it is pinned independently of
      // the assertion below — otherwise raising ROSTER_ROW_MAX would raise the
      // expectation with it and the check would pass vacuously.
      expect(ROSTER_ROW_MAX).toBeLessThanOrEqual(100);

      const catalogue = await booted.catalogue();
      for (const type of getAvailableTypes()) {
        const description = getAgentConfig(type)?.description;
        if (!description) continue;
        const capped = summarize(description);
        expect(capped.length).toBeLessThanOrEqual(ROSTER_ROW_MAX + 1);
        // The row's description is exactly the capped first sentence — so the
        // bounding happens in the renderer, not merely in `summarize`.
        const row = catalogue.split("\n").find(line => line.includes(` ${type}: `));
        expect(row?.endsWith(`${type}: ${capped}`)).toBe(true);
      }
      // And no whole row runs away, whatever an author writes.
      for (const row of catalogue.split("\n")) {
        expect(row.length).toBeLessThanOrEqual(220);
      }
    } finally {
      await booted.restore();
    }
  });

  it("lists exactly the spawnable types, one row each, and names them all in the roster", async () => {
    const booted = await boot();
    try {
      const available = getAvailableTypes();
      const catalogue = await booted.catalogue();
      const rowNames = catalogue
        .split("\n")
        .map(line => line.match(/^- \d+ \S+ ([^:]+): /)?.[1])
        .filter((name): name is string => Boolean(name));
      // Agreement in both directions: no extra row for an unspawnable type, and
      // no type missing from the catalogue.
      expect(rowNames).toEqual(available);
      expect(new Set(rowNames).size).toBe(rowNames.length);

      // Every name the every-turn roster carries must resolve to something
      // spawnable — a stale name routes the model at a type that cannot spawn.
      const rosterLine = (booted.tools.get("Agent").description as string)
        .split("Available agent types:\n")[1]
        .split("\n")[0];
      for (const name of rosterLine.split(", ")) {
        expect(available).toContain(name);
      }
    } finally {
      await booted.restore();
    }
  });
});

/**
 * The `scope:` badge, rendered through `list_agents`.
 *
 * The catalogue is the only thing the orchestrator LLM knows about an agent's
 * capabilities before spawning it. `tools: none` and an `ext:`-only `tools:`
 * both parse to zero built-ins (custom-agents.ts parseToolsField), and
 * test/fixtures/.pi/agents/tools-none.md pins that the *runtime* really does
 * drop every built-in. So the catalogue must not claim otherwise — an agent
 * advertised as able to edit that cannot edit gets routed work it can only fail
 * at, and the reverse keeps the one agent that could do it out of the running.
 */
describe("catalogue scope badge", () => {
  const agentFile = (description: string, frontmatter = "") =>
    `---\ndescription: ${description}\n${frontmatter ? `${frontmatter}\n` : ""}---\n\nBody.\n`;

  /** One row's badge, whatever directory index the hermetic setup produced. */
  const badgeOf = (catalogue: string, name: string): string | undefined =>
    catalogue.split("\n").find((line) => line.includes(` ${name}: `))?.split(" ")[2];

  it("`tools: none` with extensions loading keeps its extension tools", async () => {
    // Zero built-ins is not zero tools: test/fixtures/.pi/agents/tools-none.md
    // pins that such an agent still surfaces alpha_read, alpha_write, beta_tool.
    // Reading that as `-` understates it and routes work away from the only
    // agent that could do it — the mirror of the bug this badge used to have.
    const booted = await boot({ quiet: agentFile("quiet agent.", "tools: none") });
    try {
      expect(badgeOf(await booted.catalogue(), "quiet")).toBe("e");
    } finally {
      await booted.restore();
    }
  });

  it("says `-` only when the agent can call nothing at all", async () => {
    // extensions: false and isolated: true both leave the agent with zero
    // built-ins AND zero extension tools — the one case `-` is true.
    for (const fm of ["tools: none\nextensions: false", "tools: none\nisolated: true"]) {
      const booted = await boot({ silent: agentFile("silent agent.", fm) });
      try {
        expect(badgeOf(await booted.catalogue(), "silent")).toBe("-");
      } finally {
        await booted.restore();
      }
    }
  });

  it("an ext:-only `tools:` is described by what it actually has", async () => {
    const booted = await boot({ extonly: agentFile("extonly agent.", 'tools: "ext:probe.mjs"') });
    try {
      expect(badgeOf(await booted.catalogue(), "extonly")).toBe("e");
    } finally {
      await booted.restore();
    }
  });

  it("an omitted `tools:` reads writable — absent means all built-ins", async () => {
    // Guards the fix from over-correcting: undefined (inherit everything, as the
    // shipped defaults do) is not the same as [] (explicitly zero).
    const booted = await boot({ broad: agentFile("broad agent.") });
    try {
      expect(badgeOf(await booted.catalogue(), "broad")).toBe("w");
    } finally {
      await booted.restore();
    }
  });

  it("a narrowed `tools:` reads r, s or w by what it can touch", async () => {
    const booted = await boot({
      reads: agentFile("reads agent.", "tools: read, grep"),
      shells: agentFile("shells agent.", "tools: read, bash"),
      edits: agentFile("edits agent.", "tools: read, write"),
    });
    try {
      const catalogue = await booted.catalogue();
      expect(badgeOf(catalogue, "reads")).toBe("r");
      // `bash` can change the repository, so it is not read-only.
      expect(badgeOf(catalogue, "shells")).toBe("s");
      expect(badgeOf(catalogue, "edits")).toBe("w");
    } finally {
      await booted.restore();
    }
  });

  it("compact mode carries no catalogue rows at all — there is no second builder to diverge", async () => {
    const hermetic = hermeticDir({
      settings: { toolDescriptionMode: "compact" },
      agentFiles: { quiet: agentFile("quiet agent.", "tools: none\nextensions: false") },
    });
    const { pi, tools, lifecycle } = makePi();
    subagentsExtension(pi);
    try {
      const description: string = tools.get("Agent").description;
      expect(description).toContain("quiet");
      expect(description).not.toContain("scope:");
      expect(description).not.toContain("(Tools:");
    } finally {
      await lifecycle.get("session_shutdown")?.({}, { hasUI: false, ui: {} });
      hermetic.restore();
    }
  });
});
