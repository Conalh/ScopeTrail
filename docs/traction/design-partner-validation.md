# Design Partner Validation

Date: 2026-05-21

## Hypothesis

The free CLI and GitHub Action create enough trust to surface teams that need a paid ScopeTrail layer.

Paid value is not "scan this one PR." Paid value is team memory:

- Multi-repo drift history.
- Shared policy.
- Slack alerts.
- Organization baselines.
- Inventory of repos that allow shell, network, cloud, payment, deploy, database, email, or broad filesystem agent access.

## Who To Talk To

Ideal first design partners:

- Platform engineers responsible for internal developer tooling.
- Security-minded engineering managers adopting coding agents.
- Devtools founders using multiple AI coding tools across repos.
- OSS maintainers experimenting with `.claude`, Codex, Cursor, Windsurf, or MCP.

Avoid early:

- Buyers who need enterprise compliance paperwork before trying anything.
- Teams that only want runtime prompt-injection defense.
- Nontechnical AI users.

## Validation Ask

Use this after someone installs or inspects the free Action:

> If ScopeTrail watched all your repos and told you when agent permissions drifted, would that be worth $99/team/month?

Follow-up questions:

- How many repos would you want watched?
- Who should get alerted?
- Would Slack alerts matter, or is PR review enough?
- Do you need history by repo, by tool, or by permission type?
- What would make this a must-have instead of a nice-to-have?

## Design Partner Offer

Founding design partner terms:

- $49/month for 6 months.
- Direct influence on detector priorities.
- No long contract.
- Cancel anytime.
- Hosted layer only built after three teams commit to concrete needs.

## Build Gate

Do not build SaaS until at least three design partners provide:

- A named team or repo set they want monitored.
- A concrete alerting/reporting need.
- A willingness to pay or a clear procurement path.

## Paid MVP Shape

Only after the build gate:

- GitHub App or scheduled Action upload.
- Hosted org dashboard.
- Repo baseline list.
- Drift event history.
- Slack webhook alerts.
- Team policy config.

Keep the free CLI and Action useful without an account.
