// forrrk 的 worker：讀 .git、開 Fork、跑 git。面板只負責畫面與確認，
// 所有路徑都在這裡從 workspace.list 推出，不信任面板送來的絕對路徑。
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { OrcaWorkerApi } from 'orca/worker'

import { discoverRepo } from './core/git/discoverRepo'
import { readRepoInfo } from './core/git/readRepoInfo'
import { pickPrimaryRemote, toRemoteWebUrl } from './core/git/remoteWebUrl'
import type { RepoInfo, RepoLocation } from './core/git/types'
import {
  autoPushCommand,
  openFolder,
  openInFork,
  prepareFilePush,
  resolveGitAutoPushCli,
  resolveRepoFile,
  revealTerminal,
  setSkipWorktree,
  switchTerminalCommand
} from './host/actions'
import { locateSessionDb, matchSessionWorkspace, readOrcaSession, sessionKey, watchSessionDb } from './host/orcaSession'
import { localWorkspaces, matchFocused } from './host/workspaces'
import type { LoadResult, Notice, Scope, WorkspaceInput, WorkspaceOption } from './protocol'

interface Target {
  workspace: WorkspaceOption
  location: RepoLocation
}

interface Focus {
  workspace: WorkspaceOption | null
  openFile: string | null
  editorFocused: boolean
}

/**
 * 先用 Orca 的 session 對到確切的 workspace 與作用中檔案；session 讀不到，
 * 或跟 readContext 說的名稱／分支對不上（session 還沒寫入）時，退回只靠名稱＋分支比對。
 */
async function readFocus(orca: OrcaWorkerApi): Promise<Focus> {
  const [listed, context, session] = await Promise.all([
    orca.host.call('workspace.list'),
    orca.host.call('workspace.readContext'),
    locateSessionDb().then(readOrcaSession)
  ])
  const options = localWorkspaces(listed.workspaces)
  const fromSession = session ? matchSessionWorkspace(session.workspaceKey, options) : null
  if (session && fromSession && context && matchFocused(context, [fromSession])) {
    return { workspace: fromSession, openFile: session.activeFile, editorFocused: session.editorFocused }
  }
  return { workspace: matchFocused(context, options), openFile: null, editorFocused: false }
}

const pickScope = (input: WorkspaceInput, focus: Focus): Scope =>
  input.scope ?? (focus.editorFocused && focus.openFile ? 'file' : 'project')

/** 找出這次要操作的 workspace 與 repo；找不到時回傳要顯示的提示。 */
async function resolveTarget(orca: OrcaWorkerApi, input: WorkspaceInput): Promise<Target | { notice: Notice }> {
  const focus = await readFocus(orca)
  const { workspace, openFile } = focus
  if (!workspace) {
    return { notice: { level: 'warn', message: '對不到目前的 workspace，請先在 Orca 左側選一個本機專案或資料夾。' } }
  }
  if (pickScope(input, focus) === 'file') {
    if (!openFile) {
      return { notice: { level: 'warn', message: '編輯區目前沒有開啟的檔案。' } }
    }
    const location = await discoverRepo(openFile)
    return location
      ? { workspace, location }
      : { notice: { level: 'warn', message: `這個檔案所在的資料夾沒有 git（${openFile}）` } }
  }
  const location = await discoverRepo(workspace.path)
  return location
    ? { workspace, location }
    : { notice: { level: 'warn', message: `這個資料夾沒有 git（${workspace.path}）` } }
}

async function load(orca: OrcaWorkerApi, input: WorkspaceInput & { file?: string | null }): Promise<LoadResult> {
  const focus = await readFocus(orca)
  const scope = pickScope(input, focus)
  const { workspace, openFile } = focus
  const start = scope === 'file' ? openFile : (workspace?.path ?? null)
  const location = workspace && start ? await discoverRepo(start) : null

  let repo: RepoInfo | null = null
  if (location) {
    // file 範圍看編輯區的檔案；project 範圍看面板輸入的相對路徑。
    const file = scope === 'file' ? openFile : input.file ? (resolveRepoFile(location.repoRoot, input.file)?.absolute ?? null) : null
    repo = await readRepoInfo(location, { activeFile: file })
  }
  const remote = repo ? pickPrimaryRemote(repo) : null

  return {
    scope,
    workspace,
    openFile,
    repo,
    remoteWebUrl: toRemoteWebUrl(remote?.url),
    readAt: Date.now()
  }
}

/** Orca 寫入 session 時比對聚焦的 workspace 與作用中檔案，換了才通知面板重讀。 */
async function watchFocus(orca: OrcaWorkerApi): Promise<void> {
  const dbPath = await locateSessionDb()
  if (!dbPath) {
    return
  }
  let last = sessionKey(await readOrcaSession(dbPath))
  watchSessionDb(dbPath, () => {
    void readOrcaSession(dbPath).then((session) => {
      const key = sessionKey(session)
      if (key !== last) {
        last = key
        orca.panels.post('forrrk.focusChanged', null)
      }
    })
  })
}

