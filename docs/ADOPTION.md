# Adoption Checklist

Use this checklist when trying ScopeTrail in a real repository. For a copy-paste external trial flow, use the [Pilot guide](PILOT.md).

1. Install ScopeTrail with `fail-on: none`.
2. Use `actions/checkout` with `fetch-depth: 0`.
3. Run it for 3-5 pull requests before considering a blocking threshold.
4. Review inline annotations and step summaries with the developers who own AI-agent config changes.
5. Open a [false-positive report](https://github.com/Conalh/ScopeTrail/issues/new?template=false-positive.yml) for noisy findings.
6. Open a [missing-surface request](https://github.com/Conalh/ScopeTrail/issues/new?template=missing-surface.yml) for unsupported agent config files.
7. Open a [team-adoption signal](https://github.com/Conalh/ScopeTrail/issues/new?template=team-adoption.yml) if the pain is about ownership, reporting, exceptions, or many repositories.
8. Raise `fail-on` only after the team agrees the findings are useful enough to block pull requests.

ScopeTrail should earn trust as an advisory reviewer first. Blocking mode is a policy choice for teams that have already seen the findings on their own pull requests.
