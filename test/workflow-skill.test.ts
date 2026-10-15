/**
 * workflow-skill.test.ts — the authoring reference ships as a skill.
 *
 * The `SubagentWorkflow` description carries only what decides *whether* to
 * call the tool and the one pattern to start from; the reference for writing a
 * script lives in `skills/workflow-authoring/SKILL.md`, which the description
 * points at by path. What this pins: the skill is well-formed and shipped, the
 * pointer resolves, and the text lives in exactly one of the two places.
 * `workflow-tool-description.test.ts` checks the contract of the pair.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fullWorkflowToolDescription, workflowToolDescription } from "../src/workflow/tool-description.js";

const SKILL_FILE = fileURLToPath(new URL("../skills/workflow-authoring/SKILL.md", import.meta.url));
const readSkill = () => readFileSync(SKILL_FILE, "utf8");

/** The YAML frontmatter as flat `key: value` pairs, and the body after it. */
function parseSkill(text: string): { front: Record<string, string>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md has no frontmatter block");
  const front: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (pair) front[pair[1]] = pair[2].replace(/^["']|["']$/g, "");
  }
  return { front, body: match[2] };
}

/** Sentences that open a reference section — each must live in exactly one file. */
const REFERENCE_MARKERS = [
  "# Workflow authoring reference",
  "A workflow structures work across many agents",
  "the right move is often **hybrid**",
  "Script body hooks:",
  "Any agent() option not listed above is rejected by name",
  "Scripts are plain JavaScript, NOT TypeScript",
  "DEFAULT TO pipeline().",
  "A barrier is NOT justified by:",
  "Loop-until-count pattern",
  "Gate-and-retry pattern",
  "Quality patterns —",
  "## Resume",
];

describe("the workflow-authoring skill", () => {
  it("exists where the package manifest declares it", () => {
    // Declared so pi lists it: a model asked whether it loaded the skill looks
    // in the skill list, not in a tool description.
    expect(existsSync(SKILL_FILE)).toBe(true);
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { pi?: { skills?: string[] } };
    expect(manifest.pi?.skills).toContain("./skills");
  });

  it("is named after its directory, as the skill spec requires", () => {
    expect(parseSkill(readSkill()).front.name).toBe("workflow-authoring");
  });

  it("says what it is for, and that loading it authorizes nothing", () => {
    const { description } = parseSkill(readSkill()).front;
    expect(description).toContain("SubagentWorkflow");
    expect(description).toMatch(/does not itself authorize/);
    // Listed in every session, so it says where it does not apply.
    expect(description).toContain("Applies only when the SubagentWorkflow tool is available.");
  });

  it("carries the reference, as plain Markdown", () => {
    const { body } = parseSkill(readSkill());
    for (const marker of REFERENCE_MARKERS) expect(body, marker).toContain(marker);
    // Moved out of a template literal: an escape left behind reaches the model
    // as a stray backslash, and a placeholder is never substituted here.
    expect(body).not.toContain("\\`");
    expect(body).not.toContain("\\$");
    expect(body).not.toContain("{{");
  });
});

/** A stand-in roster: the description names the types it can pass to `agentType`. */
const ROSTER_NAMES = "Explore, general-purpose, Plan";

describe("the tool description", () => {
  it("points at the skill by a path that resolves", () => {
    const path = fullWorkflowToolDescription(ROSTER_NAMES).match(/load the `workflow-authoring` skill \(read `([^`]+)`\)/)?.[1];
    expect(path, "no skill pointer in the description").toBeDefined();
    expect(path).toBe(SKILL_FILE);
  });

  it("keeps what decides whether to call it, and the shape to start from", () => {
    const text = fullWorkflowToolDescription(ROSTER_NAMES);
    expect(text).toContain("ONLY call this when the user explicitly opted into");
    expect(text).toContain("Every script must begin with `export const meta = {...}`");
    expect(text).toContain("Canonical shape:");
    // The roster is an argument, interpolated at registration, because the skill
    // is a static file and cannot carry a list that grows with custom agents.
    expect(text).toContain(ROSTER_NAMES);
  });

  it("no longer carries the reference", () => {
    for (const marker of REFERENCE_MARKERS) {
      expect(fullWorkflowToolDescription(ROSTER_NAMES), marker).not.toContain(marker);
    }
    expect(fullWorkflowToolDescription(ROSTER_NAMES).length).toBeLessThan(8000);
  });
});

describe("the inline reference", () => {
  const inline = workflowToolDescription("inline", ROSTER_NAMES);

  it("is the description with the skill body in place of the pointer", () => {
    expect(inline).not.toMatch(/Before writing a script, load the `workflow-authoring` skill/);
    for (const marker of REFERENCE_MARKERS) expect(inline, marker).toContain(marker);
    expect(inline).toContain("Canonical shape:");
    expect(inline).toContain(ROSTER_NAMES);
  });

  it("carries the skill body exactly, without its frontmatter", () => {
    expect(inline).toContain(parseSkill(readSkill()).body.trim());
    expect(inline).not.toContain("name: workflow-authoring");
    expect(inline).not.toMatch(/^---$/m);
  });

  it("leaves \"skill\" as the plain description", () => {
    expect(workflowToolDescription("skill", ROSTER_NAMES)).toBe(fullWorkflowToolDescription(ROSTER_NAMES));
  });
});
