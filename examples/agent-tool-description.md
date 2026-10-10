Launch a new agent to handle complex, multi-step tasks autonomously. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
{{typeList}}

Custom agents can be defined in .pi/agents/<name>.md (project) or {{agentDir}}/agents/<name>.md (global) — they are picked up automatically. Project-level agents override global ones; a file named after a default agent overrides it.

## Usage notes

- If the target is already known, use a direct tool — `read`, `grep`, `find`. Reserve this tool for open-ended work, or for a task that matches an agent type's description, including one that says to use it without being asked.
- Send independent work as multiple Agent calls in one message so they run concurrently; "in parallel" means exactly this. Never repeat work you delegated.
- Agents run in the background by default and you are notified on completion — do not sleep, poll, or predict results before that notification arrives. Pass `run_in_background: false` only when your next action needs the result and nothing else could usefully happen meanwhile.
- The result is not shown to the user — summarize it. An agent's summary is intent, not outcome: when it writes code, verify the actual changes before reporting the work as done. Say whether you want code written or research only; the agent cannot infer your intent.
- The prompt must be self-contained — a new call has no memory of prior runs, so include the file paths, line numbers and constraints it needs. `resume` continues an earlier agent by ID, `steer_subagent` messages a running one, `inherit_context` forks this conversation into it, and `model` / `thinking` override its defaults.{{isolationGuideline}}{{scheduleGuideline}}

## Writing the prompt

Brief the agent like a smart colleague who just walked into the room — it has not seen this conversation, does not know what you tried or why the task matters. State the goal, what you already learned or ruled out, and enough context to make judgment calls rather than follow a narrow instruction. Hand over the exact command for a lookup and the question for an investigation — prescribed steps are dead weight when the premise is wrong. If you need a short answer, say so.

**Never delegate understanding.** "Based on your findings, implement it" pushes synthesis onto the agent. Name the file, the line, and what specifically to change; terse command-style prompts produce shallow, generic work.
