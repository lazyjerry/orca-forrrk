import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { decideGitGate, isInsideAnyFolder } from '../../src/core/workspace/workspaceGate';
import { makeTempDir, removeTempDir, writeFile } from './helpers';

describe('isInsideAnyFolder', () => {
  test('資料夾內的檔案、巢狀目錄與資料夾本身', () => {
    assert.equal(isInsideAnyFolder('/ws/a.txt', ['/ws'], path.posix), true);
    assert.equal(isInsideAnyFolder('/ws/src/deep/a.txt', ['/ws'], path.posix), true);
    assert.equal(isInsideAnyFolder('/ws', ['/ws'], path.posix), true);
    assert.equal(isInsideAnyFolder('/ws/..hidden/a.txt', ['/ws'], path.posix), true);
  });

  test('多個資料夾任一符合即可', () => {
    assert.equal(isInsideAnyFolder('/b/a.txt', ['/a', '/b'], path.posix), true);
  });

  test('同前綴的兄弟目錄、上層與外部都不算在內', () => {
    assert.equal(isInsideAnyFolder('/ws-evil/a.txt', ['/ws'], path.posix), false);
    assert.equal(isInsideAnyFolder('/wsx', ['/ws'], path.posix), false);
    assert.equal(isInsideAnyFolder('/a.txt', ['/ws'], path.posix), false);
    assert.equal(isInsideAnyFolder('/ws/a.txt', [], path.posix), false);
  });

  test('Windows 路徑：不同磁碟與同前綴兄弟目錄不算在內', () => {
    assert.equal(isInsideAnyFolder('C:\\ws\\a.txt', ['C:\\ws'], path.win32), true);
    assert.equal(isInsideAnyFolder('D:\\ws\\a.txt', ['C:\\ws'], path.win32), false);
    assert.equal(isInsideAnyFolder('C:\\ws-evil\\a.txt', ['C:\\ws'], path.win32), false);
  });
});

describe('decideGitGate', () => {
  let root: string;
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    root = await fs.realpath(await makeTempDir());
    workspace = path.join(root, 'ws');
    outside = path.join(root, 'outside');
    await writeFile(workspace, 'a.txt', 'in\n');
    await writeFile(outside, 'b.txt', 'out\n');
  });

  afterEach(async () => {
    await removeTempDir(root);
  });

  test('受信任工作區內的檔案允許跑 git', async () => {
    assert.equal(await decideGitGate(path.join(workspace, 'a.txt'), { trusted: true, folders: [workspace] }), 'allowed');
  });

  test('工作區外的檔案不跑 git', async () => {
    assert.equal(await decideGitGate(path.join(outside, 'b.txt'), { trusted: true, folders: [workspace] }), 'outside-workspace');
    assert.equal(await decideGitGate(path.join(workspace, 'a.txt'), { trusted: true, folders: [] }), 'outside-workspace');
  });

  test('未受信任的工作區不跑 git', async () => {
    assert.equal(await decideGitGate(path.join(workspace, 'a.txt'), { trusted: false, folders: [workspace] }), 'untrusted-workspace');
  });

  test('工作區內的 symlink 指向外部時視為外部', async () => {
    await fs.symlink(path.join(outside, 'b.txt'), path.join(workspace, 'link.txt'));
    await fs.symlink(outside, path.join(workspace, 'linked-dir'));
    assert.equal(await decideGitGate(path.join(workspace, 'link.txt'), { trusted: true, folders: [workspace] }), 'outside-workspace');
    assert.equal(
      await decideGitGate(path.join(workspace, 'linked-dir', 'b.txt'), { trusted: true, folders: [workspace] }),
      'outside-workspace',
    );
  });

  test('同前綴的兄弟目錄不算在內', async () => {
    await writeFile(`${workspace}-evil`, 'c.txt', 'x\n');
    assert.equal(
      await decideGitGate(path.join(`${workspace}-evil`, 'c.txt'), { trusted: true, folders: [workspace] }),
      'outside-workspace',
    );
  });

  test('工作區資料夾經 symlink 開啟時仍算在內', async () => {
    const linkedWorkspace = path.join(root, 'linked-ws');
    await fs.symlink(workspace, linkedWorkspace);
    assert.equal(await decideGitGate(path.join(linkedWorkspace, 'a.txt'), { trusted: true, folders: [linkedWorkspace] }), 'allowed');
    assert.equal(await decideGitGate(path.join(workspace, 'a.txt'), { trusted: true, folders: [linkedWorkspace] }), 'allowed');
  });

  test('檔案不存在時視為外部', async () => {
    assert.equal(await decideGitGate(path.join(workspace, 'missing.txt'), { trusted: true, folders: [workspace] }), 'outside-workspace');
  });
});
