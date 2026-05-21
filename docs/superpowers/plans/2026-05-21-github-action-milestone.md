# GitHub Action Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ScopeTrail usable as a free GitHub Action that reviews AI-agent permission drift in pull requests.

**Architecture:** Keep the CLI as the source of truth. Add a git snapshot layer that materializes known config files from `--base` and `--head` refs into temporary directories, then reuses the existing detectors. Add a composite `action.yml` that installs/builds ScopeTrail inside the action checkout, runs the CLI against the workflow repository, and writes the Markdown report to the GitHub step summary.

**Tech Stack:** Node 24, TypeScript, Node built-in test runner, Git CLI, GitHub composite action metadata.

---

### Task 1: Git Ref Diff Support

**Files:**
- Create: `src/git-snapshot.ts`
- Modify: `src/index.ts`
- Create: `test/git-diff.test.mjs`

- [ ] Write a failing test that creates a temporary git repo with `.mcp.json` and `.claude/settings.json`, commits a base state, commits a risky head state, then runs `node dist/index.js diff --repo <repo> --base <base> --head <head> --format json`.
- [ ] Verify the test fails because `--base` and `--head` are not supported.
- [ ] Implement `materializeGitSnapshot(repo, ref)` using `git -C <repo> show <ref>:<path>` for `.mcp.json` and `.claude/settings.json`.
- [ ] Update `diff` argument parsing so callers can use either `--old/--new` or `--base/--head`, with optional `--repo`.
- [ ] Re-run the focused test and then the full suite.

### Task 2: Action Metadata And Step Summary

**Files:**
- Create: `action.yml`
- Modify: `README.md`
- Create: `test/action-metadata.test.mjs`

- [ ] Write a failing metadata test that asserts `action.yml` exists, declares `runs.using: composite`, and includes `base`, `head`, `repo`, and `fail-on` inputs.
- [ ] Verify the test fails because `action.yml` does not exist.
- [ ] Add a composite action that runs `npm ci`, `npm run build`, runs `scopetrail diff --base --head --repo --format markdown`, and appends the report to `$GITHUB_STEP_SUMMARY`.
- [ ] Document the minimal workflow snippet using `actions/checkout` with `fetch-depth: 0`.
- [ ] Re-run the focused test and then the full suite.

### Task 3: Trust Defaults

**Files:**
- Modify: `README.md`
- Modify: `docs/product/mvp-brief.md`

- [ ] Document that the free action uploads nothing by default, uses local git state, and writes only GitHub check/summary output.
- [ ] Document that PR checks should start as non-blocking while teams tune severity.
- [ ] Run final verification: `npm run build`, `npm test`, and a local git-ref CLI smoke.

