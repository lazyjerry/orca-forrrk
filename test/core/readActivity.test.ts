import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import path from 'node:path';

import { readActivity } from '../../src/core/git/readActivity';
import { makeTempDir, removeTempDir, writeFile } from './helpers';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER_SHA = '00112233445566778899aabbccddeeff00112233';
const NOW = Date.parse('2026-08-27T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('readActivity', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });

  afterEach(async () => {
    await removeTempDir(root);
  });

  function line(action: string, agoDays: number, author = 'lazyjerry'): string {
    const seconds = Math.floor((NOW - agoDays * DAY) / 1000);
    return `${OTHER_SHA} ${SHA} ${author} <${author}@example.com> ${seconds} +0800\t${action}`;
  }

  async function reflog(...lines: string[]): Promise<void> {
    await writeFile(root, path.join('.git', 'logs', 'HEAD'), `${lines.join('\n')}\n`);
  }

  test('取最近提交、7／30 天次數與作者', async () => {
    await reflog(
      line('commit (initial): 開張', 40),
      line('commit: 舊的', 20, 'someone'),
      line('checkout: moving from main to feat/a', 3),
      line('commit: 新的', 2),
      line('commit (amend): 修訊息', 1),
    );

    const activity = await readActivity(path.join(root, '.git'), NOW);

    assert.deepEqual(
      activity.recentCommits.map((commit) => commit.message),
      ['修訊息', '新的', '舊的', '開張'],
    );
    assert.equal(activity.recentCommits[0].author, 'lazyjerry');
    assert.equal(activity.recentCommits[0].sha, SHA);
    assert.equal(activity.commitsLast7Days, 2);
    assert.equal(activity.commitsLast30Days, 3);
    assert.deepEqual(activity.authors, ['lazyjerry', 'someone']);
    assert.equal(activity.truncated, false);
  });

  test('最後活動時間算的是任何操作，不限提交', async () => {
    await reflog(line('commit: 提交', 5), line('checkout: moving from main to feat/a', 1));

    const activity = await readActivity(path.join(root, '.git'), NOW);

    assert.equal(activity.lastActivityAt, NOW - DAY);
    assert.equal(activity.commitsLast7Days, 1);
  });

  test('沒有 reflog 時回空統計，不拋例外', async () => {
    const activity = await readActivity(path.join(root, '.git'), NOW);

    assert.deepEqual(activity.recentCommits, []);
    assert.equal(activity.lastActivityAt, null);
    assert.deepEqual(activity.authors, []);
  });
});
