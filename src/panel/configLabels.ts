// git config 的鍵名是專有名詞，翻掉反而查不到文件，所以英文照舊、中文說明掛在旁邊。
// 只收常見的；查不到就不標，不硬湊。

const LABELS: Record<string, string> = {
  'core.repositoryformatversion': '儲存庫格式版本',
  'core.filemode': '記錄執行權限位元',
  'core.bare': '裸儲存庫',
  'core.logallrefupdates': '記錄 ref 變更（reflog）',
  'core.ignorecase': '檔名不分大小寫',
  'core.precomposeunicode': 'Unicode 檔名正規化',
  'core.symlinks': '支援符號連結',
  'core.autocrlf': '換行字元轉換',
  'core.safecrlf': '換行轉換安全檢查',
  'core.editor': '提交訊息編輯器',
  'core.excludesfile': '全域忽略清單',
  'core.hookspath': 'hook 目錄',
  'core.sshcommand': 'SSH 指令',
  'core.fsmonitor': '檔案變更監看',
  'core.compression': '壓縮等級',
  'core.worktree': '工作目錄位置',
  'user.name': '提交者名稱',
  'user.email': '提交者信箱',
  'user.signingkey': '簽章金鑰',
  'init.defaultbranch': '預設分支名',
  'pull.rebase': '拉取時改用 rebase',
  'pull.ff': '快轉合併策略',
  'push.default': '推送策略',
  'push.autosetupremote': '自動建立上游分支',
  'fetch.prune': '抓取時清掉消失的遠端分支',
  'commit.gpgsign': '提交自動簽章',
  'commit.template': '提交訊息範本',
  'merge.tool': '合併工具',
  'diff.tool': '差異比對工具',
  'credential.helper': '憑證存取方式',
  'gc.auto': '自動打包門檻',
  'include.path': '引入的設定檔',
  'includeif.path': '條件式引入的設定檔',
  'submodule.active': '啟用的子模組',
  'submodule.url': '子模組來源',
  'lfs.repositoryformatversion': 'LFS 格式版本',
  'extensions.worktreeconfig': '每個 worktree 各自的設定',
};

/** groupTitle 可能是 `core` 或 `submodule "docs"`，取前面那段當 section。 */
export function configLabel(groupTitle: string, key: string): string | null {
  const section = groupTitle.split(' ')[0].toLowerCase();
  return LABELS[`${section}.${key.toLowerCase()}`] ?? null;
}
