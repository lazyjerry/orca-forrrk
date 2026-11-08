import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import path from 'node:path';

import { readScale } from '../../src/core/git/readScale';
import { makeTempDir, removeTempDir, writeFile } from './helpers';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('readScale', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });

  afterEach(async () => {
    await removeTempDir(root);
  });

  async function git(relativePath: string, content: string): Promise<void> {
    await writeFile(root, path.join('.git', relativePath), content);
  }

  test('鬆散 ref 與 packed-refs 的分支、標籤一起計算', async () => {
    await git(path.join('refs', 'heads', 'main'), `${SHA}\n`);
    await git(path.join('refs', 'heads', 'feat', 'nested'), `${SHA}\n`);
    await git(path.join('refs', 'tags', 'v1.0.0'), `${SHA}\n`);
    await git(
      'packed-refs',
      ['# pack-refs with: peeled fully-peeled sorted', `${SHA} refs/heads/packed`, `${SHA} refs/tags/v0.9.0`, `^${SHA}`].join(
        '\n',
      ),
    );

    const scale = await readScale(path.join(root, '.git'), path.join(root, '.git'));

    assert.equal(scale.branchCount, 3);
    assert.equal(scale.tagCount, 2);
  });

  test('物件庫只算 packfile 大小與鬆散物件個數', async () => {
    await git(path.join('objects', 'pack', 'pack-1.pack'), 'x'.repeat(500));
    await git(path.join('objects', 'pack', 'pack-1.idx'), 'x'.repeat(900));
    await git(path.join('objects', 'ab', '1111111111111111111111111111111111111'), 'z');
    await git(path.join('objects', 'cd', '2222222222222222222222222222222222222'), 'z');
    await git('index', 'binary-ish');

    const scale = await readScale(path.join(root, '.git'), path.join(root, '.git'));

    assert.equal(scale.packBytes, 500);
    assert.equal(scale.looseObjectCount, 2);
    assert.ok(scale.lastGitOperationAt !== null);
  });

  test('空的 .git 也給得出零，不拋例外', async () => {
    const scale = await readScale(path.join(root, '.git'), path.join(root, '.git'));

    assert.deepEqual(
      { ...scale, lastGitOperationAt: null },
      { branchCount: 0, tagCount: 0, packBytes: 0, looseObjectCount: 0, lastGitOperationAt: null },
    );
  });
});
