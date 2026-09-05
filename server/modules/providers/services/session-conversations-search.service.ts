import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { spawn } from 'cross-spawn';
import { rgPath } from '@vscode/ripgrep';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { gjcSearchFile, gjcSearchMessages, gjcSearchRoots } from '@/modules/providers/services/gjc-conversation-search.js';

type RecordValue = Record<string, any>;
type Provider = 'claude' | 'codex' | 'gjc';
type Highlight = { start: number; end: number };
type ConversationMatch = { role: string; snippet: string; highlights: Highlight[]; timestamp: string | null; provider: Provider; messageUuid?: string | null };
type SessionResult = { sessionId: string; provider: Provider; sessionSummary: string; matches: ConversationMatch[] };
type ProjectResult = { projectId: string | null; projectName: string; projectDisplayName: string; sessions: SessionResult[] };

type SessionConversationSearchProgressUpdate = { projectResult: ProjectResult | null; totalMatches: number; scannedProjects: number; totalProjects: number };
type SearchSessionConversationsInput = { query: string; limit: number; projectId?: string; signal?: AbortSignal; onProgress?: (update: SessionConversationSearchProgressUpdate) => void };
type SessionRow = ReturnType<typeof sessionsDb.getAllSessions>[number];
type Candidate = SessionRow & { provider: Provider; jsonl_path: string };
type ProjectGroup = { projectId: string | null; projectName: string; projectDisplayName: string; sessions: Candidate[] };
type ClaudeState = { matches: ConversationMatch[]; delayedSummaries: Map<string, string>; fallbackUser: string | null; fallbackAssistant: string | null; summary: string | null };

const PROVIDERS = new Set<Provider>(['claude', 'codex', 'gjc']);
const MAX_PER_SESSION = 2;
const RG_BATCH = 40;
const RG_WORKERS = 6;
const UNKNOWN = '__unknown_project__';
const HIDDEN = ['<system-reminder>', 'Caveat:', 'Invalid API key', '[Request interrupted'];
const CODEX_HIDDEN = ['<environment_context>', '<cwd>'];

