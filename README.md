# ScopeTrail

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Language: TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)
[![Local-only](https://img.shields.io/badge/runs-local--only-success.svg)](#how-it-works)
[![Release](https://img.shields.io/github/v/release/Conalh/ScopeTrail)](https://github.com/Conalh/ScopeTrail/releases)

**A PR-level permission drift detector for AI-agent configuration.** ScopeTrail compares agent config files between pull-request base and head, then reports what permissions, MCP servers, hooks, and sandbox settings changed.

AI-agent review is no longer just code review. A PR can leave the application logic alone while quietly widening `Bash(npm *)`, removing `Read(.env)`, adding an unpinned MCP server, or enabling network access in Codex. ScopeTrail makes that config drift visible before the new permission surface becomes the default behavior for every future agent run.

```mermaid
flowchart LR
    Base["PR base<br/>agent config before"] --> Diff
    Head["PR head<br/>agent config after"] --> Diff
    Diff[("ScopeTrail<br/>permission drift diff")] --> Report["Review output<br/>annotations · markdown · JSON"]
    Report --> Reviewer["Reviewer sees<br/>what changed and why"]

    classDef input fill:#1e293b,stroke:#334155,color:#e2e8f0
    classDef engine fill:#0f172a,stroke:#1e293b,color:#e2e8f0,stroke-width:2px
    classDef output fill:#0c4a6e,stroke:#0369a1,color:#e0f2fe
    class Base,Head input
    class Diff engine
    class Report,Reviewer output
```

**See also:** [PolicyMesh](https://github.com/Conalh/PolicyMesh) for contradictions across current policy files · [CapabilityEcho](https://github.com/Conalh/CapabilityEcho) for capability drift through code · [GovVerdict](https://github.com/Conalh/GovVerdict) for one merged suite verdict.

## Where this fits

ScopeTrail is the **config-diff** detector — it reports what a PR changed in your agent configuration, separate from whether that change is risky.

| Tool | Input | Catches / decides | Output | Use when |
|---|---|---|---|---|
| [warden](https://github.com/Conalh/warden) | policy + tool action | allow / deny / ask | verdict | you need deterministic runtime policy decisions |
| [barbican](https://github.com/Conalh/barbican) | MCP tools/list + tools/call | denied calls, ask handling, tool poisoning | enforced MCP proxy + reports | you need MCP runtime enforcement |
| **ScopeTrail** | PR base/head agent config | permission/config drift | annotations + report | a PR changes agent config |
| [PolicyMesh](https://github.com/Conalh/PolicyMesh) | current repo policy/config files | contradictory rules across agent surfaces | report / SARIF | current policy is inconsistent |
| [CapabilityEcho](https://github.com/Conalh/CapabilityEcho) | PR diff | new executable capability | annotations + report | code gains network/subprocess/eval/lifecycle/workflow power |
| [TaskBound](https://github.com/Conalh/TaskBound) | stated task + PR diff | scope creep | annotations + report | an agent may have gone off-task |
| [SessionTrail](https://github.com/Conalh/SessionTrail) | Cursor/Claude/Codex JSONL transcripts | risky runtime behavior | report / SARIF | an agent session already ran |
| [GovVerdict](https://github.com/Conalh/GovVerdict) | JSON reports | deduped suite verdict | merged report | you want one final review verdict |
| [AgentPulse](https://github.com/Conalh/AgentPulse) | live session events | trajectory state | terminal dashboard | you want live session observation |
| [agent-gov-core](https://github.com/Conalh/agent-gov-core) | shared schemas/parsers | common Finding/Report model | library | tools need shared report primitives |

## Why this exists

AI coding agents are governed by repo-local files: MCP configs, Claude settings, Codex config, hooks, and sandbox policy. Those files are just as load-bearing as source code, but normal PR review tends to treat them as setup noise.

ScopeTrail exists for the moment when the task says “add billing endpoint” and the diff also changes the agent’s future permissions. It answers the review question directly: **what did this PR make the agent newly able to do?**

## What it catches

| Drift class | Example |
| --- | --- |
| **MCP drift** | New server added, command changed, `@latest` introduced, Windsurf `serverUrl` changed. |
| **Claude permission drift** | Broad allow rules added, deny rules removed, hooks added/removed/swapped. |
| **Codex drift** | Sandbox elevation, weaker approval policy, network access enabled, trusted-project changes. |
| **Review drift** | Config changes that look harmless in a file-by-file diff but materially change the agent surface. |

## Demo

Live demo PR: [Demo: risky agent permission drift](https://github.com/Conalh/ScopeTrail/pull/3)

That PR intentionally adds a new `stripe-admin` MCP server, an unpinned `@latest` MCP package, and broad Claude Code rules: `Bash(npm *)` and `Read(~/**)`.

ScopeTrail reports `HIGH` permission drift and emits GitHub error annotations on the risky config lines.

![ScopeTrail PR annotations showing risky Claude and MCP config changes](assets/demo-pr-annotations.png)

For a PR that exercises the whole suite at once, see [agent-gov-demo PR #1](https://github.com/Conalh/agent-gov-demo/pull/1).

## Quickstart

ScopeTrail isn't published to npm yet — clone, build, and run against any repo:

```bash
git clone https://github.com/Conalh/ScopeTrail && cd ScopeTrail
npm install && npm run build
node dist/index.js diff --repo . --base main --head HEAD --format text
```

Or as a GitHub Action on pull requests:

```yaml
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
      - uses: Conalh/ScopeTrail@v0.4.0
        with:
          fail-on: none       # start advisory; raise to high/critical later
```

The Action writes a Markdown report to the GitHub step summary and emits PR-visible annotations on the exact config lines that drifted — errors for `high`/`critical` drift, warnings otherwise.

Pilot ScopeTrail in a real repository and share team feedback in the [active pilot issue](https://github.com/Conalh/ScopeTrail/issues/18).

## Local development

```powershell
npm install
npm run build
node dist/index.js diff --old test/fixtures/combined/old --new test/fixtures/combined/new --format markdown
```

## Example output

Text output against the bundled `test/fixtures/combined` fixture:

```
ScopeTrail permission drift: CRITICAL
[HIGH] stripe-admin: MCP server "stripe-admin" was added. (client=Claude Code, runtime_active=true)
[HIGH] stripe-admin: MCP server "stripe-admin" uses an unpinned command: npx -y @vendor/stripe-mcp@latest. (client=Claude Code, runtime_active=true)
[HIGH] Bash(npm *): Claude permission allowlist now includes broad access: Bash(npm *). (client=Claude Code, runtime_active=true)
[MEDIUM] Read(~/**): Claude permission allowlist now includes broad access: Read(~/**). (client=Claude Code, runtime_active=true)
[CRITICAL] Read(.env): Claude permission deny rule was removed: Read(.env). (client=Claude Code, runtime_active=true)
[HIGH] PreToolUse: Claude hook "PreToolUse" was removed. (client=Claude Code, runtime_active=true)
```

Each finding states the **client** that loads the surface and whether it is `runtime_active` — a live config an agent loads (`true`) versus an opt-in sample/template that never loads (`false`). That keeps `.cursor/mcp.json` drift visibly distinct from a `.mcp.json.template` example.

`--format json` emits the canonical [agent-gov-core](https://github.com/Conalh/agent-gov-core) `Report` envelope so cross-tool reviewers like GovVerdict can merge findings across the suite:

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
      "salientKey": "Read(.env)",
      "data": {
        "subject": "Read(.env)",
        "recommendation": "Keep deny rules for secrets, credentials, and protected files unless a reviewer approves the removal.",
        "client": "Claude Code",
        "runtimeActive": true
      },
      "fingerprint": "1a6a5b7504e48356"
    }
  ]
}
```

## How it works

ScopeTrail is **local-only**. It reads the checked-out repository, materializes the two git refs into temp directories, runs detectors over them, and prints the result. The scanner uploads nothing — no repository contents, findings, or telemetry leave your machine — and it needs no API keys. (The GitHub Action's setup step installs ScopeTrail's one runtime dependency with `npm ci` from the npm registry; the analysis itself makes no network calls.)

The detectors cover the surfaces an AI agent can actually escalate through:

- **MCP** — `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.codeium/windsurf/mcp_config.json`. Sample/template/disabled variants (and prefixed sample files such as `claude_mcp_config.json`) are reviewed only with `--include-samples` / the Action's `include-samples: true` — those files never load into an agent, so a change to one is not permission drift.
- **Claude Code settings** — `.claude/settings.json`, including widened allow rules, removed deny rules, and added / removed / command-swapped hooks.
- **Codex** — `.codex/config.toml`, including sandbox elevation, weakened approval policy, network access, trusted-project changes, and `[mcp_servers.NAME]` additions / unpinned commands.

### Claude Code local settings boundary

ScopeTrail reviews `.claude/settings.json` because it is the repository-shared Claude Code configuration surface.

It intentionally does not treat `.claude/settings.local.json` as a team configuration surface. Claude Code defines that file as machine-local, untracked state for personal preferences and experimentation. A local settings file committed accidentally should be removed from source control and added to `.gitignore`.

Findings carry a `severity` (`low` / `medium` / `high` / `critical`) and the report's overall `rating` is the max severity across findings. `--fail-on` gates CI on that rating.

## How well it catches it

ScopeTrail ships a labeled precision/recall benchmark over **35 fixture PRs** (27 with planted drift, 8 benign) spanning **21 detector kinds**. Each fixture is an `old/`+`new/` config snapshot pair; ground truth is fixed by fixture design and the harness diffs the pair and scores the drift engine against it. Reproduce with `npm run build && node benchmark/run-benchmark.mjs`. These figures score the engine against its own labeled fixtures — they bound regressions, not a claim of real-world field accuracy across every config a PR might contain.

| Metric | Result |
| --- | --- |
| Detection (any finding) — recall | **100%** (27/27 rogue PRs flagged) |
| Detection — false-positive rate | **0%** (0/8 benign PRs flagged) |
| Detection — precision | **100%** |
| Correct primary finding kind | **27/27** rogue PRs |
| All expected finding kinds | **27/27** rogue PRs |
| Exact consolidated rating | **35/35** PRs |

The 8 benign cases include seven engineered **false-positive traps** — narrowly-scoped Claude grants (a textual diff sees new `allow` lines), an all-tightening Codex posture, network access that was *already* on, a brand-new Codex config pinned to the narrowest posture, a dropped MCP `env` var, a removed MCP server, and a `.mcp.json` with reordered keys but an identical launch command — plus one byte-identical snapshot. None produce a finding, because the detectors compare semantics and flag only *widening*.

**Severity is calibrated, not maximized.** At a strict `fail-on: high` gate, recall is 85% — by design: opt-in sample/template MCP additions, pinned version bumps, broad `Read` allows, and newly-enabled Codex network access sit at `low`/`medium` because they widen the surface without being directly exploitable. The `high`/`critical` band is reserved for executable or secret-facing changes — a bare `Bash` grant, a removed `Read(.env)` deny, a `danger-full-access` sandbox, an unencrypted remote MCP endpoint. Full confusion matrix at every gate, per-category and per-case breakdowns: [benchmark/RESULTS.md](benchmark/RESULTS.md). Methodology and labels: [benchmark/labels.json](benchmark/labels.json).

## Design choices worth flagging

- **Diff-first.** ScopeTrail cares about what changed in this PR, not whether the repo already had historical config debt.
- **Line-level review output.** Findings point at the changed config lines so reviewers can discuss a concrete permission change.
- **Local-only by design.** The tool does not need hosted state or access to your secrets.
- **Suite-shaped output.** JSON uses the shared `Finding` contract so GovVerdict can dedupe it with PolicyMesh, CapabilityEcho, TaskBound, and SessionTrail.

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
| `--fail-on <rating>` | Exit 1 when rating >= `low` / `medium` / `high` / `critical`. Default `none`. |

GitHub Action inputs (`Conalh/ScopeTrail@v0.4.0`):

| Input | Default | Description |
| --- | --- | --- |
| `repo` | `$GITHUB_WORKSPACE` | Repo path to inspect. |
| `base` | PR base SHA | Base ref. |
| `head` | PR head SHA | Head ref. |
| `fail-on` | `none` | Severity that fails the action. |
| `include-samples` | `false` | Also review sample/template/disabled MCP configurations. These findings remain advisory and report `runtime_active=false`. |

Action outputs: `rating` (`none`/`low`/`medium`/`high`/`critical`) and `finding-count`.

## Part of the agent-gov suite

Local-only OSS tools that review AI-agent PRs and coding sessions for config drift, policy mismatches, and scope creep. Each tool covers an orthogonal failure mode; each emits the same `Finding` shape so GovVerdict can merge them into one verdict.

| Repo | What it catches |
| --- | --- |
| **ScopeTrail** *(this repo)* | Agent config drift between PR base and head. |
| [PolicyMesh](https://github.com/Conalh/PolicyMesh) | Contradictory agent instructions and config drift that make behavior non-reproducible. |
| [CapabilityEcho](https://github.com/Conalh/CapabilityEcho) | Capability drift introduced by code, manifests, workflows, and Dockerfiles. |
| [TaskBound](https://github.com/Conalh/TaskBound) | Scope creep between the stated task and the actual diff. |
| [SessionTrail](https://github.com/Conalh/SessionTrail) | Risky runtime behavior in Cursor / Claude Code / Codex session transcripts. |
| [GovVerdict](https://github.com/Conalh/GovVerdict) | Merges JSON reports from the tools above into one deduped review. |
| [agent-gov-core](https://github.com/Conalh/agent-gov-core) | Shared parsers, the canonical `Finding` schema, and `mergeFindings`. |
| [agent-gov-demo](https://github.com/Conalh/agent-gov-demo) | Demo sandbox with a rogue PR that fires all five reviewers. |

MIT. Bug reports and false-positive reports welcome via [Issues](https://github.com/Conalh/ScopeTrail/issues).
