// 面板測試與 plugin check 共用的假資料。
import type { LoadResult } from '../protocol'

const workspace = { id: 'ws-1', name: 'demo', path: '/work/demo', branch: 'main', kind: 'worktree' as const }

export function sampleLoad(overrides: Partial<NonNullable<LoadResult['repo']>> = {}): LoadResult {
  return {
    scope: 'project',
    workspace,
    openFile: null,
    remoteWebUrl: 'https://github.com/acme/demo.git',
    readAt: 1_700_000_000_000,
    repo: {
      repoRoot: '/work/demo',
      gitDir: '/work/demo/.git',
      branch: 'main',
      detached: false,
      headSha: '0123456789abcdef0123456789abcdef01234567',
      recentBranches: ['feature/login'],
      remotes: [{ name: 'origin', url: 'git@github.com:acme/demo.git' }],
      upstream: { remote: 'origin', branch: 'main' },
      stashCount: 1,
      configGroups: [{ title: 'core', entries: [{ key: 'filemode', value: 'true' }], hasInclude: false }],
      activity: {
        recentCommits: [{ sha: 'abcdef0123456789abcdef0123456789abcdef01', message: 'feat: 登入頁', author: 'jerry', at: 1_700_000_000_000 }],
        commitsLast7Days: 3,
        commitsLast30Days: 12,
        lastActivityAt: 1_700_000_000_000,
        authors: ['jerry'],
        truncated: false
      },
      scale: { branchCount: 4, tagCount: 2, packBytes: 2048, looseObjectCount: 7, lastGitOperationAt: 1_700_000_000_000 },
      project: { name: 'demo', version: '1.0.0', description: 'A demo repo.', source: 'package.json', license: 'MIT' },
      readme: { path: '/work/demo/README.md', fileName: 'README.md', title: 'demo', body: 'A demo repo.' },
      environment: { submodules: [], worktrees: [], hooks: ['pre-commit'], lfs: false, workflows: [] },
      ignore: {
        changes: [{ path: 'config/local.php', assumeUnchanged: false, skipWorktree: true }],
        totalChanges: 1,
        indexUnreadable: false,
        excludePath: '/work/demo/.git/info/exclude',
        excludeExists: true,
        excludeLines: ['# local', '*.log']
      },
      activeFile: null,
      warnings: [],
      ...overrides
    }
  }
}
