import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import express from 'express';

const PLATFORM_OPENERS = {
  darwin: { command: 'open', args: (target) => [target] },
  win32: { command: 'cmd', args: (target) => ['/c', 'start', '', target] },
  linux: { command: 'xdg-open', args: (target) => [target] },
};

function defaultOpener(target) {
  const opener = PLATFORM_OPENERS[process.platform] ?? PLATFORM_OPENERS.linux;
  return new Promise((resolve, reject) => {
    execFile(opener.command, opener.args(target), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function createSystemRouter({ opener = defaultOpener } = {}) {
  const router = express.Router();

  router.post('/open-file', async (req, res) => {
    const target = req.body?.path;
    if (typeof target !== 'string' || !isAbsolute(target)) {
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

  return router;
}

export function safeExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

export default createSystemRouter();
