import type { RemoteInfo, RepoInfo } from './types';

// 遠端網址是給 git 用的，不一定能丟進瀏覽器：scp 形式（git@host:owner/repo）根本不是 URL，
// ssh:// 與 git:// 瀏覽器也開不了。這裡只做協定改寫，路徑原封不動——
// 託管服務（GitHub、GitLab、Bitbucket）拿到 https://host/owner/repo.git 會自己跳轉到專案頁。

/** 能在瀏覽器開啟的協定；其餘（file、本機路徑）沒有對應網頁。 */
const WEB_READY_SCHEMES = new Set(['http', 'https']);
/** 走 git 傳輸但主機通常同時提供網頁介面，改寫成 https 後交給對方跳轉。 */
const REWRITABLE_SCHEMES = new Set(['ssh', 'git', 'git+ssh']);

export function toRemoteWebUrl(url: string | undefined): string | null {
  if (!url || url.trim() === '') {
    return null;
  }
  const value = url.trim();

  // scp 形式 git@host:owner/repo.git。冒號後接斜線的是 scheme（file://），不算。
  const scpLike = /^(?:[^/@]+@)?([^/:]+):(?!\/)(.+)$/.exec(value);
  if (scpLike) {
    return `https://${scpLike[1]}/${scpLike[2].replace(/^\/+/, '')}`;
  }

  const withScheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(value);
  if (!withScheme) {
    return null;
  }

  const scheme = withScheme[1].toLowerCase();
  const authority = withScheme[2];
  const path = withScheme[3] ?? '/';
  // 帶憑證的網址不該原封不動丟給瀏覽器。
  const host = authority.replace(/^[^@]*@/, '');
  if (host === '') {
    return null;
  }

  if (WEB_READY_SCHEMES.has(scheme)) {
    return `${scheme}://${host}${path}`;
  }
  if (REWRITABLE_SCHEMES.has(scheme)) {
    // ssh 的埠號換到 https 上沒有意義，去掉。IPv6 的 [::1] 不當埠號處理。
    return `https://${host.replace(/(?<!:):\d+$/, '')}${path}`;
  }
  return null;
}

/**
 * 挑一個代表這個 repo 的遠端：優先目前分支追蹤的那個，其次 origin，再其次第一個有網址的。
 * 面板只放一個按鈕，得替使用者選一個「最像這個專案的正身」的遠端。
 */
export function pickPrimaryRemote(repo: Pick<RepoInfo, 'remotes' | 'upstream'>): RemoteInfo | null {
  const usable = repo.remotes.filter((remote) => toRemoteWebUrl(remote.url) !== null);
  if (usable.length === 0) {
    return null;
  }
  const tracked = repo.upstream ? usable.find((remote) => remote.name === repo.upstream?.remote) : undefined;
  return tracked ?? usable.find((remote) => remote.name === 'origin') ?? usable[0];
}
