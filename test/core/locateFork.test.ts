import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';

import { locateFork } from '../../src/core/fork/locateFork';

describe('locateFork', () => {
  test('PATH 中找得到 fork 時回傳 ready', async () => {
    const result = await locateFork({
      platform: 'darwin',
      env: { PATH: '/opt/bin:/usr/local/bin' },
      isExecutable: async (target) => target === '/usr/local/bin/fork',
      exists: async () => true,
    });

    assert.deepEqual(result, { kind: 'ready', cliPath: '/usr/local/bin/fork' });
  });

  test('App 在但連 bundle 內的執行檔都不可執行時回傳 appOnly', async () => {
    const result = await locateFork({
      platform: 'darwin',
      env: { PATH: '/usr/local/bin' },
      isExecutable: async () => false,
      exists: async (target) => target === '/Applications/Fork.app',
    });

    assert.deepEqual(result, { kind: 'appOnly', appPath: '/Applications/Fork.app' });
  });

  test('也會找使用者目錄下的 Fork.app', async () => {
    const result = await locateFork({
      platform: 'darwin',
      env: { PATH: '' },
      homeDir: '/Users/someone',
      isExecutable: async () => false,
      exists: async (target) => target === '/Users/someone/Applications/Fork.app',
    });

    assert.deepEqual(result, { kind: 'appOnly', appPath: '/Users/someone/Applications/Fork.app' });
  });

  test('都找不到時回傳 missing', async () => {
    const result = await locateFork({
      platform: 'darwin',
      env: { PATH: '/usr/local/bin' },
      isExecutable: async () => false,
      exists: async () => false,
    });

    assert.deepEqual(result, { kind: 'missing' });
  });

  test('Windows 用分號切 PATH 並找 fork.exe', async () => {
    const result = await locateFork({
      platform: 'win32',
      env: { PATH: 'C:\\tools;C:\\Program Files\\Fork' },
      isExecutable: async (target) => target === 'C:\\tools\\fork.exe',
      exists: async () => false,
    });

    assert.deepEqual(result, { kind: 'ready', cliPath: 'C:\\tools\\fork.exe' });
  });

  test('Linux 直接判定為不支援，不做任何檔案檢查', async () => {
    const result = await locateFork({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      isExecutable: async () => assert.fail('不該檢查檔案'),
      exists: async () => assert.fail('不該檢查檔案'),
    });

    assert.deepEqual(result, { kind: 'unsupportedPlatform', platform: 'linux' });
  });

  test('PATH 沒有 /usr/local/bin 時仍找得到官方安裝的 symlink', async () => {
    const result = await locateFork({
      platform: 'darwin',
      // VS Code 從 Dock 啟動時 extension host 實際拿到的 PATH。
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      isExecutable: async (target) => target === '/usr/local/bin/fork',
      exists: async () => assert.fail('PATH 保底就該命中，不必再找 App'),
    });

    assert.deepEqual(result, { kind: 'ready', cliPath: '/usr/local/bin/fork' });
  });

  test('symlink 不存在時改用 App bundle 內的執行檔', async () => {
    const result = await locateFork({
      platform: 'darwin',
      env: { PATH: '/usr/bin:/bin' },
      isExecutable: async (target) => target === '/Applications/Fork.app/Contents/Resources/fork_cli',
      exists: async (target) => target === '/Applications/Fork.app',
    });

    assert.deepEqual(result, {
      kind: 'ready',
      cliPath: '/Applications/Fork.app/Contents/Resources/fork_cli',
    });
  });

  test('使用者目錄下的 Fork.app 同樣適用 bundle 內執行檔', async () => {
    const result = await locateFork({
      platform: 'darwin',
      env: { PATH: '' },
      homeDir: '/Users/someone',
      isExecutable: async (target) =>
        target === '/Users/someone/Applications/Fork.app/Contents/Resources/fork_cli',
      exists: async (target) => target === '/Users/someone/Applications/Fork.app',
    });

    assert.deepEqual(result, {
      kind: 'ready',
      cliPath: '/Users/someone/Applications/Fork.app/Contents/Resources/fork_cli',
    });
  });

  test('Windows 不套用 /usr/local/bin 保底，也不找 bundle 內執行檔', async () => {
    const checked: string[] = [];
    const result = await locateFork({
      platform: 'win32',
      env: { PATH: 'C:\\tools', ProgramFiles: 'C:\\Program Files' },
      isExecutable: async (target) => {
        checked.push(target);
        return false;
      },
      exists: async (target) => target === 'C:\\Program Files\\Fork\\Fork.exe',
    });

    assert.deepEqual(result, { kind: 'appOnly', appPath: 'C:\\Program Files\\Fork\\Fork.exe' });
    assert.ok(!checked.some((target) => target.includes('/usr/local/bin')));
  });
});
