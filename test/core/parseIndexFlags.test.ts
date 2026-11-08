import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';

import { parseIndexFlags } from '../../src/core/git/parseIndexFlags';
import { buildGitIndex } from './helpers';

describe('parseIndexFlags', () => {
  test('只有被標記的檔案進清單，沒標記的整批跳過', () => {
    const buffer = buildGitIndex(
      [
        { path: 'src/a.ts' },
        { path: 'config/local.json', skipWorktree: true },
        { path: 'README.md' },
        { path: 'secrets.env', assumeUnchanged: true },
      ],
      { version: 3 },
    );

    const flags = parseIndexFlags(buffer);

    assert.equal(flags.unreadable, false);
    assert.equal(flags.total, 2);
    assert.deepEqual(flags.entries, [
      { path: 'config/local.json', assumeUnchanged: false, skipWorktree: true },
      { path: 'secrets.env', assumeUnchanged: true, skipWorktree: false },
    ]);
  });

  test('沒有任何標記時清單是空的，但不算讀不到', () => {
    const flags = parseIndexFlags(buildGitIndex([{ path: 'a.ts' }, { path: 'b.ts' }]));

    assert.deepEqual(flags, { entries: [], total: 0, unreadable: false, focus: null });
  });

  test('超過 limit 只收前面幾筆，total 仍是全部', () => {
    const files = Array.from({ length: 5 }, (_, index) => ({ path: `pkg/${index}.json`, skipWorktree: true }));

    const flags = parseIndexFlags(buildGitIndex(files, { version: 3 }), { limit: 2 });

    assert.deepEqual(
      flags.entries.map((entry) => entry.path),
      ['pkg/0.json', 'pkg/1.json'],
    );
    assert.equal(flags.total, 5);
  });

  test('focusPath 就算排在 limit 之外也查得到旗標', () => {
    const files = [
      ...Array.from({ length: 3 }, (_, index) => ({ path: `a/${index}.ts`, skipWorktree: true })),
      { path: 'z/target.ts', assumeUnchanged: true },
    ];

    const flags = parseIndexFlags(buildGitIndex(files, { version: 3 }), { limit: 1, focusPath: 'z/target.ts' });

    assert.deepEqual(flags.focus, { path: 'z/target.ts', assumeUnchanged: true, skipWorktree: false });
  });

  test('index 裡沒有這個路徑時 focus 是 null', () => {
    const flags = parseIndexFlags(buildGitIndex([{ path: 'a.ts' }]), { focusPath: 'b.ts' });

    assert.equal(flags.focus, null);
  });

  test('名稱長度欄位滿格時改用 NUL 找結尾，後面的項目仍讀得到', () => {
    const longPath = `${'d/'.repeat(2100)}file.ts`;
    const buffer = buildGitIndex([{ path: longPath, skipWorktree: true }, { path: 'tail.ts', skipWorktree: true }], {
      version: 3,
    });

    const flags = parseIndexFlags(buffer);

    assert.ok(longPath.length > 0x0fff);
    assert.deepEqual(
      flags.entries.map((entry) => entry.path),
      [longPath, 'tail.ts'],
    );
  });

  test('SHA-256 儲存庫的物件 ID 是 32 bytes，長度給對才解得開', () => {
    const buffer = buildGitIndex([{ path: 'a.ts', skipWorktree: true }], { version: 3, oidLength: 32 });

    assert.deepEqual(parseIndexFlags(buffer, { oidLength: 32 }).entries, [
      { path: 'a.ts', assumeUnchanged: false, skipWorktree: true },
    ]);
  });

  test('簽章不對、版本不支援、內容截斷都回報讀不到', () => {
    const version4 = buildGitIndex([{ path: 'a.ts' }], { version: 4 });
    const truncated = buildGitIndex([{ path: 'a.ts', skipWorktree: true }], { version: 3 }).subarray(0, 30);

    assert.equal(parseIndexFlags(Buffer.from('NOPE0000....')).unreadable, true);
    assert.equal(parseIndexFlags(version4).unreadable, true);
    assert.equal(parseIndexFlags(truncated).unreadable, true);
  });
});
