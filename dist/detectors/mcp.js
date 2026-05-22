import { readdir } from 'node:fs/promises';
import { configPath, isRecord, lineOfJsonKey, lineOfJsonStringValue, readJsonObjectWithSource } from '../discovery.js';
import { isPipeToShellCommand, isUnpinnedCommand, serverCommand } from '../mcp-risk.js';
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
export async function detectMcpDrift(oldRoot, newRoot) {
    const findings = [];
    for (const config of MCP_CONFIGS) {
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
        }
    }
    for (const path of await listMcpSampleConfigPaths(oldRoot, newRoot)) {
        const config = { path, serverKeys: ['mcpServers', 'servers'] };
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
                findings.push({
                    kind: 'scope_trail.mcp_sample_remote_endpoint',
                    severity: 'medium',
                    file: path,
                    line: lineForRemoteEndpoint(newServer) ?? newServer.line,
                    subject: name,
                    message: `Sample/disabled MCP server "${name}" points at remote endpoint: ${endpoint}.`,
                    recommendation: 'Confirm the endpoint is intended for copied sample configs and does not expose unexpected data or tools.'
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
    if (!isRecord(rawServers)) {
        return {};
    }
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
            serverUrl: typeof value.serverUrl === 'string' ? value.serverUrl : undefined
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
    for (const entry of entries) {
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (!IGNORED_SAMPLE_SCAN_DIRS.has(entry.name)) {
                await collectMcpSampleConfigPaths(root, relativePath, paths);
            }
            continue;
        }
        if (entry.isFile() && isMcpSampleConfigPath(relativePath)) {
            paths.add(relativePath);
        }
    }
}
function readServerMap(json, serverKeys) {
    for (const key of serverKeys) {
        if (isRecord(json[key])) {
            return json[key];
        }
    }
    return undefined;
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
    if (['npx', 'uvx', 'pipx'].includes((server.command ?? '').toLowerCase())) {
        return firstLineForValues(server, server.args ?? [], (arg) => looksLikePackageName(arg) && !hasExactVersion(arg));
    }
    if (/https:\/\/github\.com\/[^ ]+/.test(normalized)) {
        return firstLineForValues(server, [server.url, server.serverUrl, ...(server.args ?? [])], (value) => value.toLowerCase().includes('https://github.com/'));
    }
    return server.line;
}
function lineForRemoteEndpoint(server) {
    return firstLineForValues(server, [server.url, server.serverUrl], isRemoteEndpoint);
}
function remoteEndpoint(server) {
    return [server.url, server.serverUrl].find((value) => Boolean(value && isRemoteEndpoint(value)));
}
function isRemoteEndpoint(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return false;
        }
        return !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    }
    catch {
        return false;
    }
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
