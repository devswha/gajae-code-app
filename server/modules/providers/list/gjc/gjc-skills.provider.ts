import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import matter from 'gray-matter';

import type { IProviderSkills } from '@/shared/interfaces.js';
import type { ProviderSkill, ProviderSkillListOptions } from '@/shared/types.js';
import { GJC_BUNDLED_SKILLS } from '@/gjc-engine.js';

// Names and descriptions come from each SKILL.md in the installed runtime,
// generated rather than transcribed: `BUNDLED_SKILLS` is not exported upstream,
// and the copy that used to live here kept advertising stale wording whenever a
// description changed.
const BUNDLED_SKILLS: readonly Omit<ProviderSkill, 'command'>[] = GJC_BUNDLED_SKILLS.map(
  (skill) => ({
    name: skill.name,
    description: skill.description,
    scope: 'bundled',
    sourcePath: `embedded:gjc/skills/${skill.name}/SKILL.md`,
  }),
);

const toCommand = (name: string): string => `/skill:${name}`;

async function scanSkillDirectory(
  directory: string,
  scope: 'project' | 'user',
): Promise<ProviderSkill[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const skills = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
    .map(async (entry): Promise<ProviderSkill | null> => {
      const sourcePath = path.join(directory, entry.name, 'SKILL.md');
      try {
        const parsed = matter(await readFile(sourcePath, 'utf8'));
        if (parsed.data.enabled === false || parsed.data.hide === true) return null;

        const rawName = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : entry.name;
        const description = typeof parsed.data.description === 'string'
          ? parsed.data.description.trim()
          : '';
        if (!rawName || /\s/.test(rawName) || !description) return null;

        return {
          name: rawName,
          description,
          command: toCommand(rawName),
          scope,
          sourcePath,
        };
      } catch {
        return null;
      }
    }));

  return skills
    .filter((skill): skill is ProviderSkill => skill !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export class GjcProviderSkills implements IProviderSkills {
  constructor(private readonly homeDir: string = os.homedir()) {}

  async listSkills(options: ProviderSkillListOptions = {}): Promise<ProviderSkill[]> {
    const projectSkills = options.workspacePath
      ? await scanSkillDirectory(path.join(options.workspacePath, '.gjc', 'skills'), 'project')
      : [];
    const userSkills = await scanSkillDirectory(path.join(this.homeDir, '.gjc', 'agent', 'skills'), 'user');
    const bundledSkills = BUNDLED_SKILLS.map((skill) => ({
      ...skill,
      command: toCommand(skill.name),
    }));
    const skillsByName = new Map<string, ProviderSkill>();

    // Match GJC's runtime precedence: project, then user, then embedded default.
    for (const skill of [...projectSkills, ...userSkills, ...bundledSkills]) {
      if (!skillsByName.has(skill.name)) skillsByName.set(skill.name, skill);
    }

    return [...skillsByName.values()];
  }
}
