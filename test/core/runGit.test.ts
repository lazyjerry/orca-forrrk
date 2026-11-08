import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runGit } from '../../src/core/git/runGit';
import { makeTempDir, removeTempDir, writeFile } from './helpers';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

describe('runGit', () => {
  let scratch: string;
  let repo: string;
  let marker: string;

  beforeEach(async () => {
    scratch = await makeTempDir();
    repo = path.join(scratch, 'repo');
    await fs.mkdir(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'test');
    await writeFile(repo, 'a.txt', 'line1\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'init');

    marker = path.join(scratch, 'fsmonitor-ran');
    const hook = path.join(scratch, 'fsmonitor.sh');
    await fs.writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    git(repo, 'config', 'core.fsmonitor', hook);
    // 工作樹有修改時 update-index 才會去問 fsmonitor
    await writeFile(repo, 'a.txt', 'line1\nchanged\n');
  });

  afterEach(async () => {
    await removeTempDir(scratch);
  });

  async function markerExists(): Promise<boolean> {
    return fs.access(marker).then(
      () => true,
      () => false,
    );
  }

  function flagOf(file: string): string {
    return git(repo, '-c', 'core.fsmonitor=false', 'ls-files', '-v', '--', file).slice(0, 1);
  }

  test('對照組：直接跑 git update-index 會執行 repo 設定的 core.fsmonitor', async () => {
    git(repo, 'update-index', '--skip-worktree', '--', 'a.txt');
    assert.ok(await markerExists(), '測試前提不成立：這版 git 沒有觸發 fsmonitor');
  });

  test('update-index 不執行 core.fsmonitor，旗標照常寫入與清除', async () => {
    await runGit(['-C', repo, 'update-index', '--skip-worktree', '--', 'a.txt'], { timeout: 10_000 });
    assert.equal(flagOf('a.txt'), 'S');

    await runGit(['-C', repo, 'update-index', '--no-skip-worktree', '--', 'a.txt'], { timeout: 10_000 });
    await runGit(['-C', repo, 'update-index', '--no-assume-unchanged', '--', 'a.txt'], { timeout: 10_000 });
    assert.equal(flagOf('a.txt'), 'H');

    assert.equal(await markerExists(), false, 'core.fsmonitor 被執行了');
  });

  test('git 失敗時照樣拋錯給呼叫端', async () => {
    await assert.rejects(runGit(['-C', repo, 'update-index', '--skip-worktree', '--', 'missing.txt'], { timeout: 10_000 }));
  });
});
