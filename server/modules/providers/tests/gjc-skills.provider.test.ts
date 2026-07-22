import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GjcProviderSkills } from '@/modules/providers/list/gjc/gjc-skills.provider.js';

async function writeSkill(root: string, directoryName: string, frontmatter: string): Promise<void> {
  const directory = path.join(root, directoryName);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'SKILL.md'), `---\n${frontmatter}\n---\nSkill body\n`, 'utf8');
}

test('GJC skills expose canonical commands and apply project/user/bundled precedence', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const workspacePath = path.join(root, 'workspace');
  const userSkills = path.join(homeDir, '.gjc', 'agent', 'skills');
  const projectSkills = path.join(workspacePath, '.gjc', 'skills');

  await writeSkill(userSkills, 'review', 'name: review\ndescription: User review');
  await writeSkill(userSkills, 'hidden', 'name: hidden\ndescription: Hidden skill\nhide: true');
  await writeSkill(projectSkills, 'review', 'name: review\ndescription: Project review');
  await writeSkill(projectSkills, 'project-only', 'name: project-only\ndescription: Project only');

  const skills = await new GjcProviderSkills(homeDir).listSkills({ workspacePath });
  const review = skills.find((skill) => skill.name === 'review');

  assert.equal(review?.scope, 'project');
  assert.equal(review?.description, 'Project review');
  assert.equal(review?.command, '/skill:review');
  assert.equal(skills.some((skill) => skill.name === 'hidden'), false);
  assert.equal(skills.some((skill) => skill.command === '/skill:ultragoal' && skill.scope === 'bundled'), true);
});
