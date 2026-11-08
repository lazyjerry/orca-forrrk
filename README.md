# forrrk for Orca

把 VS Code 擴充 [forrrk](https://marketplace.visualstudio.com/items?itemName=workjerry.forrrk)（[lazyjerry/fork-ext](https://github.com/lazyjerry/fork-ext) v0.2.0）移植成 Orca 外掛：在 Orca 右側邊欄顯示 workspace 所在儲存庫的唯讀 git 資訊，並一鍵用 [Fork](https://git-fork.com/) 開啟。

原始碼：[lazyjerry/orca-forrrk](https://github.com/lazyjerry/orca-forrrk)

讀取資訊直接讀 `.git` 底下的檔案，不呼叫 `git`；只有「取消／恢復追蹤變更」與「只推目前檔案」的前置檢查會執行 git。

> **非官方套件**：forrrk 不是 [Fork](https://git-fork.com/) 官方出品的外掛，與 Fork 及其開發者沒有任何關係。主要用途：
>
> - **呼叫 Fork**：透過 Fork 的命令列工具開啟目前的儲存庫；Fork 本體需自行安裝。
> - **查詢 git 資訊**：唯讀顯示 HEAD 與遠端、最近提交、專案 README、忽略變更與 config 等 `.git` 資訊。
> - **整合 git-auto-push**：在 Orca 終端機執行 [git-auto-push](https://github.com/lazyjerry/git-auto-push) 腳本（Auto Push／只推目前檔案）；腳本需自行安裝，只支援 macOS／Linux：
>
>   ```sh
>   curl -fsSL https://raw.githubusercontent.com/lazyjerry/git-auto-push/refs/heads/master/install.sh | sh
>   ```
>
>   預設裝到 `~/.local/bin`；外掛會依序找 PATH、`~/.local/bin`、`/usr/local/bin`，沒裝時面板會顯示這行安裝指令。

## 功能對照

| forrrk（VS Code） | Orca 版 | 差異 |
|---|---|---|
| 底部 Panel 的 webview | 右側邊欄 components 面板 | 版面改用 Orca 元件，跟著 Orca 主題 |
| 跟隨作用中編輯器找 `.git` | 範圍選單兩項：「當前專案／資料夾」與「當前開啟檔案」；編輯區開著檔案時自動用檔案所在的 repo，資料夾沒有 git 時直接提示 | 外掛 API 沒有「作用中編輯器」，聚焦的 workspace 也只給名稱與分支；worker 改為唯讀 Orca 的 `profile-state.db`（未公開格式，讀不到時退回名稱＋分支比對、沒有檔案範圍） |
| 手動刷新 | 手動刷新；切換聚焦的 workspace 或編輯區換檔案時自動重讀 | 面板不輪詢；worker 監看 Orca 的 session 檔，作用中檔案換了才通知面板 |
| 開啟資料夾 | worker 執行 `open`／`explorer`／`xdg-open` | 相同 |
| 忽略變更切換（含確認對話框） | 面板兩段式確認（先顯示後果，再按「確認」） | Orca 面板沒有 modal |
| 目前檔案的忽略狀態 | 「當前開啟檔案」範圍直接看編輯區的檔案；「當前專案／資料夾」範圍在卡片輸入 repo 內相對路徑，或點選清單裡的檔案 | 相同 |
| 開啟 `info/exclude`、README | `editor.open` 在 Orca 編輯器開啟 | 只能開 workspace 內的檔案；linked worktree 的 `info/exclude` 在主 repo 底下，改為顯示路徑 |
| 開啟遠端網頁 | 面板 `shell.openExternal` | Orca 第一次開某個網域會先詢問 |
| 開啟 Fork | worker 執行 `fork -C <repo> open` | 缺 CLI／未安裝時顯示安裝步驟與指令 |
| Auto Push／只推目前檔案 | `terminal.create` 在該 workspace 開 Orca 終端機執行 `git-auto-push`，再用 `orca terminal switch` 切過去 | 外掛 API 只能開背景終端機，切換靠 Orca CLI（見下方〈權限清單以外〉）；不會自動關掉上一個終端機；Orca 編輯器未存檔的內容不會被提交；按下後先在面板確認才執行 |
| 點擊複製 SHA／路徑 | 無 | Orca 面板沒有剪貼簿 API；安裝指令改成顯示在程式碼區塊 |
| 命令面板 | `forrrk: Open Current Repository in Fork`、`forrrk: Open Repository Folder`、`forrrk: Run git-auto-push -a` | 開遠端網頁需要使用者按下，只能在面板做 |

限制：只支援本機的 workspace。SSH 或遠端環境的 workspace 路徑在本機讀不到 `.git`，不會出現在選單裡。

## 安裝（社群外掛目錄）

[Open in Orca](https://onorca.dev/plugins/lazyjerry.forrrk?catalog=community)

或在 Orca 的 Settings → Plugins 搜尋 `forrrk`。外掛列在 Orca 社群目錄（[orca-community-plugins](https://github.com/stablyai/orca-community-plugins)），是自動檢查、沒有人工審查的目錄；第一次安裝時 Orca 會先問要不要加入社群目錄，再列出外掛要求的權限（見下一節）請你同意。

支援平台：

| 功能 | macOS | Windows | Linux |
|---|---|---|---|
| 面板的 git 資訊、開啟資料夾、開遠端網頁 | ✅ | ✅ | ✅ |
| 在 Fork 中開啟（需自行安裝 Fork） | ✅ | ✅ | —（Fork 沒有 Linux 版） |
| Auto Push／只推目前檔案（需自行安裝 git-auto-push） | ✅ | — | ✅ |

## 安裝（開發中載入）

外掛含 worker（`trusted-worker`），以你的使用者權限在本機跑 Node，載入時要你同意：

```sh
cd forrrk
orca plugin dev load . --json          # 第一次會回 approval_required，列出要授予的權限與 fingerprint
orca plugin dev load . --approve <fingerprint> --json
orca plugin open local.forrrk --panel forrrk
```

要求的權限：

- `workspace:read`：讀取聚焦的 workspace 與 workspace 清單
- `workspace:write`：在 Orca 編輯器開啟 README／`info/exclude`
- `terminal:send`：開終端機執行 `git-auto-push`

### 權限清單以外：直接讀取 Orca 內部的 session 資料

除了上面的權限，worker 還會**繞過外掛 API，直接讀 Orca 自己的 session 資料庫**。權限宣告裡沒有這一項，能讀是因為 `trusted-worker` 沒有沙箱，可以讀使用者權限能讀到的任何檔案。

- **讀什麼**：
  - `<Orca userData>/orca-profile-index.json`：取得啟用中的 profile id。
  - `<Orca userData>/profiles/<profileId>/profile-state.db`：用 `node:sqlite` 唯讀開啟，只查 `profile_state_documents` 表裡 `domain='workspaceSession'` 那一筆，取 `activeWorktreeId`、`activeFileIdByWorktree`、`activeTabTypeByWorktree`。
  - `<Orca userData>` 是 Electron 的預設位置：macOS 為 `~/Library/Application Support/orca`，Windows 為 `%APPDATA%\orca`，Linux 為 `$XDG_CONFIG_HOME/orca`（未設定時是 `~/.config/orca`）。
- **監看**：用 `fs.watch` 監看該 profile 目錄，`profile-state.db` 相關檔案有變動就重讀，300 ms 內的變動合併成一次。
- **為什麼要讀**：外掛 API 的 `workspace.readContext` 只給聚焦 workspace 的名稱與分支，多個 workspace 同名又同分支時分不出是哪一個；外掛 API 和 `orca` CLI 也都拿不到「作用中的編輯器檔案」。
- **不做的事**：不寫入、不讀其他 domain、不傳到本機以外。
- **交叉驗證**：session 指到的 workspace 要跟 `readContext` 的名稱、分支一致才採用，不一致時退回只比對名稱＋分支。

風險：

- **格式沒有公開**：Orca 改版可能改動表名或鍵名。讀取或解析失敗時會靜默退回名稱＋分支比對，面板**不會顯示任何提示**。退化後的症狀：選單的「當前開啟檔案」一直沒有檔案；同名同分支的 workspace 顯示「對不到目前的 workspace」。排查方式是用 `sqlite3 -readonly` 查看 payload 的鍵名有沒有變。
- **依賴執行環境**：需要 `node:sqlite`（Orca 內建 Node 24）。換成比較舊的 runtime 一樣會靜默退回。
- **只找預設位置**：Orca 改用自訂的 user data 目錄啟動時找不到資料庫，一樣會退回。

### 權限清單以外：呼叫 Orca CLI 切換到 git-auto-push 的終端機

外掛 API 的 `terminal.create` 固定以背景方式開終端機（Orca 內部帶 `presentation: 'background'`）：程序在跑，但沒有分頁，畫面上找不到。外掛 API 也沒有切換終端機的方法。`git-auto-push` 會提問，看不到就會一直卡在那裡等。

所以 worker 開完終端機後，會**繞過外掛 API，直接執行 Orca CLI**：

```sh
orca terminal switch --terminal <terminalId> --json
```

- **為什麼可以這樣做**：`terminal.create` 回傳的 `terminalId` 就是 CLI 的 terminal handle（`term_...`）。`switch` 會替背景終端機補上分頁並把畫面切過去。
- **CLI 的位置**：先找 PATH 上的 `orca`，找不到再用 worker 所在 `Orca.app` 內附的 `Contents/Resources/bin/orca`。
- **切換失敗時**：終端機照樣在背景執行。面板改顯示警告，附上原因和上面那行指令，讓你自己貼到終端機執行。
- **副作用**：會把 Orca 的畫面切到該終端機。
- **風險**：CLI 的指令與參數不屬於外掛 API 的相容性承諾，Orca 改版後可能改變。症狀是每次按 Auto Push 都出現「切換不過去」的警告。這時先用 `orca terminal switch --help` 確認參數有沒有變。

與 VS Code 版的差異：

| 項目 | forrrk（VS Code） | Orca 版 |
|---|---|---|
| 開終端機 | `vscode.window.createTerminal`，直接開在畫面上 | 外掛 API 的 `terminal.create`，只能開背景終端機 |
| 顯示並切過去 | 同一組 API 的 `terminal.show()` | 外掛 API 做不到，改呼叫 Orca CLI 的 `orca terminal switch` |
| 送出指令 | `cwd` 設為 repo 根目錄，再用 `sendText` 送出 CLI | `terminal.create` 的 `command` 帶 `cd <repo 根目錄> && <CLI>` |
| 上一個終端機 | 開新的之前先關掉 | 不會關，每按一次就多一個 |
| 切換失敗時 | 不會發生，全程走擴充 API | 終端機照樣在背景執行，面板顯示警告和指令，讓你自己貼上執行 |
| 依賴 | 只用 VS Code 擴充 API | 外掛 API 加上 Orca CLI，CLI 不在外掛 API 的相容性承諾內 |
| 按下按鈕後 | 直接執行 | 先在面板顯示確認（`-a` 是全自動模式，不會再提問），按「確認」才執行 |

## 開發

```sh
orca plugin validate . --json
orca plugin test . --json     # core 移植測試 + worker + 面板，共 139 個
orca plugin check . --json    # 依 src/panel.check.ts 的情境畫面板
orca plugin dev watch . --check --shot .orca/shots --json
```

型別檢查需要 `@types/node`。不要把 `node_modules/` 裝在外掛資料夾裡（外掛上限 2,000 個檔案），改裝在別處，再用一份 `extends` 本專案 `.orca/types/tsconfig.json` 的 tsconfig，`types` 加上 `node` 後執行 `tsc -p`。

## 目錄

```
orca-plugin.json
src/
  worker.ts          面板請求的處理、命令面板指令
  panel.tsx          右側邊欄面板
  protocol.ts        面板 ⇄ worker 協定
  host/              worker 端的動作（Fork、資料夾、git、git-auto-push）、workspace 對應、Orca session 讀取
  panel/             面板端的格式化、config 中文標籤、測試假資料
  core/              來自 forrrk 的 .git 讀取邏輯（原樣）
test/core/           來自 forrrk 的 core 單元測試
```

`src/core/` 與上游同步時，直接覆蓋成 fork-ext 的 `src/core/`，再把 `installHint.ts` 裡的「重新開啟 VS Code」改回 Orca。

## 授權

[Apache License 2.0](LICENSE)，沿用上游 [lazyjerry/fork-ext](https://github.com/lazyjerry/fork-ext) 的授權；`LICENSE` 由上游原樣複製。
