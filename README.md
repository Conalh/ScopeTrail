# ScopeTrail

Code review for AI agent permissions.

ScopeTrail is an early CLI prototype that reports risky permission drift between two versions of agent configuration files. The first slice supports:

- `.mcp.json`
- `.claude/settings.json`
- Terminal, Markdown, and JSON output
- GitHub Action step summaries for pull requests

## Local Use

```powershell
npm install
npm run build
node dist/index.js diff --old test/fixtures/combined/old --new test/fixtures/combined/new --format markdown
```

Compare two git refs:

```powershell
node dist/index.js diff --repo . --base main --head HEAD --format markdown
```

JSON output:

```powershell
node dist/index.js diff --old test/fixtures/combined/old --new test/fixtures/combined/new --format json
```

## GitHub Action

Add this workflow to review agent permission drift on pull requests:

```yaml
name: ScopeTrail

on:
  pull_request:

permissions:
  contents: read

jobs:
  scopetrail:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: Conalh/ScopeTrail@main
        with:
          fail-on: none
```

The action uploads nothing by default. It reads local git state from the checked-out repository and writes a Markdown report to the GitHub Actions step summary.

Start with `fail-on: none` so ScopeTrail is advisory while you tune policy. Raise it to `high` or `critical` once the findings are trusted.

## Current Findings

ScopeTrail v0 detects:

- Added MCP servers.
- Changed MCP launch commands.
- Unpinned MCP launch commands such as `@latest`.
- Broad Claude Code allow rules such as `Bash(npm *)` and `Read(~/**)`.
- Removed Claude Code deny rules for sensitive files such as `.env`.
- Removed Claude Code hooks such as `PreToolUse`.

## Development

```powershell
npm install
npm run build
npm test
```
