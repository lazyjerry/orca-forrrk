import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readEnvironment } from '../../src/core/git/readEnvironment';
import { makeTempDir, removeTempDir, writeFile } from './helpers';

describe('readEnvironment', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });

  afterEach(async () => {
    await removeTempDir(root);
  });

  test('讀出子模組、worktree、已安裝 hook、LFS 與 CI', async () => {
    await writeFile(root, '.gitmodules', '[submodule "docs"]\n\tpath = docs\n\turl = https://example.com/docs.git\n');
    await writeFile(root, path.join('.git', 'worktrees', 'feature', 'HEAD'), 'ref: refs/heads/feature\n');
    await writeFile(root, path.join('.git', 'hooks', 'pre-commit'), '#!/bin/sh\n');
    await writeFile(root, path.join('.git', 'hooks', 'pre-push.sample'), '#!/bin/sh\n');
    await writeFile(root, '.gitattributes', '*.psd filter=lfs diff=lfs merge=lfs -text\n');
    await writeFile(root, path.join('.github', 'workflows', 'ci.yml'), 'name: ci\n');
    await writeFile(root, path.join('.github', 'workflows', 'notes.md'), '不是 workflow\n');

    const environment = await readEnvironment(root, path.join(root, '.git'));

    assert.deepEqual(environment, {
      submodules: ['docs'],
      worktrees: ['feature'],
      hooks: ['pre-commit'],
      lfs: true,
      workflows: ['ci.yml'],
    });
  });

  test('什麼都沒有時每一項都是空的', async () => {
    const environment = await readEnvironment(root, path.join(root, '.git'));

    assert.deepEqual(environment, { submodules: [], worktrees: [], hooks: [], lfs: false, workflows: [] });
  });

  test('.gitmodules 與 .gitattributes 是 symlink 時不跟隨', async () => {
    if (process.platform === 'win32') {
      return;
    }
    await writeFile(root, 'real-modules', '[submodule "docs"]\n\tpath = docs\n');
    await writeFile(root, 'real-attributes', '*.psd filter=lfs\n');
    await fs.symlink(path.join(root, 'real-modules'), path.join(root, '.gitmodules'));
    await fs.symlink(path.join(root, 'real-attributes'), path.join(root, '.gitattributes'));

    const environment = await readEnvironment(root, path.join(root, '.git'));

    assert.deepEqual(environment.submodules, []);
    assert.equal(environment.lfs, false);
  });
});
