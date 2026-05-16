# Claude skills shipped with Journey

This directory holds the Claude skills we vendor in lockstep with the rest of the codebase. Treat them as documentation that an agent loads — same editorial bar as `docs/`, but tuned for an LLM rather than a human reader.

## Install

Claude Code reads skills from `~/.claude/skills/<skill-name>/`. The simplest install is a one-shot copy:

```sh
cp -r skills/journey-api-testing ~/.claude/skills/
```

For development against this repo (so a change here shows up in your Claude session without re-copying), symlink instead:

```sh
mkdir -p ~/.claude/skills
ln -sfn "$PWD/skills/journey-api-testing" ~/.claude/skills/journey-api-testing
```

After either install, restart Claude Code so it picks up the new skill.

## What's here

| Skill                                                  | Triggers on                                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [`journey-api-testing/`](journey-api-testing/SKILL.md) | Scaffolding, writing, running, and debugging `.journey.ts` projects backed by `@journey/cli` / `@journey/core`. |

## Keeping skills in sync

The `journey-api-testing` skill documents user-facing surface area — CLI commands and flags, `step()` options, the `expect()` matcher table, `journey.config.json` fields, and the troubleshooting catalogue. Whenever you change one of those (in a single PR), update `skills/journey-api-testing/SKILL.md` in the same commit so the agent's mental model stays current. The `docs-sync` agent (see `.claude/agents/docs-sync.md`) audits this skill alongside `CLAUDE.md` / `CONTRIBUTING.md` / `README.md` / `docs/SOURCES.md`.

`CONTRIBUTING.md` spells out the trigger list — the short version is: APIs, CLI commands, codegen output, config schema, or user-facing error messages.
