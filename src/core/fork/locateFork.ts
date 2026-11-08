import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

// 偵測階段刻意不開子行程（不 spawn which / where）：掃 PATH 比啟動一個殼快，
// 也讓「只有真的要開 Fork 時才有子行程」這條線保持乾淨。

export type ForkAvailability =
  | { kind: 'ready'; cliPath: string }
  | { kind: 'appOnly'; appPath: string }
  | { kind: 'missing' }
  | { kind: 'unsupportedPlatform'; platform: string };

export interface LocateForkOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** 測試用替身；預設檢查檔案存在且可執行。 */
  isExecutable?: (target: string) => Promise<boolean>;
  /** 測試用替身；預設檢查路徑存在。 */
  exists?: (target: string) => Promise<boolean>;
}

/** Fork 只發行 macOS 與 Windows 版本。 */
const SUPPORTED_PLATFORMS: NodeJS.Platform[] = ['darwin', 'win32'];

export const FORK_DOWNLOAD_URL = 'https://git-fork.com/';

/** macOS 上 CLI 實際指向的執行檔，也是官方 fork_cli_install 建立 symlink 的來源。 */
export const MAC_CLI_RELATIVE_PATH = 'Contents/Resources/fork_cli';

export async function locateFork(options: LocateForkOptions = {}): Promise<ForkAvailability> {
  const platform = options.platform ?? process.platform;
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return { kind: 'unsupportedPlatform', platform };
  }

  const env = options.env ?? process.env;
  const isExecutable = options.isExecutable ?? defaultIsExecutable;
  const exists = options.exists ?? defaultExists;

  const cliPath = await findCliOnPath(platform, env, isExecutable);
  if (cliPath) {
    return { kind: 'ready', cliPath };
  }

  const appPath = await findApp(platform, env, options.homeDir, exists);
  if (!appPath) {
    return { kind: 'missing' };
  }

  // CLI 就躺在 app bundle 裡，symlink 只是捷徑：找到 app 就等於找到 CLI。
  const bundledCli = await findCliInBundle(platform, appPath, isExecutable);
  return bundledCli ? { kind: 'ready', cliPath: bundledCli } : { kind: 'appOnly', appPath };
}

async function findCliOnPath(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  isExecutable: (target: string) => Promise<boolean>,
): Promise<string | null> {
  const windows = platform === 'win32';
  const names = windows ? ['fork.exe', 'fork.cmd', 'fork.bat'] : ['fork'];
  const join = joinFor(platform);

  for (const directory of cliDirectories(platform, env)) {
    for (const name of names) {
      const candidate = join(directory, name);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * PATH 之後補上官方 fork_cli_install 建立 symlink 的位置。
 * VS Code 從 Finder / Dock 啟動時只拿得到 launchd 的精簡 PATH（`/usr/bin:/bin:/usr/sbin:/sbin`），
 * 補解析 login shell 環境又可能逾時，光掃 PATH 會把裝好的 CLI 誤判成沒裝。
 */
function cliDirectories(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const windows = platform === 'win32';
  const directories = (env.PATH ?? env.Path ?? '').split(windows ? ';' : ':').filter(Boolean);
  if (!windows) {
    directories.push('/usr/local/bin');
  }
  return [...new Set(directories)];
}

/**
 * macOS 的最後一道：直接用 app bundle 內的執行檔，繞過 PATH 與 symlink。
 * Windows 版沒有對應的 bundle 內 CLI，維持原本的 appOnly 提示。
 */
async function findCliInBundle(
  platform: NodeJS.Platform,
  appPath: string,
  isExecutable: (target: string) => Promise<boolean>,
): Promise<string | null> {
  if (platform !== 'darwin') {
    return null;
  }

  const candidate = path.posix.join(appPath, MAC_CLI_RELATIVE_PATH);
  return (await isExecutable(candidate)) ? candidate : null;
}

async function findApp(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string | undefined,
  exists: (target: string) => Promise<boolean>,
): Promise<string | null> {
  for (const candidate of appCandidates(platform, env, homeDir)) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function appCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, homeDir: string | undefined): string[] {
  const join = joinFor(platform);

  if (platform === 'darwin') {
    const candidates = ['/Applications/Fork.app'];
    if (homeDir) {
      candidates.push(join(homeDir, 'Applications', 'Fork.app'));
    }
    return candidates;
  }

  const candidates: string[] = [];
  if (env.LOCALAPPDATA) {
    candidates.push(join(env.LOCALAPPDATA, 'Fork', 'Fork.exe'));
  }
  if (env.ProgramFiles) {
    candidates.push(join(env.ProgramFiles, 'Fork', 'Fork.exe'));
  }
  return candidates;
}

/** 以目標平台的規則組路徑，別跟著執行環境走——否則在 macOS 上測不了 Windows 分支。 */
function joinFor(platform: NodeJS.Platform): (...parts: string[]) => string {
  return platform === 'win32' ? path.win32.join : path.posix.join;
}

async function defaultIsExecutable(target: string): Promise<boolean> {
  try {
    await fs.access(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultExists(target: string): Promise<boolean> {
  try {
    await fs.access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
