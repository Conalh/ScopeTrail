import { readdir } from 'node:fs/promises';
import { configPath, isRecord, lineOfJsonKey, lineOfJsonStringValue, readJsonObjectWithSource } from '../discovery.js';
import { isPipeToShellCommand, isUnpinnedCommand, serverCommand, remoteEndpoint, isRemoteEndpoint, isUnencryptedEndpoint, readSensitiveFields, sensitiveFieldChanges, describeSensitiveFieldChange, recommendationForSensitiveFieldChange } from '../mcp-risk.js';
const MCP_CONFIGS = [
    { path: '.mcp.json', serverKeys: ['mcpServers'] },
    { path: '.cursor/mcp.json', serverKeys: ['mcpServers', 'servers'] },
    { path: '.vscode/mcp.json', serverKeys: ['servers', 'mcpServers'] },
    { path: '.codeium/windsurf/mcp_config.json', serverKeys: ['mcpServers'] }
];
const MCP_SAMPLE_CONFIG_FILENAMES = new Set([
    '.mcp.json.sample',
    '.mcp.json.disabled',
    '.mcp.json.template',
    '.mcp.json.example',
    'mcp_config.json.sample',
    'mcp_config.json.disabled',
    'mcp_config.json.template',
    'mcp_config.json.example'
]);
const MCP_PREFIXED_SAMPLE_CONFIG_FILENAMES = new Set([
    'example_mcp_config.json',
    'claude_mcp_config.json',
    'cursor_mcp_config.json',
    'vscode_mcp_config.json'
]);
const MCP_EXAMPLE_BASE_FILENAMES = ['.mcp.json', 'mcp_config.json'];
const MCP_PLATFORM_EXAMPLE_QUALIFIERS = new Set([
    'darwin',
    'linux',
    'mac',
    'macos',
    'osx',
    'win',
    'win32',
    'windows'
]);
const IGNORED_SAMPLE_SCAN_DIRS = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    '.turbo'
]);
// Exported so git-snapshot can materialize every surface this detector
// reads. Keeping the source of truth in the detector prevents the
// snapshot list and the detector list from drifting (they did, before).
export const MCP_TARGET_PATHS = MCP_CONFIGS.map((config) => config.path);
export async function detectMcpDrift(oldRoot, newRoot, options = {}) {
    const findings = [];
    for (const config of MCP_CONFIGS) {
        // Surface invalid JSON as a finding instead of silently producing
        // an empty server map (which would let real drift slip through
        // and look like a clean report). Skip the diff for this file
        // when the new copy is unparseable — false "added" findings on
        // an empty parse would just add noise.
        const newSource = await readJsonObjectWithSource(configPath(newRoot, config.path));
        if (newSource.parseError) {
            findings.push({
                kind: 'scope_trail.mcp_config_syntax_error',
                severity: 'high',
                file: config.path,
                subject: config.path,
                message: `MCP config "${config.path}" failed to parse: ${newSource.parseError.message}`,
                recommendation: 'Fix the JSON syntax. ScopeTrail cannot reason about server permissions while the file is invalid.'
            });
            continue;
        }
        const oldServers = await readMcpServers(oldRoot, config);
        const newServers = await readMcpServers(newRoot, config);
        for (const [name, newServer] of Object.entries(newServers)) {
            const oldServer = oldServers[name];
            if (!oldServer) {
                findings.push({
                    kind: 'scope_trail.mcp_server_added',
                    severity: 'high',
                    file: config.path,
                    line: newServer.line,
                    subject: name,
                    message: `MCP server "${name}" was added.`,
                    recommendation: 'Review the server package, pin its version, and confirm the tools it exposes before merging.'
                });
            }
            else if (serverCommand(newServer) !== serverCommand(oldServer)) {
                findings.push({
                    kind: 'scope_trail.mcp_server_command_changed',
                    severity: 'medium',
                    file: config.path,
                    line: lineForServerCommand(newServer) ?? newServer.line,
                    subject: name,
                    message: `MCP server "${name}" changed its launch command.`,
                    recommendation: 'Confirm the command change is intentional and still points at a trusted, pinned package.'
                });
            }
            if ((!oldServer || serverCommand(newServer) !== serverCommand(oldServer)) && isUnpinnedCommand(newServer)) {
                findings.push({
                    kind: 'scope_trail.unpinned_mcp_command',
                    severity: 'high',
                    file: config.path,
                    line: lineForUnpinnedCommand(newServer) ?? newServer.line,
                    subject: name,
                    message: `MCP server "${name}" uses an unpinned command: ${serverCommand(newServer)}.`,
                    recommendation: 'Pin executable packages to an exact version and avoid pipe-to-shell installation commands.'
                });
            }
            const endpoint = remoteEndpoint(newServer);
            if ((!oldServer || serverCommand(newServer) !== serverCommand(oldServer)) && endpoint) {
                const unencrypted = isUnencryptedEndpoint(endpoint);
                findings.push({
                    kind: 'scope_trail.mcp_remote_endpoint',
                    severity: unencrypted ? 'critical' : 'high',
                    file: config.path,
                    line: lineForRemoteEndpoint(newServer) ?? newServer.line,
                    subject: name,
                    message: unencrypted
                        ? `MCP server "${name}" points at an unencrypted remote endpoint: ${endpoint}.`
                        : `MCP server "${name}" points at remote endpoint: ${endpoint}.`,
                    recommendation: unencrypted
                        ? 'Use https:// for remote MCP endpoints — prompt data and tool executions must not go over unencrypted transport.'
                        : 'Confirm the endpoint is trusted and does not expose unexpected data or tools to external hosts.'
                });
            }
            if (oldServer) {
                // An existing server keeping the same launch command but gaining
                // secret-bearing env, auth headers, or a redirected cwd is a real
                // permission change that serverCommand()-based diffing misses.
                for (const change of sensitiveFieldChanges(oldServer, newServer)) {
                    findings.push({
                        kind: 'scope_trail.mcp_server_sensitive_field_changed',
                        severity: change.secretLike ? 'high' : 'medium',
                        file: config.path,
                        line: newServer.line,
                        subject: name,
                        message: describeSensitiveFieldChange(name, change),
                        recommendation: recommendationForSensitiveFieldChange(change)
                    });
                }
            }
        }
    }
    // Sample/template configs are an opt-in surface — see McpDriftOptions for why
    // a file that no agent loads can't be drift. Off by default keeps the report
    // scoped to live configuration.
    if (options.includeSamples) {
        findings.push(...(await detectMcpSampleDrift(oldRoot, newRoot)));
    }
    return findings;
}
// Diff sample/template/disabled MCP configs on their own low-severity track so
// a noisy template change can be reviewed for copy-paste hygiene without ever
// being mistaken for a change to what an agent can actually do. Only runs when
// the caller opts in via McpDriftOptions.includeSamples.
async function detectMcpSampleDrift(oldRoot, newRoot) {
    const findings = [];
    for (const path of await listMcpSampleConfigPaths(oldRoot, newRoot)) {
        const config = { path, serverKeys: ['mcpServers', 'servers'] };
        const newSource = await readJsonObjectWithSource(configPath(newRoot, path));
        if (newSource.parseError) {
            // Sample configs are advisory examples, not live servers, so
            // syntax errors here are lower severity than the active
            // .mcp.json equivalent.
            findings.push({
                kind: 'scope_trail.mcp_sample_config_syntax_error',
                severity: 'low',
                file: path,
                subject: path,
                message: `Sample MCP config "${path}" failed to parse: ${newSource.parseError.message}`,
                recommendation: 'Fix the JSON syntax so users who copy this sample get a parseable starting point.'
            });
            continue;
        }
        const oldServers = await readMcpServers(oldRoot, config);
        const newServers = await readMcpServers(newRoot, config);
        for (const [name, newServer] of Object.entries(newServers)) {
            const oldServer = oldServers[name];
            const changed = oldServer && serverCommand(newServer) !== serverCommand(oldServer);
            if (!oldServer) {
                findings.push({
                    kind: 'scope_trail.mcp_sample_server_added',
                    severity: 'low',
                    file: path,
                    line: newServer.line,
                    subject: name,
                    message: `Sample/disabled MCP server "${name}" was added.`,
                    recommendation: 'Confirm this sample config is intentionally shipped and safe for users to copy before merging.'
                });
            }
            else if (changed) {
                findings.push({
                    kind: 'scope_trail.mcp_sample_server_command_changed',
                    severity: 'low',
                    file: path,
                    line: lineForServerCommand(newServer) ?? newServer.line,
                    subject: name,
                    message: `Sample/disabled MCP server "${name}" changed its launch command.`,
                    recommendation: 'Confirm this sample config change is intentional and safe for users to copy before merging.'
                });
            }
            if ((!oldServer || changed) && isUnpinnedCommand(newServer)) {
                findings.push({
                    kind: 'scope_trail.mcp_sample_unpinned_command',
                    severity: severityForSampleCommandRisk(newServer),
                    file: path,
                    line: lineForUnpinnedCommand(newServer) ?? newServer.line,
                    subject: name,
                    message: `Sample/disabled MCP server "${name}" uses an unpinned command: ${serverCommand(newServer)}.`,
                    recommendation: 'Pin sample MCP packages to an exact version so users do not copy a drifting install command.'
                });
            }
            const endpoint = remoteEndpoint(newServer);
            if ((!oldServer || changed) && endpoint) {
                const unencrypted = isUnencryptedEndpoint(endpoint);
                findings.push({
                    kind: 'scope_trail.mcp_sample_remote_endpoint',
                    // An `http://` endpoint in a sample config is worse than an
                    // `https://` one: anyone who copies the sample inherits a
                    // MitM-vulnerable connection. Bump to high; https stays at
                    // medium because the copy-and-paste risk is "is this the
                    // right endpoint?" not "is this transport safe?".
                    severity: unencrypted ? 'high' : 'medium',
                    file: path,
                    line: lineForRemoteEndpoint(newServer) ?? newServer.line,
                    subject: name,
                    message: unencrypted
                        ? `Sample/disabled MCP server "${name}" points at an unencrypted remote endpoint: ${endpoint}.`
                        : `Sample/disabled MCP server "${name}" points at remote endpoint: ${endpoint}.`,
                    recommendation: unencrypted
                        ? 'Use https:// for sample remote MCP endpoints — copy-pasted samples should not silently downgrade users to unencrypted transport.'
                        : 'Confirm the endpoint is intended for copied sample configs and does not expose unexpected data or tools.'
                });
            }
        }
    }
    return findings;
}
async function readMcpServers(root, config) {
    const source = await readJsonObjectWithSource(configPath(root, config.path));
    const json = source.json;
    const rawServers = readServerMap(json, config.serverKeys);
    const servers = {};
    for (const [name, value] of Object.entries(rawServers)) {
        if (!isRecord(value)) {
            continue;
        }
        servers[name] = {
            line: lineOfJsonKey(source.text, name),
            sourceText: source.text,
            command: typeof value.command === 'string' ? value.command : undefined,
            args: Array.isArray(value.args) ? value.args.filter((arg) => typeof arg === 'string') : undefined,
            url: typeof value.url === 'string' ? value.url : undefined,
            serverUrl: typeof value.serverUrl === 'string' ? value.serverUrl : undefined,
            ...readSensitiveFields(value)
        };
    }
    return servers;
}
export function isMcpSampleConfigPath(relativePath) {
    const normalized = normalizePath(relativePath);
    const segments = normalized.split('/');
    if (segments.some((segment) => IGNORED_SAMPLE_SCAN_DIRS.has(segment))) {
        return false;
    }
    const fileName = segments.at(-1);
    return fileName
        ? MCP_SAMPLE_CONFIG_FILENAMES.has(fileName)
            || MCP_PREFIXED_SAMPLE_CONFIG_FILENAMES.has(fileName)
            || isPlatformSuffixedMcpExampleFileName(fileName)
        : false;
}
function isPlatformSuffixedMcpExampleFileName(fileName) {
    for (const baseName of MCP_EXAMPLE_BASE_FILENAMES) {
        const prefix = `${baseName}.`;
        if (!fileName.startsWith(prefix)) {
            continue;
        }
        const qualifiers = fileName.slice(prefix.length).split('.').map((segment) => segment.toLowerCase());
        return qualifiers.length > 1
            && qualifiers.includes('example')
            && qualifiers.every((segment) => segment === 'example' || MCP_PLATFORM_EXAMPLE_QUALIFIERS.has(segment));
    }
    return false;
}
async function listMcpSampleConfigPaths(...roots) {
    const paths = new Set();
    for (const root of roots) {
        await collectMcpSampleConfigPaths(root, '', paths);
    }
    return [...paths].sort();
}
async function collectMcpSampleConfigPaths(root, relativeDir, paths) {
    let entries;
    try {
        entries = await readdir(configPath(root, relativeDir), { withFileTypes: true });
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return;
        }
        throw error;
    }
    // Walk subdirectories in parallel. Each `readdir` is independent
    // and `paths` is a Set mutated from the same event loop, so add
    // operations are race-free in single-threaded Node. The caller
    // already sorts the result, so insertion order doesn't matter.
    await Promise.all(entries.map(async (entry) => {
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (!IGNORED_SAMPLE_SCAN_DIRS.has(entry.name)) {
                await collectMcpSampleConfigPaths(root, relativePath, paths);
            }
            return;
        }
        if (entry.isFile() && isMcpSampleConfigPath(relativePath)) {
            paths.add(relativePath);
        }
    }));
}
// Some MCP config schemas expose servers under more than one key — Cursor
// and VS Code both accept `mcpServers` and `servers`. The previous
// first-recognized-map-wins logic let an empty `mcpServers: {}` shadow a
// populated `servers: {}`, so every server under the second key was
// invisible to the diff. Merge all recognized maps instead; on a name
// collision the earlier key in `serverKeys` wins, since that order encodes
// the schema's documented precedence.
function readServerMap(json, serverKeys) {
    const merged = {};
    for (const key of serverKeys) {
        const map = json[key];
        if (!isRecord(map)) {
            continue;
        }
        for (const [name, value] of Object.entries(map)) {
            if (!(name in merged)) {
                merged[name] = value;
            }
        }
    }
    return merged;
}
function severityForSampleCommandRisk(server) {
    return isPipeToShellCommand(server) ? 'high' : 'medium';
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
function lineForServerCommand(server) {
    return firstLineForValues(server, [server.command, ...(server.args ?? []), server.url, server.serverUrl]) ?? server.line;
}
function lineForUnpinnedCommand(server) {
    const command = serverCommand(server);
    const normalized = command.toLowerCase();
    if (normalized.includes('@latest')) {
        return firstLineForValues(server, [server.command, ...(server.args ?? []), server.url, server.serverUrl], (value) => value.toLowerCase().includes('@latest'));
    }
    if (/\b(curl|iwr|invoke-webrequest)\b/.test(normalized)) {
        return firstLineForValues(server, [server.command, ...(server.args ?? []), server.url, server.serverUrl]);
    }
    const cmd = (server.command ?? '').toLowerCase();
    // Direct runners: the package name lives in args[0..]. `bunx` was
    // added to `isUnpinnedCommand` in fb56768 but not to the line
    // locator — bunx findings fell back to the server declaration's
    // line instead of pointing at the package.
    if (['npx', 'uvx', 'pipx', 'bunx'].includes(cmd)) {
        return firstLineForValues(server, server.args ?? [], (arg) => looksLikePackageName(arg) && !hasExactVersion(arg));
    }
    // Wrapper runners: args[0] is the executor subcommand (`exec`,
    // `dlx`, `x`). Skip it before locating — `exec` and `dlx` both
    // pass `looksLikePackageName`, so a naive scan would mis-locate
    // to the subcommand line instead of the package.
    if (['npm', 'yarn', 'pnpm'].includes(cmd)) {
        const args = server.args ?? [];
        if (args.length > 1 && isWrapperSubcommand(cmd, args[0])) {
            return firstLineForValues(server, args.slice(1), (arg) => looksLikePackageName(arg) && !hasExactVersion(arg));
        }
    }
    if (/https:\/\/github\.com\/[^ ]+/.test(normalized)) {
        return firstLineForValues(server, [server.url, server.serverUrl, ...(server.args ?? [])], (value) => value.toLowerCase().includes('https://github.com/'));
    }
    return server.line;
}
function lineForRemoteEndpoint(server) {
    return firstLineForValues(server, [server.url, server.serverUrl], isRemoteEndpoint);
}
function isWrapperSubcommand(cmd, arg) {
    const sub = arg.toLowerCase();
    if (cmd === 'npm')
        return sub === 'exec' || sub === 'x';
    if (cmd === 'yarn')
        return sub === 'dlx';
    if (cmd === 'pnpm')
        return sub === 'dlx' || sub === 'exec' || sub === 'x';
    return false;
}
function firstLineForValues(server, values, predicate = () => true) {
    const source = getSourceText(server);
    for (const value of values) {
        if (value && predicate(value)) {
            const line = lineOfJsonStringValue(source, value);
            if (line) {
                return line;
            }
        }
    }
    return undefined;
}
function getSourceText(server) {
    return server.sourceText ?? '';
}
function normalizePath(path) {
    return path.replaceAll('\\', '/');
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
