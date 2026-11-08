import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { RepoLocation } from './types';

/**
 * 從 startPath 逐層往上找最近的 .git，回傳 repo 根目錄與實際的 git 目錄。
 * startPath 可以是檔案或目錄；找到檔案系統根仍無 .git 時回傳 null。
 */
export async function discoverRepo(startPath: string): Promise<RepoLocation | null> {
  let dir = await toDirectory(startPath);

  for (;;) {
    const dotGit = path.join(dir, '.git');
    const kind = await statKind(dotGit);

    if (kind === 'dir') {
      return { repoRoot: dir, gitDir: dotGit };
    }
    if (kind === 'file') {
      const gitDir = await readGitDirFile(dotGit, dir);
      if (gitDir) {
        return { repoRoot: dir, gitDir };
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

async function toDirectory(target: string): Promise<string> {
  const resolved = path.resolve(target);
  try {
    const stat = await fs.stat(resolved);
    return stat.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    // 路徑不存在（例如未存檔的檔案）時，仍從它的所在目錄往上找。
    return path.dirname(resolved);
  }
}

async function statKind(target: string): Promise<'dir' | 'file' | 'none'> {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory() ? 'dir' : 'file';
  } catch {
    return 'none';
  }
}

/** worktree 與 submodule 的 .git 是文字檔，內容為 `gitdir: <path>`；相對路徑以 repo 根解析。 */
async function readGitDirFile(dotGitFile: string, repoRoot: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(dotGitFile, 'utf8');
  } catch {
    return null;
  }

  const line = raw.split(/\r?\n/).find((candidate) => candidate.startsWith('gitdir:'));
  if (!line) {
    return null;
  }

  const target = line.slice('gitdir:'.length).trim();
  if (!target) {
    return null;
  }
  return path.resolve(repoRoot, target);
}
