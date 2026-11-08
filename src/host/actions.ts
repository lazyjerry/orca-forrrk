import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { buildCliInstallHint } from '../core/fork/installHint'
import { FORK_DOWNLOAD_URL, locateFork } from '../core/fork/locateFork'
import {
  GIT_AUTO_PUSH_INSTALL_COMMAND,
  GIT_AUTO_PUSH_REPO_URL,
  locateGitAutoPush
} from '../core/gitAutoPush/locateGitAutoPush'
import { fileScopeArgs, otherStagedPaths } from '../core/gitAutoPush/fileScope'
import { runGit } from '../core/git/runGit'
import { isMacBundlePath } from '../core/os/macBundle'
import { decideGitGate } from '../core/workspace/workspaceGate'
import type { Notice } from '../protocol'

const execFileAsync = promisify(execFile)

const FORK_LAUNCH_TIMEOUT_MS = 10_000
const GIT_COMMAND_TIMEOUT_MS = 10_000

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** 每個參數都單引號包住，路徑含空白或引號也安全。 */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/**
 * 面板送來的是 repo 內相對路徑，這裡轉成絕對路徑並擋掉跳出 repo 的寫法（../、絕對路徑）。
 * 回傳 null 代表不收。
 */
export function resolveRepoFile(repoRoot: string, relative: string): { absolute: string; relative: string } | null {
  const trimmed = relative.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (trimmed === '' || path.isAbsolute(trimmed)) {
    return null
  }
  const absolute = path.resolve(repoRoot, trimmed)
  const back = path.relative(repoRoot, absolute)
  if (back === '' || back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
    return null
  }
  return { absolute, relative: back.split(path.sep).join('/') }
}

export async function openInFork(repoRoot: string): Promise<Notice> {
  const availability = await locateFork({ homeDir: os.homedir() })
  switch (availability.kind) {
    case 'ready':
      try {
        await execFileAsync(availability.cliPath, ['-C', repoRoot, 'open'], { timeout: FORK_LAUNCH_TIMEOUT_MS })
        return { level: 'info', message: '已在 Fork 中開啟。' }
      } catch (error) {
        return { level: 'error', message: `執行 fork 指令失敗（${errorText(error)}）` }
      }
    case 'appOnly': {
      const hint = buildCliInstallHint(availability.appPath, process.platform)
      return {
        level: 'warn',
        message: hint.message.replace(/^forrrk：/, ''),
        detail: hint.steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
        command: hint.copyCommand ?? undefined
      }
    }
    case 'missing':
      return {
        level: 'warn',
        message: '找不到 Fork 應用程式。',
        detail: '安裝 Fork 後回到本面板按「刷新」，再按一次「在 Fork 中開啟」。',
        link: { label: '前往下載 Fork', url: FORK_DOWNLOAD_URL }
      }
    case 'unsupportedPlatform':
      return { level: 'warn', message: `Fork 只提供 macOS 與 Windows 版本，目前平台是 ${availability.platform}。` }
  }
}

export async function openFolder(repoRoot: string): Promise<Notice> {
  // *.app 這類 bundle 交給 open 會被直接啟動，改成在 Finder 中選取它。
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', isMacBundlePath(repoRoot) ? ['-R', repoRoot] : [repoRoot]]
      : process.platform === 'win32'
        ? ['explorer', [repoRoot]]
        : ['xdg-open', [repoRoot]]

  return new Promise<Notice>((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', (error) => resolve({ level: 'error', message: `開不了資料夾（${errorText(error)}）` }))
    child.once('spawn', () => {
      child.unref()
      resolve({ level: 'info', message: '已在檔案管理員開啟儲存庫根目錄。' })
    })
  })
}

/** 找到 git-auto-push 就回傳絕對路徑，否則回傳要顯示給使用者的提示。 */
export async function resolveGitAutoPushCli(): Promise<{ cliPath: string } | { notice: Notice }> {
  const availability = await locateGitAutoPush({ homeDir: os.homedir() })
  switch (availability.kind) {
    case 'ready':
      return { cliPath: availability.cliPath }
    case 'missing':
      return {
        notice: {
          level: 'warn',
          message: '找不到 git-auto-push 指令。',
          detail: '1. 在終端機執行下面的安裝指令（預設裝到 ~/.local/bin）。\n2. 裝好之後再按一次「Auto Push」。',
          command: GIT_AUTO_PUSH_INSTALL_COMMAND,
          link: { label: '前往 GitHub', url: GIT_AUTO_PUSH_REPO_URL }
        }
      }
    case 'unsupportedPlatform':
      return {
        notice: { level: 'warn', message: `git-auto-push 是 bash 腳本，不支援 ${availability.platform} 原生終端機。` }
      }
  }
}

/** terminal.create 的 command：先 cd 到 repo 根（workspace 可能開在子資料夾），再用絕對路徑跑 CLI。 */
export function autoPushCommand(cliPath: string, repoRoot: string, args: readonly string[]): string {
  return `cd ${shellQuote(repoRoot)} && ${[cliPath, ...args].map(shellQuote).join(' ')}`
}

/**
 * 只推單一檔案前的檢查。-f 只限縮 add，commit 會帶走整個暫存區，所以暫存區有別的檔案就不跑。
 * 這一步要執行 git，git 會照 repo 的 config 跑外部 filter，所以只對 workspace 內的檔案執行。
 */
