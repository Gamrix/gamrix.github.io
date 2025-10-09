# Agent Rules

## Codebase Rules

- Do not change config files unless the user explicitly asks.
- Do not add or remove comments unless the user explicitly asks.
- Prefer simplification over backward compatibility; remove legacy code rather than preserving it.

## Code Style

- Extract a function only if it reduces total lines by >50% and the function body is under 20 lines.
- Inline any 1–3 line functions.
- Add logging only to debug an existing, reproducible issue.
- Use snake_case for new file names.

### KISS — Keep It Simple, Stupid

- Keep code straightforward and easy to reason about.
- UI flourishes inside a component are fine. Do not add unrequested features that
  increase complexity outside it.
- If you need a non-exported variable, export it. Do not duplicate it.

### YAGNI — You Aren’t Going to Need It

- Build only what the current task needs.
- No abstractions, configs, or options without a real consumer.
- Do not add new types, functions, or code unless you will use them now.
- Keep types narrow. Add generics, unions, or optionals only when a concrete use appears.

### Errors

- Prefer visible failures to papered-over ones; don’t silence linter/type errors with temporary workarounds (e.g., any`/unknown`).
- Surface issues at compile time when possible; use types to make potential errors explicit.
- Add error handling only for clear, likely failure modes.

## Language Rules

### TypeScript Rules

- Do not “fix” type errors with any or unknown.
- Use Zod for types and schemas. Avoid TypeScript interfaces where Zod suffices.
- Do not implement both a Zod type and a TypeScript interface for the same schema.
