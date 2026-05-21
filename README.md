# ScopeTrail

Code review for AI agent permissions.

ScopeTrail is an early CLI prototype that reports risky permission drift between two versions of agent configuration files. The first slice supports:

- `.mcp.json`
- `.claude/settings.json`
- Terminal, Markdown, and JSON output

## Local Use

```powershell
npm install
npm run build
node dist/index.js diff --old test/fixtures/combined/old --new test/fixtures/combined/new --format markdown
```

JSON output:

```powershell
node dist/index.js diff --old test/fixtures/combined/old --new test/fixtures/combined/new --format json
```

## Current Findings

ScopeTrail v0 detects:

- Added MCP servers.
- Changed MCP launch commands.
- Unpinned MCP launch commands such as `@latest`.
- Broad Claude Code allow rules such as `Bash(npm *)` and `Read(~/**)`.
- Removed Claude Code deny rules for sensitive files such as `.env`.
- Removed Claude Code hooks such as `PreToolUse`.

## Development

```powershell
npm install
npm run build
npm test
```
