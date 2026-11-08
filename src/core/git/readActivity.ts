import path from 'node:path';

import { readFileTail } from './fsRead';
import type { ActivityInfo, CommitEntry } from './types';

/**
 * reflog 是唯一不用解 commit 物件就能拿到「誰、什麼時候、做了什麼」的地方。
 * 代價是它只記這台機器上的操作：別人推上遠端的提交、clone 之前的歷史都不在裡面。
 */

/** 讀這麼多檔尾就涵蓋得到相當長一段活動紀錄；再往前的統計價值也不高。 */
const REFLOG_TAIL_BYTES = 256 * 1024;
const RECENT_COMMIT_LIMIT = 5;
const AUTHOR_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `<old> <new> <name> <email> <ts> <tz>\t<action>: <message>` */
const REFLOG_LINE = /^([0-9a-f]{40}) ([0-9a-f]{40}) (.*?) <([^>]*)> (\d+) ([+-]\d{4})\t(.*)$/i;

export async function readActivity(gitDir: string, now = Date.now()): Promise<ActivityInfo> {
  const empty: ActivityInfo = {
    recentCommits: [],
    commitsLast7Days: 0,
    commitsLast30Days: 0,
    lastActivityAt: null,
    authors: [],
    truncated: false,
  };

  const tail = await readFileTail(path.join(gitDir, 'logs', 'HEAD'), REFLOG_TAIL_BYTES);
  if (!tail) {
    return empty;
  }

  const lines = tail.text.split('\n');
  // 從檔案中段截斷時第一行只有半截，會解析失敗，先丟掉省得誤判。
  if (tail.truncated) {
    lines.shift();
  }

  const recentCommits: CommitEntry[] = [];
  const authors: string[] = [];
  let commitsLast7Days = 0;
  let commitsLast30Days = 0;
  let lastActivityAt: number | null = null;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = REFLOG_LINE.exec(lines[index]);
    if (!match) {
      continue;
    }

    const [, , newSha, author, , seconds, , action] = match;
    const at = Number(seconds) * 1000;
    if (lastActivityAt === null) {
      lastActivityAt = at;
    }
    if (authors.length < AUTHOR_LIMIT && author && !authors.includes(author)) {
      authors.push(author);
    }

    // amend 與 initial 也是提交：`commit (amend): …`、`commit (initial): …`。
    if (!action.startsWith('commit')) {
      continue;
    }
    const age = now - at;
    if (age <= 7 * DAY_MS) {
      commitsLast7Days += 1;
    }
    if (age <= 30 * DAY_MS) {
      commitsLast30Days += 1;
    }
    if (recentCommits.length < RECENT_COMMIT_LIMIT) {
      recentCommits.push({
        sha: newSha.toLowerCase(),
        message: action.slice(action.indexOf(':') + 1).trim(),
        author,
        at,
      });
    }
  }

  return { recentCommits, commitsLast7Days, commitsLast30Days, lastActivityAt, authors, truncated: tail.truncated };
}
