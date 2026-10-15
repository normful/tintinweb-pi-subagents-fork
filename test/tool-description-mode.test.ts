// End-to-end test for `toolDescriptionMode` (#91): settings file → sanitize →
// applier → registration-time description pick. Instantiates the real extension
// with a mock pi (same pattern as print-mode.test.ts) inside a temp cwd, then
// inspects the registered Agent tool's description.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import subagentsExtension from "../src/index.js";
import { setWorktreeIsolationEnabled } from "../src/worktree.js";

const EXAMPLE_TEMPLATE = fileURLToPath(new URL("../examples/agent-tool-description.md", import.meta.url));

function makePi() {
  const tools = new Map<string, any>();
  const handlers = new Map<string, any>();

  return {
    pi: {
      registerMessageRenderer: vi.fn(),
      registerTool: vi.fn((tool: any) => {
        tools.set(tool.name, tool);
      }),
      registerCommand: vi.fn(),
      registerEntryRenderer: vi.fn(),
      registerFlag: vi.fn(),
      getFlag: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        handlers.set(event, handler);
      }),
      events: {
        emit: vi.fn(),
        on: vi.fn(() => vi.fn()),
      },
      appendEntry: vi.fn(),
      sendMessage: vi.fn(),
    } as any,
    tools,
    handlers,
  };
}