function comparablePath(value: string): string {
  if (!value || typeof value !== 'string') return '';
  const input = value.startsWith('\\\\?\\') ? value.slice(4) : value;
  const normalized = path.normalize(input.trim());
  if (!normalized) return '';
  const absolute = path.resolve(normalized);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function batches<T>(values: T[], length: number): T[][] {
  if (length <= 0) return [values];
  const output: T[][] = [];
  for (let start = 0; start < values.length; start += length) output.push(values.slice(start, start + length));
  return output;
}

function sessionKey(row: Pick<SessionRow, 'provider' | 'session_id'>): string { return `${row.provider}:${row.session_id}`; }
function projectKey(value: string | null): string { const trimmed = typeof value === 'string' ? value.trim() : ''; return trimmed || UNKNOWN; }
function summary(customName: string | null, fallback: string | null | undefined, empty: string): string {
  const chosen = typeof customName === 'string' ? customName.trim() : '';
  if (chosen) return chosen;
  const text = typeof fallback === 'string' ? fallback.trim() : '';
  if (!text) return empty;
  return text.length > 50 ? `${text.slice(0, 50)}...` : text;
}
function containsPrefix(text: string, prefixes: readonly string[]): boolean { return prefixes.some((prefix) => text.startsWith(prefix)); }
function escapePattern(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function tagValue(text: string, tag: string): string | null { const found = new RegExp(`<${escapePattern(tag)}>([\\s\\S]*?)<\\/${escapePattern(tag)}>`).exec(text); return found ? found[1] : null; }
function withoutAnsi(text: string): string { return text.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, ''); }

class QueryMatcher {
  private readonly phrase: RegExp;
  private readonly wholeWords: RegExp[];
  private readonly phraseRequired: boolean;

  constructor(raw: string, readonly words: string[]) {
    const normalized = raw.trim().replace(/\s+/g, ' ');
    this.phraseRequired = words.length > 1 && normalized.length > 0;
    this.phrase = new RegExp(words.map(escapePattern).join('\\s+'), 'iu');
    this.wholeWords = words.map((word) => new RegExp(`(?<!\\p{L})${escapePattern(word)}(?!\\p{L})`, 'u'));
  }

  accepts(text: string): boolean {
    if (typeof text !== 'string' || !text.length) return false;
    if (this.phraseRequired) return this.phrase.test(text);
    if (this.phrase.test(text)) return true;
    const lower = text.toLowerCase();
    return this.wholeWords.every((pattern) => pattern.test(lower));
  }

  excerpt(text: string): { snippet: string; highlights: Highlight[] } {
    const phraseMatch = this.phrase.exec(text);
    let hit = phraseMatch?.index ?? -1;
    let hitLength = phraseMatch?.[0].length ?? 0;
    if (hit < 0) {
      const lower = text.toLowerCase();
      for (const word of this.words) {
        const match = new RegExp(`(?<!\\p{L})${escapePattern(word)}(?!\\p{L})`, 'u').exec(lower);
        if (match && (hit < 0 || match.index < hit)) { hit = match.index; hitLength = word.length; }
      }
    }
    if (hit < 0) hit = 0;
    const start = Math.max(0, hit - 75);
    const end = Math.min(text.length, hit + 75 + hitLength);
    const lead = start ? '...' : '';
    const snippet = `${lead}${text.slice(start, end).replace(/\n/g, ' ')}${end < text.length ? '...' : ''}`;
    const spans: Highlight[] = [];
    if (phraseMatch && phraseMatch.index >= start && phraseMatch.index + phraseMatch[0].length <= end) spans.push({ start: lead.length + phraseMatch.index - start, end: lead.length + phraseMatch.index - start + phraseMatch[0].length });
    if (!this.phraseRequired) {
      const lower = snippet.toLowerCase();
      for (const word of this.words) {
        const expression = new RegExp(`(?<!\\p{L})${escapePattern(word)}(?!\\p{L})`, 'gu');
        for (let match = expression.exec(lower); match; match = expression.exec(lower)) spans.push({ start: match.index, end: match.index + word.length });
      }
    }
    spans.sort((a, b) => a.start - b.start);
    const highlights: Highlight[] = [];
    for (const span of spans) {
      const previous = highlights[highlights.length - 1];
      if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
      else highlights.push({ ...span });
    }
    return { snippet, highlights };
  }
}

function claudeContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter((part: RecordValue) => part?.type === 'text' && typeof part?.text === 'string').map((part: RecordValue) => String(part.text)).join(' ');
}
function codexContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((item) => { const row = item as RecordValue; return row && typeof row === 'object' && (row.type === 'input_text' || row.type === 'output_text' || row.type === 'text') && typeof row.text === 'string' ? row.text : ''; }).filter(Boolean).join(' ');
}
function claudeMessage(entry: RecordValue): { text: string; role: 'user' | 'assistant' } | null {
  if (!entry.message?.content || entry.isApiErrorMessage) return null;
  const role = entry.message.role;
  if (role !== 'user' && role !== 'assistant') return null;
  if (typeof entry.message.content !== 'string') {
    const text = claudeContent(entry.message.content);
    if (!text || containsPrefix(text, HIDDEN)) return null;
    return { text, role: entry.isCompactSummary === true ? 'assistant' : role };
  }
  const text = String(entry.message.content);
  if (entry.isCompactSummary === true && text.trim()) return { text, role: 'assistant' };
  const commandName = tagValue(text, 'command-name');
  const commandMessage = tagValue(text, 'command-message');
  const commandArgs = tagValue(text, 'command-args');
  if (commandName !== null || commandMessage !== null || commandArgs !== null) {
    const command = (commandName ?? '').trim() || (commandMessage ?? '').trim();
    const args = (commandArgs ?? '').trim();
    return command ? { text: args ? `${command} ${args}` : command, role: 'user' } : null;
  }
  const stdout = tagValue(text, 'local-command-stdout');
  if (stdout !== null) { const cleaned = withoutAnsi(stdout).trim(); return cleaned ? { text: cleaned, role: 'assistant' } : null; }
  if (!text || containsPrefix(text, HIDDEN)) return null;
  return { text, role };
}
function codexMessage(entry: RecordValue): { text: string; role: 'user' | 'assistant' } | null {
  let text: string | null = null; let role: 'user' | 'assistant' | null = null;
  const payload = entry.payload as RecordValue;
  if (entry.type === 'event_msg' && payload?.type === 'user_message' && (!payload.kind || payload.kind === 'plain') && typeof payload.message === 'string' && payload.message.trim()) { text = payload.message; role = 'user'; }
  else if (entry.type === 'event_msg' && payload?.type === 'agent_reasoning' && typeof payload.text === 'string') { text = payload.text; role = 'assistant'; }
  else if (entry.type === 'response_item' && payload?.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) { text = codexContent(payload.content); role = payload.role; }
  else if (entry.type === 'response_item' && payload?.type === 'reasoning') { const value = Array.isArray(payload.summary) ? payload.summary.map((item: RecordValue) => typeof item?.text === 'string' ? item.text : '').filter(Boolean).join('\n') : ''; if (value.trim()) { text = value; role = 'assistant'; } }
  return text && role && !containsPrefix(text.trimStart(), CODEX_HIDDEN) ? { text, role } : null;
}

