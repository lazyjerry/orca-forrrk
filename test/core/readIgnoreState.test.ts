import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readIgnoreState } from '../../src/core/git/readIgnoreState';
import { buildGitIndex, makeTempDir, removeTempDir, writeFile } from './helpers';

describe('readIgnoreState', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });

  afterEach(async () => {
    await removeTempDir(root);
  });

  function options(activeFile: string | null) {
    const gitDir = path.join(root, '.git');
    return { repoRoot: root, gitDir, commonDir: gitDir, activeFile, oidLength: 20 };
  }

  async function writeIndex(files: Parameters<typeof buildGitIndex>[0]): Promise<void> {
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.writeFile(path.join(root, '.git', 'index'), buildGitIndex(files, { version: 3 }));
  }

  test('列出忽略變更的檔案與 info/exclude 的原始內容', async () => {
    await writeIndex([{ path: 'src/a.ts' }, { path: 'config/local.json', skipWorktree: true }]);
    await writeFile(root, path.join('.git', 'info', 'exclude'), '# 本機專用\n*.env\n');

    const { ignore } = await readIgnoreState(options(null));

    assert.deepEqual(ignore.changes, [{ path: 'config/local.json', assumeUnchanged: false, skipWorktree: true }]);
    assert.equal(ignore.totalChanges, 1);
    assert.equal(ignore.indexUnreadable, false);
    assert.equal(ignore.excludeExists, true);
    assert.deepEqual(ignore.excludeLines, ['# 本機專用', '*.env']);
  });

  test('作用中的檔案同時被標記與被排除時，兩邊都認得出來', async () => {
    await writeIndex([{ path: 'config/local.json', skipWorktree: true, assumeUnchanged: true }]);
    await writeFile(root, path.join('.git', 'info', 'exclude'), 'config/\n');

    const { activeFile } = await readIgnoreState(options(path.join(root, 'config', 'local.json')));

    assert.deepEqual(activeFile, {
      path: path.join(root, 'config', 'local.json'),
      relativePath: 'config/local.json',
      tracked: true,
      assumeUnchanged: true,
      skipWorktree: true,
      excludedBy: 'config/',
    });
  });

  test('作用中的檔案沒被標記也沒被排除時，欄位全是否', async () => {
    await writeIndex([{ path: 'src/a.ts' }]);
    await writeFile(root, path.join('.git', 'info', 'exclude'), '*.env\n');

    const { activeFile } = await readIgnoreState(options(path.join(root, 'src', 'a.ts')));

    assert.equal(activeFile?.relativePath, 'src/a.ts');
    assert.equal(activeFile?.tracked, true, 'index 裡有這一筆就算有被追蹤，沒有旗標也一樣');
    assert.equal(activeFile?.skipWorktree, false);
    assert.equal(activeFile?.assumeUnchanged, false);
    assert.equal(activeFile?.excludedBy, null);
  });

  test('檔案不在儲存庫底下時相對路徑是 null，不會拿去比對', async () => {
    await writeIndex([{ path: 'a.ts', skipWorktree: true }]);
    await writeFile(root, path.join('.git', 'info', 'exclude'), '*.ts\n');

    const { activeFile } = await readIgnoreState(options(path.join(path.dirname(root), 'elsewhere', 'a.ts')));

    assert.equal(activeFile?.relativePath, null);
    assert.equal(activeFile?.excludedBy, null);
    assert.equal(activeFile?.skipWorktree, false);
  });

  test('index 裡沒有這個路徑就是沒被追蹤', async () => {
    await writeIndex([{ path: 'src/a.ts' }]);

    const { activeFile } = await readIgnoreState(options(path.join(root, 'src', 'new.ts')));

    assert.equal(activeFile?.tracked, false);
  });

  test('沒有 index 與 exclude 時各自降級，不拋例外', async () => {
    const { ignore, activeFile } = await readIgnoreState(options(null));

    assert.equal(ignore.indexUnreadable, true);
    assert.deepEqual(ignore.changes, []);
    assert.equal(ignore.excludeExists, false);
    assert.deepEqual(ignore.excludeLines, []);
    assert.equal(activeFile, null);
  });
});
