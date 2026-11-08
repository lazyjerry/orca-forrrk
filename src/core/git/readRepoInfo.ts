import path from 'node:path';

import { readProjectIdentity, readReadme } from '../project/readProject';
import { readActivity } from './readActivity';
import { readEnvironment } from './readEnvironment';
import { readFileTail, readTextFile } from './fsRead';
import { parseGitConfig } from './parseConfig';
import { readIgnoreState } from './readIgnoreState';
import { readScale } from './readScale';
import type { ConfigGroup, GitConfigEntry, RemoteInfo, RepoInfo, RepoLocation, UpstreamInfo } from './types';

/** reflog 可能很大，只讀檔尾這麼多位元組就足以取得最近幾次切換。 */
const REFLOG_TAIL_BYTES = 64 * 1024;
const RECENT_BRANCH_LIMIT = 5;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const CHECKOUT_LINE = /checkout: moving from (\S+) to (\S+)/;

/** remote.* 與 branch.* 已在專屬區塊呈現，不重複列進「其他設定」。 */
const CONSUMED_SECTIONS = new Set(['remote', 'branch']);

export interface ReadRepoOptions {
  /** 作用中編輯器的檔案絕對路徑，用來判斷這個檔案有沒有被忽略變更或排除。 */
  activeFile?: string | null;
}

/**
 * 讀出面板要顯示的全部欄位。任何一份檔案讀不到都只降級成 warning，不拋例外，
 * 讓面板至少能顯示拿得到的部分。
 */
export async function readRepoInfo(location: RepoLocation, options: ReadRepoOptions = {}): Promise<RepoInfo> {
  const warnings: string[] = [];
  const commonDir = await resolveCommonDir(location.gitDir);

  const head = await readHead(location.gitDir, warnings);
  const headSha = head.sha ?? (head.ref ? await resolveRef(location.gitDir, commonDir, head.ref) : null);
  const entries = await readConfigEntries(commonDir, warnings);

  // 這幾份互不相干，一起讀比串著讀快，而且每一份自己吞掉讀不到的情況。
  const [recentBranches, stashCount, activity, scale, project, readme, environment, ignoreState] = await Promise.all([
    readRecentBranches(location.gitDir, head.branch),
    readStashCount(commonDir),
    readActivity(location.gitDir),
    readScale(location.gitDir, commonDir),
    readProjectIdentity(location.repoRoot),
    readReadme(location.repoRoot),
    readEnvironment(location.repoRoot, commonDir),
    readIgnoreState({
      repoRoot: location.repoRoot,
      gitDir: location.gitDir,
      commonDir,
      activeFile: options.activeFile ?? null,
      oidLength: objectIdLength(entries),
    }),
  ]);

  return {
    repoRoot: location.repoRoot,
    gitDir: location.gitDir,
    branch: head.branch,
    detached: head.detached,
    headSha,
    recentBranches,
    remotes: collectRemotes(entries),
    upstream: collectUpstream(entries, head.branch),
    stashCount,
    configGroups: groupConfig(entries),
    activity,
    scale,
    project,
    readme,
    environment,
    ignore: ignoreState.ignore,
    activeFile: ignoreState.activeFile,
    warnings,
  };
}

/**
 * linked worktree 的 gitDir 是 .git/worktrees/<name>，只有 HEAD 與自己的 reflog 在裡面；
 * config、packed-refs、stash 都在 commondir 指的主 git 目錄。
 */
async function resolveCommonDir(gitDir: string): Promise<string> {
  const raw = await readTextFile(path.join(gitDir, 'commondir'));
  if (!raw) {
    return gitDir;
  }
  const target = raw.trim();
  return target ? path.resolve(gitDir, target) : gitDir;
}

interface HeadState {
  branch: string | null;
  detached: boolean;
  /** HEAD 指向的 ref 全名，例如 refs/heads/main。 */
  ref: string | null;
  /** detached 時 HEAD 直接寫 SHA。 */
  sha: string | null;
}

async function readHead(gitDir: string, warnings: string[]): Promise<HeadState> {
  const raw = await readTextFile(path.join(gitDir, 'HEAD'));
  if (raw === null) {
    warnings.push('讀不到 .git/HEAD，無法判斷目前分支');
    return { branch: null, detached: false, ref: null, sha: null };
  }

  const line = raw.trim();
  if (line.startsWith('ref:')) {
    const ref = line.slice('ref:'.length).trim();
    return { branch: shortenRef(ref), detached: false, ref, sha: null };
  }
  if (SHA_PATTERN.test(line)) {
    return { branch: null, detached: true, ref: null, sha: line.toLowerCase() };
  }

  warnings.push('.git/HEAD 格式無法辨識');
  return { branch: null, detached: false, ref: null, sha: null };
}

