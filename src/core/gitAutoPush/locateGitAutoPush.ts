import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

// 與 locateFork 同一原則：偵測階段不開子行程，只掃檔案系統。

export type GitAutoPushAvailability =
  | { kind: 'ready'; cliPath: string }
  | { kind: 'missing' }
  | { kind: 'unsupportedPlatform'; platform: string };

export interface LocateGitAutoPushOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** 測試用替身；預設檢查檔案存在且可執行。 */
  isExecutable?: (target: string) => Promise<boolean>;
}

export const GIT_AUTO_PUSH_COMMAND = 'git-auto-push';
export const GIT_AUTO_PUSH_REPO_URL = 'https://github.com/lazyjerry/git-auto-push';
/** 官方 README 的一行安裝指令；預設裝到 ~/.local/bin。 */
export const GIT_AUTO_PUSH_INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/lazyjerry/git-auto-push/refs/heads/master/install.sh | sh';

export async function locateGitAutoPush(options: LocateGitAutoPushOptions = {}): Promise<GitAutoPushAvailability> {
  const platform = options.platform ?? process.platform;
  // 這是 bash 腳本，安裝也走 curl | sh；Windows 原生殼跑不起來。
  if (platform === 'win32') {
    return { kind: 'unsupportedPlatform', platform };
  }

  const env = options.env ?? process.env;
  const isExecutable = options.isExecutable ?? defaultIsExecutable;

  for (const directory of candidateDirectories(env, options.homeDir)) {
    const candidate = path.posix.join(directory, GIT_AUTO_PUSH_COMMAND);
    if (await isExecutable(candidate)) {
      return { kind: 'ready', cliPath: candidate };
    }
  }
  return { kind: 'missing' };
}

/**
 * PATH 之後補上 install.sh 的兩個安裝位置：
 * VS Code 從 Dock 啟動時 PATH 常常沒有 ~/.local/bin，光掃 PATH 會誤判成沒裝。
 */
function candidateDirectories(env: NodeJS.ProcessEnv, homeDir: string | undefined): string[] {
  const directories = (env.PATH ?? '').split(':').filter(Boolean);
  if (homeDir) {
    directories.push(path.posix.join(homeDir, '.local', 'bin'));
  }
  directories.push('/usr/local/bin');
  return [...new Set(directories)];
}

async function defaultIsExecutable(target: string): Promise<boolean> {
  try {
    await fs.access(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
