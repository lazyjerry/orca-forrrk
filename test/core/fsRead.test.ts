import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readWorktreeTextFile, WORKTREE_TEXT_MAX_BYTES } from '../../src/core/git/fsRead';
import { makeTempDir, removeTempDir, writeFile } from './helpers';

describe('readWorktreeTextFile', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });

  afterEach(async () => {
    await removeTempDir(root);
  });

  test('一般檔案照常讀出完整內容', async () => {
    await writeFile(root, 'README.md', '# 標題\n\n內容\n');
    assert.equal(await readWorktreeTextFile(path.join(root, 'README.md')), '# 標題\n\n內容\n');
  });

  test('空檔回空字串、不存在回 null', async () => {
    await writeFile(root, 'empty', '');
    assert.equal(await readWorktreeTextFile(path.join(root, 'empty')), '');
    assert.equal(await readWorktreeTextFile(path.join(root, 'missing')), null);
  });

  test('只讀前 maxBytes 位元組', async () => {
    await writeFile(root, 'big.txt', 'a'.repeat(5000));
    assert.equal(await readWorktreeTextFile(path.join(root, 'big.txt'), 100), 'a'.repeat(100));
  });

  test('預設上限大於 README 摘要讀取的 64 KB（以 4 位元組字元計）', () => {
    assert.ok(WORKTREE_TEXT_MAX_BYTES >= 64 * 1024 * 4);
  });

  test('拒絕 symlink，不論指向一般檔案或 /dev/zero', async () => {
    await writeFile(root, 'real.md', '真檔案\n');
    await fs.symlink(path.join(root, 'real.md'), path.join(root, 'link.md'));
    assert.equal(await readWorktreeTextFile(path.join(root, 'link.md')), null);

    if (process.platform !== 'win32') {
      await fs.symlink('/dev/zero', path.join(root, 'zero.md'));
      assert.equal(await readWorktreeTextFile(path.join(root, 'zero.md')), null);
    }
  });

  test('拒絕目錄與 FIFO，不會卡住', async () => {
    await fs.mkdir(path.join(root, 'dir'));
    assert.equal(await readWorktreeTextFile(path.join(root, 'dir')), null);

    if (process.platform === 'win32') {
      return;
    }
    execFileSync('mkfifo', [path.join(root, 'fifo')]);
    assert.equal(await readWorktreeTextFile(path.join(root, 'fifo')), null);
  });
});
