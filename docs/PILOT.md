# Pilot Guide

Use this guide to try ScopeTrail in an external repository before any paid team-layer work exists.

## Install

Add this workflow with `fail-on: none` so ScopeTrail reports findings without blocking pull requests.

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

      - uses: Conalh/ScopeTrail@v0.1.8
        with:
          fail-on: none
```

## Trial Window

Run ScopeTrail on 3-5 pull requests before deciding whether it should stay installed. Review the GitHub Action step summary and PR-visible warning annotations with the people who own AI-agent config changes.

Useful checks during the trial:

- Did ScopeTrail catch real permission drift?
- Did any warning feel noisy or too broad?
- Did sample/template/disabled MCP config findings, including platform-suffixed examples, correctly stay separate from active MCP server drift?
- Did it miss an agent config surface your repository uses?
- Would a team workflow need cross-repo visibility, policy ownership, exception workflow, or reporting?

## Report Results

Report pilot results in the active pilot issue:

https://github.com/Conalh/ScopeTrail/issues/18

Or open a structured pilot result:

https://github.com/Conalh/ScopeTrail/issues/new?template=pilot-result.yml

Use this format:

```md
Pilot source: external repo / team / solo repo
Repository count:
Agent tools in use:
ScopeTrail install status: installed / asked install question / not installed
Useful findings:
Noisy findings:
Missing surfaces:
Team workflow requested: cross-repo visibility / policy ownership / exceptions / reporting / none
Would keep installed after trial: yes / no / unsure
```

## Outreach Queue

Potential external pilots are tracked separately:

https://github.com/Conalh/ScopeTrail/issues/21

Being listed in the outreach queue does not count as validation evidence. A repo only counts after an external maintainer installs ScopeTrail, asks a concrete installation question, or reports team workflow pain in an auditable comment or issue.

## Boundary

ScopeTrail is a free local-only CLI and GitHub Action today. The paid team layer remains unbuilt until external pilot evidence shows repeated team-level pain that the single-repo Action cannot manage well.
