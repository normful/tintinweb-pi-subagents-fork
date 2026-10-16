/**
 * agent-tool-description.test.ts — the agent catalogue and the Agent tool
 * description it sits beside.
 *
 * Two things are pinned here that nothing else checks.
 *
 * `summarize` is the bound on a catalogue row. Without it a row's length is
 * whatever an agent file's author wrote — the shipped ones run to 544
 * characters, and `firstSentence` alone does not bound them, since a description
 * with no internal `.`, `!` or `?` passes through whole.
 *
 * `createAgentToolDescription` takes its roster as accessors rather than reading
 * the process-global registry. That is what makes the prose testable without an
 * extension instance, and the test below that runs it against a fake roster is
 * what keeps it that way: the day someone reaches for `getAvailableTypes()`
 * inside, this file fails instead of the coupling going unnoticed.
 */

import { describe, expect, it } from "vitest";
import { buildAgentCatalogue, createAgentToolDescription, getModelLabelFromConfig, scopeTag, summarize } from "../src/agent-tool-description.js";
import type { AgentConfig } from "../src/types.js";

/** Flatten the way `summarize` does, so a test can assert on a prefix. */
const flatten = (text: string) => text.replace(/\s+/g, " ").trim();

describe("summarize", () => {
  it("passes a short description through unwrapped, with no ellipsis", () => {
    expect(summarize("Finds relevant documents in .rpiv/artifacts/.")).toBe(
      "Finds relevant documents in .rpiv/artifacts/.",
    );
  });

  it("keeps the first sentence and drops the rest", () => {
    // Real shape: "what it is" then "use when" — the cap is what makes the
    // second half affordable to lose.
    expect(summarize("Locates files and components. Use it when you would otherwise reach for grep.")).toBe(
      "Locates files and components.",
    );
  });

  it("collapses newlines and runs of whitespace before measuring", () => {
    expect(summarize("Line one.\n\n   Line   two.")).toBe("Line one.");
    expect(summarize("no  terminal\n punctuation")).toBe("no terminal punctuation");
  });

  it("caps a single long sentence and marks the cut", () => {
    const long = `${"word ".repeat(60)}end.`;
    const result = summarize(long, 80);
    expect(result.length).toBeLessThanOrEqual(81); // 80 + the ellipsis
    expect(result.endsWith("…")).toBe(true);
    // Everything before the ellipsis is a genuine prefix — no rewriting.
    const body = result.slice(0, -1);
    expect(flatten(long).startsWith(body)).toBe(true);
  });

  it("breaks on a word boundary rather than mid-word", () => {
    const result = summarize(`${"alpha bravo ".repeat(20)}stop.`, 40);
    expect(result).toBe(`${"alpha bravo ".repeat(3).trimEnd()}…`);
  });

  it("hard-cuts when the first word is longer than half the budget", () => {
    // No useful boundary exists, so a word-boundary break would leave "A…".
    const result = summarize(`A ${"x".repeat(200)} tail.`, 40);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(result.endsWith("…")).toBe(true);
    expect(result.startsWith("A ")).toBe(true);
  });

  it("bounds the longest shipped-style description to the cap", () => {
    const worst = `Do you find yourself desiring information that you don't quite feel well-trained on? ${"More. ".repeat(80)}`;
    expect(summarize(worst).length).toBeLessThanOrEqual(81);
  });

  it("honours a custom cap", () => {
    expect(summarize("one two three four five six", 10)).toBe("one two…");
  });
});

describe("scopeTag", () => {
  const cfg = (over: Partial<AgentConfig>) => ({ name: "x", ...over }) as AgentConfig;

  it("reads an agent that never narrowed its tools as writable", () => {
    // Absent is every built-in, `write` and `edit` included — not read-only.
    expect(scopeTag(cfg({}))).toBe("w");
    expect(scopeTag(undefined)).toBe("w");
  });

  it("reads an explicit full built-in set as writable", () => {
    expect(scopeTag(cfg({ builtinToolNames: ["read", "bash", "grep", "find", "ls", "edit", "write"] }))).toBe("w");
  });

  it("separates a shell that can write from an agent that only reads", () => {
    // `bash` can change the repository, so it must not inherit the read-only
    // badge that `r` claims.
    expect(scopeTag(cfg({ builtinToolNames: ["read", "bash", "grep", "find", "ls"] }))).toBe("s");
    expect(scopeTag(cfg({ builtinToolNames: ["read", "grep", "find", "ls"] }))).toBe("r");
  });

  it("reads a narrowed set with an editing tool as writable", () => {
    expect(scopeTag(cfg({ builtinToolNames: ["read", "write"] }))).toBe("w");
    expect(scopeTag(cfg({ builtinToolNames: ["read", "edit"] }))).toBe("w");
  });

  it("reserves `-` for an agent that can genuinely call nothing", () => {
    expect(scopeTag(cfg({ builtinToolNames: [], isolated: true }))).toBe("-");
    expect(scopeTag(cfg({ builtinToolNames: [], extensions: false }))).toBe("-");
  });

  it("distinguishes zero built-ins from zero tools", () => {
    expect(scopeTag(cfg({ builtinToolNames: [], extensions: true }))).toBe("e");
  });
});

