/**
 * git-auto-push 的 -f 只限縮 `git add`，commit 仍是不帶路徑的 `git commit`，
 * 暫存區裡原本就有的其他檔案會一起被提交。這裡從 `git diff --cached --name-only -z` 的輸出
 * 挑出目標檔以外的已暫存路徑，非空就不該執行。
 */
export function otherStagedPaths(stagedNul: string, target: string): string[] {
  return stagedNul.split('\0').filter((entry) => entry !== '' && entry !== target);
}

/** -f 會一路吃到下一個 "-" 開頭的參數，所以 "-" 開頭的路徑補上 "./"，免得被當成旗標。 */
export function fileScopeArgs(relativePath: string): string[] {
  return ['-a', '-f', relativePath.startsWith('-') ? `./${relativePath}` : relativePath];
}
