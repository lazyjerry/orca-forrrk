import { afterEach, beforeEach, describe, test } from 'orca/testing';
import * as assert from 'node:assert/strict';

import { pickPrimaryRemote, toRemoteWebUrl } from '../../src/core/git/remoteWebUrl';
import type { RemoteInfo, UpstreamInfo } from '../../src/core/git/types';

describe('toRemoteWebUrl', () => {
  test('scp 形式改寫成 https，路徑原封不動交給對方跳轉', () => {
    assert.equal(toRemoteWebUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo.git');
    assert.equal(toRemoteWebUrl('github.com:owner/repo'), 'https://github.com/owner/repo');
  });

  test('ssh 與 git 協定改成 https，ssh 的埠號去掉', () => {
    assert.equal(toRemoteWebUrl('ssh://git@github.com/owner/repo.git'), 'https://github.com/owner/repo.git');
    assert.equal(toRemoteWebUrl('ssh://git@ssh.example.com:2222/owner/repo.git'), 'https://ssh.example.com/owner/repo.git');
    assert.equal(toRemoteWebUrl('git://example.com/owner/repo.git'), 'https://example.com/owner/repo.git');
  });

  test('http(s) 原樣保留，但去掉帶在網址上的憑證', () => {
    assert.equal(toRemoteWebUrl('https://gitlab.com/group/sub/repo.git'), 'https://gitlab.com/group/sub/repo.git');
    assert.equal(toRemoteWebUrl('http://example.com:8080/repo.git'), 'http://example.com:8080/repo.git');
    assert.equal(toRemoteWebUrl('https://user:token@github.com/owner/repo.git'), 'https://github.com/owner/repo.git');
  });

  test('開不成網頁的來源回傳 null', () => {
    assert.equal(toRemoteWebUrl(undefined), null);
    assert.equal(toRemoteWebUrl('   '), null);
    assert.equal(toRemoteWebUrl('/srv/git/repo.git'), null);
    assert.equal(toRemoteWebUrl('../sibling/repo'), null);
    assert.equal(toRemoteWebUrl('file:///srv/git/repo.git'), null);
  });
});

describe('pickPrimaryRemote', () => {
  const remote = (name: string, url?: string): RemoteInfo => ({ name, url });
  const upstream = (name: string): UpstreamInfo => ({ remote: name, branch: 'main' });

  test('優先目前分支追蹤的遠端', () => {
    const picked = pickPrimaryRemote({
      remotes: [remote('origin', 'git@github.com:owner/fork.git'), remote('upstream', 'git@github.com:org/repo.git')],
      upstream: upstream('upstream'),
    });
    assert.equal(picked?.name, 'upstream');
  });

  test('沒有追蹤設定時退回 origin，再退回第一個能開的', () => {
    const remotes = [remote('backup', 'git@example.com:a.git'), remote('origin', 'git@github.com:owner/repo.git')];
    assert.equal(pickPrimaryRemote({ remotes, upstream: null })?.name, 'origin');
    assert.equal(pickPrimaryRemote({ remotes: [remotes[0]], upstream: null })?.name, 'backup');
  });

  test('開不成網頁的遠端不列入候選，全都不能開時回傳 null', () => {
    const picked = pickPrimaryRemote({
      remotes: [remote('origin', '/srv/git/repo.git'), remote('web', 'https://github.com/owner/repo.git')],
      upstream: upstream('origin'),
    });
    assert.equal(picked?.name, 'web');
    assert.equal(pickPrimaryRemote({ remotes: [remote('origin', '/srv/git/repo.git')], upstream: null }), null);
    assert.equal(pickPrimaryRemote({ remotes: [], upstream: null }), null);
  });
});
