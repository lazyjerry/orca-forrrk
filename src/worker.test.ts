import { promises as fs } from 'node:fs'
import path from 'node:path'

import { afterEach, assert, beforeEach, describe, mockHost, mountWorker, test } from 'orca/testing'

import { makeTempDir, removeTempDir, writeFile } from '../test/core/helpers'
import { orcaCliCandidates } from './host/actions'
import { matchSessionWorkspace, orcaUserDataDir, parseFileId, parseWorkspaceSession } from './host/orcaSession'
import { matchFocused } from './host/workspaces'
import * as main from './worker'

const CAPABILITIES = ['workspace:read', 'workspace:write', 'terminal:send']

/** 只放 readRepoInfo 會讀的最小 .git：HEAD、config、info/exclude。 */
async function makeRepo(root: string): Promise<void> {
  await writeFile(root, '.git/HEAD', 'ref: refs/heads/main\n')
  await writeFile(root, '.git/config', '[remote "origin"]\n\turl = git@github.com:acme/demo.git\n')
  await writeFile(root, '.git/info/exclude', '# local\n*.log\n')
  await writeFile(root, 'README.md', '# demo\n\nA demo repo.\n')
}

function hostFor(root: string, extra: Record<string, unknown> = {}) {
  return mockHost({
    capabilities: CAPABILITIES,
    results: {
      'workspace.list': {
        truncated: false,
        workspaces: [
          { id: 'ws-local', kind: 'worktree', name: 'demo', path: root, branch: 'main', hostId: 'local' },
          { id: 'ws-ssh', kind: 'worktree', name: 'demo', path: '/srv/demo', branch: 'main', hostId: 'ssh-1' }
        ]
      },
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [] },
      'terminal.create': { terminalId: 't1' },
      'editor.open': { opened: true },
      ...extra
    }
  })
}

describe('matchFocused', () => {
  const a = { id: 'a', name: 'app', path: '/a', branch: 'main', kind: 'worktree' as const }
  const b = { id: 'b', name: 'app', path: '/b', branch: 'feat', kind: 'worktree' as const }
  const folder = { id: 'f', name: 'notes', path: '/n', branch: null, kind: 'folder' as const }

  test('同名時用分支分辨', () => {
    assert.equal(matchFocused({ displayName: 'app', branch: 'feat' }, [a, b])?.id, 'b')
  })
  test('同名同分支對不到唯一一筆就不猜', () => {
    assert.equal(matchFocused({ displayName: 'app', branch: 'main' }, [a, { ...b, branch: 'main' }]), null)
  })
  test('資料夾 workspace 的空字串分支對得到 null 分支', () => {
    const other = { ...folder, id: 'g', branch: 'main' }
    assert.equal(matchFocused({ displayName: 'notes', branch: '' }, [folder, other])?.id, 'f')
  })
})

describe('Orca session', () => {
  test('編輯器分頁 id 解出檔案的絕對路徑', () => {
    const id = `editor:${encodeURIComponent('r1::/work/app')}:local:${encodeURIComponent('/work/app/中文/a.ts')}`
    assert.equal(parseFileId(id, path.posix), '/work/app/中文/a.ts')
    assert.equal(parseFileId('/work/app/b.ts', path.posix), '/work/app/b.ts')
    assert.equal(parseFileId('agent-session:x', path.posix), null)
    assert.equal(parseFileId(null, path.posix), null)
  })

  test('只有作用中分頁是編輯器時才算編輯區開著檔案', () => {
    const base = { activeWorktreeId: 'r1::/work/app', activeFileIdByWorktree: { 'r1::/work/app': '/work/app/a.ts' } }
    const editor = parseWorkspaceSession(JSON.stringify({ ...base, activeTabTypeByWorktree: { 'r1::/work/app': 'editor' } }))
    assert.deepEqual(editor, { workspaceKey: 'r1::/work/app', activeFile: '/work/app/a.ts', editorFocused: true })
    const terminal = parseWorkspaceSession(JSON.stringify({ ...base, activeTabTypeByWorktree: { 'r1::/work/app': 'terminal' } }))
    assert.equal(terminal?.editorFocused, false)
    assert.equal(parseWorkspaceSession('not json'), null)
  })

  test('worktree 用路徑對到 workspace.list，資料夾用 id', () => {
    const a = { id: 'identity:a', name: 'main', path: '/work/a', branch: 'main', kind: 'worktree' as const }
    const b = { id: 'identity:b', name: 'main', path: '/work/b', branch: 'main', kind: 'worktree' as const }
    const folder = { id: 'folder:f1', name: 'notes', path: '/n', branch: null, kind: 'folder' as const }
    assert.equal(matchSessionWorkspace('r2::/work/b', [a, b, folder])?.id, 'identity:b')
    assert.equal(matchSessionWorkspace('folder:f1', [a, b, folder])?.id, 'folder:f1')
    assert.equal(matchSessionWorkspace('r3::/work/c', [a, b, folder]), null)
  })
})

