import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

export class GjcProviderAuth implements IProviderAuth {
  /**
   * Checks whether the gjc CLI is available to the server runtime.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('gjc', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error;
    } catch {
      return false;
    }
  }

  /**
   * Best-effort login check.
   *
   * gjc keeps credentials in `~/.gjc/agent/agent.db`. The database is opened
   * read-only (it may be in use by a live gjc process) and treated as
   * authenticated when the `auth_credentials` table holds at least one row.
   * Any read failure degrades to "not authenticated" instead of throwing.
   */
  private checkAuthenticated(): { authenticated: boolean; method: string | null } {
    const agentDbPath = path.join(os.homedir(), '.gjc', 'agent', 'agent.db');
    if (!existsSync(agentDbPath)) {
      return { authenticated: false, method: null };
    }

    try {
      const db = new Database(agentDbPath, { readonly: true, fileMustExist: true });
      try {
        const table = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_credentials' LIMIT 1")
          .get();
        if (!table) {
          return { authenticated: false, method: null };
        }

        const row = db.prepare('SELECT 1 FROM auth_credentials LIMIT 1').get();
        return row
          ? { authenticated: true, method: 'agent_db' }
          : { authenticated: false, method: null };
      } finally {
        db.close();
      }
    } catch {
      return { authenticated: false, method: null };
    }
  }

  /**
   * Returns gjc CLI availability and credential status. Missing install or
   * missing credentials are reported as data, never thrown.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const { authenticated, method } = this.checkAuthenticated();

    return {
      installed,
      provider: 'gjc',
      authenticated,
      email: authenticated ? 'Authenticated' : null,
      method,
      error: authenticated ? undefined : 'Not authenticated',
    };
  }
}