export async function prepareFilePush(
  repoRoot: string,
  workspacePath: string,
  file: string
): Promise<{ root: string; args: string[] } | { notice: Notice }> {
  const resolved = resolveRepoFile(repoRoot, file)
  if (!resolved) {
    return { notice: { level: 'warn', message: `「${file}」不是這個儲存庫內的相對路徑。` } }
  }
  const gate = await decideGitGate(resolved.absolute, { trusted: true, folders: [workspacePath] })
  if (gate !== 'allowed') {
    return { notice: { level: 'warn', message: `${resolved.relative} 不在這個 workspace 內（或不存在），未執行 git。` } }
  }

  // 兩邊都解開 symlink 再算相對路徑，否則寫法不同時會算出 ../ 開頭。
  const [realRoot, realFile] = await Promise.all([fs.realpath(repoRoot), fs.realpath(resolved.absolute)])
  const relativePath = path.relative(realRoot, realFile).split(path.sep).join('/')
  if (relativePath === '' || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    return { notice: { level: 'warn', message: `算不出 ${file} 在儲存庫內的路徑。` } }
  }

  let changed: string
  let staged: string
  try {
    changed = (await runGit(['-C', realRoot, 'status', '--porcelain', '-z', '--', relativePath], { timeout: GIT_COMMAND_TIMEOUT_MS })).stdout
    staged = (await runGit(['-C', realRoot, 'diff', '--cached', '--name-only', '-z'], { timeout: GIT_COMMAND_TIMEOUT_MS })).stdout
  } catch (error) {
    return { notice: { level: 'error', message: `讀取 git 狀態失敗（${errorText(error)}）` } }
  }

  if (changed === '') {
    return { notice: { level: 'info', message: `${relativePath} 沒有變更，不需要推送。` } }
  }
  const others = otherStagedPaths(staged, relativePath)
  if (others.length > 0) {
    return {
      notice: {
        level: 'warn',
        message: '暫存區已有其他檔案，會被一起提交，已取消。',
        detail: `請先取消暫存下列檔案，或改用「Auto Push」：\n${others.join('\n')}`
      }
    }
  }
  return { root: realRoot, args: fileScopeArgs(relativePath) }
}

/**
 * 切換「忽略變更」：標記或清除 .git/index 上的 skip-worktree／assume-unchanged。
 * 確認對話框由面板負責（Orca 面板沒有 modal API，改成兩段式按鈕）。
 */
export async function setSkipWorktree(repoRoot: string, workspacePath: string, file: string, ignore: boolean): Promise<Notice> {
  const action = ignore ? '取消追蹤變更' : '恢復追蹤變更'
  const resolved = resolveRepoFile(repoRoot, file)
  if (!resolved) {
    return { level: 'warn', message: `「${file}」不是這個儲存庫內的相對路徑。` }
  }
  const gate = await decideGitGate(resolved.absolute, { trusted: true, folders: [workspacePath] })
  if (gate !== 'allowed') {
    return { level: 'warn', message: `${resolved.relative} 不在這個 workspace 內（或不存在），未執行 git，無法${action}。` }
  }

  // update-index 一次只有一個 mark 旗標生效（assume-unchanged 優先），「恢復」要分兩次跑。
  const flagSets = ignore ? [['--skip-worktree']] : [['--no-skip-worktree'], ['--no-assume-unchanged']]
  for (const flags of flagSets) {
    try {
      await runGit(['-C', repoRoot, 'update-index', ...flags, '--', resolved.relative], { timeout: GIT_COMMAND_TIMEOUT_MS })
    } catch (error) {
      return { level: 'error', message: `${action}失敗（${errorText(error)}）` }
    }
  }
  return { level: 'info', message: `已${action} ${resolved.relative}` }
}

const ORCA_SWITCH_TIMEOUT_MS = 10_000

/**
 * 找 `orca` CLI 的順序：PATH 上的 `orca`，再來是 worker 所在的 Orca.app 自帶的 `Contents/Resources/bin/orca`。
 * worker 跑在 Orca 的 Electron 裡，execPath 是 `.../Orca.app/Contents/MacOS/Orca`（或其 Helper），取第一個 `.app` 為止。
 */
export function orcaCliCandidates(execPath: string = process.execPath): string[] {
  const candidates = ['orca']
  const appEnd = execPath.indexOf('.app/')
  if (appEnd >= 0) {
    candidates.push(path.posix.join(execPath.slice(0, appEnd + 4), 'Contents', 'Resources', 'bin', 'orca'))
  }
  return candidates
}

/** 給使用者自己貼到終端機的版本。 */
export const switchTerminalCommand = (terminalId: string): string => `orca terminal switch --terminal ${shellQuote(terminalId)}`

/**
 * 外掛 API 的 terminal.create 固定以背景方式開終端機（沒有分頁，畫面上看不到），外掛 API 也沒有切換終端機的方法。
 * 這裡改呼叫 Orca CLI 的 `orca terminal switch`：它會替背景終端機補上分頁並切過去。
 * terminal.create 回傳的 terminalId 就是 CLI 的 terminal handle。
 */
export async function revealTerminal(terminalId: string, candidates: readonly string[] = orcaCliCandidates()): Promise<{ ok: true } | { ok: false; reason: string }> {
  let reason = '找不到 orca 指令'
  for (const cli of candidates) {
    try {
      await execFileAsync(cli, ['terminal', 'switch', '--terminal', terminalId, '--json'], { timeout: ORCA_SWITCH_TIMEOUT_MS })
      return { ok: true }
    } catch (error) {
      // 這個位置沒有 orca 就試下一個；有 orca 但執行失敗就不再試。
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      reason = errorText(error)
      break
    }
  }
  return { ok: false, reason }
}
