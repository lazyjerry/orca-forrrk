import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';

import { matchExclude, parseExcludeRules } from '../../src/core/git/excludeMatch';

function excludedBy(text: string, relativePath: string): string | null {
  return matchExclude(relativePath, parseExcludeRules(text));
}

describe('excludeMatch', () => {
  test('註解與空行不算規則', () => {
    assert.deepEqual(parseExcludeRules('# 註解\n\n   \n*.log\n').map((rule) => rule.line), ['*.log']);
  });

  test('不含斜線的樣式比對任何一層的檔名', () => {
    assert.equal(excludedBy('*.log', 'a/b/debug.log'), '*.log');
    assert.equal(excludedBy('*.log', 'debug.log'), '*.log');
    assert.equal(excludedBy('*.log', 'debug.log.txt'), null);
  });

  test('開頭有斜線只認根層，中間有斜線從根算起', () => {
    assert.equal(excludedBy('/build', 'build'), '/build');
    assert.equal(excludedBy('/build', 'src/build'), null);
    assert.equal(excludedBy('src/tmp.txt', 'src/tmp.txt'), 'src/tmp.txt');
    assert.equal(excludedBy('src/tmp.txt', 'lib/src/tmp.txt'), null);
  });

  test('結尾斜線只匹配目錄，底下的檔案跟著被排除', () => {
    assert.equal(excludedBy('build/', 'a/build/out.js'), 'build/');
    assert.equal(excludedBy('build/', 'build'), null);
  });

  test('** 可以跨目錄，a/**/b 也匹配 a/b', () => {
    assert.equal(excludedBy('docs/**/tmp', 'docs/tmp'), 'docs/**/tmp');
    assert.equal(excludedBy('docs/**/tmp', 'docs/a/b/tmp'), 'docs/**/tmp');
    assert.equal(excludedBy('docs/*/tmp', 'docs/a/b/tmp'), null);
  });

  test('後面的規則蓋前面的，! 反向等於沒被排除', () => {
    const rules = '*.log\n!keep.log\n';

    assert.equal(excludedBy(rules, 'debug.log'), '*.log');
    assert.equal(excludedBy(rules, 'keep.log'), null);
  });

  test('? 只吃一個字元且不跨目錄', () => {
    assert.equal(excludedBy('a?.txt', 'ab.txt'), 'a?.txt');
    assert.equal(excludedBy('a?.txt', 'abc.txt'), null);
  });
});
