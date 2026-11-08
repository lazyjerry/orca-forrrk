// 面板顯示所需的 git 資訊型別。全部來自直接讀 .git 底下的檔案，不呼叫 git 指令。

/** .git 的位置。gitDir 可能不等於 repoRoot/.git（worktree 與 submodule 會指到別處）。 */
export interface RepoLocation {
  repoRoot: string;
  gitDir: string;
}

/** git config 的一筆設定。section 與 key 正規化為小寫，subsection 保留原樣（git 對它大小寫敏感）。 */
export interface GitConfigEntry {
  section: string;
  subsection?: string;
  key: string;
  value: string;
}

export interface RemoteInfo {
  name: string;
  url?: string;
  pushUrl?: string;
}

/** 目前分支的上游追蹤設定，取自 config 的 [branch "x"]。 */
export interface UpstreamInfo {
  remote: string;
  /** 從 refs/heads/<name> 取出的分支名；非此格式時退回原字串。 */
  branch: string;
}

/** 面板「其他設定」區塊的一組卡片。 */
export interface ConfigGroup {
  /** 顯示用標題，例如 core、user、submodule "docs"。 */
  title: string;
  entries: Array<{ key: string; value: string }>;
  /** 這組含 include.path / includeIf.*，內容未展開，需在 UI 標示。 */
  hasInclude: boolean;
}

/** reflog 解析出的一次提交。reflog 只記本機操作，所以這是「這台機器上發生過的提交」。 */
export interface CommitEntry {
  sha: string;
  message: string;
  author: string;
  /** epoch 毫秒。 */
  at: number;
}

export interface ActivityInfo {
  /** 最新在前。 */
  recentCommits: CommitEntry[];
  commitsLast7Days: number;
  commitsLast30Days: number;
  /** reflog 最後一筆紀錄的時間，任何操作都算。 */
  lastActivityAt: number | null;
  /** reflog 出現過的作者，最近活躍的在前。 */
  authors: string[];
  /** reflog 太大只讀了檔尾，統計不完整。 */
  truncated: boolean;
}

/** 儲存庫規模。物件大小只算 packfile 與鬆散物件個數，不遞迴 stat 每一顆物件。 */
export interface ScaleInfo {
  branchCount: number;
  tagCount: number;
  packBytes: number;
  looseObjectCount: number;
  /** .git/index 的 mtime，約等於上一次 git 操作時間。 */
  lastGitOperationAt: number | null;
}

/** 從 repo 根目錄的專案宣告檔取得的身份資訊。 */
export interface ProjectIdentity {
  name: string | null;
  version: string | null;
  description: string | null;
  /** 資料來自哪個檔案，例如 package.json。 */
  source: string;
  /** LICENSE 檔首行推斷出的授權名稱。 */
  license: string | null;
}

export interface ReadmeSummary {
  /** 絕對路徑，供「開啟」使用。 */
  path: string;
  fileName: string;
  title: string | null;
  body: string;
}

export interface EnvironmentInfo {
  submodules: string[];
  worktrees: string[];
  /** 已安裝的 hook（排除 .sample）。 */
  hooks: string[];
  lfs: boolean;
  workflows: string[];
}

/** .git/index 裡被標記成「忽略變更」的一筆檔案。兩個旗標都是 git update-index 加上去的。 */
export interface IgnoredChange {
  /** 相對儲存庫根目錄、一律用 / 分隔（index 裡本來就是這個形式）。 */
  path: string;
  /** update-index --assume-unchanged。 */
  assumeUnchanged: boolean;
  /** update-index --skip-worktree，Fork 的「Ignore changes」用的是這個。 */
  skipWorktree: boolean;
}

/** 忽略變更的清單與 .git/info/exclude 的內容。 */
export interface IgnoreInfo {
  /** 最多 IGNORED_CHANGE_LIMIT 筆，sparse checkout 會標到上萬個檔案。 */
  changes: IgnoredChange[];
  /** 實際被標記的總筆數，可能大於 changes 的長度。 */
  totalChanges: number;
  /** .git/index 讀不到或版本不支援，清單不可信。 */
  indexUnreadable: boolean;
  /** info/exclude 的絕對路徑。 */
  excludePath: string;
  excludeExists: boolean;
  /** info/exclude 的原始行，含註解與空行，照原樣顯示。 */
  excludeLines: string[];
}

/** 作用中編輯器那個檔案在忽略設定裡的處境。 */
export interface ActiveFileStatus {
  /** 絕對路徑。 */
  path: string;
  /** 相對儲存庫根目錄；檔案不在這個儲存庫裡時為 null。 */
  relativePath: string | null;
  /** 在 .git/index 裡有這一筆，也就是 git 有在追蹤它。沒追蹤的檔案沒有旗標可切換。 */
  tracked: boolean;
  assumeUnchanged: boolean;
  skipWorktree: boolean;
  /** info/exclude 裡命中的那一行原文，沒命中為 null。 */
  excludedBy: string | null;
}

export interface RepoInfo {
  repoRoot: string;
  gitDir: string;
  /** detached HEAD 時為 null。 */
  branch: string | null;
  detached: boolean;
  headSha: string | null;
  /** 由 reflog 取得的最近切換過的分支，最新在前，已去重且排除目前分支。 */
  recentBranches: string[];
  remotes: RemoteInfo[];
  upstream: UpstreamInfo | null;
  stashCount: number;
  configGroups: ConfigGroup[];
  activity: ActivityInfo;
  scale: ScaleInfo;
  /** 找不到任何專案宣告檔時為 null。 */
  project: ProjectIdentity | null;
  /** 找不到 README 時為 null。 */
  readme: ReadmeSummary | null;
  environment: EnvironmentInfo;
  ignore: IgnoreInfo;
  /** 沒有作用中的檔案編輯器時為 null。 */
  activeFile: ActiveFileStatus | null;
  /** 讀取過程中的降級訊息；有值不代表整體失敗。 */
  warnings: string[];
}
