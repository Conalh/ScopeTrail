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
}

/**
 * Read a JSONC file. Comments and trailing commas are stripped via
 * agent-gov-core, then JSON.parse runs against the stripped (but
 * position-preserving) text. Missing files resolve to an empty object so
 * detectors can run on repos that haven't adopted Claude settings yet.
 */
export async function readJsonObjectWithSource(path: string): Promise<JsonObjectSource> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(stripJsonComments(raw));
    return { json: isRecord(parsed) ? parsed : {}, text: raw };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { json: {}, text: '' };
    }

    throw error;
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
