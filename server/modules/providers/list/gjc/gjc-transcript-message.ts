import type { AnyRecord } from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';

/**
 * Reads a normal SDK message or the visible user request behind a skill entry.
 * Skill content is expanded instructions, not the user's prompt. Only the
 * explicit attribution and structured name/args can reconstruct that prompt;
 * never fall back to parsing content, paths, or other custom message types.
 * History, turn lineage, and session titles must use the same interpretation.
 */
export function readGjcTranscriptMessage(value: unknown): AnyRecord | null {
  const entry = readObjectRecord(value);
  if (!entry) return null;
  if (entry.type === 'message') return readObjectRecord(entry.message);
  if (
    entry.type !== 'custom_message'
    || entry.customType !== 'skill-prompt'
    || entry.display !== true
    || entry.attribution !== 'user'
  ) return null;

  const details = readObjectRecord(entry.details);
  if (
    !details
    || typeof details.name !== 'string'
    || !/^[\p{L}\p{N}_.:-]+$/u.test(details.name)
    || (details.args !== undefined && typeof details.args !== 'string')
  ) return null;

  return {
    role: 'user',
    content: `/skill:${details.name}${details.args ? ` ${details.args}` : ''}`,
  };
}
