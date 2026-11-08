import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';

import { isMacBundlePath } from '../../src/core/os/macBundle';

describe('isMacBundlePath', () => {
  test('bundle 副檔名的資料夾', () => {
    assert.equal(isMacBundlePath('/tmp/evil.app'), true);
    assert.equal(isMacBundlePath('/tmp/Evil.APP'), true);
    assert.equal(isMacBundlePath('/tmp/evil.app/'), true);
    assert.equal(isMacBundlePath('/tmp/x.prefPane'), true);
    assert.equal(isMacBundlePath('/tmp/x.workflow'), true);
  });

  test('一般 repo 資料夾，含帶點的名稱', () => {
    assert.equal(isMacBundlePath('/Users/me/projects/fork-ext'), false);
    assert.equal(isMacBundlePath('/Users/me/projects/vue.js'), false);
    assert.equal(isMacBundlePath('/Users/me/projects/example.com'), false);
    assert.equal(isMacBundlePath('/Users/me/app'), false);
    assert.equal(isMacBundlePath('/Users/me/my.apps'), false);
  });
});
