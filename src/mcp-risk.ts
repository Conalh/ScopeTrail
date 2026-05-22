// Shared MCP launch-command risk model. Both .mcp.json (JSON) and
// .codex/config.toml (TOML) carry the same shape of risky command —
// @latest tags, github tarballs, curl-pipe-sh installers, unpinned
// npx/uvx/pipx packages. Keeping the heuristic in one module means
// the two detectors stay aligned as the risk model evolves.

export interface McpCommandShape {
  command?: string;
  args?: readonly string[];
  url?: string;
  serverUrl?: string;
}

export function serverCommand(spec: McpCommandShape): string {
  return [spec.command, ...(spec.args ?? []), spec.url, spec.serverUrl].filter(Boolean).join(' ');
}

export function isUnpinnedCommand(spec: McpCommandShape): boolean {
  const command = serverCommand(spec);
  const normalized = command.toLowerCase();

  if (normalized.includes('@latest')) {
    return true;
  }

  if (/https:\/\/github\.com\/[^ ]+/.test(normalized)) {
    return true;
  }

  if (/\bcurl\b.+\|\s*(bash|sh)\b/.test(normalized)) {
    return true;
  }

  if (/\b(iwr|invoke-webrequest)\b.+\|\s*(iex|invoke-expression)\b/.test(normalized)) {
    return true;
  }

  const packageLikeArgs = spec.args ?? [];
  const cmd = (spec.command ?? '').toLowerCase();

  if (['npm', 'yarn', 'pnpm'].includes(cmd) && packageLikeArgs.length > 1) {
    const sub = packageLikeArgs[0].toLowerCase();
    const isExecutor = (cmd === 'npm' && (sub === 'exec' || sub === 'x')) ||
                       (cmd === 'yarn' && sub === 'dlx') ||
                       (cmd === 'pnpm' && (sub === 'dlx' || sub === 'exec' || sub === 'x'));
    if (isExecutor) {
      const packageArgs = packageLikeArgs.slice(1).filter((arg) => !arg.startsWith('-'));
      if (packageArgs.length > 0) {
        const pkg = packageArgs[0];
        if (looksLikePackageName(pkg) && !hasExactVersion(pkg)) {
          return true;
        }
      }
    }
  }

  // `bunx` is Bun's npx equivalent and ships as its own binary, so it
  // surfaces as `command: "bunx"` in MCP configs.
  return ['npx', 'uvx', 'pipx', 'bunx'].includes(cmd)
    && packageLikeArgs.some((arg) => looksLikePackageName(arg) && !hasExactVersion(arg));
}

export function isPipeToShellCommand(spec: McpCommandShape): boolean {
  const normalized = serverCommand(spec).toLowerCase();
  return /\bcurl\b.+\|\s*(bash|sh)\b/.test(normalized)
    || /\b(iwr|invoke-webrequest)\b.+\|\s*(iex|invoke-expression)\b/.test(normalized);
}

function looksLikePackageName(value: string): boolean {
  return /^[a-z0-9@][a-z0-9._/@-]+$/i.test(value) && !value.startsWith('-');
}

function hasExactVersion(value: string): boolean {
  const packageVersion = value.startsWith('@') ? value.indexOf('@', 1) : value.indexOf('@');
  if (packageVersion === -1) {
    return false;
  }

  const version = value.slice(packageVersion + 1);
  return /^\d+\.\d+\.\d+/.test(version);
}
