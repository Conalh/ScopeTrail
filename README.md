# ScopeTrail

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Language: TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)
[![Local-only](https://img.shields.io/badge/runs-local--only-success.svg)](#how-it-works)
[![Release](https://img.shields.io/github/v/release/Conalh/ScopeTrail)](https://github.com/Conalh/ScopeTrail/releases)

**ScopeTrail diffs the agent config files in a pull request and tells you what
permissions, MCP servers, and hooks just changed.**

## The problem

AI coding agents quietly edit their own permission surfaces. A PR titled *"add
billing endpoint"* can add an `npx ... @latest` MCP server, widen `Bash(npm *)`,
remove a `Read(.env)` deny rule, or swap a `PreToolUse` hook for a no-op — and
none of that shows up in a normal code review. ScopeTrail reads the PR base and
head, compares the agent-config files between them, and reports exactly what
changed and why it matters.

## Quickstart

Install from npm and run against the current repo:

Pilot ScopeTrail in a real repository and share team feedback in the [active pilot issue](https://github.com/Conalh/ScopeTrail/issues/18).

## Part of an AI-agent governance suite

Five tools mapping orthogonal failure modes of AI-agent deployment:

- **ScopeTrail** *(this repo)* — config drift over time (PR-level).
- **[PolicyMesh](https://github.com/Conalh/PolicyMesh)** — policy contradictions across agent surfaces.
- **[CapabilityEcho](https://github.com/Conalh/CapabilityEcho)** — capability drift via code, not config.
- **[TaskBound](https://github.com/Conalh/TaskBound)** — scope creep after the agent runs.
- **[SessionTrail](https://github.com/Conalh/SessionTrail)** — runtime behavior review across agent session transcripts.

ScopeTrail, PolicyMesh, and CapabilityEcho are preventive (static analysis of config and code). SessionTrail is runtime (in-session transcript review). TaskBound is detective (stated task vs. actual diff).

Plus, sitting alongside the five detectors:

- **[GovVerdict](https://github.com/Conalh/GovVerdict)** — meta-reviewer that merges JSON reports from the five tools above into one PR verdict.
- **[agent-gov-core](https://github.com/Conalh/agent-gov-core)** — shared `Finding` schema, `mergeFindings`, and parsers all six tools consume.
- **[agent-gov-demo](https://github.com/Conalh/agent-gov-demo)** — demo sandbox; [PR #1](https://github.com/Conalh/agent-gov-demo/pull/1) trips all five detectors at once.

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

Easy path — no clone, runs against the current repo:

```bash
npx scopetrail diff --repo . --base main --head HEAD --format text
```

Or build from source:

```powershell
npm install
npm run build
node dist/index.js diff --old test/fixtures/combined/old --new test/fixtures/combined/new --format markdown
```

Or as a GitHub Action on pull requests:

```yaml
# .github/workflows/scopetrail.yml
name: ScopeTrail
on: pull_request
permissions:
  contents: read
jobs:
  scopetrail:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0      # required: ScopeTrail compares base..head
      - uses: Conalh/ScopeTrail@v0.2.0
        with:
          fail-on: none       # start advisory; raise to high/critical later
```

The Action writes a Markdown report to the GitHub step summary and emits
PR-visible warning annotations on the exact config lines that drifted.

## Example output

Text output against the bundled `test/fixtures/combined` fixture (a PR that
adds an unpinned `stripe-admin` MCP server, widens Claude permissions, removes
a `.env` deny rule, and drops a `PreToolUse` hook):

```
ScopeTrail permission drift: CRITICAL
[HIGH]     stripe-admin: MCP server "stripe-admin" was added.
[HIGH]     stripe-admin: MCP server "stripe-admin" uses an unpinned command: npx -y @vendor/stripe-mcp@latest.
[HIGH]     Bash(npm *):  Claude permission allowlist now includes broad access: Bash(npm *).
[MEDIUM]   Read(~/**):   Claude permission allowlist now includes broad access: Read(~/**).
[CRITICAL] Read(.env):   Claude permission deny rule was removed: Read(.env).
[HIGH]     PreToolUse:   Claude hook "PreToolUse" was removed.
```

`--format json` emits the canonical [agent-gov-core](https://github.com/Conalh/agent-gov-core)
`Report` envelope so cross-tool reviewers (GovVerdict) can merge findings
across the suite:

```json
{
  "schemaVersion": "1.0",
  "tool": "scope_trail",
  "rating": "critical",
  "findings": [
    {
      "tool": "scope_trail",
      "kind": "scope_trail.permission_deny_removed",
      "severity": "critical",
      "message": "Claude permission deny rule was removed: Read(.env).",
      "location": { "file": ".claude/settings.json" },
      "data": {
        "subject": "Read(.env)",
        "recommendation": "Keep deny rules for secrets, credentials, and protected files unless a reviewer approves the removal."
      },
      "fingerprint": "b3242ffa5f6b40d8"
    }
  ]
}
```

In a real PR the same findings render as inline warning annotations:

![ScopeTrail PR annotations showing risky Claude and MCP config changes](assets/demo-pr-annotations.png)

<!-- TODO: add an asciinema GIF of `scopetrail diff` running locally against the demo repo -->

## How it works

ScopeTrail is **local-only**. It reads the checked-out repository, materializes
the two git refs into temp directories, runs three detectors over them, and
prints the result. It uploads nothing, calls no external services, and has no
required API keys.

The detectors cover the surfaces an AI agent can actually escalate through:

- **MCP** — `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`,
  `.codeium/windsurf/mcp_config.json`, sample/template/disabled variants, and
  prefixed sample files such as `claude_mcp_config.json`. Catches added
  servers, changed launch commands, `@latest` and other unpinned versions,
  and Windsurf `serverUrl` changes.
- **Claude Code settings** — `.claude/settings.json`. Catches widened allow
  rules (`Bash(npm *)`, `Read(~/**)`), removed deny rules (`Read(.env)`), and
  added / removed / command-swapped hooks.
- **Codex** — `.codex/config.toml`. Catches sandbox elevation, weakened
  approval policy, enabled network access, trusted-project changes, and
  `[mcp_servers.NAME]` additions / unpinned commands.

Findings carry a `severity` (`low` / `medium` / `high` / `critical`) and the
report's overall `rating` is the max severity across findings. `--fail-on`
gates CI on that rating.

## Options

CLI:

| Flag | Description |
| --- | --- |
| `--repo <path>` | Repo to inspect (defaults to `cwd`). Pair with `--base` / `--head`. |
| `--base <ref>` | Base git ref or SHA. |
| `--head <ref>` | Head git ref or SHA. |
| `--old <dir>` | Old snapshot directory (alternative to git mode). |
| `--new <dir>` | New snapshot directory (alternative to git mode). |
| `--format <fmt>` | `text` (default), `markdown`, `json`, or `github`. |
| `--out-markdown <path>` | Also write a Markdown report to this path. |
| `--out-json <path>` | Also write the canonical JSON report to this path. |
| `--fail-on <rating>` | Exit 1 when rating ≥ `low` / `medium` / `high` / `critical`. Default `none`. |

GitHub Action inputs (`Conalh/ScopeTrail@v0.2.0`):

| Input | Default | Description |
| --- | --- | --- |
| `repo` | `$GITHUB_WORKSPACE` | Repo path to inspect. |
| `base` | PR base SHA | Base ref. |
| `head` | PR head SHA | Head ref. |
| `fail-on` | `none` | Severity that fails the action. |

Action outputs: `rating` (`none`/`low`/`medium`/`high`/`critical`) and
`finding-count`.

## Development

```bash
npm install
npm run build
npm test
```

Shared parsers, the canonical `Finding` schema, and `mergeFindings` live in
[agent-gov-core](https://github.com/Conalh/agent-gov-core) — see its
[CONTRIBUTING.md](https://github.com/Conalh/agent-gov-core/blob/main/CONTRIBUTING.md)
before touching that library.

---

## Part of the agent-gov suite

ScopeTrail is one tool in a suite of local-only OSS reviewers for AI-agent PRs
and coding sessions. Each tool catches an orthogonal failure mode; each emits
the same `Finding` shape so they can be merged into a single verdict.

| Repo | What it catches |
| --- | --- |
| **[ScopeTrail](https://github.com/Conalh/ScopeTrail)** *(this repo)* | Agent config drift between PR base and head (MCP, Claude, Codex). |
| [PolicyMesh](https://github.com/Conalh/PolicyMesh) | Contradictions across MCP / Claude / Codex policy surfaces in one repo. |
| [CapabilityEcho](https://github.com/Conalh/CapabilityEcho) | Network, subprocess, and capability signals introduced by a code diff. |
| [TaskBound](https://github.com/Conalh/TaskBound) | Scope creep — stated task vs. what the diff actually changed. |
| [SessionTrail](https://github.com/Conalh/SessionTrail) | Risky behavior in Cursor / Claude / Codex session transcripts (JSONL). |
| [GovVerdict](https://github.com/Conalh/GovVerdict) | Merges JSON reports from the tools above into one verdict. |
| [agent-gov-core](https://github.com/Conalh/agent-gov-core) | Shared parsers, the canonical `Finding` schema, and `mergeFindings`. |
| [agent-gov-demo](https://github.com/Conalh/agent-gov-demo) | Demo sandbox with a rogue PR that fires all five reviewers. |

See the full stack in action on the demo PR:
[agent-gov-demo#1](https://github.com/Conalh/agent-gov-demo/pull/1).