describe("toolDescriptionMode", () => {
  let tmpDir: string;
  let hermeticAgentDir: string;
  let prevCwd: string;
  let prevAgentDir: string | undefined;
  let prevHome: string | undefined;
  let shutdown: (() => Promise<void>) | undefined;

  function setup(settings?: Record<string, unknown>, beforeInstantiate?: () => void) {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-tooldesc-"));
    // Isolate global settings (getAgentDir / ~/.pi) so the dev's real
    // subagents.json can't leak into the "default is full" assertion.
    hermeticAgentDir = mkdtempSync(join(tmpdir(), "pi-tooldesc-agentdir-"));
    prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    prevHome = process.env.HOME;
    process.env.PI_CODING_AGENT_DIR = hermeticAgentDir;
    process.env.HOME = hermeticAgentDir;
    prevCwd = process.cwd();
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    if (settings) {
      writeFileSync(join(tmpDir, ".pi", "subagents.json"), JSON.stringify(settings));
    }
    beforeInstantiate?.();
    process.chdir(tmpDir);

    const { pi, tools, handlers } = makePi();
    subagentsExtension(pi);
    shutdown = async () => {
      await handlers.get("session_shutdown")?.({}, { hasUI: false, ui: {} } as any);
    };
    return tools;
  }

  afterEach(async () => {
    await shutdown?.();
    shutdown = undefined;
    // applySettings only applies keys that are PRESENT, so a subagents.json
    // without `worktreeIsolation` leaves the module singleton wherever the
    // previous test left it. Reset it so each setup()'s settings decide, and
    // so the "default" assertions below really test the default.
    setWorktreeIsolationEnabled(true);
    process.chdir(prevCwd);
    if (prevAgentDir == null) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(hermeticAgentDir, { recursive: true, force: true });
  });

  it("defaults to the full description", () => {
    const tools = setup();
    const desc: string = tools.get("Agent").description;
    expect(desc).toContain("## Usage notes");
    expect(desc).toContain("## Writing the prompt");
    // The every-turn roster is the bare name list — every agent is still named,
    // and none of their descriptions is paid for on every turn.
    const roster = desc.split("Available agent types:\n")[1].split("\n")[0];
    expect(roster.split(", ")).toEqual(
      expect.arrayContaining(["general-purpose", "Explore", "Plan"]),
    );
    expect(desc).not.toContain("very thorough");
  });

  it("compact mode swaps in the short description and the same bare name list", () => {
    const tools = setup({ toolDescriptionMode: "compact" });
    const desc: string = tools.get("Agent").description;
    expect(desc).toContain("Launch an autonomous agent");
    expect(desc).not.toContain("## Usage notes");
    expect(desc).not.toContain("## Writing the prompt");
    // Both modes name every agent; neither renders catalogue rows.
    const roster = desc.split("Agent types:\n")[1].split("\n")[0];
    expect(roster.split(", ")).toEqual(
      expect.arrayContaining(["general-purpose", "Explore", "Plan"]),
    );
    expect(desc).not.toContain("Explore: Fast read-only search agent");
    expect(desc).not.toContain("(Tools:");
    // The point of the feature: materially smaller than the full version. A
    // ceiling rather than a target — the roster is bounded independently.
    expect(desc.length).toBeLessThan(1600);
  });

  it("invalid mode in the settings file is dropped — full description", () => {
    const tools = setup({ toolDescriptionMode: "tiny" });
    const desc: string = tools.get("Agent").description;
    expect(desc).toContain("## Usage notes");
  });

  it("compact keeps every load-bearing contract — fails when a behavior change forgets compact", () => {
    const tools = setup({ toolDescriptionMode: "compact" });
    const desc: string = tools.get("Agent").description;
    // One keyword per behavioral contract the orchestrator must know about.
    // If you change one of these behaviors, update BOTH descriptions.
    for (const contract of [
      "run_in_background",
      "resume",
      "steer_subagent",
      'isolation: "worktree"',
      ".pi/agents/",
      "self-contained",
    ]) {
      expect(desc).toContain(contract);
    }
  });

  // The compact test above pins the prose alone, which is right for compact —
  // it is the only place that mode states these. `full` is different: several
  // contracts are stated twice, in the description AND in the param schema, so
  // pinning prose alone would block a legitimate move of one into the other
  // while missing the failure that actually matters — a contract that ends up
  // in neither. Asserting over description + schema is the invariant that
  // survives either choice. The second test then keeps the schema half honest,
  // so "it's also in the schema" can never degrade to an empty stub.
  it("full states every load-bearing contract in the description or the schema", () => {
    const tool = setup().get("Agent");
    const visible = `${tool.description}\n${JSON.stringify(tool.parameters)}`;
    for (const contract of [
      "run_in_background",
      "resume",
      "steer_subagent",
      "worktree",
      ".pi/agents/",
      "self-contained",
      "model",
      "thinking",
      "inherit_context",
    ]) {
      expect(visible).toContain(contract);
    }
  });

  it("every strategy param carries a real description of its own", () => {
    const props = setup().get("Agent").parameters?.properties ?? {};
    for (const name of ["run_in_background", "model", "thinking", "inherit_context"]) {
      // Long enough to be an explanation the model can act on, not a bare label.
      expect(props[name]?.description?.length ?? 0).toBeGreaterThan(40);
    }
  });

  it("custom mode renders the project template with placeholders substituted", () => {
    const tools = setup({ toolDescriptionMode: "custom" }, () => {
      writeFileSync(
        join(tmpDir, ".pi", "agent-tool-description.md"),
        "My agents:\n{{typeList}}\n\nGlobal dir: {{agentDir}}\nUnknown: {{nope}}\nCost: $& stays literal",
      );
    });
    const desc: string = tools.get("Agent").description;
    expect(desc).toContain("My agents:");
    expect(desc).toContain("- general-purpose:"); // {{typeList}} expanded
    expect(desc).toContain(`Global dir: ${hermeticAgentDir}`); // {{agentDir}} expanded
    expect(desc).toContain("Unknown: {{nope}}"); // unknown placeholder left verbatim
    expect(desc).toContain("Cost: $& stays literal"); // no $-pattern expansion
    expect(desc).not.toContain("## Usage notes");
  });

  it("custom mode falls back to the global file when no project file exists", () => {
    const tools = setup({ toolDescriptionMode: "custom" }, () => {
      writeFileSync(join(hermeticAgentDir, "agent-tool-description.md"), "GLOBAL CUSTOM\n{{compactTypeList}}");
    });
    const desc: string = tools.get("Agent").description;
    expect(desc).toContain("GLOBAL CUSTOM");
    expect(desc).toContain("- Explore: Fast read-only search agent for locating code. (Tools:");
  });

  it("{{scheduleGuideline}} expands to the schedule bullet when scheduling is on (default)", () => {
    const tools = setup({ toolDescriptionMode: "custom" }, () => {
      writeFileSync(join(tmpDir, ".pi", "agent-tool-description.md"), "RULES:{{scheduleGuideline}}\nEND");
    });
    const desc: string = tools.get("Agent").description;
    // The expansion carries its own leading "\n- " bullet.
    expect(desc).toContain("RULES:\n- Use `schedule` only when");
  });

  it("{{scheduleGuideline}} expands to the empty string when scheduling is disabled", () => {
    const tools = setup({ toolDescriptionMode: "custom", schedulingEnabled: false }, () => {
      writeFileSync(join(tmpDir, ".pi", "agent-tool-description.md"), "RULES:{{scheduleGuideline}}\nEND");
    });
    const desc: string = tools.get("Agent").description;
    expect(desc).toContain("RULES:\nEND");
    expect(desc).not.toContain("schedule");
  });

  it("{{isolationGuideline}} expands to the isolation bullet when worktrees are on (default)", () => {
    const tools = setup({ toolDescriptionMode: "custom" }, () => {
      writeFileSync(join(tmpDir, ".pi", "agent-tool-description.md"), "RULES:{{isolationGuideline}}\nEND");
    });
    const desc: string = tools.get("Agent").description;
    expect(desc).toContain('RULES:\n- Use isolation: "worktree"');
  });

  it("{{isolationGuideline}} expands to the empty string when worktree isolation is disabled", () => {
    const tools = setup({ toolDescriptionMode: "custom", worktreeIsolation: false }, () => {
      writeFileSync(join(tmpDir, ".pi", "agent-tool-description.md"), "RULES:{{isolationGuideline}}\nEND");
    });
    const desc: string = tools.get("Agent").description;
    expect(desc).toContain("RULES:\nEND");
    expect(desc).not.toContain("isolation");
  });

  it("every documented placeholder is replaced — no {{ }} residue", () => {
    const tools = setup({ toolDescriptionMode: "custom" }, () => {
      writeFileSync(
        join(tmpDir, ".pi", "agent-tool-description.md"),
        "A {{typeList}} B {{compactTypeList}} C {{agentDir}} D {{scheduleGuideline}} E {{isolationGuideline}} F",
      );
    });
    const desc: string = tools.get("Agent").description;
    expect(desc).not.toContain("{{");
    expect(desc).not.toContain("}}");
  });

  it("the shipped example template renders byte-identical to the full description", async () => {
    // Guards examples/agent-tool-description.md against going stale: it must
    // reproduce the full description exactly. If you edit one, edit the other.
    const example = readFileSync(EXAMPLE_TEMPLATE, "utf-8");
    const tools = setup({ toolDescriptionMode: "custom" }, () => {
      writeFileSync(join(tmpDir, ".pi", "agent-tool-description.md"), example);
    });
    const customDesc: string = tools.get("Agent").description;

    // Second instance in the same hermetic cwd, flipped to full mode.
    writeFileSync(join(tmpDir, ".pi", "subagents.json"), JSON.stringify({ toolDescriptionMode: "full" }));
    const second = makePi();
    subagentsExtension(second.pi);
    try {
      expect(customDesc).toBe(second.tools.get("Agent").description);
    } finally {
      await second.handlers.get("session_shutdown")?.({}, { hasUI: false, ui: {} } as any);
    }
  });

  it("custom mode without a file falls back to the full description with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const tools = setup({ toolDescriptionMode: "custom" });
      const desc: string = tools.get("Agent").description;
      expect(desc).toContain("## Usage notes");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("no agent-tool-description.md found"));
    } finally {
      warn.mockRestore();
    }
  });

  // README:87 promises that disabling scheduling "removes `schedule` from the
  // `Agent` tool spec (no LLM-context cost)". Only the {{scheduleGuideline}}
  // TEXT expansion was tested — nothing asserted the schema itself, so the
  // parameter could keep costing tokens (and stay callable) while the prose
  // claimed otherwise.
  describe("schedulingEnabled gates the schedule parameter", () => {
    const props = (tools: Map<string, any>) =>
      Object.keys(tools.get("Agent").parameters?.properties ?? {});

    it("advertises `schedule` by default", () => {
      expect(props(setup())).toContain("schedule");
    });

    it("removes `schedule` from the tool schema when scheduling is disabled", () => {
      const names = props(setup({ schedulingEnabled: false }));
      expect(names).not.toContain("schedule");
      // The rest of the parameter surface is untouched — this gates one field,
      // not the tool.
      expect(names).toEqual(expect.arrayContaining(["prompt", "description", "subagent_type"]));
    });
  });

  // The schema half of `worktreeIsolation: false` shipped without the prose
  // half: `isolationParam` dropped the field while both descriptions kept
  // telling the model to pass it. Nothing rejects the undeclared key (TypeBox
  // sets no additionalProperties: false) and, by design, nothing notes the
  // downgrade on the result — so the model had every reason to report a
  // `pi-agent-*` branch that was never created. Schema and prose have to move
  // together, which is why both are asserted here.
  describe("worktreeIsolation gates the isolation parameter and its prose", () => {
    const props = (tools: Map<string, any>) =>
      Object.keys(tools.get("Agent").parameters?.properties ?? {});

    it("advertises `isolation` in schema and prose by default", () => {
      const tools = setup();
      expect(props(tools)).toContain("isolation");
      expect(tools.get("Agent").description).toContain('Use isolation: "worktree"');
    });

    it("drops both when worktree isolation is disabled", () => {
      const tools = setup({ worktreeIsolation: false });
      const names = props(tools);
      expect(names).not.toContain("isolation");
      expect(tools.get("Agent").description).not.toContain("isolation");
      // One field, not the tool — and the neighbouring gate is unaffected.
      expect(names).toEqual(expect.arrayContaining(["prompt", "description", "subagent_type", "schedule"]));
    });

    it("drops the compact description's bullet too", () => {
      const enabled = setup({ toolDescriptionMode: "compact" });
      expect(enabled.get("Agent").description).toContain('isolation: "worktree"');
    });

    it("compact mode says nothing about isolation when disabled", () => {
      const tools = setup({ toolDescriptionMode: "compact", worktreeIsolation: false });
      expect(tools.get("Agent").description).not.toContain("isolation");
      // The bullet above it survives — the gate trims a suffix, not the list.
      expect(tools.get("Agent").description).toContain("resume continues a previous agent by ID");
    });
  });

});
