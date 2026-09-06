import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, win32 } from 'node:path';

import express from 'express';

import { sessionsDb } from '../modules/database/repositories/sessions.db.js';

const PLATFORM_OPENERS = {
  darwin: { command: 'open', args: (target) => [target] },
  linux: { command: 'xdg-open', args: (target) => [target] },
};

export function createSystemOpener({ platform = process.platform, env = process.env, execute = execFile } = {}) {
  return (target) => {
    const opener = PLATFORM_OPENERS[platform] ?? PLATFORM_OPENERS.linux;
    let command = opener.command;
    let args = opener.args(target);
    if (platform === 'win32') {
      const rootKey = Object.keys(env).find((key) => key.toLowerCase() === 'systemroot');
      command = win32.join(env[rootKey] || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      // cmd/start reinterprets &, %, quotes and other metacharacters in targets.
      // ShellExecute opens the association directly. Encode the target as data,
      // including Unicode quotes that PowerShell otherwise treats as delimiters.
      const encodedTarget = Buffer.from(target, 'utf8').toString('base64');
      const script = [
        "$ErrorActionPreference = 'Stop'",
        '$info = New-Object System.Diagnostics.ProcessStartInfo',
        `$info.FileName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTarget}'))`,
        '$info.UseShellExecute = $true',
        '[void][System.Diagnostics.Process]::Start($info)',
      ].join('; ');
      args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
    }
    return new Promise((resolve, reject) => {
      execute(command, args, { windowsHide: true, shell: false }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  };
}

export function createSystemRouter({ opener = createSystemOpener() } = {}) {
  const router = express.Router();

  router.post('/open-file', async (req, res) => {
    const target = req.body?.path;
    if (typeof target !== 'string' || target.includes('\0') || !isAbsolute(target)) {
      return res.status(400).json({ error: 'An absolute path is required.' });
    }

    try {
      await stat(target);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      await opener(target);
      return res.json({ success: true });
    } catch (error) {
      console.error('Failed to open file externally:', error);
      return res.status(500).json({ error: 'Failed to open the file' });
    }
  });

  /**
   * The desktop shell's webview loads the server's loopback origin, where
   * neither Tauri IPC nor window.open reach the outside; a sign-in link or a
   * docs link clicked there opened nothing. The sidecar runs on the same
   * machine as the person, so it hands the URL to the OS browser. Only
   * https: is accepted: this is for web pages, not for schemes.
   */
  router.post('/open-url', async (req, res) => {
    const target = safeExternalUrl(req.body?.url);
    if (!target) {
      return res.status(400).json({ error: 'An https URL is required.' });
    }

    try {
      await opener(target);
      return res.json({ success: true });
    } catch (error) {
      console.error('Failed to open URL externally:', error);
      return res.status(500).json({ error: 'Failed to open the link' });
    }
  });

  // Workspace Browser also visits local HTTP development servers. Keep that
  // explicit action separate from the HTTPS-only sign-in/docs link contract.
  router.post('/open-browser-url', async (req, res) => {
    const target = safeBrowserUrl(req.body?.url);
    if (!target) return res.status(400).json({ error: 'An HTTP or HTTPS page URL is required.' });
    try {
      await opener(target);
      return res.json({ success: true });
    } catch (error) {
      console.error('Failed to open browser page externally:', error);
      return res.status(500).json({ error: 'Failed to open the page' });
    }
  });

  /**
   * Everything a bug report about a session needs, in one paste: the DB row,
   * the tail of the transcript and the worker log. QA feedback used to be a
   * screenshot and a retelling; this makes "Copy debug info" carry the
   * evidence instead. Text on purpose: it goes into a chat message.
   */
  router.post('/debug-bundle', async (req, res) => {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    try {
      const bundle = await buildDebugBundle(sessionId || null);
      res.json({ success: true, bundle });
    } catch (error) {
      console.error('Failed to assemble the debug bundle:', error);
      res.status(500).json({ error: 'Failed to assemble the debug bundle' });
    }
  });

  return router;
}

async function packageVersion() {
  try {
    return JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const BUNDLE_TRANSCRIPT_BYTES = 16 * 1024;
const BUNDLE_LOG_LINES = 60;

async function tailLines(filePath, lineCount) {
  const text = await readFile(filePath, 'utf8').catch(() => null);
  if (text === null) return '(unavailable)';
  const lines = text.trimEnd().split('\n');
  return lines.slice(-lineCount).join('\n');
}

async function tailBytes(filePath, byteCount) {
  const text = await readFile(filePath, 'utf8').catch(() => null);
  if (text === null) return '(unavailable)';
  return text.length > byteCount ? `…${text.slice(-byteCount)}` : text;
}

async function buildDebugBundle(sessionId) {
  const sections = [
    '# Gajae Code App debug bundle',
    `generated: ${new Date().toISOString()}`,
    `version: ${await packageVersion()}`,
  ];
  if (sessionId) {
    // A fresh install can lack the sessions table entirely; the bundle still
    // assembles, just without a row.
    let row = null;
    try {
      row = sessionsDb.getSessionById(sessionId);
    } catch { /* no table yet */ }
    sections.push('', '## session', row ? JSON.stringify({
      sessionId: row.session_id,
      provider: row.provider,
      providerSessionId: row.provider_session_id,
      project: row.project_path,
      name: row.custom_name,
      nameSource: row.name_source,
      archived: Boolean(row.isArchived),
      transcript: row.jsonl_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }, null, 2) : `(no session "${sessionId}" in the database)`);
    if (row?.jsonl_path) {
      sections.push('', '## transcript tail (jsonl, last bytes)', await tailBytes(row.jsonl_path, BUNDLE_TRANSCRIPT_BYTES));
    }
  }
  sections.push('', '## worker log tail', await tailLines(`${homedir()}/.gajae-app/logs/gjc-worker.log`, BUNDLE_LOG_LINES));
  sections.push('', '## browser sidecar log tail', await tailLines(`${homedir()}/.gajae-app/logs/browser-sidecar.log`, BUNDLE_LOG_LINES));
  return sections.join('\n');
}

export function safeExternalUrl(value) {
  const url = safeBrowserUrl(value);
  return url?.startsWith('https:') ? url : null;
}

export function safeBrowserUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

export default createSystemRouter();
