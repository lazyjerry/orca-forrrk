import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';

import { parseGitConfig } from '../../src/core/git/parseConfig';

describe('parseGitConfig', () => {
  test('解析基本 section 與 key', () => {
    const entries = parseGitConfig('[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n');
    assert.deepEqual(entries, [
      { section: 'core', subsection: undefined, key: 'repositoryformatversion', value: '0' },
      { section: 'core', subsection: undefined, key: 'filemode', value: 'true' },
    ]);
  });

  test('保留 subsection 原本大小寫，section 轉小寫', () => {
    const entries = parseGitConfig('[Remote "OriGin"]\n\turl = https://example.com/a.git\n');
    assert.equal(entries[0].section, 'remote');
    assert.equal(entries[0].subsection, 'OriGin');
  });

  // 舊式語法的 subsection 只允許英數、點與減號，所以含 / 的分支名一定要用引號形式。
  test('舊式 [section.subsection] 也能拆開', () => {
    const entries = parseGitConfig('[branch.release-2]\n\tremote = origin\n');
    assert.equal(entries[0].section, 'branch');
    assert.equal(entries[0].subsection, 'release-2');
  });

  test('沒有等號的裸鍵視為布林 true', () => {
    const entries = parseGitConfig('[core]\n\tbare\n');
    assert.deepEqual(entries, [{ section: 'core', subsection: undefined, key: 'bare', value: 'true' }]);
  });

  test('修掉註解，但引號內的 # 與 ; 保留', () => {
    const entries = parseGitConfig('[user]\n\tname = Jerry # 註解\n\tsignature = "a#b;c"\n');
    assert.equal(entries[0].value, 'Jerry');
    assert.equal(entries[1].value, 'a#b;c');
  });

  test('處理逸出字元', () => {
    const entries = parseGitConfig('[alias]\n\tlg = "log --pretty=\\"%h\\"\\n"\n');
    assert.equal(entries[0].value, 'log --pretty="%h"\n');
  });

  test('反斜線結尾的值會續接下一行', () => {
    const entries = parseGitConfig('[alias]\n\tst = status \\\n--short\n');
    assert.equal(entries[0].value, 'status --short');
  });

  test('引號內的尾端空白會保留，引號外的修掉', () => {
    const entries = parseGitConfig('[user]\n\ta = plain   \n\tb = "  padded  "\n');
    assert.equal(entries[0].value, 'plain');
    assert.equal(entries[1].value, '  padded  ');
  });

  test('重複的 key 全部保留', () => {
    const entries = parseGitConfig('[remote "origin"]\n\tfetch = +a\n\tfetch = +b\n');
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((entry) => entry.value),
      ['+a', '+b'],
    );
  });

  test('section 之前出現的 key 直接忽略', () => {
    assert.deepEqual(parseGitConfig('stray = 1\n[core]\n\tbare = false\n').length, 1);
  });

  test('整行註解與空行忽略', () => {
    const entries = parseGitConfig('# 標題\n; 另一種註解\n\n[core]\n\tbare = false\n');
    assert.equal(entries.length, 1);
  });
});
