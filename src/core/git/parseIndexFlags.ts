import type { IgnoredChange } from './types';

// 直接解 .git/index 這份二進位檔，取出被標記 assume-unchanged / skip-worktree 的檔案。
// 這是「不呼叫 git 指令」的前提下唯一拿得到忽略變更清單的地方。
// 格式：12 bytes 表頭（DIRC、版本、筆數），接著每筆 40 bytes 的 stat 欄位、物件 ID、
// 2 bytes 旗標（版本 3 起可再多 2 bytes 擴充旗標）、NUL 結尾的路徑，最後補 NUL 讓整筆長度是 8 的倍數。

const SIGNATURE = 'DIRC';
const HEADER_BYTES = 12;
/** ctime 到 size 這段固定欄位。 */
const STAT_BYTES = 40;
const FLAG_ASSUME_VALID = 0x8000;
const FLAG_EXTENDED = 0x4000;
const FLAG_NAME_MASK = 0x0fff;
const EXTENDED_SKIP_WORKTREE = 0x4000;

export interface ParseIndexOptions {
  /** SHA-1 是 20，SHA-256 儲存庫是 32。 */
  oidLength?: number;
  /** 最多收集幾筆進 entries。 */
  limit?: number;
  /** 這個路徑不論有沒有超過 limit 都要查出旗標。 */
  focusPath?: string | null;
}

export interface IndexFlags {
  /** 被標記的檔案，最多 limit 筆。 */
  entries: IgnoredChange[];
  /** 被標記的總筆數，可能大於 entries 的長度。 */
  total: number;
  /** 表頭不對、版本不支援或內容截斷；此時 entries 一定是空的。 */
  unreadable: boolean;
  /** focusPath 在 index 裡的旗標；沒指定或 index 裡沒有這個路徑時為 null。 */
  focus: IgnoredChange | null;
}

const UNREADABLE: IndexFlags = { entries: [], total: 0, unreadable: true, focus: null };

export function parseIndexFlags(buffer: Buffer, options: ParseIndexOptions = {}): IndexFlags {
  const oidLength = options.oidLength ?? 20;
  const limit = options.limit ?? Number.MAX_SAFE_INTEGER;
  const focusPath = options.focusPath ?? null;

  if (buffer.length < HEADER_BYTES || buffer.toString('latin1', 0, 4) !== SIGNATURE) {
    return UNREADABLE;
  }
  // 版本 4 把路徑名做了前綴壓縮，跟 2／3 是兩種讀法；不支援就老實回報讀不到，不要猜。
  const version = buffer.readUInt32BE(4);
  if (version !== 2 && version !== 3) {
    return UNREADABLE;
  }

  const count = buffer.readUInt32BE(8);
  const entries: IgnoredChange[] = [];
  let total = 0;
  let focus: IgnoredChange | null = null;
  let offset = HEADER_BYTES;

  for (let index = 0; index < count; index += 1) {
    const flagsOffset = offset + STAT_BYTES + oidLength;
    if (flagsOffset + 2 > buffer.length) {
      return UNREADABLE;
    }
    const flags = buffer.readUInt16BE(flagsOffset);
    const extended = (flags & FLAG_EXTENDED) !== 0;
    if (extended && flagsOffset + 4 > buffer.length) {
      return UNREADABLE;
    }
    const extendedFlags = extended ? buffer.readUInt16BE(flagsOffset + 2) : 0;

    const nameOffset = flagsOffset + (extended ? 4 : 2);
    // 名稱長度欄位只有 12 bits，滿格代表「更長，自己找 NUL」。
    let nameLength = flags & FLAG_NAME_MASK;
    if (nameLength === FLAG_NAME_MASK) {
      const terminator = buffer.indexOf(0, nameOffset);
      if (terminator === -1) {
        return UNREADABLE;
      }
      nameLength = terminator - nameOffset;
    }
    if (nameOffset + nameLength > buffer.length) {
      return UNREADABLE;
    }

    const entry: IgnoredChange = {
      path: buffer.toString('utf8', nameOffset, nameOffset + nameLength),
      assumeUnchanged: (flags & FLAG_ASSUME_VALID) !== 0,
      skipWorktree: (extendedFlags & EXTENDED_SKIP_WORKTREE) !== 0,
    };

    if (entry.assumeUnchanged || entry.skipWorktree) {
      total += 1;
      if (entries.length < limit) {
        entries.push(entry);
      }
    }
    if (focusPath !== null && entry.path === focusPath) {
      focus = entry;
    }

    offset += ((nameOffset - offset) + nameLength + 8) & ~7;
  }

  return { entries, total, unreadable: false, focus };
}
