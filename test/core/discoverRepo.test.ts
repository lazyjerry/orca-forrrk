import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import path from 'node:path';

import { discoverRepo } from '../../src/core/git/discoverRepo';
import { makeTempDir, removeTempDir, writeFile } from './helpers';

describe('discoverRepo', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });

  afterEach(async () => {
    await removeTempDir(root);
  });

  test('從 repo 內的深層檔案往上找得到 .git', async () => {
    await writeFile(root, path.join('.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(root, path.join('src', 'deep', 'file.ts'), '');

    const found = await discoverRepo(path.join(root, 'src', 'deep', 'file.ts'));
    assert.deepEqual(found, { repoRoot: root, gitDir: path.join(root, '.git') });
  });

  test('.git 是檔案時依 gitdir: 指向解析（worktree / submodule）', async () => {
    const realGitDir = path.join(root, 'store', 'modules', 'sub');
    await writeFile(root, path.join('store', 'modules', 'sub', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(root, path.join('work', '.git'), `gitdir: ${path.relative(path.join(root, 'work'), realGitDir)}\n`);

    const found = await discoverRepo(path.join(root, 'work'));
    assert.deepEqual(found, { repoRoot: path.join(root, 'work'), gitDir: realGitDir });
  });

  test('gitdir: 也接受絕對路徑', async () => {
    const realGitDir = path.join(root, 'elsewhere');
    await writeFile(root, path.join('elsewhere', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(root, path.join('work', '.git'), `gitdir: ${realGitDir}\n`);

    const found = await discoverRepo(path.join(root, 'work'));
    assert.equal(found?.gitDir, realGitDir);
  });

  test('找不到 .git 時回傳 null', async () => {
    await writeFile(root, path.join('plain', 'file.txt'), '');
    // 暫存目錄本身不在任何 repo 底下，往上找到根也不會命中。
    assert.equal(await discoverRepo(path.join(root, 'plain')), null);
  });

  test('起點是不存在的路徑時，改從它的所在目錄往上找', async () => {
    await writeFile(root, path.join('.git', 'HEAD'), 'ref: refs/heads/main\n');

    const found = await discoverRepo(path.join(root, 'not-created-yet.ts'));
    assert.equal(found?.repoRoot, root);
  });
});
