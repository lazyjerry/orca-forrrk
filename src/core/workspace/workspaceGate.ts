import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * 兩者都要是 realpath 過的絕對路徑：symlink 先解開，才不會讓工作區內的連結把 git 帶到外部 repo。
 * 資料夾本身也算在內；同前綴的兄弟目錄（/ws 與 /ws-evil）不算。
 */
export function isInsideAnyFolder(realFile: string, realFolders: readonly string[], pathApi: path.PlatformPath = path): boolean {
  return realFolders.some((folder) => {
    const relative = pathApi.relative(folder, realFile);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative));
  });
}

export type GitGateResult = 'allowed' | 'untrusted-workspace' | 'outside-workspace';

export interface WorkspaceScope {
  trusted: boolean;
  folders: readonly string[];
}

/**
 * git 會照 repo 的 .git/config 執行 filter.<名>.clean 這類外部指令，-c 關不完，
 * 所以只對「受信任工作區裡的檔案」跑 git。路徑解析失敗一律視為外部。
 */
export async function decideGitGate(target: string, scope: WorkspaceScope): Promise<GitGateResult> {
  if (!scope.trusted) {
    return 'untrusted-workspace';
  }
  const realFile = await fs.realpath(target).catch(() => undefined);
  const realFolders = await Promise.all(scope.folders.map((folder) => fs.realpath(folder).catch(() => undefined)));
  const folders = realFolders.filter((folder): folder is string => folder !== undefined);
  return realFile !== undefined && isInsideAnyFolder(realFile, folders) ? 'allowed' : 'outside-workspace';
}