class FileProbe {
  constructor(private readonly signal?: AbortSignal) {}
  private run(term: string, files: string[]): Promise<Set<string>> {
    if (!term || !files.length || this.signal?.aborted) return Promise.resolve(new Set());
    return new Promise((resolve, reject) => {
      const child = spawn(rgPath, ['--files-with-matches', '--no-messages', '--ignore-case', '--fixed-strings', '--', term, ...files], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const out: Buffer[] = []; const errors: Buffer[] = []; let killed = false;
      const abort = () => { killed = true; child.kill(); };
      this.signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk)); child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
      child.on('error', (error) => { this.signal?.removeEventListener('abort', abort); if (killed || this.signal?.aborted) resolve(new Set()); else reject(error); });
      child.on('close', (code) => { this.signal?.removeEventListener('abort', abort); if (killed || this.signal?.aborted) return resolve(new Set()); if (code !== 0 && code !== 1) return reject(new Error(`ripgrep failed with code ${String(code)}: ${Buffer.concat(errors).toString('utf8').trim()}`)); resolve(new Set(Buffer.concat(out).toString('utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(comparablePath))); });
    });
  }
  async matching(entries: Array<{ normalized: string; absolute: string }>, terms: string[]): Promise<Set<string>> {
    if (!entries.length || !terms.length || this.signal?.aborted) return new Set();
    let survivors = entries.slice();
    for (const term of terms) {
      if (this.signal?.aborted) return new Set();
      const found = new Set<string>(); const chunks = batches(survivors.map((entry) => entry.absolute), RG_BATCH); let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(RG_WORKERS, chunks.length) }, async () => { while (cursor < chunks.length && !this.signal?.aborted) { const index = cursor++; for (const value of await this.run(term, chunks[index])) found.add(value); } }));
      if (this.signal?.aborted) return new Set();
      survivors = survivors.filter((entry) => found.has(entry.normalized));
      if (!survivors.length) break;
    }
    return new Set(survivors.map((entry) => entry.normalized));
  }
}

async function candidates(projectId: string | undefined, stopped: () => boolean): Promise<Candidate[]> {
  const archived = new Map<string, boolean>(); const output: Candidate[] = [];
  const project = projectId === undefined ? undefined : projectsDb.getProjectById(projectId);
  if (projectId !== undefined && (!project || project.isArchived)) return [];
  const roots = await gjcSearchRoots();
  for (const row of sessionsDb.getAllSessions()) {
    if (stopped()) break;
    if (project && row.project_path !== project.project_path) continue;
    const provider = row.provider as Provider; const raw = typeof row.jsonl_path === 'string' ? row.jsonl_path.trim() : '';
    if (!PROVIDERS.has(provider) || !raw) continue;
    const jsonl_path = provider === 'gjc' ? await gjcSearchFile(raw, roots) : path.resolve(raw);
    if (!jsonl_path || !fs.existsSync(jsonl_path)) continue;
    const projectPath = typeof row.project_path === 'string' ? row.project_path.trim() : '';
    if (projectPath) { if (!archived.has(projectPath)) archived.set(projectPath, Boolean(projectsDb.getProjectPath(projectPath)?.isArchived)); if (archived.get(projectPath)) continue; }
    output.push({ ...row, provider, jsonl_path });
  }
  return output;
}
function groups(rows: Candidate[]): ProjectGroup[] {
  const output = new Map<string, ProjectGroup>();
  for (const row of rows) { const name = projectKey(row.project_path); let group = output.get(name); if (!group) { const project = name === UNKNOWN ? null : projectsDb.getProjectPath(name); const custom = typeof project?.custom_project_name === 'string' ? project.custom_project_name.trim() : ''; group = { projectId: project?.project_id ?? null, projectName: name, projectDisplayName: name === UNKNOWN ? 'Unknown Project' : custom || path.basename(name) || name, sessions: [] }; output.set(name, group); } group.sessions.push(row); }
  for (const group of output.values()) group.sessions.sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
  return [...output.values()];
}

class TranscriptSearch {
  private total = 0;
  private readonly claudeCache = new Map<string, Map<string, SessionResult>>();
  constructor(private readonly matcher: QueryMatcher, private readonly max: number, private readonly aborted: () => boolean, private readonly selected: Set<string>, private readonly claudeByFile: Map<string, Candidate[]>) {}
  get count(): number { return this.total; }
  private record(matches: ConversationMatch[], match: ConversationMatch): void { if (this.total < this.max && matches.length < MAX_PER_SESSION) { matches.push(match); this.total++; } }
  private async lines(file: string, consume: (row: RecordValue) => void): Promise<boolean> { try { const reader = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity }); for await (const line of reader) { if (this.total >= this.max || this.aborted()) break; if (!line.trim()) continue; try { consume(JSON.parse(line) as RecordValue); } catch { /* skip malformed lines */ } } return true; } catch { return false; } }
  async search(row: Candidate): Promise<SessionResult | null> {
    if (row.provider === 'gjc') return this.gjc(row);
    return row.provider === 'claude' ? this.claude(row) : this.codex(row);
  }
  private async gjc(row: Candidate): Promise<SessionResult | null> {
    const matches: ConversationMatch[] = [];
    let firstUser: string | null = null;
    let firstAssistant: string | null = null;
    for await (const message of gjcSearchMessages(row.jsonl_path, row.provider_session_id ?? row.session_id, row.project_path, this.aborted)) {
      if (this.total >= this.max || this.aborted()) break;
      if (message.role === 'user') firstUser ??= message.text;
      else firstAssistant ??= message.text;
      if (!this.matcher.accepts(message.text)) continue;
      this.record(matches, { role: message.role, ...this.matcher.excerpt(message.text), timestamp: message.timestamp, provider: 'gjc', messageUuid: message.messageUuid });
      if (matches.length >= MAX_PER_SESSION || this.total >= this.max) break;
    }
    return matches.length ? { sessionId: row.session_id, provider: 'gjc', sessionSummary: summary(row.custom_name, firstUser ?? firstAssistant, 'GJC Session'), matches } : null;
  }
  private async claude(row: Candidate): Promise<SessionResult | null> {
    const file = comparablePath(row.jsonl_path); if (!file) return null;
    if (!this.claudeCache.has(file)) {
      const related = (this.claudeByFile.get(file) ?? []).filter((candidate) => this.selected.has(sessionKey(candidate))); const targets = related.length ? related : [row]; const ids = new Set(targets.map((candidate) => candidate.session_id)); const names = new Map(targets.map((candidate) => [candidate.session_id, candidate.custom_name ?? null])); const states = new Map<string, ClaudeState>(); let current: string | null = null;
      const state = (id: string): ClaudeState => { let result = states.get(id); if (!result) { result = { matches: [], delayedSummaries: new Map(), fallbackUser: null, fallbackAssistant: null, summary: null }; states.set(id, result); } return result; };
      const readable = await this.lines(row.jsonl_path, (entry) => { if (entry.sessionId) current = String(entry.sessionId); const id = entry.sessionId ? String(entry.sessionId) : current; if (!id || !ids.has(id)) return; const target = state(id); if (entry.type === 'summary' && entry.summary) { const value = String(entry.summary); if (entry.sessionId) target.summary = value; else if (entry.leafUuid) target.delayedSummaries.set(String(entry.leafUuid), value); } if (!target.summary && entry.parentUuid) { const delayed = target.delayedSummaries.get(String(entry.parentUuid)); if (delayed) target.summary = delayed; } const message = claudeMessage(entry); if (!message) return; if (entry.isCompactSummary === true) target.summary = message.text; if (message.role === 'user') target.fallbackUser = message.text; else target.fallbackAssistant = message.text; if (!this.matcher.accepts(message.text)) return; const excerpt = this.matcher.excerpt(message.text); this.record(target.matches, { role: message.role, ...excerpt, timestamp: entry.timestamp ? String(entry.timestamp) : null, provider: 'claude', messageUuid: entry.uuid ? String(entry.uuid) : null }); });
      const results = new Map<string, SessionResult>(); if (readable) for (const [id, value] of states) if (value.matches.length) results.set(id, { sessionId: id, provider: 'claude', sessionSummary: summary(names.get(id) ?? null, value.summary || value.fallbackUser || value.fallbackAssistant, 'New Session'), matches: value.matches }); this.claudeCache.set(file, results);
    }
    return this.claudeCache.get(file)?.get(row.session_id) ?? null;
  }
  private async codex(row: Candidate): Promise<SessionResult | null> {
    const matches: ConversationMatch[] = []; let latest: string | null = null; const seen = new Set<string>(); const readable = await this.lines(row.jsonl_path, (entry) => { const message = codexMessage(entry); if (!message) return; if (message.role === 'user') latest = message.text; const fingerprint = `${message.role}:${message.text.trim().toLowerCase()}`; if (seen.has(fingerprint)) return; seen.add(fingerprint); if (!this.matcher.accepts(message.text)) return; const excerpt = this.matcher.excerpt(message.text); this.record(matches, { role: message.role, ...excerpt, timestamp: entry.timestamp ? String(entry.timestamp) : null, provider: 'codex' }); });
    return readable && matches.length ? { sessionId: row.session_id, provider: 'codex', sessionSummary: summary(row.custom_name, latest, 'Codex Session'), matches } : null;
  }
}

