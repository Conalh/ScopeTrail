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
      if (packageArgs.length > 0 && isUnpinnedPackageSpec(packageArgs[0])) {
        return true;
      }
    }
  }

  // `bunx` is Bun's npx equivalent and ships as its own binary, so it
  // surfaces as `command: "bunx"` in MCP configs.
  return ['npx', 'uvx', 'pipx', 'bunx'].includes(cmd)
    && packageLikeArgs.some(isUnpinnedPackageSpec);
}

export function isPipeToShellCommand(spec: McpCommandShape): boolean {
  const normalized = serverCommand(spec).toLowerCase();
  return /\bcurl\b.+\|\s*(bash|sh)\b/.test(normalized)
    || /\b(iwr|invoke-webrequest)\b.+\|\s*(iex|invoke-expression)\b/.test(normalized);
}

// A package spec covers `name`, `name@<version-or-range>`, and the
// occasional `name>=1.2.3` form. Only `name@<exact N.N.N>` is pinned;
// anything else (bare name, `@latest`, `^`, `~`, `>=`, `*`) is unpinned.
// The previous narrow `looksLikePackageName` regex rejected any value
// containing range operators, so `@vendor/helper@^1.2.3` slipped past
// the unpinned check entirely.
function isUnpinnedPackageSpec(value: string): boolean {
  const spec = parsePackageSpec(value);
  if (!spec) {
    return false;
  }
  if (spec.versionSpec === undefined) {
    return true;
  }
  return !/^@\d+\.\d+\.\d+/.test(spec.versionSpec);
}

function parsePackageSpec(value: string): { name: string; versionSpec?: string } | undefined {
  if (!value || value.startsWith('-')) {
    return undefined;
  }

  // For scoped names (`@scope/name`), skip the leading `@` so we don't
  // mistake it for the version separator.
  const scanFrom = value.startsWith('@') ? 1 : 0;
  let cut = -1;
  for (let index = scanFrom; index < value.length; index += 1) {
    const char = value[index];
    if (char === '@' || char === '>' || char === '<' || char === '=') {
      cut = index;
      break;
    }
  }

  const name = cut === -1 ? value : value.slice(0, cut);
  const versionSpec = cut === -1 ? undefined : value.slice(cut);

  if (!/^@?[a-z0-9][a-z0-9._/-]*$/i.test(name)) {
    return undefined;
  }
  return { name, versionSpec };
}

export function remoteEndpoint(spec: McpCommandShape): string | undefined {
  return [spec.url, spec.serverUrl].find((value): value is string => Boolean(value && isRemoteEndpoint(value)));
}

export function isRemoteEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    // Node's URL parser returns IPv6 hostnames with surrounding
    // brackets (`new URL('http://[::1]:3000').hostname === '[::1]'`),
    // so `'::1'` alone never matched. Include both forms.
    return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isUnencryptedEndpoint(value: string): boolean {
  try {
    return new URL(value).protocol === 'http:';
  } catch {
    return false;
  }
}

