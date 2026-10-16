---
name: writing-subagents
description: "Use when creating or editing a subagent definition file — `.pi/agents/*.md`, `.agents/agents/*.md`, or a package's declared agents the Agent tool spawns by `subagent_type`: the frontmatter keys this extension parses, what the body becomes, and load precedence. Read `writing-subagent-workflows` instead when the next call is SubagentWorkflow; read both when a script's `agentType` names a type you are also authoring."
---

# Subagent definition files

A definition file is Markdown with YAML frontmatter that binds a type name to a role
prompt, a tool surface, a model and a prompt posture. The `Agent` tool spawns it with
`subagent_type: "<name>"`; a workflow script addresses the same type as
`agent(prompt, { agentType: "<name>" })`.

```markdown
---
name: security-auditor
description: Audits code for hardcoded secrets and injection flaws
tools: read, grep, bash
model: claude-sonnet-4-5
thinking: high
prompt_mode: append
---

Audit the files you are given for vulnerabilities...
```

## Read this before your keys

`.pi/agents/` is shared territory. Other orchestrators read the same directory with a
different dialect, and this extension **ignores keys it does not recognise — silently**.
No error, no warning, no listing entry: a misnamed key simply does not apply, and the
agent then runs with a default its author never chose. A `tools: none` written in a
dialect this parser does not read is the sharp edge — the agent registers with the full
default toolset instead.

Two spellings from the nearest dialect are accepted here as aliases, which makes a
wrong-dialect file look partly right:

