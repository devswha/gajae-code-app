import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import matter from 'gray-matter';

import type { IProviderSkills } from '@/shared/interfaces.js';
import type { ProviderSkill, ProviderSkillListOptions } from '@/shared/types.js';

const BUNDLED_SKILLS: readonly Omit<ProviderSkill, 'command'>[] = [
  {
    name: 'deep-interview',
    description: 'Socratic deep interview with mathematical ambiguity gating before explicit execution approval',
    scope: 'bundled',
    sourcePath: 'embedded:gjc/skills/deep-interview/SKILL.md',
  },
  {
    name: 'ralplan',
    description: 'Consensus planning entrypoint that auto-gates vague team/ultragoal requests before execution',
    scope: 'bundled',
    sourcePath: 'embedded:gjc/skills/ralplan/SKILL.md',
  },
  {
    name: 'team',
    description: 'Multi-worker GJC tmux team orchestration',
    scope: 'bundled',
    sourcePath: 'embedded:gjc/skills/team/SKILL.md',
  },
  {
    name: 'ultragoal',
    description: 'Create and execute durable repo-native multi-goal plans over GJC goal mode artifacts.',
    scope: 'bundled',
    sourcePath: 'embedded:gjc/skills/ultragoal/SKILL.md',
  },
];

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
