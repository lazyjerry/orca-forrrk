import path from 'node:path';

import { matchExclude, parseExcludeRules } from './excludeMatch';
import { readBinaryFile, readTextFile } from './fsRead';
import { parseIndexFlags } from './parseIndexFlags';
import type { ActiveFileStatus, IgnoreInfo } from './types';

/** sparse checkout 會把幾萬個檔案標成 skip-worktree，清單只留前面這些筆。 */
const IGNORED_CHANGE_LIMIT = 200;

export interface IgnoreReadOptions {
  repoRoot: string;
  /** index 在各自的 gitDir 裡（linked worktree 有自己的一份）。 */
  gitDir: string;
  /** info/exclude 在主 git 目錄。 */
  commonDir: string;
  /** 作用中編輯器的檔案絕對路徑，沒有就是 null。 */
  activeFile: string | null;
  /** SHA-1 儲存庫是 20，SHA-256 是 32。 */
  oidLength: number;
}

export interface IgnoreState {
  ignore: IgnoreInfo;
  activeFile: ActiveFileStatus | null;
}

export async function readIgnoreState(options: IgnoreReadOptions): Promise<IgnoreState> {
  const relativePath = options.activeFile === null ? null : toRepoRelative(options.repoRoot, options.activeFile);
  const excludePath = path.join(options.commonDir, 'info', 'exclude');

  const [indexBuffer, excludeText] = await Promise.all([
    readBinaryFile(path.join(options.gitDir, 'index')),
    readTextFile(excludePath),
  ]);

  const flags =
    indexBuffer === null
      ? { entries: [], total: 0, unreadable: true, focus: null }
      : parseIndexFlags(indexBuffer, {
          oidLength: options.oidLength,
          limit: IGNORED_CHANGE_LIMIT,
          focusPath: relativePath,
        });

  const ignore: IgnoreInfo = {
    changes: flags.entries,
    totalChanges: flags.total,
    indexUnreadable: flags.unreadable,
    excludePath,
    excludeExists: excludeText !== null,
    excludeLines: excludeText === null ? [] : trimTrailingBlank(excludeText.split(/\r?\n/)),
  };

  return { ignore, activeFile: buildActiveFileStatus(options.activeFile, relativePath, flags.focus, excludeText) };
}

function buildActiveFileStatus(
  activeFile: string | null,
  relativePath: string | null,
  focus: { assumeUnchanged: boolean; skipWorktree: boolean } | null,
  excludeText: string | null,
): ActiveFileStatus | null {
  if (activeFile === null) {
    return null;
  }
  return {
    path: activeFile,
    relativePath,
    tracked: focus !== null,
    assumeUnchanged: focus?.assumeUnchanged ?? false,
    skipWorktree: focus?.skipWorktree ?? false,
    excludedBy:
      relativePath === null || excludeText === null ? null : matchExclude(relativePath, parseExcludeRules(excludeText)),
  };
}

/** 轉成 index 與 gitignore 用的形式（相對根目錄、/ 分隔）；不在儲存庫底下時回 null。 */
function toRepoRelative(repoRoot: string, target: string): string | null {
  const relative = path.relative(repoRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

/** 檔尾的換行會生出一個空字串，去掉它才不會多畫一行空白。 */
function trimTrailingBlank(lines: string[]): string[] {
  const result = [...lines];
  while (result.length > 0 && result[result.length - 1].trim() === '') {
    result.pop();
  }
  return result;
}
