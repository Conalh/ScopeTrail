# Trust and Permissions

ScopeTrail is a local-only GitHub Action and CLI for reviewing AI-agent permission drift in pull requests.

## What It Reads

ScopeTrail reads the checked-out repository and compares supported agent configuration files between the pull request base and head refs. Supported active files include `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.codeium/windsurf/mcp_config.json`, `.claude/settings.json`, and `.codex/config.toml`.

ScopeTrail also reviews sample/template/disabled MCP config files such as `.mcp.json.sample`, `.mcp.json.template`, `.mcp.json.disabled`, `.mcp.json.example`, platform-suffixed MCP example files such as `.mcp.json.windows.example` and `.mcp.json.example.mac`, nested `mcp_config.json.example` variants, and prefixed MCP config example files such as `example_mcp_config.json`, `claude_mcp_config.json`, `cursor_mcp_config.json`, and `vscode_mcp_config.json`. Those findings are reported separately from active MCP server drift so copied examples can be reviewed without implying they are live configuration.

In GitHub Actions, `fetch-depth: 0` is required so ScopeTrail can compare the pull request base and head commits instead of only seeing the latest checkout.

## What It Writes

ScopeTrail writes a Markdown report to the GitHub Actions step summary, emits PR-visible warning annotations, and exposes `rating` and `finding-count` outputs from the Action step.

## Data Uploads

ScopeTrail uploads nothing by default. It does not send repository contents, findings, or telemetry to a hosted service.

## Runtime Dependencies

The GitHub Action runs the committed `dist/` runtime from the ScopeTrail release tag. It does not run `npm ci` or `npm run build` in the installing repository, so pilot repositories do not need to download ScopeTrail development dependencies during their PR checks.

## Required GitHub Permissions

Required permissions: `contents: read`.

The recommended workflow uses:

```yaml
permissions:
  contents: read
```

That permission lets the Action read the checked-out repository. ScopeTrail does not require write permissions for its advisory default mode.

## Advisory Default

Start with `fail-on: none`. In that mode, ScopeTrail reports findings without blocking the pull request. After the team trusts the findings, raise `fail-on` to `high` or `critical` if blocking risky permission drift fits the repository's policy.

## Security Boundary

ScopeTrail is a review aid. It does not provide a security guarantee, replace human review, or prove that an agent configuration is safe. Treat findings as prompts for review and treat clean reports as limited to the config surfaces ScopeTrail currently supports.
