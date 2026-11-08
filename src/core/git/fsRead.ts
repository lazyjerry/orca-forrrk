import { constants as fsConstants, promises as fs } from 'node:fs';

// 讀檔一律「讀不到就回 null」：面板寧可少一張卡片，也不要因為一份檔案不存在就整個掛掉。

export async function readTextFile(target: string): Promise<string | null> {
  try {
    return await fs.readFile(target, 'utf8');
  } catch {
    return null;
  }
}

/** 工作樹裡的小文字檔（README、宣告檔、.gitattributes…）最多讀這麼多。 */
export const WORKTREE_TEXT_MAX_BYTES = 1024 * 1024;

/**
 * 讀工作樹裡的文字檔。這些檔案的內容由 repo 決定：symlink 可能指向 /dev/zero 或 repo 外的檔案，
 * FIFO 一開就卡住，所以只收一般檔案，且只讀前 maxBytes 位元組。
 */
export async function readWorktreeTextFile(
  target: string,
  maxBytes: number = WORKTREE_TEXT_MAX_BYTES,
): Promise<string | null> {
  let handle;
  try {
    if (!(await fs.lstat(target)).isFile()) {
      return null;
    }
    // lstat 與 open 之間檔案可能被換掉：O_NOFOLLOW 擋 symlink，O_NONBLOCK 讓換成 FIFO 時不會卡在 open。
    // Windows 沒有這兩個旗標，值是 undefined。
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
    handle = await fs.open(target, flags);
  } catch {
    return null;
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      return null;
    }
    const length = Math.min(stat.size, maxBytes);
    if (length === 0) {
      return '';
    }
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

export interface FileTail {
  text: string;
  /** 檔案比 maxBytes 大，讀到的只是尾段。 */
  truncated: boolean;
}

export async function readFileTail(target: string, maxBytes: number): Promise<FileTail | null> {
  let handle;
  try {
    handle = await fs.open(target, 'r');
  } catch {
    return null;
  }

  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    if (length === 0) {
      return { text: '', truncated: false };
    }
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    return { text: buffer.toString('utf8'), truncated: stat.size > maxBytes };
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** 目錄項目；讀不到目錄回空陣列。 */
export async function listDirectory(target: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  } catch {
    return [];
  }
}

export async function fileSize(target: string): Promise<number> {
  try {
    return (await fs.stat(target)).size;
  } catch {
    return 0;
  }
}

export async function modifiedAt(target: string): Promise<number | null> {
  try {
    return (await fs.stat(target)).mtimeMs;
  } catch {
    return null;
  }
}

/** 二進位讀檔（.git/index 是 binary，不能用 utf8 讀）。 */
export async function readBinaryFile(target: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(target);
  } catch {
    return null;
  }
}