async function searchConversations(query: string, limit = 50, onProjectResult: ((update: SessionConversationSearchProgressUpdate) => void) | null = null, signal: AbortSignal | null = null, projectId?: string): Promise<{ results: ProjectResult[]; totalMatches: number; query: string }> {
  const clean = typeof query === 'string' ? query.trim() : ''; const cap = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 50, 200)); const words = clean.toLowerCase().split(/\s+/).filter(Boolean); const stopped = () => signal?.aborted === true;
  if (!words.length || stopped()) return { results: [], totalMatches: 0, query: clean };
  const rows = await candidates(projectId, stopped); if (!rows.length) return { results: [], totalMatches: 0, query: clean };
  const byFile = new Map<string, Candidate[]>(); const paths: Array<{ normalized: string; absolute: string }> = [];
  for (const row of rows) { if (row.provider === 'gjc') continue; const key = comparablePath(row.jsonl_path); if (!key) continue; if (!byFile.has(key)) { byFile.set(key, []); paths.push({ normalized: key, absolute: row.jsonl_path }); } byFile.get(key)?.push(row); }
  // GJC must be matched after decoding: /skill:name is reconstructed from
  // metadata and JSON escapes can hide literal query terms from ripgrep.
  const files = await new FileProbe(signal ?? undefined).matching(paths, words); if (stopped()) return { results: [], totalMatches: 0, query: clean };
  const selected = new Set<string>(rows.filter((row) => row.provider === 'gjc').map(sessionKey)); for (const file of files) for (const row of byFile.get(file) ?? []) selected.add(sessionKey(row));
  const claudeByFile = new Map<string, Candidate[]>(); for (const [file, entries] of byFile) { const claude = entries.filter((entry) => entry.provider === 'claude'); if (claude.length) claudeByFile.set(file, claude); }
  const scanner = new TranscriptSearch(new QueryMatcher(clean, words), cap, stopped, selected, claudeByFile); const results: ProjectResult[] = []; const projectGroups = groups(rows); let scanned = 0;
  for (const group of projectGroups) { if (scanner.count >= cap || stopped()) break; const projectResult: ProjectResult = { projectId: group.projectId, projectName: group.projectName, projectDisplayName: group.projectDisplayName, sessions: [] }; for (const row of group.sessions) { if (scanner.count >= cap || stopped()) break; if (!selected.has(sessionKey(row))) continue; const found = await scanner.search(row); if (found) projectResult.sessions.push(found); } scanned++; if (projectResult.sessions.length) { results.push(projectResult); onProjectResult?.({ projectResult, totalMatches: scanner.count, scannedProjects: scanned, totalProjects: projectGroups.length }); } else if (onProjectResult && scanned % 10 === 0) onProjectResult({ projectResult: null, totalMatches: scanner.count, scannedProjects: scanned, totalProjects: projectGroups.length }); }
  return { results, totalMatches: scanner.count, query: clean };
}

export const sessionConversationsSearchService = { async search(input: SearchSessionConversationsInput): Promise<void> { await searchConversations(input.query, input.limit, input.onProgress ?? null, input.signal ?? null, input.projectId); } };