/** 先找鬆散的 ref 檔，沒有再掃 packed-refs。 */
async function resolveRef(gitDir: string, commonDir: string, ref: string): Promise<string | null> {
  for (const base of new Set([gitDir, commonDir])) {
    const loose = await readTextFile(path.join(base, ...ref.split('/')));
    if (loose && SHA_PATTERN.test(loose.trim())) {
      return loose.trim().toLowerCase();
    }
  }

  const packed = await readTextFile(path.join(commonDir, 'packed-refs'));
  if (!packed) {
    return null;
  }

  for (const rawLine of packed.split(/\r?\n/)) {
    // ^ 開頭的行是 annotated tag 的解參考目標，不是 ref 本身。
    if (!rawLine || rawLine.startsWith('#') || rawLine.startsWith('^')) {
      continue;
    }
    const space = rawLine.indexOf(' ');
    if (space === -1) {
      continue;
    }
    if (rawLine.slice(space + 1).trim() === ref) {
      return rawLine.slice(0, space).toLowerCase();
    }
  }
  return null;
}

async function readConfigEntries(commonDir: string, warnings: string[]): Promise<GitConfigEntry[]> {
  const raw = await readTextFile(path.join(commonDir, 'config'));
  if (raw === null) {
    warnings.push('讀不到 .git/config，遠端與設定資訊從缺');
    return [];
  }
  return parseGitConfig(raw);
}

/** SHA-256 儲存庫的 index 裡每筆物件 ID 是 32 bytes，拿 20 去解會整份錯位。 */
function objectIdLength(entries: GitConfigEntry[]): number {
  const format = entries.find((entry) => entry.section === 'extensions' && entry.key === 'objectformat');
  return format?.value.trim().toLowerCase() === 'sha256' ? 32 : 20;
}

function collectRemotes(entries: GitConfigEntry[]): RemoteInfo[] {
  const byName = new Map<string, RemoteInfo>();

  for (const entry of entries) {
    if (entry.section !== 'remote' || !entry.subsection) {
      continue;
    }
    const remote = byName.get(entry.subsection) ?? { name: entry.subsection };
    if (entry.key === 'url') {
      remote.url = entry.value;
    } else if (entry.key === 'pushurl') {
      remote.pushUrl = entry.value;
    }
    byName.set(entry.subsection, remote);
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectUpstream(entries: GitConfigEntry[], branch: string | null): UpstreamInfo | null {
  if (!branch) {
    return null;
  }

  let remote: string | undefined;
  let merge: string | undefined;
  for (const entry of entries) {
    if (entry.section !== 'branch' || entry.subsection !== branch) {
      continue;
    }
    if (entry.key === 'remote') {
      remote = entry.value;
    } else if (entry.key === 'merge') {
      merge = entry.value;
    }
  }

  if (!remote || !merge) {
    return null;
  }
  return { remote, branch: shortenRef(merge) };
}

function groupConfig(entries: GitConfigEntry[]): ConfigGroup[] {
  const groups = new Map<string, ConfigGroup>();

  for (const entry of entries) {
    if (CONSUMED_SECTIONS.has(entry.section)) {
      continue;
    }
    const title = entry.subsection ? `${entry.section} "${entry.subsection}"` : entry.section;
    const group = groups.get(title) ?? { title, entries: [], hasInclude: false };
    group.entries.push({ key: entry.key, value: entry.value });
    if ((entry.section === 'include' || entry.section === 'includeif') && entry.key === 'path') {
      group.hasInclude = true;
    }
    groups.set(title, group);
  }

  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** 由 reflog 尾端往前找 checkout 紀錄，取出離開過的分支名。 */
async function readRecentBranches(gitDir: string, currentBranch: string | null): Promise<string[]> {
  const tail = await readFileTail(path.join(gitDir, 'logs', 'HEAD'), REFLOG_TAIL_BYTES);
  if (!tail) {
    return [];
  }

  const lines = tail.text.split('\n');
  // 從檔案中段截斷時，第一行多半只有半截，直接丟掉。
  if (tail.truncated) {
    lines.shift();
  }

  const found: string[] = [];
  for (let i = lines.length - 1; i >= 0 && found.length < RECENT_BRANCH_LIMIT; i -= 1) {
    const tab = lines[i].indexOf('\t');
    if (tab === -1) {
      continue;
    }
    const match = CHECKOUT_LINE.exec(lines[i].slice(tab + 1));
    if (!match) {
      continue;
    }
    const from = match[1];
    // detached 時 from 是 SHA，對「跳回某條分支」沒有幫助。
    if (SHA_PATTERN.test(from) || from === currentBranch || found.includes(from)) {
      continue;
    }
    found.push(from);
  }

  return found;
}

async function readStashCount(commonDir: string): Promise<number> {
  const raw = await readTextFile(path.join(commonDir, 'logs', 'refs', 'stash'));
  if (!raw) {
    return 0;
  }
  return raw.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function shortenRef(ref: string): string {
  if (ref.startsWith('refs/heads/')) {
    return ref.slice('refs/heads/'.length);
  }
  return ref.startsWith('refs/') ? ref.slice('refs/'.length) : ref;
}