describe("buildAgentCatalogue", () => {
  const agent = (over: Partial<AgentConfig>) => ({ name: "x", ...over }) as AgentConfig;

  it("numbers a directory once and reuses it for every agent in it", () => {
    const roster = {
      availableTypes: () => ["gp", "explorer", "auditor", "shipper"],
      agentConfig: (type: string) =>
        ({
          gp: agent({ name: "gp", description: "General purpose." }),
          explorer: agent({
            name: "explorer",
            description: "Explores.",
            sourcePath: "/home/me/.pi/agent/agents/explorer.md",
            builtinToolNames: ["read", "grep", "find", "ls"],
          }),
          auditor: agent({
            name: "auditor",
            description: "Audits.",
            sourcePath: "/work/.pi/agents/auditor.md",
            builtinToolNames: ["read", "bash"],
          }),
          shipper: agent({
            name: "shipper",
            description: "Ships.",
            sourcePath: "/home/me/.pi/agent/agents/shipper.md",
            builtinToolNames: ["read", "write"],
          }),
        })[type],
    };

    expect(buildAgentCatalogue(roster, { home: "/home/me", cwd: "/work" })).toBe(
      [
        "dirs: 0=built-in (no file) 1=~/.pi/agent/agents 2=.pi/agents  (each agent's file: <dir>/<type>.md)",
        "scope: r=read-only, s=shell (can write via bash), w=write/edit, e=extension tools only, -=no tools",
        "- 0 w gp: General purpose.",
        "- 1 r explorer: Explores.",
        "- 2 s auditor: Audits.",
        "- 1 w shipper: Ships.",
      ].join("\n"),
    );
  });

  it("names the real file when frontmatter `name:` overrode the filename", () => {
    // The `<dir>/<type>.md` in the legend is a guess the loader does not always
    // honour: `name:` wins, so that row has to carry its own filename.
    const roster = {
      availableTypes: () => ["reviewer"],
      agentConfig: () => agent({
        name: "reviewer",
        description: "Reviews.",
        sourcePath: "/work/.pi/agents/code-reviewer.md",
      }),
    };
    const catalogue = buildAgentCatalogue(roster, { home: "/home/me", cwd: "/work" });
    expect(catalogue).toContain("dirs: 1=.pi/agents  (each agent's file: <dir>/<type>.md)");
    expect(catalogue).toContain("- 1 w reviewer: Reviews. (file: code-reviewer.md)");
  });

  it("lists only the legend when every agent is an embedded default", () => {
    const roster = {
      availableTypes: () => ["gp"],
      agentConfig: () => agent({ name: "gp", description: "General purpose." }),
    };
    const catalogue = buildAgentCatalogue(roster, { home: "/home/me", cwd: "/work" });
    expect(catalogue).toContain("dirs: 0=built-in (no file)\n");
    expect(catalogue).not.toContain("<dir>/<type>.md");
  });

  it("renders nothing at all for an empty registry", () => {
    // No legend with no rows under it.
    expect(buildAgentCatalogue({ availableTypes: () => [], agentConfig: () => undefined })).toBe("");
  });
});

describe("createAgentToolDescription", () => {
  /** A roster that shares no name with any real agent, so leaks are visible. */
  const fakeRoster = {
    availableTypes: () => ["zig-locator", "zig-verifier"],
    agentConfig: (type: string) =>
      ({
        "zig-locator": { name: "zig-locator", description: "Finds zig files. Use when searching.", model: "acme/zig-1-20250101", builtinToolNames: ["find"] },
        "zig-verifier": { name: "zig-verifier", description: "Verifies zig claims.", builtinToolNames: [], extensions: false },
      })[type] as AgentConfig | undefined,
  };

  const build = (over: Partial<Parameters<typeof createAgentToolDescription>[0]> = {}) =>
    createAgentToolDescription({
      roster: fakeRoster,
      mode: "full",
      schedulingEnabled: true,
      worktreeIsolationEnabled: true,
      ...over,
    });

  it("renders exactly the injected roster — no registry dependency", () => {
    const agentToolDescription = build();
    // The every-turn roster is the bare name list, not rows.
    expect(agentToolDescription).toContain("zig-locator, zig-verifier");
    expect(agentToolDescription).not.toContain("- zig-locator:");
    // Nothing from the process-global registry leaks in.
    expect(agentToolDescription).not.toContain("general-purpose");
    expect(agentToolDescription).not.toContain("Explore");
  });

  it("renders the catalogue on demand, with each row's description capped", () => {
    const catalogue = buildAgentCatalogue(fakeRoster);
    expect(catalogue).toContain("- 0 r zig-locator: Finds zig files.");
    expect(catalogue).toContain("- 0 - zig-verifier: Verifies zig claims.");
    expect(catalogue).not.toContain("general-purpose");
    // `Use when searching.` is the clause the cap drops — it must not be here.
    expect(catalogue).not.toContain("Use when searching");
  });

  it("strips the provider prefix and the date suffix from the model label", () => {
    expect(getModelLabelFromConfig("acme/zig-1-20250101")).toBe("zig-1");
    expect(getModelLabelFromConfig("zig-1")).toBe("zig-1");
  });

  it("compact mode swaps in the shorter description and the same bare name list", () => {
    const agentToolDescription = build({ mode: "compact" });
    expect(agentToolDescription).toContain("Launch an autonomous agent");
    expect(agentToolDescription).not.toContain("## Usage notes");
    expect(agentToolDescription).toContain("zig-locator, zig-verifier");
    // Neither mode renders catalogue rows any more.
    expect(agentToolDescription).not.toContain("(Tools:");
  });

  it("gates the schedule bullet on schedulingEnabled", () => {
    expect(build()).toContain("Use `schedule` only when");
    expect(build({ schedulingEnabled: false })).not.toContain("schedule");
  });

  it("gates the isolation bullet on worktreeIsolationEnabled", () => {
    expect(build()).toContain('Use isolation: "worktree"');
    expect(build({ worktreeIsolationEnabled: false })).not.toContain("isolation");
  });

  it("gates the compact isolation bullet with the same switch", () => {
    expect(build({ mode: "compact" })).toContain('isolation: "worktree"');
    expect(build({ mode: "compact", worktreeIsolationEnabled: false })).not.toContain("isolation");
  });
});
