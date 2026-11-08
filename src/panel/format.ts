// 面板用的純文字格式化；面板只能 import orca 與相對檔案，這裡不能碰 node:*。

export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${index === 0 ? value : value.toFixed(1)} ${units[index]}`
}

/** 路徑用中間省略，頭尾都比中段重要。 */
export function middleEllipsis(value: string, max: number): string {
  if (value.length <= max) {
    return value
  }
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}

/**
 * 遠端網址拆成網域與路徑兩欄：真正要看的是「哪個主機」與「哪個 owner/repo」。
 * 認得 scp 形式與帶 scheme 的 URL，都不認得就整串當路徑（本機路徑）。
 */
export function splitRemoteUrl(url: string | undefined): { host: string | null; path: string } {
  if (!url) {
    return { host: null, path: '（未設定 url）' }
  }
  const scpLike = /^(?:[^/@]+@)?([^/:]+):(?!\/)(.+)$/.exec(url)
  if (scpLike) {
    return { host: scpLike[1], path: scpLike[2] }
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/]*@)?([^/]+)(\/.*)?$/.exec(url)
  if (withScheme) {
    return { host: withScheme[1], path: (withScheme[2] ?? '/').replace(/^\//, '') || '/' }
  }
  return { host: null, path: url }
}

export function flagNames(entry: { skipWorktree: boolean; assumeUnchanged: boolean }): string[] {
  const names: string[] = []
  if (entry.skipWorktree) {
    names.push('skip-worktree')
  }
  if (entry.assumeUnchanged) {
    names.push('assume-unchanged')
  }
  return names
}

/** 兩段式確認時顯示的內容：忽略變更的副作用不直覺，切換前把後果講完。 */
export function skipWorktreeConsequence(relativePath: string, ignore: boolean): string {
  if (ignore) {
    return [
      `git update-index --skip-worktree -- ${relativePath}`,
      '',
      '之後這個檔案的本機修改不會出現在 git 狀態裡，也不會被 commit。',
      '注意：切換分支或 pull 時若這個檔案在對方有更新，git 會直接失敗，要先恢復追蹤。'
    ].join('\n')
  }
  return [
    `git update-index --no-skip-worktree -- ${relativePath}`,
    `git update-index --no-assume-unchanged -- ${relativePath}`,
    '',
    '之後這個檔案的本機修改會重新出現在 git 狀態裡。'
  ].join('\n')
}
