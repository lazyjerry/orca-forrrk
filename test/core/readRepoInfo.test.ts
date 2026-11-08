import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import path from 'node:path';

import { readRepoInfo } from '../../src/core/git/readRepoInfo';
import { makeTempDir, removeTempDir, writeFile } from './helpers';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER_SHA = '00112233445566778899aabbccddeeff00112233';

describe('readRepoInfo', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });

  afterEach(async () => {
    await removeTempDir(root);
  });

  function location() {
    return { repoRoot: root, gitDir: path.join(root, '.git') };
  }

  async function git(relativePath: string, content: string): Promise<void> {
    await writeFile(root, path.join('.git', relativePath), content);
  }

  test('讀出分支、SHA、遠端與 upstream', async () => {
    await git('HEAD', 'ref: refs/heads/main\n');
    await git(path.join('refs', 'heads', 'main'), `${SHA}\n`);
    await git(
      'config',
      [
        '[core]',
        '\tbare = false',
        '[remote "origin"]',
        '\turl = https://example.com/a.git',
        '\tpushurl = git@example.com:a.git',
        '[branch "main"]',
        '\tremote = origin',
        '\tmerge = refs/heads/main',
        '',
      ].join('\n'),
    );

    const info = await readRepoInfo(location());

    assert.equal(info.branch, 'main');
    assert.equal(info.detached, false);
    assert.equal(info.headSha, SHA);
    assert.deepEqual(info.remotes, [
      { name: 'origin', url: 'https://example.com/a.git', pushUrl: 'git@example.com:a.git' },
    ]);
    assert.deepEqual(info.upstream, { remote: 'origin', branch: 'main' });
    assert.deepEqual(info.warnings, []);
  });

  test('detached HEAD 直接從 HEAD 取 SHA', async () => {
    await git('HEAD', `${SHA}\n`);
    await git('config', '[core]\n\tbare = false\n');

    const info = await readRepoInfo(location());

    assert.equal(info.detached, true);
    assert.equal(info.branch, null);
    assert.equal(info.headSha, SHA);
    assert.equal(info.upstream, null);
  });

  test('鬆散 ref 不存在時改查 packed-refs', async () => {
    await git('HEAD', 'ref: refs/heads/main\n');
    await git('packed-refs', ['# pack-refs with: peeled fully-peeled sorted', `${SHA} refs/heads/main`, ''].join('\n'));
    await git('config', '');

    assert.equal((await readRepoInfo(location())).headSha, SHA);
  });

  test('packed-refs 的 ^ 解參考行不會被誤認', async () => {
    await git('HEAD', 'ref: refs/heads/main\n');
    await git(
      'packed-refs',
      [`${OTHER_SHA} refs/tags/v1`, `^${SHA}`, `${SHA} refs/heads/main`, ''].join('\n'),
    );
    await git('config', '');

    assert.equal((await readRepoInfo(location())).headSha, SHA);
  });

  test('reflog 取出最近切換過的分支，去重且排除目前分支', async () => {
    await git('HEAD', 'ref: refs/heads/main\n');
    await git('config', '');
    await git(
      path.join('logs', 'HEAD'),
      [
        reflogLine('checkout: moving from main to feat/a'),
        reflogLine('checkout: moving from feat/a to feat/b'),
        reflogLine('commit: 做點事'),
        reflogLine('checkout: moving from feat/b to feat/a'),
        reflogLine('checkout: moving from feat/a to main'),
        '',
      ].join('\n'),
    );

    assert.deepEqual((await readRepoInfo(location())).recentBranches, ['feat/a', 'feat/b']);
  });

  test('reflog 中 detached 的 SHA 不算分支', async () => {
    await git('HEAD', 'ref: refs/heads/main\n');
    await git('config', '');
    await git(
      path.join('logs', 'HEAD'),
      [reflogLine(`checkout: moving from ${SHA} to main`), ''].join('\n'),
    );

    assert.deepEqual((await readRepoInfo(location())).recentBranches, []);
  });

  test('reflog 超過 64KB 時只讀檔尾，且丟掉被截半的首行', async () => {
    await git('HEAD', 'ref: refs/heads/main\n');
    await git('config', '');

    const filler = Array.from({ length: 900 }, () => reflogLine('commit: 填充'));
    const lines = [
      reflogLine('checkout: moving from main to too-old'),
      ...filler,
      reflogLine('checkout: moving from recent to main'),
      '',
    ];
    await git(path.join('logs', 'HEAD'), lines.join('\n'));

    const info = await readRepoInfo(location());
    assert.deepEqual(info.recentBranches, ['recent']);
  });

  test('stash 筆數以 logs/refs/stash 的行數計，檔案不存在為 0', async () => {
    await git('HEAD', 'ref: refs/heads/main\n');
    await git('config', '');
    assert.equal((await readRepoInfo(location())).stashCount, 0);

    await git(path.join('logs', 'refs', 'stash'), [reflogLine('WIP a'), reflogLine('WIP b'), ''].join('\n'));
    assert.equal((await readRepoInfo(location())).stashCount, 2);
  });

  test('其他設定排除 remote 與 branch，並標示未展開的 include', async () => {
    await git('HEAD', 'ref: refs/heads/main\n');
    await git('config', ['[core]', '\tbare = false', '[remote "origin"]', '\turl = x', '[include]', '\tpath = ../shared', ''].join('\n'));

    const groups = (await readRepoInfo(location())).configGroups;

    assert.deepEqual(
      groups.map((group) => group.title),
      ['core', 'include'],
    );
    assert.equal(groups[1].hasInclude, true);
  });

  test('worktree 的 config 走 commondir，HEAD 走自己的目錄', async () => {
    const mainGitDir = path.join(root, '.git');
    const worktreeGitDir = path.join(mainGitDir, 'worktrees', 'wt');

    await git('config', '[remote "origin"]\n\turl = https://example.com/a.git\n');
    await writeFile(root, path.join('.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/wt\n');
    await writeFile(root, path.join('.git', 'worktrees', 'wt', 'commondir'), '../..\n');
    await writeFile(root, path.join('.git', 'refs', 'heads', 'wt'), `${SHA}\n`);

    const info = await readRepoInfo({ repoRoot: path.join(root, 'wt'), gitDir: worktreeGitDir });

    assert.equal(info.branch, 'wt');
    assert.equal(info.headSha, SHA);
    assert.equal(info.remotes[0]?.url, 'https://example.com/a.git');
  });

  test('缺少 HEAD 與 config 時降級成 warning，不拋例外', async () => {
    await git('placeholder', '');

    const info = await readRepoInfo(location());

    assert.equal(info.branch, null);
    assert.deepEqual(info.remotes, []);
    assert.equal(info.warnings.length, 2);
  });
});

/** 造一行合乎 reflog 格式的紀錄：<old> <new> <name> <email> <ts> <tz>\t<message> */
function reflogLine(message: string): string {
  return `${OTHER_SHA} ${SHA} Jerry <jerry@example.com> 1700000000 +0800\t${message}`;
}
