# ScopeTrail Launch Plan

Date: 2026-05-21

## Goal

Use the free GitHub Action to find real users before building a hosted SaaS.

The launch goal is not revenue yet. It is proof that developers and small platform teams care enough to install ScopeTrail, leave it running, and ask for multi-repo/team features.

## Positioning

Use:

> Code review for AI agent permission drift.

Supporting copy:

- Catch risky `.claude/settings.json` and `.mcp.json` changes before they merge.
- Know when a PR widens what coding agents can read, run, or connect to.
- Free, local, advisory by default, no upload required.

Avoid:

- AI governance platform.
- MCP malware scanner.
- Runtime firewall.
- Enterprise guardrails.

## Launch Assets

Required before broader promotion:

- README with a five-minute install path.
- Live demo PR that shows real GitHub warnings.
- Release tag users can pin.
- Short post with public-config audit findings.
- Simple issue template for detector false positives and missing config surfaces.

Current proof:

- `v0.1.1` release exists.
- Draft demo PR exists at `https://github.com/Conalh/ScopeTrail/pull/3`.
- ScopeTrail emitted warnings on GitHub for intentionally risky config drift.

## First Distribution Loops

1. Direct install asks.

Ask 20 technical people to try the free Action on one repo where they use Claude Code, Codex, Cursor, Windsurf, or MCP.

2. Public audit post.

Publish a short, aggregate post:

> I audited public Claude Code and MCP configs. Here is how AI-agent permissions drift in PRs.

3. GitHub social proof.

Keep the demo PR open and link it from the README so users can inspect the actual check output.

4. Issue-led roadmap.

Convert credible missing surfaces into GitHub issues:

- Codex config support.
- Cursor/Windsurf rule support.
- GitHub Action SARIF or check-run output.
- Better permission lattice.

## Success Criteria

Move toward paid-team validation only after at least two of these are true:

- 50 GitHub stars.
- 5 real repositories install the Action.
- 3 users open issues or send concrete detector feedback.
- 2 teams ask about multi-repo drift history, Slack alerts, or org baselines.

## Do Not Build Yet

- Hosted dashboard.
- Accounts or billing.
- Slack app.
- GitHub App installation flow.
- Organization policy UI.

Those are paid-layer candidates, not launch prerequisites.
