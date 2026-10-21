# Rules for using AI

GoShop is built with AI assistance (Claude Code and the agents in `.claude/agents/`). AI makes the work faster, but the code in this repository is still ours: we read it, we understand it, and we are responsible for it. These rules say when AI is used, how its output is shown in the articles, and what it is never allowed to do.

## When to write by hand, when to use AI

| Write it yourself | Let AI draft it, then review |
|---|---|
| The first time a concept appears in the course (the first handler, the first migration, the first React hook) — the point is to learn it | Repetition of a pattern you already wrote by hand (the fifth CRUD handler, another sqlc query) |
| Business rules: prices, stock, order status transitions, permissions | Boilerplate: Dockerfiles, CI config, test tables, type definitions from the OpenAPI contract |
| Security-sensitive code: auth, token handling, payment webhook verification | Refactors with a clear, checkable goal ("extract this into a function", "rename X to Y") |
| Anything you cannot yet explain line by line | Reviews: asking for bugs, edge cases and missing tests in code you wrote |
| | First drafts of documents (PRD, ADR) that you then edit |

The rule of thumb: **if you could not write it yourself, you are not ready to accept it from AI.**

## The AI box in every article

Whenever an article uses AI to produce code or a document, it shows an "AI box" with three parts, so the reader can see exactly what the machine did and what the human did:

1. **Prompt** — the exact prompt, including the files or context given to the model.
2. **Raw output** — what the model returned, unedited (shortened with `…` if long, never rewritten).
3. **Manual changes and why** — every change made before committing, each with its reason (wrong API, missing error handling, does not match our conventions, security issue, …).

If the output was used unchanged, the third part says so explicitly. An article never presents AI output as hand-written.

## Never put secrets in a prompt

- Do not paste `.env` contents, API keys, tokens, passwords, connection strings with real credentials, or customer data into a prompt.
- Use the placeholder values from `.env.example` when a prompt needs configuration.
- Logs and database dumps are scrubbed of personal data (names, emails, phone numbers, addresses) before they are shared with a model.
- If a secret was pasted by mistake, treat it as leaked: rotate it immediately.

## AI output goes through the same gate

There is no fast lane for AI-generated code. Every change, whoever or whatever wrote it, must:

- be read and understood by the person committing it;
- follow the repo conventions (`CLAUDE.md`, the agent files, `CONTRIBUTING.md`);
- pass the full verified gate: build, lint, unit tests with coverage, database audit, integration tests and quality review (`make verify` locally; the Makefile arrives in artikel-12);
- pass the secret scan.

A failing gate goes back to the code's owner, human or agent, and the whole gate runs again.

## Checking AI output

Models are confidently wrong in predictable ways. Before accepting output, check in particular:

- **APIs that do not exist** — every imported package and function must exist in the pinned version (`go doc`, the package's docs).
- **Outdated versions** — Docker images, npm packages and GitHub Actions pinned to old or non-existent tags.
- **Silent behaviour changes** in refactors — run the tests before and after.
- **Missing error handling and edge cases** — empty lists, zero quantities, duplicate requests, timeouts.
- **Licences** — no large blocks copied from code with an incompatible licence.
