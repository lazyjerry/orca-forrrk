import type { WorkspaceOption } from '../protocol'

export interface ListedWorkspace {
  id: string
  kind: 'worktree' | 'folder'
  name: string
  path: string
  branch: string | null
  hostId: string | null
}

export interface FocusedContext {
  branch: string
  displayName: string
}

/** worker 只讀得到這台機器的檔案系統；SSH／遠端環境的 workspace 路徑在本機不存在。 */
export function localWorkspaces(listed: readonly ListedWorkspace[]): WorkspaceOption[] {
  return listed
    .filter((workspace) => workspace.hostId === null || workspace.hostId === 'local')
    .map(({ id, name, path, branch, kind }) => ({ id, name, path, branch, kind }))
}

/**
 * workspace.readContext 只給名稱與分支，沒有 id 或路徑，只能拿這兩個去 workspace.list 對。
 * 名稱加分支對到唯一一筆才算數；同名同分支（例如兩台機器各有一份）時寧可回 null 讓使用者自己選，
 * 也不要猜錯 repo。
 */
export function matchFocused(context: FocusedContext | null, options: readonly WorkspaceOption[]): WorkspaceOption | null {
  if (!context) {
    return null
  }
  const byName = options.filter((option) => option.name === context.displayName)
  if (byName.length === 1) {
    return byName[0]
  }
  // 資料夾 workspace 沒有分支：readContext 給空字串，list 給 null。
  const byBranch = byName.filter((option) => (option.branch ?? '') === context.branch)
  return byBranch.length === 1 ? byBranch[0] : null
}
