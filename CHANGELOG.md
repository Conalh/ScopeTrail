# Changelog

All notable changes to this project will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Under v1.0, minor versions may carry breaking changes.

## [0.3.3] — 2026-06-18

### Fixed

- Added the missing `include-samples` input to the README GitHub Action input table.

### Documentation

- Clarified that ScopeTrail reviews the repository-shared `.claude/settings.json` surface, while `.claude/settings.local.json` is machine-local state that should remain untracked.

No detector, fingerprint, runtime-support, or GitHub Action behavior changed.

## [0.3.2] — 2026-06-14

### Added
- **Findings now state `client` and `runtime_active`.** Every finding reports which agent/editor loads the surface (Cursor / VS Code / Windsurf / Claude Code / Codex) and whether that surface is a live runtime config (`true`) or an inert sample/template (`false`). Surfaced in the text and GitHub-annotation output as `(client=…, runtime_active=…)`, in markdown as a `Loaded by:` line, and in the canonical JSON `data` bag for cross-tool consumers. This answers the pilot ask in [Abilityai/trinity#911](https://github.com/Abilityai/trinity/issues/911) for output that says *what loads a change and why it is active*.

### Changed
- **Sample/template MCP scanning is opt-in.** `.mcp.json.template`, `.sample`, `.disabled`, `.example`, and prefixed examples (`claude_mcp_config.json`, …) never load into an agent runtime, so a change to one is not permission drift. They are reviewed only with `--include-samples` / the Action's `include-samples: true`, on a separate low-severity `scope_trail.mcp_sample_*` finding track so they can never be mistaken for live `.mcp.json` drift. (#50)

### Fixed
- Closed permission-drift blind spots and a release-blocking bin resolution bug surfaced in external review: the `scopetrail` bin now runs correctly whether invoked directly or through an npm symlink, MCP server maps under multiple recognized keys are merged instead of shadowed, and sensitive env/header/cwd changes on an unchanged launch command are flagged. (#49)

## [0.3.1] — 2026-05-28

### Internal
- Adopted the shared diff-input safety guards from `agent-gov-core` 1.3.0: the local `verifyGitRef` string check is now `isValidGitRef`, and the snapshot path-containment check is now `resolveWithinRoot`. Behavior is identical — the guards were lifted verbatim out of this detector into core so every suite tool enforces the same argument-injection and path-traversal rules. Bumped `agent-gov-core` `^1.2.1` → `^1.3.0`.

## [0.3.0] — 2026-05-28

### Changed
- **GitHub annotations are now severity-aware.** `high` and `critical` findings emit `::error` annotations; `medium` and `low` stay `::warning`. This matches the annotation contract in agent-gov-core (and GovVerdict), so a critical permission drift no longer shows up as a yellow warning in the PR diff. Exit-code gating is unchanged — that is still controlled by `--fail-on`.

### Fixed
- PR comment / markdown output now escapes inline markdown syntax in finding messages so subjects like `Bash(npm *)` render literally instead of as formatting.
- README text-output example matches the actual unaligned `renderText` output (single-space `[SEVERITY] subject: message`).

### Internal
- Bumped `agent-gov-core` dependency `^1.0.0` → `^1.2.1`.

## [0.2.0] — 2026-05-22

**BREAKING** — JSON output now emits the canonical agent-gov-core `Report` envelope so the cross-tool meta-reviewer (GovVerdict) can ingest one shape across the whole suite.

### Changed (breaking)
- `--format json` output replaces the legacy `{ rating, findingCount, findings }` shape with a canonical `Report` envelope: `{ schemaVersion: '1.0', tool: 'scope_trail', rating, findings }`. The aggregate rating remains accessible at `.rating` (same path); the previous `.findingCount` is now `.findings.length`.
- Each emitted finding moves the flat `file` / `line` fields into a structured `location: { file, line }` per the canonical `Finding` schema. Tool-specific extras (`subject`, `recommendation`) ride along under `data.*` per finding.
- `action.yml`: the Action step's `finding-count` output now derives from `.findings.length` rather than the dropped top-level `.findingCount`. Action-level output keys are unchanged.

### Why
- Closes the envelope mismatch that forced GovVerdict to carry a legacy adapter in `src/load.ts`. After all five consumers migrate, the adapter is deleted in GovVerdict v0.2.0.
- Unblocks the agent-gov-core v1.0 schema freeze: every consumer now flows through `createReport` + `createFinding`, so the canonical envelope is the only contract downstream tools depend on.

### Internal
- Internal `DriftReport` type retained — markdown / text / GitHub annotation renderers still consume it directly. The migration is at the JSON serialization edge only.
