import path from 'node:path';

import { listDirectory, readWorktreeTextFile } from './fsRead';
import { parseGitConfig } from './parseConfig';
import type { EnvironmentInfo } from './types';

/** 這些是 repo 怎麼被組起來、怎麼被自動化的線索，全部拿得到而且都是小檔案。 */
export async function readEnvironment(repoRoot: string, commonDir: string): Promise<EnvironmentInfo> {
  const [submodules, worktrees, hooks, lfs, workflows] = await Promise.all([
    readSubmodules(repoRoot),
    readWorktrees(commonDir),
    readInstalledHooks(commonDir),
    hasLfs(repoRoot),
    readWorkflows(repoRoot),
  ]);

  return { submodules, worktrees, hooks, lfs, workflows };
}

async function readSubmodules(repoRoot: string): Promise<string[]> {
  const raw = await readWorktreeTextFile(path.join(repoRoot, '.gitmodules'));
  if (!raw) {
    return [];
  }
  // .gitmodules 用的是 git config 格式：[submodule "docs"] path = docs。
  const paths = parseGitConfig(raw)
    .filter((entry) => entry.section === 'submodule' && entry.key === 'path')
    .map((entry) => entry.value);
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

async function readWorktrees(commonDir: string): Promise<string[]> {
  const entries = await listDirectory(path.join(commonDir, 'worktrees'));
  return entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function readInstalledHooks(commonDir: string): Promise<string[]> {
  const entries = await listDirectory(path.join(commonDir, 'hooks'));
  return entries
    .filter((entry) => !entry.isDirectory && !entry.name.endsWith('.sample'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function hasLfs(repoRoot: string): Promise<boolean> {
  const raw = await readWorktreeTextFile(path.join(repoRoot, '.gitattributes'));
  return raw !== null && raw.includes('filter=lfs');
}

async function readWorkflows(repoRoot: string): Promise<string[]> {
  const entries = await listDirectory(path.join(repoRoot, '.github', 'workflows'));
  return entries
    .filter((entry) => !entry.isDirectory && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}
