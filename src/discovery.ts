import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  stripJsonComments,
  lineOfJsonKey as coreLineOfJsonKey,
  lineOfJsonStringValue as coreLineOfJsonStringValue,
} from 'agent-gov-core';

export async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  return (await readJsonObjectWithSource(path)).json;
}

export interface JsonObjectSource {
  json: Record<string, unknown>;
  text: string;
  /**
   * Set when the file existed but JSON parsing failed. The CLI used
   * to crash with a raw SyntaxError on invalid JSON, bypassing the
   * whole ScopeTrail report pipeline. Surface the error so detectors
   * can emit a `*_config_syntax_error` finding instead.
   */
  parseError?: Error;
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
export async function readJsonObjectWithSource(path: string): Promise<JsonObjectSource> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { json: {}, text: '' };
    }
    throw error;
  }

  try {
    const parsed: unknown = JSON.parse(stripJsonComments(raw));
    return { json: isRecord(parsed) ? parsed : {}, text: raw };
  } catch (error) {
    return {
      json: {},
      text: raw,
      parseError: error instanceof Error ? error : new Error(String(error))
    };
  }
}

export function configPath(root: string, relativePath: string): string {
  return join(root, relativePath);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function lineOfJsonKey(text: string, key: string): number | undefined {
  const line = coreLineOfJsonKey(text, key);
  return line === 0 ? undefined : line;
}

export function lineOfJsonStringValue(text: string, value: string): number | undefined {
  const line = coreLineOfJsonStringValue(text, value);
  return line === 0 ? undefined : line;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
