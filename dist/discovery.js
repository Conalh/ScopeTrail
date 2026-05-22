import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripJsonComments, lineOfJsonKey as coreLineOfJsonKey, lineOfJsonStringValue as coreLineOfJsonStringValue, } from 'agent-gov-core';
export async function readJsonObject(path) {
    return (await readJsonObjectWithSource(path)).json;
}
/**
 * Read a JSONC file. Comments and trailing commas are stripped via
 * agent-gov-core, then JSON.parse runs against the stripped (but
 * position-preserving) text. Missing files resolve to an empty object so
 * detectors can run on repos that haven't adopted Claude settings yet.
 *
 * Invalid JSON returns `{ json: {}, text: raw, parseError }` rather
 * than throwing — callers emit findings, not crashes.
 */
export async function readJsonObjectWithSource(path) {
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return { json: {}, text: '' };
        }
        throw error;
    }
    try {
        const parsed = JSON.parse(stripJsonComments(raw));
        return { json: isRecord(parsed) ? parsed : {}, text: raw };
    }
    catch (error) {
        return {
            json: {},
            text: raw,
            parseError: error instanceof Error ? error : new Error(String(error))
        };
    }
}
export function configPath(root, relativePath) {
    return join(root, relativePath);
}
export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function lineOfJsonKey(text, key) {
    const line = coreLineOfJsonKey(text, key);
    return line === 0 ? undefined : line;
}
export function lineOfJsonStringValue(text, value) {
    const line = coreLineOfJsonStringValue(text, value);
    return line === 0 ? undefined : line;
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
