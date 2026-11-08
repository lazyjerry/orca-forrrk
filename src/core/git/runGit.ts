import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// 面板可能開在外來的 repo，其 .git/config 的 core.fsmonitor 會在 update-index 時被當成指令執行；
// 命令列 -c 優先於 repo 設定，關掉只少了加速，不影響旗標寫入的結果。
const SAFE_CONFIG = ['-c', 'core.fsmonitor=false'];

/** 所有 git 指令都從這裡出去，確保一律帶上 SAFE_CONFIG。 */
export function runGit(args: string[], options: { timeout: number }): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', [...SAFE_CONFIG, ...args], { ...options, encoding: 'utf8' });
}
