Launch a new agent to handle complex, multi-step tasks autonomously. Each agent type has specific capabilities and tools available to it — `list_agents` says what each one does.

Available agent types:
{{agentNames}}

Custom agents can be defined in .pi/agents/<name>.md (project) or {{agentDir}}/agents/<name>.md (global) — they are picked up automatically. Project-level agents override global ones; a file named after a default agent overrides it.

## Usage notes

- If the target is already known, use a direct tool — `read`, `grep`, `find`. Reserve this tool for open-ended work, or a task that matches an agent type's description.
- Send independent work as multiple Agent calls in one message; they run concurrently. Never repeat work you delegated.
- Agents run in the background by default and you are notified on completion — do not sleep, poll, or predict results. Pass `run_in_background: false` only when your next action needs the result and nothing else could usefully happen meanwhile.
- The result is not shown to the user — summarize it, and verify an agent's actual changes before reporting its work as done. The prompt must be self-contained: a new call has no memory of prior runs, so include the file paths, line numbers and constraints it needs. `resume` continues an earlier agent by ID, `steer_subagent` messages a running one, `inherit_context` forks this conversation into it, and `model` / `thinking` override its defaults.{{isolationGuideline}}{{scheduleGuideline}}

## Writing the prompt

Brief the agent like a smart colleague who just walked into the room — state the goal, what you already learned or ruled out, and the exact command for a lookup, rather than prescribed steps. Never delegate understanding: name the file, the line, and what specifically to change, because terse command-style prompts produce shallow work.
