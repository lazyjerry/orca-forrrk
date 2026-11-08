import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';

import { locateGitAutoPush } from '../../src/core/gitAutoPush/locateGitAutoPush';

describe('locateGitAutoPush', () => {
  test('PATH 中找得到時回傳 ready', async () => {
    const result = await locateGitAutoPush({
      platform: 'darwin',
      env: { PATH: '/opt/bin:/usr/local/bin' },
      isExecutable: async (target) => target === '/opt/bin/git-auto-push',
    });

    assert.deepEqual(result, { kind: 'ready', cliPath: '/opt/bin/git-auto-push' });
  });

  test('PATH 沒有時仍會找 ~/.local/bin（install.sh 預設位置）', async () => {
    const result = await locateGitAutoPush({
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      homeDir: '/Users/someone',
      isExecutable: async (target) => target === '/Users/someone/.local/bin/git-auto-push',
    });

    assert.deepEqual(result, { kind: 'ready', cliPath: '/Users/someone/.local/bin/git-auto-push' });
  });

  test('也會找 /usr/local/bin（--global 安裝位置）', async () => {
    const result = await locateGitAutoPush({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      isExecutable: async (target) => target === '/usr/local/bin/git-auto-push',
    });

    assert.deepEqual(result, { kind: 'ready', cliPath: '/usr/local/bin/git-auto-push' });
  });

  test('都找不到時回傳 missing', async () => {
    const result = await locateGitAutoPush({
      platform: 'darwin',
      env: { PATH: '/usr/local/bin' },
      homeDir: '/Users/someone',
      isExecutable: async () => false,
    });

    assert.deepEqual(result, { kind: 'missing' });
  });

  test('Windows 直接判定為不支援，不做任何檔案檢查', async () => {
    const result = await locateGitAutoPush({
      platform: 'win32',
      env: { PATH: 'C:\\tools' },
      isExecutable: async () => assert.fail('不該檢查檔案'),
    });

    assert.deepEqual(result, { kind: 'unsupportedPlatform', platform: 'win32' });
  });
});
