# ScopeTrail

[![CI](https://github.com/Conalh/ScopeTrail/actions/workflows/ci.yml/badge.svg)](https://github.com/Conalh/ScopeTrail/actions/workflows/ci.yml)
[![ScopeTrail](https://github.com/Conalh/ScopeTrail/actions/workflows/scopetrail.yml/badge.svg)](https://github.com/Conalh/ScopeTrail/actions/workflows/scopetrail.yml)
[![Release](https://img.shields.io/github/v/release/Conalh/ScopeTrail)](https://github.com/Conalh/ScopeTrail/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Code review for AI agent permission drift.

ScopeTrail is a free OSS CLI and GitHub Action that reviews pull requests for risky changes to AI-agent configuration files.

- `.mcp.json`
- `.claude/settings.json`
- Terminal, Markdown, JSON, and GitHub annotation output
- GitHub Action step summaries and PR-visible warnings

It is intentionally not a hosted scanner. The Action reads the checked-out repository, uploads nothing by default, and starts advisory with `fail-on: none`.

## Demo

Live demo PR: [Demo: risky agent permission drift](https://github.com/Conalh/ScopeTrail/pull/3)

That PR intentionally adds:

- A new `stripe-admin` MCP server.
- An unpinned `@latest` MCP package.
- Broad Claude Code rules: `Bash(npm *)` and `Read(~/**)`.

ScopeTrail reports `HIGH` permission drift and emits GitHub warning annotations.

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

      - uses: Conalh/ScopeTrail@v0.1.1
        with:
          fail-on: none
```

The action uploads nothing by default. It reads local git state from the checked-out repository, writes a Markdown report to the GitHub Actions step summary, and emits PR-visible warning annotations for each finding.

Start with `fail-on: none` so ScopeTrail is advisory while you tune policy. Raise it to `high` or `critical` once the findings are trusted.

`fetch-depth: 0` is required because ScopeTrail compares the pull request base and head refs.

Action outputs:

- `rating`: `none`, `low`, `medium`, `high`, or `critical`
- `finding-count`: total findings in the diff

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
