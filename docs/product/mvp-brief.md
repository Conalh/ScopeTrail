# ScopeTrail MVP Brief

Date: 2026-05-21

## Executive Decision

Revision after product collision pass:

ScopeTrail starts as code review for AI agent permission drift.

The first product is not a dashboard, marketplace, policy runtime, or generic MCP scanner. It is a CLI and GitHub Action that explains how a pull request changes source-controlled agent access: `.claude`, MCP config, hooks, skills, AGENTS instructions, and related coding-agent policy files.

See `docs/product/product-collision.md` for the competitive pass that forced this narrower positioning.

Working tagline:

> Code review for AI agent permissions.

## Why This Wedge

AI agent security is crowded already, but most visible products are aiming at runtime governance, enterprise dashboards, or broad agent observability. That is a bigger build and a slower sales motion.

ScopeTrail should enter through the smaller wedge:

> "This PR changes what your agents can do. Here is the risk."

That gives us a useful free tool, a way to dogfood our own agent workflows, and a path to paid team features later without fighting better-funded runtime-security products.

## Target User

Primary user:

- Developers using Codex, Claude Code, Cursor, Windsurf, local MCP servers, or repo-specific agent tooling.
- Small teams experimenting with agents before security has a formal program.
- Security-minded engineering leads who need a quick inventory before approving agent access.

Not the first user:

- Large compliance departments.
- Regulated enterprise procurement.
- Nontechnical AI users.

## MVP Promise

`scopetrail diff` answers four questions:

1. What agent permission/config files changed?
2. Did this widen read, write, shell, network, MCP, hook, or credential access?
3. Which changes deserve human review before merge?
4. What should the reviewer ask the author to tighten?

## First Diff Rules

ScopeTrail v0 should detect:

- New or changed MCP servers, especially commands launched through `npx`, `uvx`, `pipx`, raw GitHub URLs, `curl | bash`, PowerShell `iwr | iex`, or unpinned package commands.
- Permission allowlists widened for shell, read, write, web, network, deploy, database, payment, email, or cloud actions.
- Permission denylists weakened for `.env`, secrets, keys, credentials, lockfiles, build outputs, or protected directories.
- Hooks removed or weakened for high-impact events such as `PreToolUse`, `PostToolUse`, `PermissionRequest`, `SessionEnd`, or equivalent coding-agent lifecycle events.
- Hook URLs widened to arbitrary hosts or HTTP endpoints.
- Project agents, skills, or instructions added with risky behavior directives.
- Local-only overrides that differ materially from checked-in team policy when the user opts into local comparison.

## Output

The CLI and GitHub Action should produce:

- Terminal summary with a low/medium/high/critical drift rating.
- Markdown report for humans.
- JSON report for automation.
- Optional SARIF later for GitHub code scanning.

Example shape:

```text
ScopeTrail permission drift: HIGH

Critical
- .mcp.json adds "stripe-admin" via npx -y @vendor/stripe-mcp@latest.
- .claude/settings.json now allows Bash(curl *).

High
- PreToolUse hook for Bash changed from a local script to a remote HTTP hook.

Suggested first fixes
1. Pin @vendor/stripe-mcp to an exact version.
2. Require approval for payment-modifying tools.
3. Keep the Bash hook local or restrict hook URLs to an allowlist.
```

## Product Shape

Phase 1: CLI

- `scopetrail diff`
- `scopetrail diff --base main --head HEAD`
- `scopetrail diff --format markdown`
- `scopetrail diff --format json`
- `scopetrail diff --ci`
- Built-in detectors plus a small policy file: `scopetrail.config.json`

Phase 2: GitHub Action

- Comment on PRs when agent/MCP access changes.
- Upload Markdown report as an artifact.
- Fail only on configured severity thresholds.

Initial Action behavior:

- Runs locally inside GitHub Actions against the checked-out repository.
- Requires `actions/checkout` with `fetch-depth: 0` so base/head refs are available.
- Uploads nothing to ScopeTrail servers.
- Writes the report to the GitHub Actions step summary.
- Starts advisory by default with `fail-on: none`; teams can raise this to `high` or `critical` after tuning.

Phase 3: Paid SaaS

- Drift history.
- Team policies.
- Baselines and diffs.
- Shared reports.
- Scheduled repo checks.
- Slack alerts.

## Pricing Hypothesis

Start open-core:

- Free: local CLI, Markdown/JSON reports, basic detectors.
- Pro: $19-$29/month for hosted drift history and private report storage.
- Team: $99-$199/month for shared policy, GitHub PR comments, Slack alerts, and retention.

This is deliberately cheaper and simpler than enterprise runtime-security products.

## Positioning

ScopeTrail should sound like a developer tool, not a compliance suite.

Avoid:

- "AI governance platform"
- "enterprise agent security mesh"
- "agentic compliance OS"

Use:

- "Find risky MCP and agent tool access before you run it."
- "Catch risky agent permission drift before merge."
- "Know when a PR changes what your coding agent can touch."

## Competitor / Collision Notes

Crowded names and adjacent products:

- AgentGuard: multiple active products around AI agent security, budget control, MCP policy, and runtime protection.
- AgentTrace: active products around agent observability and MCP security.
- Toolmark: existing package for testing/scanning/publishing AI agent tools.
- ToolFence: existing package described as runtime security for AI agent tools.

ScopeTrail appears cleaner as a product/package name from the initial search, but `scopetrail.com` has DNS. Prefer `scopetrail.dev` if registrar availability checks out, with `usescopetrail.com` as the fallback.

## Validation Plan

The first validation is not paid ads or outreach. It is a useful artifact.

1. Build a diff tool that finds real permission drift in sample `.claude`, MCP, hook, skill, and AGENTS config changes.
2. Publish a crisp example PR report from a harmless sample repo.
3. Put the CLI on GitHub and npm as `scopetrail`.
4. Share one technical post: "I audited 50 public Claude Code configs. Here is how teams widen agent permissions."
5. Watch for stars, issues, comments, and people asking for GitHub Action or team policy.

## Out of Scope For v0

- Runtime policy enforcement.
- Hosted dashboard.
- Natural-language policy engine.
- Enterprise SSO.
- Real-time MCP proxy.
- Secret storage or credential brokering.
- Automatic remediation that edits user config.

## Go / No-Go Signal

Keep building if, within two weeks of a public CLI:

- At least 50 GitHub stars or meaningful comments from agent/MCP users.
- At least 5 people run it on their own repo and report useful drift findings.
- At least 2 requests for hosted multi-repo drift history.

Stop or pivot if:

- The diff tool only finds generic lint issues.
- Existing tools already cover the same exact local-first wedge better.
- Users care only about runtime blocking, not PR review or drift reports.

## Next Build Step

Create a minimal TypeScript CLI:

- Package name: `scopetrail`
- Command: `scopetrail`
- First command: `diff`
- First input surface: explicit old/new file paths plus Git base/head discovery.
- First detectors: new MCP server, MCP command changed, allowlist widened, denylist weakened, hook removed, broad shell/read/write/network capability added.
- First tests: fixture configs with expected findings.
