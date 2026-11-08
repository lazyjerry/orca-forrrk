import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';

import { fileScopeArgs, otherStagedPaths } from '../../src/core/gitAutoPush/fileScope';

describe('fileScope', () => {
  test('暫存區只有目標檔或是空的時，沒有其他檔案', () => {
    assert.deepEqual(otherStagedPaths('', 'src/a.ts'), []);
    assert.deepEqual(otherStagedPaths('src/a.ts\0', 'src/a.ts'), []);
  });

  test('暫存區有目標檔以外的檔案時列出來', () => {
    assert.deepEqual(otherStagedPaths('README.md\0src/a.ts\0src/b.ts\0', 'src/a.ts'), ['README.md', 'src/b.ts']);
  });

  test('一般路徑原樣交給 -f，"-" 開頭的補 ./ 免得被當成旗標', () => {
    assert.deepEqual(fileScopeArgs('src/a b.ts'), ['-a', '-f', 'src/a b.ts']);
    assert.deepEqual(fileScopeArgs('-draft.md'), ['-a', '-f', './-draft.md']);
  });
});