async function autoPush(orca: OrcaWorkerApi, input: WorkspaceInput & { file?: string | null }): Promise<Notice> {
  const target = await resolveTarget(orca, input)
  if ('notice' in target) {
    return target.notice
  }

  let root = target.location.repoRoot
  let args = ['-a']
  if (input.file) {
    const prepared = await prepareFilePush(root, target.workspace.path, input.file)
    if ('notice' in prepared) {
      return prepared.notice
    }
    root = prepared.root
    args = prepared.args
  }

  const cli = await resolveGitAutoPushCli()
  if ('notice' in cli) {
    return cli.notice
  }
  // git-auto-push 是互動式腳本（選單、AI 產生訊息），不能藏在背景子行程，一提問就卡死。
  const { terminalId } = await orca.host.call('terminal.create', {
    workspaceId: target.workspace.id,
    title: 'git-auto-push',
    command: autoPushCommand(cli.cliPath, root, args)
  })
  // terminal.create 開的是背景終端機，畫面上沒有分頁；改用 Orca CLI 切過去，切不過去就給指令讓使用者自己切。
  const revealed = await revealTerminal(terminalId)
  if (revealed.ok) {
    return { level: 'info', message: '已在 Orca 終端機執行 git-auto-push，並切到該終端機，請在那裡回答提問。' }
  }
  return {
    level: 'warn',
    message: '已在背景終端機執行 git-auto-push，但切換不過去，畫面上看不到它。',
    detail: `原因：${revealed.reason}\n請在任一終端機執行下面的指令切過去，git-auto-push 提問時會一直等你回答。`,
    command: switchTerminalCommand(terminalId)
  }
}

async function openFile(orca: OrcaWorkerApi, input: WorkspaceInput & { target: 'readme' | 'exclude' }): Promise<Notice> {
  const target = await resolveTarget(orca, input)
  if ('notice' in target) {
    return target.notice
  }
  const repo = await readRepoInfo(target.location)
  const file = input.target === 'readme' ? repo.readme?.path : repo.ignore.excludeExists ? repo.ignore.excludePath : undefined
  if (!file) {
    return { level: 'warn', message: input.target === 'readme' ? '找不到 README。' : '沒有 .git/info/exclude。' }
  }
  // editor.open 只收 workspace 內的相對路徑。linked worktree 的 info/exclude 在主 repo 的 .git 底下，
  // workspace 開在 repo 子資料夾時 README 也在外面，這兩種只能把路徑給使用者。
  const [realWorkspace, realFile] = await Promise.all([fs.realpath(target.workspace.path), fs.realpath(file)])
  const relative = path.relative(realWorkspace, realFile)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { level: 'warn', message: '這個檔案不在目前的 workspace 內，Orca 無法在編輯器開啟。', command: file }
  }
  try {
    await orca.host.call('editor.open', { workspaceId: target.workspace.id, path: relative.split(path.sep).join('/') })
    return { level: 'info', message: `已開啟 ${relative}` }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { level: 'warn', message: `Orca 開不了這個檔案（${detail}）`, command: file }
  }
}

const withTarget =
  (orca: OrcaWorkerApi, run: (target: Target) => Promise<Notice>) =>
  async (input: WorkspaceInput): Promise<Notice> => {
    const target = await resolveTarget(orca, input)
    return 'notice' in target ? target.notice : run(target)
  }

export default function activate(orca: OrcaWorkerApi): void {
  void watchFocus(orca)
  orca.panels.handle('forrrk.load', (input) => load(orca, input))
  orca.panels.handle('forrrk.openInFork', withTarget(orca, (target) => openInFork(target.location.repoRoot)))
  orca.panels.handle('forrrk.openFolder', withTarget(orca, (target) => openFolder(target.location.repoRoot)))
  orca.panels.handle('forrrk.openFile', (input) => openFile(orca, input))
  orca.panels.handle('forrrk.autoPush', (input) => autoPush(orca, input))
  orca.panels.handle('forrrk.setSkipWorktree', (input) =>
    withTarget(orca, (target) => setSkipWorktree(target.location.repoRoot, target.workspace.path, input.file, input.ignore))(input)
  )

  // 命令面板：一律作用在 Orca 目前聚焦的 workspace。回傳字串由 Orca 顯示。
  // 命令面板沒有按鈕，連結改成直接列出網址。
  const asText = (notice: Notice): string =>
    [notice.message, notice.detail, notice.command, notice.link && `${notice.link.label}：${notice.link.url}`].filter(Boolean).join('\n')
  orca.commands.register('forrrk.openInFork', async () => asText(await withTarget(orca, (t) => openInFork(t.location.repoRoot))({})))
  orca.commands.register('forrrk.openFolder', async () => asText(await withTarget(orca, (t) => openFolder(t.location.repoRoot))({})))
  orca.commands.register('forrrk.autoPush', async () => asText(await autoPush(orca, {})))
}
