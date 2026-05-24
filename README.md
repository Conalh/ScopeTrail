# ScopeTrail

[![CI](https://github.com/Conalh/ScopeTrail/actions/workflows/ci.yml/badge.svg)](https://github.com/Conalh/ScopeTrail/actions/workflows/ci.yml)
[![ScopeTrail](https://github.com/Conalh/ScopeTrail/actions/workflows/scopetrail.yml/badge.svg)](https://github.com/Conalh/ScopeTrail/actions/workflows/scopetrail.yml)
[![Release](https://img.shields.io/github/v/release/Conalh/ScopeTrail)](https://github.com/Conalh/ScopeTrail/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Code review for AI agent permission drift.

ScopeTrail is a free OSS CLI and GitHub Action that reviews pull requests for risky changes to AI-agent configuration files.

- `.mcp.json`
- `.mcp.json.sample`, `.mcp.json.template`, `.mcp.json.disabled`, `.mcp.json.example`, and platform-suffixed examples such as `.mcp.json.windows.example`
- `.cursor/mcp.json`
- `.vscode/mcp.json`
- `.codeium/windsurf/mcp_config.json`
- `mcp_config.json.sample`, `mcp_config.json.template`, `mcp_config.json.disabled`, and `mcp_config.json.example`
- Prefixed sample MCP configs such as `example_mcp_config.json`, `claude_mcp_config.json`, `cursor_mcp_config.json`, and `vscode_mcp_config.json`
- `.claude/settings.json`
- `.codex/config.toml`
- Terminal, Markdown, JSON, and line-level GitHub annotation output
- GitHub Action step summaries and PR-visible warnings

It is intentionally not a hosted scanner. The Action reads the checked-out repository, uploads nothing by default, and starts advisory with `fail-on: none`.

Before you install with `fail-on: none`, see [Trust and permissions](docs/TRUST.md). For rollout, use the [Adoption checklist](docs/ADOPTION.md) and [Pilot guide](docs/PILOT.md).

Pilot ScopeTrail in a real repository and share team feedback in the [active pilot issue](https://github.com/Conalh/ScopeTrail/issues/18).

## Part of an AI-agent governance suite

Five tools mapping orthogonal failure modes of AI-agent deployment:

- **ScopeTrail** *(this repo)* — config drift over time (PR-level).
- **[PolicyMesh](https://github.com/Conalh/PolicyMesh)** — policy contradictions across agent surfaces.
- **[CapabilityEcho](https://github.com/Conalh/CapabilityEcho)** — capability drift via code, not config.
- **[TaskBound](https://github.com/Conalh/TaskBound)** — scope creep after the agent runs.
- **[SessionTrail](https://github.com/Conalh/SessionTrail)** — runtime behavior review across agent session transcripts.

ScopeTrail, PolicyMesh, and CapabilityEcho are preventive (static analysis of config and code). SessionTrail is runtime (in-session transcript review). TaskBound is detective (stated task vs. actual diff).

## Demo

Live demo PR: [Demo: risky agent permission drift](https://github.com/Conalh/ScopeTrail/pull/3)

That PR intentionally adds:

- A new `stripe-admin` MCP server.
- An unpinned `@latest` MCP package.
- Broad Claude Code rules: `Bash(npm *)` and `Read(~/**)`.

ScopeTrail reports `HIGH` permission drift and emits GitHub warning annotations on the risky config lines.

![ScopeTrail PR annotations showing risky Claude and MCP config changes](assets/demo-pr-annotations.png)

For a PR that exercises all five suite tools at once, see [agent-gov-demo PR #1](https://github.com/Conalh/agent-gov-demo/pull/1).

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
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: Conalh/ScopeTrail@v0.2.0
        with:
          fail-on: none
```

The action uploads nothing by default. It reads local git state from the checked-out repository, writes a Markdown report to the GitHub Actions step summary, and emits PR-visible warning annotations for each finding. Findings point at exact config lines when ScopeTrail can resolve them.

The Action runs the committed `dist/` runtime from the release tag, runs `npm ci --omit=dev` inside the ScopeTrail Action directory to install runtime dependencies, and does not run `npm run build` in your repository's workflow.

Start with `fail-on: none` so ScopeTrail is advisory while you tune policy. Raise it to `high` or `critical` once the findings are trusted.

`fetch-depth: 0` is required because ScopeTrail compares the pull request base and head refs.

Before rolling this out across a team, review [Trust and permissions](docs/TRUST.md), the [Adoption checklist](docs/ADOPTION.md), and the [Pilot guide](docs/PILOT.md).

Action outputs:

- `rating`: `none`, `low`, `medium`, `high`, or `critical`
- `finding-count`: total findings in the diff

## Current Findings

ScopeTrail v0 detects:

- Added MCP servers.
- Changed MCP launch commands.
- Unpinned MCP launch commands such as `@latest`.
- Cursor, VS Code, and Windsurf MCP config files using `mcpServers` or `servers` where supported.
- Windsurf remote MCP endpoint changes through `serverUrl`.
- Sample/template/disabled MCP config drift as a separate advisory category, not active server drift.
- Risky copied MCP examples such as `.mcp.json.sample`, `.mcp.json.template`, `.mcp.json.disabled`, `.mcp.json.windows.example`, `.mcp.json.example.mac`, nested `mcp_config.json.example`, and prefixed files such as `example_mcp_config.json` with unpinned commands or remote endpoints.
- Broad Claude Code allow rules such as `Bash(npm *)` and `Read(~/**)`. Scoped grants (`WebFetch(domain:example.com)`, `mcp__github__get_issue`) are recognized as narrow and not flagged.
- Removed Claude Code deny rules for sensitive files such as `.env`.
- Claude Code hook changes: **removed**, **added**, and **command-changed** (a strict `PreToolUse` swapped for a no-op script is the same risk as a removal — both are now caught).
- Codex config drift such as full-access/elevated sandboxes, weakened approval policy, enabled network access, or trusted project settings.
- Codex `[mcp_servers.NAME]` additions, launch-command changes, and unpinned commands (the same risk model as `.mcp.json` MCP detection, applied to TOML).

The git-mode snapshot list is derived from the detectors themselves, so adding a new surface in one place can never leave the GitHub Action silently blind to it. A regression test fails the build if a detector's target paths aren't covered.

## Feedback Wanted

ScopeTrail is intentionally small right now. If a warning is noisy, open a
[false-positive report](https://github.com/Conalh/ScopeTrail/issues/new?template=false-positive.yml).
If your team uses another agent config surface, open a
[missing-surface request](https://github.com/Conalh/ScopeTrail/issues/new?template=missing-surface.yml).
If you're piloting ScopeTrail across multiple repositories, the [pilot guide](docs/PILOT.md) walks through running it on a real repo, and PR-level feedback is welcome on the [active pilot issue](https://github.com/Conalh/ScopeTrail/issues/18).

## Development

```powershell
npm install
npm run build
npm test
```

Shared parsing, locators, and the Finding schema live in [agent-gov-core](https://github.com/Conalh/agent-gov-core) — see its [CONTRIBUTING.md](https://github.com/Conalh/agent-gov-core/blob/main/CONTRIBUTING.md) before touching that library.