| Not read here | Read here |
|---|---|
| `systemPromptMode: append` | `prompt_mode: append` |
| `disallowedTools` | `disallowed_tools` |
| `contextMode: focused` | no equivalent — set `prompt_mode`, `inherit_context` and `skills` separately |
| `inheritProjectContext: true` | no equivalent — see [Project context](#project-context) |
| `harness_type`, `harness_config` | no equivalent |
| `inheritSkills`, `inheritExtensions` | accepted as aliases of `skills` and `extensions` |

When a key looks right and nothing happens, check its spelling in the tables below
before deciding the feature is broken. `strictAgentFiles` does not help: it aborts on an
*unparseable* file, never on an unknown key.

## Where files are found

| Priority | Location | Scope |
|---|---|---|
| 1 (highest) | `<cwd>/.pi/agents/*.md` | project — authoritative, and where `/agents` writes |
| 2 | `<cwd>/.agents/agents/*.md` | project — shared cross-tool workspace |
| 3 | `$PI_CODING_AGENT_DIR/agents/*.md` (default `~/.pi/agent/agents/`) | user |
| 4 (lowest) | paths an installed package declares in `pi.subagents.agents` | package |

- Only `*.md` directly inside a directory. There is no recursion, and no convention
  directory: a package's `agents/` folder contributes nothing unless declared.
- Files are loaded lowest-priority-first, so a later load overwrites an earlier one. That
  is why row 1 wins.
- **The type is the frontmatter `name:`, falling back to the filename.** A `name:`
  containing `:` is refused outright and the file is skipped with a warning — Claude
  Code reserves that character for plugin-scoped identifiers. An empty or whitespace-only
  `name:` falls back to the filename.
- Any name may shadow a built-in, so a file called `Explore.md` really does replace
  `Explore`.
- Two files claiming one type: the later load wins and a warning names the file that took
  over. Nothing refuses the spawn, so a shadowed type is not an error you will notice.
- Files reload on activation and again on **every `Agent` call**, so an edit is live on
  the next spawn. A broken edit therefore warns rather than fatals; `strictAgentFiles:
  true` aborts load only at startup, and never for a package-provided file.

## Resolving a type at spawn time

- Resolution is case-insensitive, but refuses to guess: an exact match always wins, and
  otherwise the requested name must match exactly one key. Two types differing only in
  case make a case-mismatched request unresolvable rather than ambiguous.
- Unknown, disabled and ambiguous names are treated alike, and all three fall through to
  the `fallbackSubagent` policy: unset → `general-purpose`; a name → that type if it is
  itself enabled, otherwise a refusal; `"none"` → refuse and list the available types.
  The refusal is returned to the caller as a message, not thrown.
- **The hazard to know about:** with `fallbackSubagent` unset *and* `general-purpose` not
  registered — which is what `disableDefaultAgents: true` does — an unresolvable type
  still resolves, and the config lookup then returns its hardcoded last-resort entry: all
  seven built-in tools, extensions on, skills on, `prompt_mode: append`. A one-character
  typo in `agentType` or `subagent_type` yields a full-tool agent. Set
  `fallbackSubagent: "none"` in `subagents.json` if you want typos to fail instead.

## Frontmatter keys

All keys are optional. The *Parsed as* column is what the loader actually accepts, which
is narrower than YAML in several places.

### Identity

| Key | Parsed as | Default | Effect |
|---|---|---|---|
| `name` | string, trimmed | filename | The spawn type. `:` is refused; empty falls back to the filename. |
| `display_name` | string | the type | UI label only — badges, lists, the widget. Never affects dispatch. |
| `color` | string | none | Badge colour. Named colours, `"#RRGGBB"`, or an alias; an unreadable value renders no badge. |
| `description` | string | `name` | Shown in the tool listing. It is the routing text, so keep it a trigger. |
| `enabled` | `false` only | `true` | `false` keeps the file listed but refuses every spawn of it. This is what the UI toggle writes. |

### Tools and extensions

| Key | Parsed as | Default | Effect |
|---|---|---|---|
| `tools` | comma-separated list, or a YAML list | all seven built-ins | Which built-ins surface. `*` or `all` expands to every built-in. `ext:<ext>` and `ext:<ext>/<tool>` add extension tools. **A `tools:` holding only `ext:` entries grants zero built-ins** — add `*` when you want both. |
| `disallowed_tools` | comma-separated list | none | Removed *after* the `tools:` allowlist, so `tools: write` with `disallowed_tools: write` leaves no write. |
| `extensions` | `true`, `false`, `none`, or a list | `true` | Which extensions load for the child. Accepts an `inherit_extensions` alias. |
| `exclude_extensions` | comma-separated list | none | Applied after `extensions:` — exclude wins. Exclusion suppresses handler binding and tool registration; excluded factories still run once, so it is not a sandbox. |

`ext:` selectors narrow which extension *tools* surface; `extensions:` alone decides what
*loads*. An `ext:foo` selector against an extension that `extensions:` excluded is an
orphan and warns after reload.

### Skills

| Key | Parsed as | Default | Effect |
|---|---|---|---|
| `skills` | `true`, `false`, `none`, or a list | `true` | A list preloads **only** those skills into the prompt and inherits nothing else. Accepts an `inherit_skills` alias. |

Skill lookup roots, in order: `<cwd>/.pi/skills`, `<cwd>/.agents/skills`,
`<agentDir>/skills`, `~/.agents/skills`, `~/.pi/skills`. Each root accepts
`<root>/<name>.md` or `<root>/…/<name>/SKILL.md`. A symlinked root or a symlinked
`SKILL.md` is refused, and a directory that itself holds `SKILL.md` is never descended
into, so skills do not nest.

### Model and reasoning

| Key | Parsed as | Default | Effect |
|---|---|---|---|
| `model` | string | inherit the parent | `provider/modelId` or a fuzzy name. Resolution is forgiving (`.` ≡ `-`, optional trailing date stamp) and retries the bare id against other providers; a spec that resolves nowhere falls back to the parent model. Separately, `scopeModels: true` checks the effective model against pi's `enabledModels`: a model the *caller* named outside that list is a hard error returned to the orchestrator, while a frontmatter pin outside it only warns and still runs. |
| `thinking` | string | inherit the parent | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. pi clamps unsupported levels down. |
| `max_turns` | **number only** | unlimited | `0` means unlimited. A quoted `"30"` is dropped rather than coerced, so the child falls back to the project's `defaultMaxTurns` — which is itself unlimited only when that setting is unset too. |

Set a `max_turns` on any agent that fans out; it is the only hard ceiling on what one
spawn can cost, and `defaultMaxTurns` in `subagents.json` is the project-wide version.

### Prompt posture

| Key | Parsed as | Default | Effect |
|---|---|---|---|
| `prompt_mode` | exactly `"append"` | `replace` | `replace` makes the body the whole system prompt. `append` reuses the parent's prompt and appends the body. Any other value, including a typo, silently means `replace`. |
| `inherit_context` | `true` only | `false` | Forks the parent conversation into the child. Honoured on the `Agent` tool path and nested spawns; workflow children and scheduled runs never inherit. |
| `isolated` | `true` only | `false` | Hermetic: forces extensions and skills off and drops `ext:` selectors, so only built-in tools remain. Distinct from `isolation`, which is about the filesystem. |

### Execution

| Key | Parsed as | Default | Effect |
|---|---|---|---|
| `isolation` | `worktree`, or `off`/`none`/`no`/`false` | absent | `worktree` runs the child in a temporary git worktree that cannot see uncommitted changes. `off` is a *value*, not absence: frontmatter outranks the call parameter, so `off` vetoes a caller's `worktree` where an omitted key would let it through. A project setting `worktreeIsolation: false` drops a requested worktree rather than failing. |
| `run_in_background` | `true` only | the `backgroundByDefault` setting | Absence defers to the caller and then the setting; naming a value pins it. |
| `persist_session` | `true` only | the `rememberAgents` setting | Keeps a real pi session so `@handle` can reopen the child later. |
| `output_transcript` | anything except `false` | the `outputTranscript` setting | Writes the `.output` transcript. Note the asymmetry with `persist_session`: a quoted `"false"` is not the boolean, so it *enables* the transcript. |
| `session_dir` | string | pi's default | Only meaningful alongside `persist_session`. |

### Memory

| Key | Parsed as | Default | Effect |
|---|---|---|---|
| `memory` | exactly `user`, `project` or `local` | none | Persistent per-agent memory. `user` → `<agentDir>/agent-memory/<name>/`, or the legacy `~/.pi/agent-memory/<name>/` when that exists and the newer path does not; `project` → `<cwd>/.pi/agent-memory/<name>/`; `local` → `<cwd>/.pi/agent-memory-local/<name>/`. |

The child gets whatever memory tools its tool surface is missing, and read-only access
when that surface has no `write` or `edit`. The agent name must match
`[A-Za-z0-9][A-Za-z0-9._-]*` and be at most 128 characters, or the directory is refused.
`MEMORY.md` is the index, and only its first 200 lines are read.

### Delegation

| Key | Parsed as | Default | Effect |
|---|---|---|---|
| `allowed_subagents` | `true`, `all`, `*`, `false`, `none`, or a list | off | Opt-in to nested `Agent` tools. |

Treat the list as a privilege boundary, not a routing hint: a child runs with *its own*
tools, extensions and `isolated` setting, so listing it grants the parent the union of
what it can do. `isolated` agents never receive nested tools at all. Depth is capped by
`maxSubagentDepth` (default 2), and nesting is capped by turns, so pair a fan-out agent
with a `max_turns`.

## The markdown body

Everything after the closing `---` is the body, and what it becomes depends on
`prompt_mode`:

- **`replace`** (default) — the body is the system prompt. The child still receives a
  fixed sub-agent header, an environment block naming its working directory, git branch
  and platform, and where relevant a worktree-isolation block and a workflow-child block.
- **`append`** — the parent's system prompt is reused verbatim as a byte-identical prefix
  so the KV cache can be shared, followed by a sub-agent bridge, an
  `<active_agent name="…">` tag, the same environment block, and then the body inside
  `<agent_instructions>`. Preloaded skills and the memory block trail it.

Write the body as a role, not a task. The task arrives as the user message, so a body
that restates the current assignment is wrong the second time the agent is used.

In a workflow, a child is additionally told its final message *is* the return value and
that no person reads it — unless the stage passes a `schema`, in which case that block is
omitted and the child answers through a structured-output tool instead. Either way a
stage's output contract belongs in the workflow's prompt, not in the definition body.

### Project context

A subagent never loads `AGENTS.md`, `CLAUDE.md` or `APPEND_SYSTEM.md` itself: the
extension suppresses all three, because upstream re-appends them after the system-prompt
override and that would defeat both `prompt_mode: replace` and `isolated: true`. Project
rules reach a child through the parent's system prompt, which is exactly what
`prompt_mode: append` reuses, or by forking the conversation with `inherit_context: true`.
`isolated: true` does not block the first route, since it governs extensions and skills
rather than the prompt. There is no key that loads project context files directly.

## Precedence: the file outranks the call

For `model`, `thinking`, `max_turns`, `inherit_context`, `run_in_background`, `isolated`
and `isolation`, a value in the file wins over the same parameter on the `Agent` call.
Setting `model` or `thinking` in the file therefore takes the choice away from every
caller — the surfaces report it as "(asked X)" on the result. Omit the key when the caller
should choose, and set it when the agent's behaviour depends on it.

## The `Agent` tool's side

The call supplies `prompt`, `description`, `subagent_type`, `name`, `model`, `thinking`,
`max_turns`, `run_in_background`, `isolated`, `isolation`, `inherit_context`, `resume` and
`schedule`.
A definition file cannot express `prompt`, `description`, `name`, `resume` or `schedule`;
those are per-call. `isolation` disappears from the tool schema entirely when the project
sets `worktreeIsolation: false`, so there is nothing to pass and nothing to explain.

## Shipping definitions in a package

A package must declare its agents — there is no convention-directory fallback, and a
package's `agents/` folder contributes nothing until named. Four spellings are accepted:

```jsonc
"pi": { "subagents": { "agents": ["./agents"], "workflows": ["./flows"] } }
// also accepted: "pi": { "subagents": ["./agents"] },
// "pi-subagents": { "agents": ["./agents"] }, and the bare-array "pi-subagents": ["./agents"]
```

Entries are directories (scanned non-recursively for `*.md`), single files, or `!`
exclusions. No globs, and nothing outside the package root is read. Package agents rank
*below* every project and user file, so any local file of the same name takes the type
back. Ship them by installing the package — see `docs/packages.md` in this repository.

## Checklist before you spawn it

- Every key spelled as in the tables above, not as another runtime spells it.
- `name:` present, and free of `:`.
- `tools:` carrying extension selectors also carrying `*`, unless zero built-ins is the
  intent.
- `max_turns` unquoted.
- `isolated`, `inherit_context`, `run_in_background`, `persist_session` hold only a real
  boolean `true`; anything else is read as false.
- The body describes a role, not the task you have in mind today.
- If a typo must not resolve to an all-tools agent, the project sets
  `fallbackSubagent: "none"`.
