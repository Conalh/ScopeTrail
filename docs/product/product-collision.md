# ScopeTrail Product Collision Pass

Date: 2026-05-21

## Bottom Line

The original ScopeTrail idea - "local MCP and agent-tool security scanner" - is too crowded as stated.

The surviving wedge is narrower:

> Source-control-first permission drift review for coding agents.

ScopeTrail should not try to beat Snyk, Invariant, Lakera, Microsoft, Cisco, or cloud guardrails at general agent security. It should become the small, sharp tool that explains risky changes to `.claude`, `.mcp.json`, AGENTS instructions, hooks, skills, and agent permission files in pull requests.

## What Is Already Covered

### Snyk Agent Scan / Invariant MCP-Scan

Covered:

- Auto-discovers agent configs and MCP servers.
- Scans MCP servers, tools, prompts, resources, and skills.
- Covers Claude Code/Desktop, Cursor, Gemini CLI, Windsurf, and more.
- Has static scan and enterprise/background reporting paths.
- Uses API-backed validation unless configured otherwise.

Implication:

- Do not position ScopeTrail as "the MCP scanner."
- Do not start with tool-poisoning, prompt-injection, or MCP server malware detection as the main differentiation.

### agent-bom

Covered:

- Local AI infrastructure and MCP config discovery.
- CVE and supply-chain scanning.
- Blast radius from package to MCP server to agent to credentials/tools.
- SARIF/SBOM-style outputs.
- Instruction-file auditing for CLAUDE.md, AGENTS.md, SKILL.md, and related files.

Implication:

- Do not lead with "agent BOM," SBOM, CVEs, or broad supply-chain mapping.
- A broad "AI infrastructure scanner" is already occupied.

### Lakera

Covered:

- Enterprise GenAI security.
- Prompt attack prevention.
- Data leakage protection.
- Runtime protection for AI applications and agents.

Implication:

- ScopeTrail cannot win as an enterprise prompt-injection/security platform.

### Anthropic Claude Code Native Controls

Covered:

- Claude Code has hierarchical settings across managed, user, project, and local scopes.
- Project `.claude/settings.json` can be checked into source control.
- Managed settings can enforce organization policy.
- Permissions, hooks, MCP servers, plugins, agents, and skills are first-class configuration surfaces.
- PreToolUse and PostToolUse hooks can approve, deny, ask, defer, inspect, or log tool calls.

Implication:

- Anthropic will keep absorbing runtime permissions and team admin controls.
- ScopeTrail should not depend on Claude Code lacking native permission controls.
- ScopeTrail can still help teams understand and review permission changes across repos and across tools.

### Cloud Guardrails

Covered:

- AWS Bedrock Guardrails evaluates model inputs and outputs, and can be used with Bedrock Agents.
- Microsoft Foundry guardrails include agent intervention points for user input, tool calls, tool responses, and output.
- Cisco AI Defense is moving toward AI asset discovery, AI BOM, MCP governance, and runtime protection.
- Microsoft has an open-source Agent Governance Toolkit for runtime policy enforcement.

Implication:

- Do not fight cloud control planes.
- ScopeTrail should sit before and beside them: repo review, local developer setup, and policy drift evidence.

## The Gap

Teams adopting coding agents now have a quiet source-control problem:

- A PR can widen agent permissions.
- A PR can add a new MCP server.
- A PR can weaken or remove a hook.
- A PR can add project agents, skills, or instructions that change behavior.
- A local override can silently differ from the team policy.
- Multiple tools have different config shapes, so humans cannot quickly compare them.

Existing scanners are better at "is this MCP/tool/skill malicious or vulnerable?"

ScopeTrail should answer:

> "Did this repo change what agents are allowed to do, and should a human approve that change?"

That is a permissions-review product, not a malware scanner.

## Revised Product Positioning

Use:

- "Code review for AI agent permissions."
- "Catch risky agent-access drift before it merges."
- "A PR bot for `.claude`, MCP, hooks, skills, and agent policy changes."

Avoid:

- "MCP security scanner."
- "Agent runtime firewall."
- "Prompt injection defense."
- "AI governance platform."

## Revised MVP

Build a CLI and GitHub Action that can:

1. Parse source-controlled agent config files.
2. Normalize them into a common permission model.
3. Compare current branch vs base branch.
4. Classify changes by risk.
5. Generate a PR-ready Markdown summary.

First supported surfaces:

- `.claude/settings.json`
- `.claude/agents/*.md`
- `.claude/skills/**/SKILL.md`
- `.mcp.json`
- `AGENTS.md`
- `.codex/**` if present
- Cursor/Windsurf rules later

First findings:

- New MCP server added.
- Existing MCP command changed.
- Permission allowlist widened.
- Permission denylist weakened.
- Broad `Bash(*)`, `Read(~/**)`, drive-root, repo-root, or network-capable permissions added.
- Hook removed from high-impact events such as `PreToolUse`, `PostToolUse`, `PermissionRequest`, or `SessionEnd`.
- Hook URL widened to arbitrary destinations.
- Agent or skill instruction contains risky behavior directives.
- Sensitive-file deny rules missing for `.env`, secrets, keys, credentials, build artifacts, or lockfiles.

First output:

```text
ScopeTrail permission drift: HIGH

This PR changes agent access in 3 files.

High
- .claude/settings.json now allows Bash(curl *).
- .mcp.json adds server "stripe-admin" via npx @vendor/stripe-mcp@latest.

Medium
- PreToolUse hook changed from local script to remote HTTPS hook.

Suggested review
1. Pin stripe MCP to an exact version.
2. Require approval for payment-modifying tools.
3. Add CODEOWNERS review for .claude and .mcp.json changes.
```

## Why This Could Survive Native Platforms

Anthropic can own Claude Code runtime controls. Microsoft and AWS can own their clouds.

ScopeTrail survives only if it is:

- Cross-tool: Claude, Codex, Cursor, Windsurf, Gemini CLI.
- Source-control-native: shows permission drift in PRs, not only local machine state.
- Privacy-first: no default upload of tool descriptions, settings, usernames, paths, or repo contents.
- Lightweight: one GitHub Action and one CLI command.
- Educational: turns messy agent configs into a human-readable review.

## Monetization

Open source:

- CLI.
- GitHub Action.
- Local reports.
- JSON/Markdown output.

Paid team layer:

- Multi-repo baselines.
- Permission drift history.
- Slack alerts.
- GitHub App installation.
- Organization policy packs.
- CODEOWNERS suggestions.
- Cross-repo "which repos allow payment/cloud/deploy tools?" view.

Suggested price:

- $99/team/month after design partners ask for multi-repo aggregation.

Do not build the dashboard before 3 design partners explicitly ask for it.

## Distribution

Best content wedge:

> "I audited 50 public Claude Code configs. Here is how teams accidentally widen AI agent permissions."

Rules:

- Only scan public repos.
- Do not publish secrets, repo names, or dunking screenshots.
- Report aggregate patterns.
- Include a reproducible methodology.
- Include a sample ScopeTrail report.

## Recommendation On Order

The bounty digest can still be useful as shipping gym, but it should be kept tiny:

- Two-week cap.
- Stripe checkout.
- Weekly email digest.
- Manual curation is acceptable.
- Success is learning checkout, emails, cancellation, and support, not getting rich.

ScopeTrail is the bigger opportunity, but it should not start as a generic scanner. Start it as a permission-drift PR reviewer.

## Decision

Reposition ScopeTrail from:

> Local MCP security scanner.

To:

> Code review for AI agent permission drift.

