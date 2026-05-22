// Shared MCP launch-command risk model. Both .mcp.json (JSON) and
// .codex/config.toml (TOML) carry the same shape of risky command —
// @latest tags, github tarballs, curl-pipe-sh installers, unpinned
// npx/uvx/pipx packages. Keeping the heuristic in one module means
// the two detectors stay aligned as the risk model evolves.
export function serverCommand(spec) {
    return [spec.command, ...(spec.args ?? []), spec.url, spec.serverUrl].filter(Boolean).join(' ');
}
export function isUnpinnedCommand(spec) {
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
    // `bunx` is Bun's npx equivalent and ships as its own binary, so it
    // surfaces as `command: "bunx"` in MCP configs. `yarn dlx` / `npm exec`
    // / `pnpm dlx` are deliberately NOT added here — those would have
    // `command: "yarn"` (etc.) with the subcommand in args[0], and need
    // a structurally different check that this heuristic doesn't do.
    return ['npx', 'uvx', 'pipx', 'bunx'].includes((spec.command ?? '').toLowerCase())
        && packageLikeArgs.some((arg) => looksLikePackageName(arg) && !hasExactVersion(arg));
}
export function isPipeToShellCommand(spec) {
    const normalized = serverCommand(spec).toLowerCase();
    return /\bcurl\b.+\|\s*(bash|sh)\b/.test(normalized)
        || /\b(iwr|invoke-webrequest)\b.+\|\s*(iex|invoke-expression)\b/.test(normalized);
}
function looksLikePackageName(value) {
    return /^[a-z0-9@][a-z0-9._/@-]+$/i.test(value) && !value.startsWith('-');
}
function hasExactVersion(value) {
    const packageVersion = value.startsWith('@') ? value.indexOf('@', 1) : value.indexOf('@');
    if (packageVersion === -1) {
        return false;
    }
    const version = value.slice(packageVersion + 1);
    return /^\d+\.\d+\.\d+/.test(version);
}
