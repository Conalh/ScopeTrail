# Public Config Audit Methodology

Date: 2026-05-21

## Purpose

Create a useful launch post without shaming projects, exposing secrets, or overstating risk.

The audit should show aggregate patterns in public AI-agent configuration drift and point readers toward the free ScopeTrail Action.

## Scope

Allowed sources:

- Public GitHub repositories.
- Public `.claude/settings.json`.
- Public `.mcp.json`.
- Public AGENTS-style instruction files when they are already indexed and visible.

Out of scope:

- Private repositories.
- Credential hunting.
- Publishing repo names as examples without maintainers' consent.
- Filing drive-by issues on projects unless the finding is clearly actionable and high-impact.

## Data To Collect

For each repo snapshot, record only aggregate-safe fields:

- Config surface found: `.claude/settings.json`, `.mcp.json`, or both.
- MCP server count.
- Number of unpinned executable MCP commands.
- Presence of broad shell permissions.
- Presence of broad home/root read permissions.
- Presence or absence of high-impact hooks such as `PreToolUse`.
- Whether sensitive deny rules exist for `.env`, keys, or credentials.

Do not store copied config bodies in the published artifact.

## Audit Queries

Use GitHub code search manually or with `gh`:

```powershell
gh search code 'path:.claude/settings.json permissions allow' --limit 50
gh search code 'path:.mcp.json mcpServers command' --limit 50
gh search code 'filename:AGENTS.md mcp' --limit 50
```

If GitHub search behavior changes or limits results, document that limitation in the post.

## Post Shape

Working title:

> I audited public AI-agent configs. Here is how permissions drift.

Sections:

1. Why agent permission drift matters.
2. Methodology and privacy guardrails.
3. Aggregate findings.
4. Examples rewritten as anonymized patterns.
5. What ScopeTrail catches today.
6. What it does not catch yet.
7. How to install the free Action.

## Claims Discipline

Say:

- "ScopeTrail flags obvious permission drift."
- "This is advisory and conservative."
- "Findings need human review."

Do not say:

- "ScopeTrail secures your agents."
- "These projects are vulnerable."
- "This replaces runtime controls."

## Call To Action

Ask readers to:

- Install `Conalh/ScopeTrail@v0.1.1` on one repo.
- Open issues for missing config surfaces.
- DM if they manage multiple repos and want drift history.
