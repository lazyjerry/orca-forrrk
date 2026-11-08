// 面板 ⇄ worker 的協定，兩端都 import 這一份。
// 面板只傳範圍（project／file）與 repo 內的相對路徑，絕對路徑一律由 worker 從 workspace.list 推出來，
// 面板送來的路徑不直接拿去開檔或跑 git。
import type { RepoInfo } from './core/git/types'

export type { RepoInfo }

export interface WorkspaceOption {
  id: string
  name: string
  path: string
  branch: string | null
  kind: 'worktree' | 'folder'
}

export interface Notice {
  level: 'info' | 'warn' | 'error'
  message: string
  /** 多行補充說明，例如安裝步驟。 */
  detail?: string
  /** 可複製的指令（Orca 面板沒有剪貼簿 API，改成顯示出來讓人選取）。 */
  command?: string
  /** 面板用 shell.openExternal 開的連結，需要使用者再按一次。 */
  link?: { label: string; url: string }
}

/** project：聚焦的專案／資料夾；file：編輯區目前開啟的檔案。 */
export type Scope = 'project' | 'file'

export interface LoadResult {
  /** 這次實際採用的範圍；面板沒指定時，編輯區開著檔案就是 file。 */
  scope: Scope
  /** Orca 目前聚焦的本機 workspace；對不到時為 null。 */
  workspace: WorkspaceOption | null
  /** 編輯區目前開啟的檔案（絕對路徑）；沒有時為 null。 */
  openFile: string | null
  repo: RepoInfo | null
  remoteWebUrl: string | null
  /** epoch 毫秒。 */
  readAt: number
}

export interface WorkspaceInput {
  /** 省略時自動判斷：編輯區開著檔案用 file，否則用 project。 */
  scope?: Scope | null
}

declare module 'orca' {
  interface PluginRequests {
    /** 定位 workspace 所在的 repo 並讀出全部資訊；file 是要檢查忽略狀態的檔案（repo 內相對路徑）。 */
    'forrrk.load': { input: WorkspaceInput & { file?: string | null }; output: LoadResult }
    'forrrk.openInFork': { input: WorkspaceInput; output: Notice }
    'forrrk.openFolder': { input: WorkspaceInput; output: Notice }
    /** target 只收 readme 與 exclude，worker 自己從 repo 資訊找出路徑。 */
    'forrrk.openFile': { input: WorkspaceInput & { target: 'readme' | 'exclude' }; output: Notice }
    /** file 有值時只推這個檔案（git-auto-push -a -f）。 */
    'forrrk.autoPush': { input: WorkspaceInput & { file?: string | null }; output: Notice }
    'forrrk.setSkipWorktree': { input: WorkspaceInput & { file: string; ignore: boolean }; output: Notice }
  }
  interface PluginPanelEvents {
    /** 聚焦的 workspace 或編輯區的作用中檔案換了。 */
    'forrrk.focusChanged': null
  }
}
