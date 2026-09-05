import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readGjcTranscriptMessage } from '@/modules/providers/list/gjc/gjc-transcript-message.js';
import { getGjcLiveSessionRoot, normalizeProjectPath, readObjectRecord } from '@/shared/utils.js';

const MAX_LINE_BYTES = 32 * 1024 * 1024;

export type GjcSearchMessage = {
  text: string;
  role: 'user' | 'assistant';
  timestamp: string | null;
  messageUuid: string | null;
};

/** Match the indexer's roots; a DB transcript path is not permission to read arbitrary files. */
export async function gjcSearchRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const root of new Set([path.join(os.homedir(), '.gjc', 'agent', 'sessions'), getGjcLiveSessionRoot()])) {
    try {
      if ((await lstat(root)).isDirectory()) roots.push(await realpath(root));
    } catch { /* Missing provider roots are normal before the first session. */ }
  }
  return roots;
}

export async function gjcSearchFile(file: string, roots: string[]): Promise<string | null> {
  if (!path.isAbsolute(file) || path.extname(file) !== '.jsonl') return null;
  try {
    if (!(await lstat(file)).isFile()) return null;
    const resolved = await realpath(file);
    // Only top-level sessions, including --session-dir files, are indexed.
    // Deeper sidecar transcripts belong to subagents, not separate conversations.
    const contained = roots.some((root) => {
      const relative = path.relative(root, resolved);
      return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative) && relative.split(path.sep).length <= 2;
    });
    return contained && path.extname(resolved) === '.jsonl' ? resolved : null;
  } catch { return null; }
}

/** Bound malformed/large records without buffering an entire transcript or an unlimited line. */
async function* lines(file: string, aborted: () => boolean): AsyncGenerator<string> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  const stream = handle.createReadStream();
  let parts: Buffer[] = [];
  let bytes = 0;
  let oversized = false;
  try {
    for await (const chunk of stream) {
      if (aborted()) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let start = 0;
      while (start < buffer.length) {
        if (aborted()) return;
        const newline = buffer.indexOf(0x0a, start);
        const end = newline < 0 ? buffer.length : newline;
        if (!oversized) {
          bytes += end - start;
          if (bytes > MAX_LINE_BYTES) { parts = []; oversized = true; }
          else if (end > start) parts.push(buffer.subarray(start, end));
        }
        if (newline < 0) break;
        if (!oversized) yield Buffer.concat(parts, bytes).toString('utf8');
        parts = [];
        bytes = 0;
        oversized = false;
        start = newline + 1;
      }
    }
    if (!oversized && bytes && !aborted()) yield Buffer.concat(parts, bytes).toString('utf8');
  } finally { stream.destroy(); }
}

export async function* gjcSearchMessages(
  file: string,
  providerSessionId: string,
  projectPath: string | null,
  aborted: () => boolean,
): AsyncGenerator<GjcSearchMessage> {
  let belongsToSession = false;
  try {
    for await (const line of lines(file, aborted)) {
      let entry;
      try { entry = readObjectRecord(JSON.parse(line)); } catch { continue; }
      if (!entry) continue;
      if (entry.type === 'session') {
        belongsToSession = entry.id === providerSessionId && typeof entry.cwd === 'string'
          && projectPath !== null && normalizeProjectPath(entry.cwd) === normalizeProjectPath(projectPath);
        if (!belongsToSession) return;
        continue;
      }
      if (!belongsToSession) continue;
      const message = readGjcTranscriptMessage(entry);
      if (!message || message.display === false || (message.role !== 'user' && message.role !== 'assistant')) continue;
      const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
        ? message.content.map((value) => {
          const part = readObjectRecord(value);
          return part?.type === 'text' && typeof part.text === 'string' ? part.text : '';
        }).filter(Boolean).join('\n') : '';
      if (text.trim()) yield {
        text,
        role: message.role,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
        messageUuid: typeof entry.id === 'string' ? entry.id : null,
      };
    }
  } catch { /* A removed or unreadable transcript must not fail the whole search. */ }
}
