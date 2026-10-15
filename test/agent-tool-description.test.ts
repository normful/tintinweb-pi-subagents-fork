/**
 * agent-tool-description.test.ts — the roster renderer and the Agent tool
 * description it feeds.
 *
 * Two things are pinned here that nothing else checks.
 *
 * `summarize` is the bound on a roster row. Without it a row's length is
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

import { describe, expect, it, vi } from "vitest";
import { createAgentToolDescription, formatToolsSuffix, summarize } from "../src/agent-tool-description.js";
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

describe("formatToolsSuffix", () => {
  const cfg = (over: Partial<AgentConfig>) => ({ name: "x", ...over }) as AgentConfig;

  it("renders `*` for an agent that never narrowed its tools", () => {
    expect(formatToolsSuffix(cfg({}))).toBe("*");
    expect(formatToolsSuffix(undefined)).toBe("*");
  });

  it("renders `*` for an explicit full built-in set", () => {
    expect(formatToolsSuffix(cfg({ builtinToolNames: ["read", "bash", "grep", "find", "ls", "edit", "write"] }))).toBe("*");
  });

  it("lists a narrowed set", () => {
    expect(formatToolsSuffix(cfg({ builtinToolNames: ["read", "grep"] }))).toBe("read, grep");
  });

  it("reserves `none` for an agent that can genuinely call nothing", () => {
    expect(formatToolsSuffix(cfg({ builtinToolNames: [], isolated: true }))).toBe("none");
    expect(formatToolsSuffix(cfg({ builtinToolNames: [], extensions: false }))).toBe("none");
  });

  it("distinguishes zero built-ins from zero tools", () => {
    expect(formatToolsSuffix(cfg({ builtinToolNames: [], extensions: true }))).toBe(
      "no built-ins, extension tools only",
    );
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
    const { agentToolDescription } = build();
    // The every-turn roster is the bare name list, not rows.
    expect(agentToolDescription).toContain("zig-locator, zig-verifier");
    expect(agentToolDescription).not.toContain("- zig-locator:");
    // Nothing from the process-global registry leaks in.
    expect(agentToolDescription).not.toContain("general-purpose");
    expect(agentToolDescription).not.toContain("Explore");
  });

  it("renders the catalogue on demand, with each row's description capped", () => {
    const catalogue = build().renderTemplate("{{typeList}}");
    expect(catalogue).toContain("- zig-locator: Finds zig files. (zig-1) (Tools: find)");
    expect(catalogue).toContain("- zig-verifier: Verifies zig claims. (Tools: none)");
    expect(catalogue).not.toContain("general-purpose");
    // `Use when searching.` is the clause the cap drops — it must not be here.
    expect(catalogue).not.toContain("Use when searching");
  });

  it("`{{agentNames}}` renders the bare list the descriptions carry", () => {
    expect(build().renderTemplate("{{agentNames}}")).toBe("zig-locator, zig-verifier");
  });

  it("strips the provider prefix and the date suffix from the model label", () => {
    expect(build().renderTemplate("{{typeList}}")).toContain("(zig-1)");
  });

  it("compact mode swaps in the shorter description and the same bare name list", () => {
    const { agentToolDescription } = build({ mode: "compact" });
    expect(agentToolDescription).toContain("Launch an autonomous agent");
    expect(agentToolDescription).not.toContain("## Usage notes");
    expect(agentToolDescription).toContain("zig-locator, zig-verifier");
    // Neither mode renders catalogue rows any more.
    expect(agentToolDescription).not.toContain("(Tools:");
  });

  it("gates the schedule bullet on schedulingEnabled", () => {
    expect(build().agentToolDescription).toContain("Use `schedule` only when");
    expect(build({ schedulingEnabled: false }).agentToolDescription).not.toContain("schedule");
  });

  it("gates the isolation bullet on worktreeIsolationEnabled", () => {
    expect(build().agentToolDescription).toContain('Use isolation: "worktree"');
    expect(build({ worktreeIsolationEnabled: false }).agentToolDescription).not.toContain("isolation");
  });

  it("gates the compact isolation bullet with the same switch", () => {
    expect(build({ mode: "compact" }).agentToolDescription).toContain('isolation: "worktree"');
    expect(build({ mode: "compact", worktreeIsolationEnabled: false }).agentToolDescription).not.toContain("isolation");
  });

  it("expands every documented placeholder and leaves unknown ones verbatim", () => {
    const { renderTemplate } = build();
    const rendered = renderTemplate("A {{typeList}} B {{compactTypeList}} C {{agentDir}} D {{scheduleGuideline}} E {{isolationGuideline}} F {{nope}}");
    expect(rendered).not.toContain("{{typeList}}");
    expect(rendered).not.toContain("{{compactTypeList}}");
    expect(rendered).not.toContain("{{agentDir}}");
    expect(rendered).not.toContain("{{scheduleGuideline}}");
    expect(rendered).not.toContain("{{isolationGuideline}}");
    expect(rendered).toContain("{{nope}}");
    expect(rendered).toContain("- zig-locator:");
  });

  it("does not expand `$&` in an agent description", () => {
    // The replacement callback exists for this: a string replacement would
    // interpret `$&` in whatever the roster rendered.
    const { renderTemplate } = build({
      roster: { ...fakeRoster, agentConfig: () => ({ name: "p", description: "Cost $& stays literal", builtinTools: [] } as unknown as AgentConfig) },
    });
    expect(renderTemplate("{{typeList}}")).toContain("Cost $& stays literal");
  });

  it("expands the gated placeholders to the empty string when the gate is off", () => {
    const { renderTemplate } = build({ schedulingEnabled: false, worktreeIsolationEnabled: false });
    expect(renderTemplate("RULES:{{scheduleGuideline}}\nEND")).toBe("RULES:\nEND");
    expect(renderTemplate("RULES:{{isolationGuideline}}\nEND")).toBe("RULES:\nEND");
  });

  it("falls back to the full description when custom mode finds no file", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // No `.pi/agent-tool-description.md` in a fake roster's world; the loader
      // only ever reads the real filesystem, so this exercises the fallback.
      const { agentToolDescription } = build({ mode: "custom" });
      // Full, not compact: the headings only the full description has.
      expect(agentToolDescription).toContain("## Usage notes");
      expect(agentToolDescription).toContain("zig-locator, zig-verifier");
    } finally {
      warn.mockRestore();
    }
  });
});
