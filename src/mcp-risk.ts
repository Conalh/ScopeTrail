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
export function isUnpinnedPackageSpec(value: string): boolean {
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

// Beyond the launch command, an MCP server config carries fields that grant
// it ambient capability: `env` (often secrets like API keys), `headers` (auth
// tokens on remote transports), and `cwd` (what the server can reach on disk).
// serverCommand() deliberately ignores these, so a server that keeps the same
// command but *gains* an `env` secret or an `Authorization` header would
// otherwise produce no finding. This model captures them for diffing.
export interface McpSensitiveFields {
  env?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  cwd?: string;
}

export interface SensitiveFieldChange {
  field: 'env' | 'headers' | 'cwd';
  keys: string[]; // added/changed keys (empty for cwd)
  secretLike: boolean; // a changed key name looks like it carries a secret
}

const SECRET_NAME_SUBSTRINGS = [
  'secret', 'token', 'password', 'passwd', 'credential',
  'authorization', 'bearer', 'cookie', 'session',
  'apikey', 'api_key', 'api-key',
  'access_key', 'access-key', 'accesskey',
  'private_key', 'private-key'
];

// True for names that carry a credential: explicit terms above, plus any name
// that *ends* in a `key` token (`API_KEY`, `x-key`, bare `key`) — but not an
// incidental substring like "monkey".
export function looksLikeSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  return SECRET_NAME_SUBSTRINGS.some((substring) => lower.includes(substring)) || /(^|[_-])key$/.test(lower);
}

export function readSensitiveFields(value: Record<string, unknown>): McpSensitiveFields {
  const fields: McpSensitiveFields = {};
  if (isPlainRecord(value.env)) {
    fields.env = value.env;
  }
  if (isPlainRecord(value.headers)) {
    fields.headers = value.headers;
  }
  if (typeof value.cwd === 'string') {
    fields.cwd = value.cwd;
  }
  return fields;
}

// Only additions and value changes count — removing an env var or header is a
// narrowing, not a widening, and the tool flags widening only. A cwd change in
// either direction is reported (it redirects what the server can reach).
export function sensitiveFieldChanges(
  oldFields: McpSensitiveFields,
  newFields: McpSensitiveFields
): SensitiveFieldChange[] {
  const changes: SensitiveFieldChange[] = [];

  const envKeys = changedRecordKeys(oldFields.env, newFields.env);
  if (envKeys.length > 0) {
    changes.push({ field: 'env', keys: envKeys, secretLike: envKeys.some(looksLikeSecretName) });
  }

  const headerKeys = changedRecordKeys(oldFields.headers, newFields.headers);
  if (headerKeys.length > 0) {
    changes.push({ field: 'headers', keys: headerKeys, secretLike: headerKeys.some(looksLikeSecretName) });
  }

  if (newFields.cwd !== undefined && newFields.cwd !== oldFields.cwd) {
    changes.push({ field: 'cwd', keys: [], secretLike: false });
  }

  return changes;
}

export function describeSensitiveFieldChange(serverName: string, change: SensitiveFieldChange): string {
  if (change.field === 'cwd') {
    return `MCP server "${serverName}" changed its working directory (cwd).`;
  }
  const label = change.field === 'env' ? 'environment variable(s)' : 'request header(s)';
  return `MCP server "${serverName}" added or changed ${label}: ${change.keys.join(', ')}.`;
}

export function recommendationForSensitiveFieldChange(change: SensitiveFieldChange): string {
  if (change.field === 'cwd') {
    return 'Confirm the working-directory change does not point the server at unexpected files.';
  }
  return 'Confirm these credentials/headers are intended — an existing server gaining secret-bearing env or auth headers is a permission change even when the launch command is unchanged.';
}

function changedRecordKeys(
  oldRecord: Record<string, unknown> | undefined,
  newRecord: Record<string, unknown> | undefined
): string[] {
  const previous = oldRecord ?? {};
  const next = newRecord ?? {};
  const changed: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (!(key in previous) || String(previous[key]) !== String(value)) {
      changed.push(key);
    }
  }
  return changed;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
