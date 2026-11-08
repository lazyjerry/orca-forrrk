import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readProjectIdentity, readReadme } from '../../src/core/project/readProject';
import { makeTempDir, removeTempDir, writeFile } from './helpers';

describe('readProject', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });

  afterEach(async () => {
    await removeTempDir(root);
  });

  test('package.json 的名稱、版本、描述與授權', async () => {
    await writeFile(
      root,
      'package.json',
      JSON.stringify({ name: 'forrrk', version: '0.1.3', description: '面板', license: 'Apache-2.0' }),
    );

    const identity = await readProjectIdentity(root);

    assert.deepEqual(identity, {
      name: 'forrrk',
      version: '0.1.3',
      description: '面板',
      source: 'package.json',
      license: 'Apache-2.0',
    });
  });

  test('沒有 license 欄位時退回讀 LICENSE 檔首行', async () => {
    await writeFile(root, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(root, 'LICENSE', '\nApache License 2.0\n\n全文…');

    const identity = await readProjectIdentity(root);

    assert.equal(identity?.license, 'Apache License 2.0');
  });

  test('pyproject.toml 用正則抓欄位，不需要 TOML 解析器', async () => {
    await writeFile(root, 'pyproject.toml', '[project]\nname = "tool"\nversion = "1.2.0"\ndescription = "說明"\n');

    const identity = await readProjectIdentity(root);

    assert.equal(identity?.name, 'tool');
    assert.equal(identity?.version, '1.2.0');
    assert.equal(identity?.source, 'pyproject.toml');
  });

  test('什麼宣告檔都沒有時回 null', async () => {
    assert.equal(await readProjectIdentity(root), null);
  });

  test('README 取首個標題與第一段敘述，跳過徽章', async () => {
    await writeFile(
      root,
      'README.md',
      ['# forrrk', '', '[![build](https://img.shields.io/x)](https://example.com)', '', '在 VS Code 底部面板顯示 **git** 資訊。', '', '## 功能'].join(
        '\n',
      ),
    );

    const readme = await readReadme(root);

    assert.equal(readme?.title, 'forrrk');
    assert.equal(readme?.body, '在 VS Code 底部面板顯示 git 資訊。');
    assert.equal(readme?.fileName, 'README.md');
    assert.equal(readme?.path, path.join(root, 'README.md'));
  });

  test('沒有 README 時回 null', async () => {
    assert.equal(await readReadme(root), null);
  });

  test('README 是 symlink 時不跟隨（指向 /dev/zero 不會整份讀入）', async () => {
    if (process.platform === 'win32') {
      return;
    }
    await fs.symlink('/dev/zero', path.join(root, 'README.md'));
    assert.equal(await readReadme(root), null);
  });

  test('大 README 仍取得標題與首段', async () => {
    await writeFile(root, 'README.md', ['# 大檔', '', '第一段。', '', 'x'.repeat(2 * 1024 * 1024)].join('\n'));

    const readme = await readReadme(root);

    assert.equal(readme?.title, '大檔');
    assert.equal(readme?.body, '第一段。');
  });

  test('宣告檔與 LICENSE 是 symlink 時略過', async () => {
    if (process.platform === 'win32') {
      return;
    }
    await writeFile(root, 'outside.json', JSON.stringify({ name: 'secret' }));
    await fs.symlink(path.join(root, 'outside.json'), path.join(root, 'package.json'));
    await fs.symlink('/dev/zero', path.join(root, 'LICENSE'));

    assert.equal(await readProjectIdentity(root), null);
  });
});
