// 外掛 API 只給聚焦 workspace 的名稱與分支（同名的 main 一多就對不到），也沒有「作用中編輯器」。
// Orca 自己把這兩件事存在 profile-state.db 的 workspaceSession，這裡唯讀取用。
// 這是 Orca 未公開的內部格式，讀不到或格式變了一律回 null，呼叫端退回外掛 API 的結果。
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { WorkspaceOption } from '../protocol'

export interface OrcaSession {
  /** worktree 是 `<repoId>::<路徑>`，資料夾是 `folder:<id>`。 */
  workspaceKey: string
  /** 該 workspace 最後作用中的編輯器檔案（絕對路徑）；沒有時為 null。 */
  activeFile: string | null
  /** 編輯區目前顯示的是檔案（不是終端機或 agent）。 */
  editorFocused: boolean
}

type Dict = Record<string, unknown>

const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 編輯器分頁 id 是 `editor:<編碼的 worktreeId>:<host>:<編碼的路徑>`，舊資料直接存絕對路徑。 */
export function parseFileId(fileId: unknown, pathApi: path.PlatformPath = path): string | null {
  if (typeof fileId !== 'string' || fileId === '') {
    return null
  }
  let candidate = fileId
  if (fileId.startsWith('editor:')) {
    try {
      candidate = decodeURIComponent(fileId.slice(fileId.lastIndexOf(':') + 1))
    } catch {
      return null
    }
  }
  return pathApi.isAbsolute(candidate) ? candidate : null
}

export function parseWorkspaceSession(payload: string): OrcaSession | null {
  let data: unknown
  try {
    data = JSON.parse(payload)
  } catch {
    return null
  }
  if (!isDict(data)) {
    return null
  }
  const fromKey = typeof data.activeWorkspaceKey === 'string' ? data.activeWorkspaceKey.replace(/^worktree:/, '') : null
  const workspaceKey = typeof data.activeWorktreeId === 'string' && data.activeWorktreeId !== '' ? data.activeWorktreeId : fromKey
  if (!workspaceKey) {
    return null
  }
  const fileIds = isDict(data.activeFileIdByWorktree) ? data.activeFileIdByWorktree : {}
  const tabTypes = isDict(data.activeTabTypeByWorktree) ? data.activeTabTypeByWorktree : {}
  const activeFile = parseFileId(fileIds[workspaceKey])
  return { workspaceKey, activeFile, editorFocused: activeFile !== null && tabTypes[workspaceKey] === 'editor' }
}

/** workspace.list 的 worktree id 是 `identity:...`，跟 session 的不同，只能用路徑對；資料夾的 id 兩邊一樣。 */
export function matchSessionWorkspace(workspaceKey: string, options: readonly WorkspaceOption[]): WorkspaceOption | null {
  const byId = options.find((option) => option.id === workspaceKey)
  if (byId) {
    return byId
  }
  const separator = workspaceKey.indexOf('::')
  if (separator < 0) {
    return null
  }
  const workspacePath = workspaceKey.slice(separator + 2)
  const byPath = options.filter((option) => option.path === workspacePath)
  return byPath.length === 1 ? byPath[0] : null
}

/** Orca 的 userData 是 Electron 預設位置。 */
export function orcaUserDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string {
  const base =
    platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : platform === 'win32'
        ? (env.APPDATA ?? path.join(home, 'AppData', 'Roaming'))
        : (env.XDG_CONFIG_HOME ?? path.join(home, '.config'))
  return path.join(base, 'orca')
}

/** 啟用中的 profile 記在 orca-profile-index.json。 */
export async function locateSessionDb(userData: string = orcaUserDataDir()): Promise<string | null> {
  try {
    const index: unknown = JSON.parse(await fs.readFile(path.join(userData, 'orca-profile-index.json'), 'utf8'))
    const profileId = isDict(index) ? index.activeProfileId : null
    // 跟 Orca 一樣檢查格式，profile id 會拼進路徑。
    if (typeof profileId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(profileId)) {
      return null
    }
    return path.join(userData, 'profiles', profileId, 'profile-state.db')
  } catch {
    return null
  }
}

export async function readOrcaSession(dbPath: string | null): Promise<OrcaSession | null> {
  if (!dbPath) {
    return null
  }
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const row = db.prepare(`SELECT payload FROM profile_state_documents WHERE domain = 'workspaceSession'`).get() as
        | { payload?: unknown }
        | undefined
      return typeof row?.payload === 'string' ? parseWorkspaceSession(row.payload) : null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/** Orca 寫入 session（含切換編輯器分頁）時呼叫 onChange；寫入很頻繁，合併 300 ms 內的變動。 */
export function watchSessionDb(dbPath: string, onChange: () => void): FSWatcher | null {
  let timer: ReturnType<typeof setTimeout> | null = null
  const fileName = path.basename(dbPath)
  try {
    const watcher = watch(path.dirname(dbPath), (_event, changed) => {
      if (changed && !String(changed).startsWith(fileName)) {
        return
      }
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, 300)
    })
    watcher.on('error', () => watcher.close())
    watcher.unref()
    return watcher
  } catch {
    return null
  }
}

export const sessionKey = (session: OrcaSession | null): string =>
  session ? `${session.workspaceKey}\0${session.activeFile ?? ''}\0${session.editorFocused}` : ''