/** 在假的家目錄底下建一份 Orca 的 profile-state.db，只放 workspaceSession。 */
async function writeSession(home: string, session: object): Promise<void> {
  const userData = orcaUserDataDir(process.platform, {}, home)
  await writeFile(userData, 'orca-profile-index.json', JSON.stringify({ activeProfileId: 'p1', profiles: [{ id: 'p1' }] }))
  await fs.mkdir(path.join(userData, 'profiles', 'p1'), { recursive: true })
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path.join(userData, 'profiles', 'p1', 'profile-state.db'))
  db.exec('CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL)')
  db.prepare('INSERT INTO profile_state_documents (domain, payload) VALUES (?, ?)').run('workspaceSession', JSON.stringify(session))
  db.close()
}

describe('worker', () => {
  let root: string
  let home: string
  const savedEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, APPDATA: process.env.APPDATA }

  beforeEach(async () => {
    root = await makeTempDir()
    await makeRepo(root)
    // 換掉家目錄，worker 才不會讀到這台機器上真正的 Orca session。
    home = await makeTempDir()
    process.env.HOME = home
    delete process.env.XDG_CONFIG_HOME
    delete process.env.APPDATA
  })
  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    await removeTempDir(root)
    await removeTempDir(home)
  })

  test('load 讀聚焦的本機 workspace，遠端主機的不列入', async () => {
    const worker = await mountWorker(main, { host: hostFor(root) })
    const result = await worker.request('forrrk.load', {})
    assert.equal(result.workspace?.id, 'ws-local')
    assert.equal(result.scope, 'project')
    assert.equal(result.repo?.branch, 'main')
    assert.equal(result.remoteWebUrl, 'https://github.com/acme/demo.git')
    assert.deepEqual(worker.refusals, [])
  })

  test('load 帶檔案時回報該檔案的 exclude 狀態；跳出 repo 的路徑不採用', async () => {
    const worker = await mountWorker(main, { host: hostFor(root) })
    const inside = await worker.request('forrrk.load', { file: 'debug.log' })
    assert.equal(inside.repo?.activeFile?.excludedBy, '*.log')
    const outside = await worker.request('forrrk.load', { file: '../etc/passwd' })
    assert.equal(outside.repo?.activeFile, null)
  })

  test('setSkipWorktree 對 repo 外的路徑不執行 git', async () => {
    const worker = await mountWorker(main, { host: hostFor(root) })
    const notice = await worker.request('forrrk.setSkipWorktree', { file: '../outside.txt', ignore: true })
    assert.equal(notice.level, 'warn')
    assert.match(notice.message, /不是這個儲存庫內的相對路徑/)
  })

  test('openFile 只開 repo 資訊裡的 README／exclude 路徑', async () => {
    const host = hostFor(root)
    const worker = await mountWorker(main, { host })
    const notice = await worker.request('forrrk.openFile', { target: 'exclude' })
    assert.equal(notice.level, 'info')
    // Orca 只收 workspace 內的相對路徑。
    assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws-local', path: '.git/info/exclude' }])
  })

  test('openFile 遇到 workspace 外的檔案不呼叫 editor.open，改給路徑', async () => {
    const host = hostFor(path.join(root, 'sub'))
    await writeFile(root, 'sub/.keep', '')
    const worker = await mountWorker(main, { host })
    const notice = await worker.request('forrrk.openFile', { target: 'readme' })
    assert.equal(notice.level, 'warn')
    assert.equal(host.callsOf('editor.open').length, 0)
  })

  test('autoPush 在該 workspace 開終端機，先 cd 到 repo 根再跑 -a', async () => {
    // PATH 最前面放一支假的 git-auto-push，偵測結果才不受這台機器有沒有裝影響。
    const bin = path.join(root, 'bin')
    await writeFile(root, 'bin/git-auto-push', '#!/bin/sh\n')
    await fs.chmod(path.join(bin, 'git-auto-push'), 0o755)
    // 假的 orca，切換終端機時才不會打到這台機器真正的 Orca。
    await writeFile(root, 'bin/orca', '#!/bin/sh\n')
    await fs.chmod(path.join(bin, 'orca'), 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const host = hostFor(root)
      const worker = await mountWorker(main, { host })
      const notice = await worker.request('forrrk.autoPush', {})
      assert.equal(notice.level, 'info')
      assert.deepEqual(host.callsOf('terminal.create'), [
        { workspaceId: 'ws-local', title: 'git-auto-push', command: `cd '${root}' && '${path.join(bin, 'git-auto-push')}' '-a'` }
      ])
    } finally {
      process.env.PATH = originalPath
    }
  })

  test('autoPush 開完背景終端機後用 orca CLI 切過去；切不過去就給指令', async () => {
    // 假的 git-auto-push 與 orca 都放在 PATH 最前面；orca 把收到的參數寫進檔案，exit code 由 ORCA_FAKE_EXIT 決定。
    const bin = path.join(root, 'bin')
    const record = path.join(root, 'orca-args.txt')
    await writeFile(root, 'bin/git-auto-push', '#!/bin/sh\n')
    await writeFile(root, 'bin/orca', `#!/bin/sh\necho "$@" > '${record}'\nexit "\${ORCA_FAKE_EXIT:-0}"\n`)
    await fs.chmod(path.join(bin, 'git-auto-push'), 0o755)
    await fs.chmod(path.join(bin, 'orca'), 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const worker = await mountWorker(main, { host: hostFor(root) })
      const ok = await worker.request('forrrk.autoPush', {})
      assert.equal(ok.level, 'info')
      assert.match(ok.message, /並切到該終端機/)
      assert.equal((await fs.readFile(record, 'utf8')).trim(), 'terminal switch --terminal t1 --json')

      process.env.ORCA_FAKE_EXIT = '1'
      const failed = await worker.request('forrrk.autoPush', {})
      assert.equal(failed.level, 'warn')
      assert.equal(failed.command, "orca terminal switch --terminal 't1'")
    } finally {
      process.env.PATH = originalPath
      delete process.env.ORCA_FAKE_EXIT
    }
  })

  test('orca CLI 先找 PATH，再找 worker 所在 Orca.app 自帶的那一支', () => {
    assert.deepEqual(orcaCliCandidates('/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper'), [
      'orca',
      '/Applications/Orca.app/Contents/Resources/bin/orca'
    ])
    assert.deepEqual(orcaCliCandidates('/usr/bin/node'), ['orca'])
  })

  test('沒裝 git-auto-push 時不開終端機，提示安裝指令與 GitHub 位置', async () => {
    // PATH 只留空資料夾、家目錄已換成暫存目錄，~/.local/bin 也找不到。
    const originalPath = process.env.PATH
    process.env.PATH = path.join(home, 'empty-bin')
    try {
      const host = hostFor(root)
      const worker = await mountWorker(main, { host })
      const notice = await worker.request('forrrk.autoPush', {})
      assert.equal(notice.level, 'warn')
      assert.match(notice.message, /找不到 git-auto-push/)
      assert.match(notice.command ?? '', /install\.sh/)
      assert.equal(notice.link?.url, 'https://github.com/lazyjerry/git-auto-push')
      assert.equal(host.callsOf('terminal.create').length, 0)

      const text = await worker.command('forrrk.autoPush')
      assert.match(String(text), /https:\/\/github\.com\/lazyjerry\/git-auto-push/)
    } finally {
      process.env.PATH = originalPath
    }
  })

  test('file 範圍但編輯區沒有開啟的檔案時不動作', async () => {
    const host = hostFor(root)
    const worker = await mountWorker(main, { host })
    const notice = await worker.request('forrrk.openInFork', { scope: 'file' })
    assert.equal(notice.level, 'warn')
    assert.match(notice.message, /沒有開啟的檔案/)
  })

  describe('有 Orca session 時', () => {
    let other: string

    beforeEach(async () => {
      other = await makeTempDir()
    })
    afterEach(async () => {
      await removeTempDir(other)
    })

    /** 兩個專案都叫 main、分支都是 main，只靠名稱＋分支對不出來。 */
    function twinHost() {
      return mockHost({
        capabilities: CAPABILITIES,
        results: {
          'workspace.list': {
            truncated: false,
            workspaces: [
              { id: 'identity:a', kind: 'worktree', name: 'main', path: other, branch: 'main', hostId: 'local' },
              { id: 'identity:b', kind: 'worktree', name: 'main', path: root, branch: 'main', hostId: 'local' }
            ]
          },
          'workspace.readContext': { branch: 'main', displayName: 'main', terminals: [] }
        }
      })
    }

    test('同名同分支的 workspace 用 session 的路徑對出聚焦的那個；沒有 git 時回 null repo', async () => {
      await writeSession(home, { activeWorktreeId: `r-a::${other}` })
      const worker = await mountWorker(main, { host: twinHost() })
      const result = await worker.request('forrrk.load', {})
      assert.equal(result.workspace?.id, 'identity:a')
      assert.equal(result.scope, 'project')
      assert.equal(result.repo, null)
    })

    test('編輯區開著檔案時預設用檔案所在的 repo，也能切回專案', async () => {
      // 檔案在 workspace 裡的另一個 repo（例如子模組），file 範圍要讀它自己的 .git。
      const nested = path.join(root, 'sub')
      await writeFile(nested, '.git/HEAD', 'ref: refs/heads/feat\n')
      await writeFile(nested, '.git/config', '')
      await writeFile(nested, 'x.txt', 'x')
      const key = `r-b::${root}`
      const file = path.join(nested, 'x.txt')
      await writeSession(home, {
        activeWorktreeId: key,
        activeFileIdByWorktree: { [key]: `editor:${encodeURIComponent(key)}:local:${encodeURIComponent(file)}` },
        activeTabTypeByWorktree: { [key]: 'editor' }
      })
      const worker = await mountWorker(main, { host: twinHost() })

      const auto = await worker.request('forrrk.load', {})
      assert.equal(auto.scope, 'file')
      assert.equal(auto.openFile, file)
      assert.equal(auto.repo?.repoRoot, nested)
      assert.equal(auto.repo?.activeFile?.relativePath, 'x.txt')

      const project = await worker.request('forrrk.load', { scope: 'project' })
      assert.equal(project.scope, 'project')
      assert.equal(project.repo?.repoRoot, root)
    })
  })
})
