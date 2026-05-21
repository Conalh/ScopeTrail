# Team-Layer Validation

The paid team layer is a hypothesis. ScopeTrail should validate that teams need it before any hosted SaaS work begins.

The active pilot issue is https://github.com/Conalh/ScopeTrail/issues/18. Use it to report installs, team workflow pain, and whether the evidence gates below are being met.

## Hypotheses

- Teams need shared visibility into AI-agent permission drift across many repositories.
- Teams need clear policy ownership for agent permission changes.
- Teams need exception workflow when a risky permission is intentional.
- Teams need reporting that separates detector noise from real governance risk.

## Evidence Gates Before SaaS

Do not build hosted SaaS until the free Action produces these signals:

- At least 3 external repositories install ScopeTrail or ask concrete installation questions.
- At least 2 independent users report team or organization usage, not only solo use.
- At least 2 independent feedback items ask for cross-repo visibility, policy ownership, exception workflow, or reporting.
- False-positive and missing-surface reports show a repeated pattern that a team layer would manage better than a single-repo Action.

## What To Collect

Useful validation evidence includes repository counts, agent tools in use, who owns permission review, which findings are noisy, which config surfaces are missing, and which workflow would be painful enough to pay for.

## Boundary

The free GitHub Action remains the product surface until these gates are met. Paid-team work should start with validated workflow pain, not accounts, billing, dashboards, or cloud ingestion.
