import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 專案路徑很長，暫存目錄一律放到短路徑底下，避免 socket / 路徑長度問題。
const TEMPORARY_ROOT = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();

export async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(TEMPORARY_ROOT, 'fork-ext-'));
}

export async function removeTempDir(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

/** 寫入檔案並自動建立所需目錄。 */
export async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

export interface IndexFile {
  path: string;
  assumeUnchanged?: boolean;
  skipWorktree?: boolean;
}

/** 組出一份 .git/index 的位元組內容，只填解析器會讀的欄位（stat 與物件 ID 全留 0）。 */
export function buildGitIndex(files: IndexFile[], options: { version?: number; oidLength?: number } = {}): Buffer {
  const version = options.version ?? 2;
  const oidLength = options.oidLength ?? 20;

  const header = Buffer.alloc(12);
  header.write('DIRC', 0, 'latin1');
  header.writeUInt32BE(version, 4);
  header.writeUInt32BE(files.length, 8);

  const chunks = [header];
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    // skip-worktree 放在擴充旗標裡，只有版本 3 起、且該筆標了 extended 才有這兩個位元組。
    const extended = version >= 3 && (file.skipWorktree ?? false);
    const fixedBytes = 40 + oidLength + (extended ? 4 : 2);

    const entry = Buffer.alloc((fixedBytes + name.length + 8) & ~7);
    let flags = Math.min(name.length, 0x0fff);
    if (file.assumeUnchanged) {
      flags |= 0x8000;
    }
    if (extended) {
      flags |= 0x4000;
      entry.writeUInt16BE(0x4000, 42 + oidLength);
    }
    entry.writeUInt16BE(flags, 40 + oidLength);
    name.copy(entry, fixedBytes);
    chunks.push(entry);
  }

  return Buffer.concat(chunks);
}
