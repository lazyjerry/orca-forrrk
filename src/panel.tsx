// forrrk 面板：右側邊欄顯示 workspace 所在 repo 的唯讀 git 資訊。
// 面板不輪詢；按刷新、切換 workspace、編輯區換檔案（worker 通知）或執行完會改狀態的動作才重讀。
import {
  atom,
  Badge,
  Button,
  Callout,
  Box,
  Code,
  CodeView,
  Collapsible,
  EmptyState,
  IconButton,
  Input,
  List,
  ListItem,
  on,
  plugin,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  shell,
  Spinner,
  Stack,
  Text,
  Toolbar,
  type KeyValueItem,
  type OrcaNode,
  type PanelContext
} from 'orca'

import type { ActiveFileStatus, RepoInfo } from './core/git/types'
import { configLabel } from './panel/configLabels'
import { flagNames, formatBytes, middleEllipsis, skipWorktreeConsequence, splitRemoteUrl } from './panel/format'
import type { LoadResult, Notice, Scope } from './protocol'

const PATH_MAX_LENGTH = 48

const data = atom<LoadResult | null>(null)
const loading = atom(false)
const notice = atom<Notice | null>(null)
const confirming = atom<{ file: string; ignore: boolean } | null>(null)
/** 等待確認的 git-auto-push；file 為 null 代表整個 repo（-a）。 */
const pushConfirming = atom<{ file: string | null } | null>(null)
/** 使用者在選單選的範圍；null 表示自動（編輯區開著檔案用 file）。聚焦或作用中檔案一換就回到自動。 */
const scope = atom<Scope | null>(null)
/** project 範圍下要檢查忽略狀態／單檔推送的檔案；file 範圍直接用編輯區的檔案。 */
const targetFile = atom('targetFile', '', { persist: 'workspace' })

/** 動作跟著畫面上顯示的範圍走，不另外重新判斷。 */
const workspaceInput = () => ({ scope: read(scope) ?? read(data)?.scope ?? null })
const fileInput = () => read(targetFile).trim() || null

async function reload(): Promise<void> {
  set(loading, true)
  try {
    // 讀取送使用者的選擇（null＝讓 worker 依編輯區自動判斷），不沿用上一次的結果。
    set(data, await plugin.request('forrrk.load', { scope: read(scope), file: fileInput() }))
  } catch (error) {
    set(notice, { level: 'error', message: `讀取失敗（${error instanceof Error ? error.message : String(error)}）` })
  } finally {
    set(loading, false)
  }
}

async function act(run: () => Promise<Notice>, refreshAfter = false): Promise<void> {
  try {
    set(notice, await run())
  } catch (error) {
    set(notice, { level: 'error', message: `執行失敗（${error instanceof Error ? error.message : String(error)}）` })
  }
  if (refreshAfter) {
    await reload()
  }
}

const openInFork = () => act(() => plugin.request('forrrk.openInFork', workspaceInput()))
const openFolder = () => act(() => plugin.request('forrrk.openFolder', workspaceInput()))
const autoPush = () => set(pushConfirming, { file: null })
const openFile = (target: 'readme' | 'exclude') => act(() => plugin.request('forrrk.openFile', { ...workspaceInput(), target }))

function autoPushFile(): void {
  const fileScope = read(data)?.scope === 'file'
  const file = fileScope ? (read(data)?.repo?.activeFile?.relativePath ?? null) : fileInput()
  if (!file) {
    set(notice, {
      level: 'warn',
      message: fileScope ? '編輯區開啟的檔案不在這個儲存庫裡。' : '先在「忽略變更」卡片填入要推送的檔案（repo 內相對路徑）。'
    })
    return
  }
  set(pushConfirming, { file })
}

async function openRemote(): Promise<void> {
  const url = read(data)?.remoteWebUrl
  if (!url) {
    const repo = read(data)?.repo
    set(notice, {
      level: 'warn',
      message: !repo
        ? '這裡不是 git 儲存庫。'
        : repo.remotes.length === 0
          ? '這個儲存庫沒有設定遠端。'
          : '遠端網址不是網頁位址（本機路徑或 file://），沒有可開啟的網頁。'
    })
    return
  }
  await shell.openExternal(url)
}

async function confirmSkipWorktree(): Promise<void> {
  const pending = read(confirming)
  set(confirming, null)
  if (pending) {
    await act(() => plugin.request('forrrk.setSkipWorktree', { ...workspaceInput(), ...pending }), true)
  }
}

/** git-auto-push -a 是全自動模式，不會再提問，所以按鈕先確認，確認後才送給 worker。 */
async function confirmAutoPush(): Promise<void> {
  const pending = read(pushConfirming)
  set(pushConfirming, null)
  if (pending) {
    await act(() => plugin.request('forrrk.autoPush', pending.file ? { ...workspaceInput(), file: pending.file } : workspaceInput()))
  }
}

/** 聚焦的 workspace 或作用中檔案換了：回到自動範圍再重讀。 */
function followFocus(): void {
  set(scope, null)
  // 確認框說的是舊的 repo，目標換了就收掉，免得確認後推到另一個 repo。
  set(pushConfirming, null)
  void reload()
}

export function setup(ctx: PanelContext): void {
  let lastFocus: string | null = null
  ctx.subscriptions.push(
    on('workspace.changed', ({ context }) => {
      // 終端機開關也會觸發，只在聚焦的 workspace 換了才重讀。第一次是訂閱時的現況，不重讀。
      const focus = context ? `${context.displayName}\0${context.branch}` : ''
      const changed = lastFocus !== null && focus !== lastFocus
      lastFocus = focus
      if (changed) {
        followFocus()
      }
    }),
    // 編輯區換檔案沒有外掛事件，由 worker 監看 Orca 的 session 後通知。
    plugin.on('forrrk.focusChanged', followFocus)
  )
  void reload()
}

export default function Panel() {
  const result = read(data)
  const repo = result?.repo ?? null

  return (
    <Stack gap="md">
      {/* 靠右、縮小：跟 Orca 頂端的分頁列同大小又靠左時，看起來像另一排分頁 */}
      <Row justify="end">
        <Toolbar label="forrrk 操作" gap="none">
          <IconButton icon="refresh" label="刷新" tooltip="重新定位儲存庫並讀取資訊" size="xs" onPress={reload} />
          <IconButton icon="file" label="Push 目前檔案" tooltip="只對目前檔案執行 git-auto-push -a -f，不動其他變更" size="xs" onPress={autoPushFile} />
          <IconButton icon="upload" label="Auto Push" tooltip="在 Orca 終端機執行 git-auto-push -a" size="xs" onPress={autoPush} />
          <IconButton icon="folder" label="開啟資料夾" tooltip="在檔案管理員開啟儲存庫根目錄" size="xs" onPress={openFolder} />
          <IconButton icon="globe" label="開啟遠端網頁" tooltip="用瀏覽器開啟遠端儲存庫" size="xs" onPress={openRemote} />
          <IconButton icon="branch" label="在 Fork 中開啟" tooltip="執行 fork -C <repo> open" size="xs" variant="outline" tone="accent" onPress={openInFork} />
        </Toolbar>
      </Row>

      <ScopePicker result={result} />
      <NoticeView />
      <ConfirmView />
      <PushConfirmView />

      {read(loading) && !result ? <Spinner label="讀取中…" /> : null}
      {result && !repo ? <NotARepo result={result} /> : null}
      {repo ? <RepoView repo={repo} /> : null}
    </Stack>
  )
}

const baseName = (file: string) => file.split(/[\\/]/).pop() ?? file

/** 只有兩個範圍：聚焦的專案／資料夾，或編輯區開啟的檔案。 */
function ScopePicker({ result }: { result: LoadResult | null }) {
  const current = read(scope) ?? result?.scope ?? 'project'
  const options = [
    { value: 'project', label: result?.workspace ? `當前專案／資料夾（${result.workspace.name}）` : '當前專案／資料夾' },
    { value: 'file', label: result?.openFile ? `當前開啟檔案（${baseName(result.openFile)}）` : '當前開啟檔案' }
  ]
  const where = current === 'file' ? (result?.openFile ?? null) : (result?.repo?.repoRoot ?? result?.workspace?.path ?? null)

  return (
    <Stack gap="xs">
      <Select
        label="範圍"
        labelHidden
        value={current}
        options={options}
        onChange={(value) => {
          set(scope, value === 'file' ? 'file' : 'project')
          void reload()
        }}
      />
      <Row gap="xs" wrap>
        <Text muted size="xs" truncate>
          {where ? middleEllipsis(where, PATH_MAX_LENGTH) : current === 'file' ? '編輯區沒有開啟的檔案' : '對不到目前的 workspace'}
        </Text>
        {read(loading) ? (
          <Text muted size="xs">讀取中…</Text>
        ) : result ? (
          <Text muted size="xs">
            讀取於 <RelativeTime at={result.readAt} format="short" />
          </Text>
        ) : null}
      </Row>
    </Stack>
  )
}

function NoticeView() {
  const current = read(notice)
  if (!current) {
    return null
  }
  const tone = current.level === 'error' ? 'danger' : current.level === 'warn' ? 'warning' : 'success'
  return (
    <Callout tone={tone} title={current.message}>
      <Stack gap="xs">
        {current.detail ? <Text size="sm">{current.detail}</Text> : null}
        {current.command ? <Code block>{current.command}</Code> : null}
        <Row gap="xs">
          {current.link ? (
            <Button size="sm" variant="outline" icon="open-external" onPress={() => shell.openExternal(current.link!.url)}>
              {current.link.label}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onPress={() => set(notice, null)}>
            關閉
          </Button>
        </Row>
      </Stack>
    </Callout>
  )
}

function ConfirmView() {
  const pending = read(confirming)
  if (!pending) {
    return null
  }
  const action = pending.ignore ? '取消追蹤變更' : '恢復追蹤變更'
  return (
    <Callout tone="warning" title={`要對 ${pending.file} ${action}嗎？`}>
      <Stack gap="xs">
        <Code block>{skipWorktreeConsequence(pending.file, pending.ignore)}</Code>
        <Row gap="xs">
          <Button size="sm" tone="warning" variant="solid" onPress={confirmSkipWorktree}>
            {`確認${action}`}
          </Button>
          <Button size="sm" variant="ghost" onPress={() => set(confirming, null)}>
            取消
          </Button>
        </Row>
      </Stack>
    </Callout>
  )
}

function PushConfirmView() {
  const pending = read(pushConfirming)
  if (!pending) {
    return null
  }
  const repoRoot = read(data)?.repo?.repoRoot ?? null
  return (
    <Callout tone="warning" title={pending.file ? `要只推送 ${pending.file} 嗎？` : '要執行 Auto Push 嗎？'}>
      <Stack gap="xs">
        <Text size="sm">
          {pending.file
            ? '全自動模式，不會再提問：只把這個檔案加入、提交並推送到遠端。'
            : '全自動模式，不會再提問：把儲存庫裡所有變更加入、提交並推送到遠端。'}
        </Text>
        {repoRoot ? <Code block>{repoRoot}</Code> : null}
        <Row gap="xs">
          <Button size="sm" tone="warning" variant="solid" onPress={confirmAutoPush}>
            {pending.file ? '確認推送此檔案' : '確認 Auto Push'}
          </Button>
          <Button size="sm" variant="ghost" onPress={() => set(pushConfirming, null)}>
            取消
          </Button>
        </Row>
      </Stack>
    </Callout>
  )
}

function NotARepo({ result }: { result: LoadResult }) {
  if (!result.workspace) {
    return (
      <EmptyState
        icon="info"
        title="對不到目前的 workspace"
        description="請在 Orca 左側選一個本機的專案或資料夾；遠端主機上的 workspace 讀不到 .git。"
      />
    )
  }
  if (result.scope === 'file') {
    return result.openFile ? (
      <EmptyState icon="info" title="這個檔案所在的資料夾沒有 git" description={result.openFile} />
    ) : (
      <EmptyState icon="info" title="編輯區沒有開啟的檔案" description="在編輯區開啟檔案後會自動切換；或改選「當前專案／資料夾」。" />
    )
  }
  return <EmptyState icon="info" title="這個資料夾沒有 git" description={result.workspace.path} />
}

function RepoView({ repo }: { repo: RepoInfo }) {
  return (
    <Stack gap="md">
      {repo.warnings.map((warning) => (
        <Callout tone="warning">{warning}</Callout>
      ))}
      <HeadCard repo={repo} />
      <ProjectCard repo={repo} />
      <ActivityCard repo={repo} />
      <IgnoreCard repo={repo} />
      <ConfigCard repo={repo} />
    </Stack>
  )
}

/** HEAD 與遠端同一張卡：upstream 的「追蹤 main」講的就是上面那個分支。 */
function HeadCard({ repo }: { repo: RepoInfo }) {
  return (
    <Section title="HEAD" description="目前狀態與遠端">
      <Stack gap="sm">
        <Row gap="xs" wrap>
          {repo.detached ? (
            <Badge tone="warning">detached HEAD</Badge>
          ) : repo.branch ? (
            <Badge tone="accent">{repo.branch}</Badge>
          ) : (
            <Badge>無法判斷分支</Badge>
          )}
          {repo.headSha ? <Code>{repo.headSha.slice(0, 7)}</Code> : null}
          {repo.stashCount > 0 ? <Badge>{`stash ${repo.stashCount}`}</Badge> : null}
        </Row>
        {repo.recentBranches.length > 0 ? (
          <Text size="sm" muted>
            {`最近切換：${repo.recentBranches.join(' · ')}`}
          </Text>
        ) : null}
        {repo.remotes.length === 0 ? (
          <Text size="sm" muted>
            未設定遠端
          </Text>
        ) : (
          repo.remotes.map((remote) => {
            const { host, path } = splitRemoteUrl(remote.url)
            const tracking = repo.upstream && repo.upstream.remote === remote.name ? `（↳ 追蹤 ${repo.upstream.branch}）` : ''
            const items: KeyValueItem[] = []
            if (host) {
              items.push({ label: '網域 Host', value: host })
            }
            items.push({ label: '路徑 Path', value: path, code: true })
            if (remote.pushUrl && remote.pushUrl !== remote.url) {
              items.push({ label: 'Push URL', value: remote.pushUrl, code: true })
            }
            return <FieldList label={`${remote.name}${tracking}`} items={items} />
          })
        )}
      </Stack>
    </Section>
  )
}

function ProjectCard({ repo }: { repo: RepoInfo }) {
  const { project, scale, readme } = repo
  const { submodules, worktrees, hooks, lfs, workflows } = repo.environment
  const items: KeyValueItem[] = []
  if (project?.license) {
    items.push({ label: '授權 License', value: project.license })
  }
  items.push({ label: '分支數 Branches', value: scale.branchCount })
  items.push({ label: '標籤數 Tags', value: scale.tagCount })
  items.push({ label: '物件庫 Objects', value: `${formatBytes(scale.packBytes)}（鬆散物件 ${scale.looseObjectCount}）` })
  items.push({
    label: '上次操作 Last git activity',
    value: scale.lastGitOperationAt === null ? '未知' : new Date(scale.lastGitOperationAt).toLocaleString()
  })
  if (submodules.length > 0) items.push({ label: '子模組 Submodules', value: submodules.join('、') })
  if (worktrees.length > 0) items.push({ label: '連結工作樹 Worktrees', value: worktrees.join('、') })
  if (hooks.length > 0) items.push({ label: '已安裝 hook', value: hooks.join('、') })
  if (lfs) items.push({ label: 'Git LFS', value: '已啟用', tone: 'success' })
  if (workflows.length > 0) items.push({ label: 'CI 流程 Workflows', value: workflows.join('、') })

  return (
    <Section title="專案" description="Project">
      <Stack gap="sm">
        {project?.name ? (
          <Text weight="semibold">{project.version ? `${project.name} ${project.version}` : project.name}</Text>
        ) : null}
        {project?.description ? <Text size="sm">{project.description}</Text> : null}
        <FieldList items={items} />
        {!project ? (
          <Text size="xs" muted>
            沒有找到 package.json 之類的專案宣告檔
          </Text>
        ) : null}
        {readme ? (
          <Collapsible title={`README（${readme.fileName}）`} defaultOpen>
            <Stack gap="xs">
              {/* README 的首個標題多半就是專案名，同一張卡裡不重複。 */}
              {readme.title && readme.title !== project?.name ? <Text weight="medium">{readme.title}</Text> : null}
              <Text size="sm" muted={!readme.body}>
                {readme.body || '找不到可摘要的段落'}
              </Text>
              <Button size="sm" variant="outline" icon="file-text" onPress={() => openFile('readme')}>
                {`開啟 ${readme.fileName}`}
              </Button>
            </Stack>
          </Collapsible>
        ) : null}
      </Stack>
    </Section>
  )
}

function ActivityCard({ repo }: { repo: RepoInfo }) {
  const { activity } = repo
  return (
    <Section title="最近提交" description="Recent commits（來源為 reflog）">
      <Stack gap="sm">
        {activity.recentCommits.length === 0 ? (
          <Text size="sm" muted>
            reflog 裡沒有這台機器上的提交紀錄
          </Text>
        ) : (
          <List label="最近提交">
            {activity.recentCommits.map((commit) => (
              <ListItem title={commit.message || '（無訊息）'}>
                <Text size="xs" muted>
                  {`${commit.author} · ${commit.sha.slice(0, 7)} · `}
                  <RelativeTime at={commit.at} format="short" />
                </Text>
              </ListItem>
            ))}
          </List>
        )}
        <FieldList
          items={[
            { label: '近 7 天', value: `${activity.commitsLast7Days} 次提交` },
            { label: '近 30 天', value: `${activity.commitsLast30Days} 次提交` },
            {
              label: '最後活動',
              value: activity.lastActivityAt === null ? '未知' : new Date(activity.lastActivityAt).toLocaleString()
            },
            { label: '作者', value: activity.authors.length > 0 ? activity.authors.join('、') : '未知' }
          ]}
        />
        <Text size="xs" muted>
          {activity.truncated
            ? 'reflog 太長只讀了檔尾，統計僅涵蓋最近一段；且 reflog 只記這台機器上的操作。'
            : 'reflog 只記這台機器上的操作，不含別人推上遠端的提交。'}
        </Text>
      </Stack>
    </Section>
  )
}

/** 忽略變更與 info/exclude 同一張卡：兩者都在回答「git 會不會盯著這個檔案」。 */
function IgnoreCard({ repo }: { repo: RepoInfo }) {
  const { ignore } = repo
  // file 範圍看的是編輯區的檔案，不能另外指定。
  const fileScope = read(data)?.scope === 'file'
  const selected = fileScope ? repo.activeFile?.relativePath : read(targetFile).trim()
  return (
    <Section title="忽略變更" description="Ignored changes">
      <Stack gap="sm">
        {fileScope ? null : (
          <Input
            label="檔案（repo 內相對路徑，Enter 套用）"
            placeholder="例如 config/local.php"
            value={read(targetFile)}
            onChange={(value) => set(targetFile, value)}
            onSubmit={() => void reload()}
          />
        )}
        <ActiveFileView status={repo.activeFile} />

        <Collapsible title={`忽略變更的檔案（${ignore.totalChanges}）`} defaultOpen={ignore.totalChanges > 0}>
          {ignore.indexUnreadable ? (
            <Text size="sm" muted>
              讀不到 .git/index，或它的版本這裡解不開
            </Text>
          ) : ignore.changes.length === 0 ? (
            <Text size="sm" muted>
              沒有被標記忽略變更的檔案
            </Text>
          ) : (
            <Stack gap="xs">
              <List label="忽略變更的檔案">
                {ignore.changes.map((change) => (
                  <ListItem
                    title={middleEllipsis(change.path, PATH_MAX_LENGTH)}
                    description={flagNames(change).join('、')}
                    current={change.path === selected}
                    onPress={
                      fileScope
                        ? undefined
                        : () => {
                            set(targetFile, change.path)
                            void reload()
                          }
                    }
                  />
                ))}
              </List>
              {ignore.changes.length < ignore.totalChanges ? (
                <Text size="xs" muted>
                  {`只列出前 ${ignore.changes.length} 筆，共 ${ignore.totalChanges} 筆`}
                </Text>
              ) : null}
            </Stack>
          )}
        </Collapsible>

        <Collapsible title="info/exclude" defaultOpen={ignore.excludeExists && ignore.excludeLines.length > 0}>
          {!ignore.excludeExists ? (
            <Text size="sm" muted>
              沒有 .git/info/exclude
            </Text>
          ) : (
            <Stack gap="xs">
              {ignore.excludeLines.length === 0 ? (
                <Text size="sm" muted>
                  檔案是空的
                </Text>
              ) : (
                <CodeView label="info/exclude" code={ignore.excludeLines.join('\n')} maxHeight="sm" />
              )}
              {/* 只在檔案真的存在時才給按鈕，不然點了只會跳一個開不了的錯誤。 */}
              <Button size="sm" variant="outline" icon="file-text" onPress={() => openFile('exclude')}>
                開啟 info/exclude
              </Button>
            </Stack>
          )}
        </Collapsible>
      </Stack>
    </Section>
  )
}

function ActiveFileView({ status }: { status: ActiveFileStatus | null }) {
  if (!status) {
    return (
      <Text size="sm" muted>
        填入檔案或點選下方清單，查看它的忽略狀態。
      </Text>
    )
  }
  if (status.relativePath === null) {
    return (
      <Text size="sm" muted>
        這個檔案不在這個儲存庫裡
      </Text>
    )
  }
  const flags = flagNames(status)
  const ignored = flags.length > 0
  const relativePath = status.relativePath
  return (
    <Stack gap="xs">
      <FieldList
        items={[
          { label: '檔案', value: relativePath, code: true },
          { label: '忽略變更', value: ignored ? `是（${flags.join('、')}）` : '否', tone: ignored ? 'warning' : 'neutral' },
          {
            label: 'info/exclude',
            value: status.excludedBy === null ? '否' : `是（${status.excludedBy}）`,
            tone: status.excludedBy === null ? 'neutral' : 'warning'
          }
        ]}
      />
      {status.tracked ? (
        <Button
          size="sm"
          variant="outline"
          tooltip={
            ignored
              ? '清掉 skip-worktree 與 assume-unchanged，本機修改重新出現在 git 狀態裡'
              : '標記 skip-worktree，本機修改不再出現在 git 狀態裡'
          }
          onPress={() => set(confirming, { file: relativePath, ignore: !ignored })}
        >
          {ignored ? '恢復追蹤變更' : '取消追蹤變更'}
        </Button>
      ) : (
        <Text size="xs" muted>
          git 沒有追蹤這個檔案，沒有變更可以忽略
        </Text>
      )}
    </Stack>
  )
}

function ConfigCard({ repo }: { repo: RepoInfo }) {
  const groups = repo.configGroups
  return (
    <Section title="其他設定" description="Config">
      {groups.length === 0 ? (
        <Text size="sm" muted>
          沒有其他設定
        </Text>
      ) : (
        <Stack gap="xs">
          {groups.map((group) => (
            <Collapsible title={group.title} description={group.hasInclude ? '此設定引入了外部檔案，內容未展開' : undefined}>
              <FieldList
                items={group.entries.map((entry) => {
                  const label = configLabel(group.title, entry.key)
                  return {
                    label: label ? `${entry.key}（${label}）` : entry.key,
                    value: entry.value,
                    code: entry.value !== 'true' && entry.value !== 'false'
                  }
                })}
              />
            </Collapsible>
          ))}
        </Stack>
      )}
    </Section>
  )
}

/**
 * 卡片外框：Card 沒有邊線參數，側邊欄裡邊線太淡，改用 Box 畫 accent 色邊線。
 */
function Section({ title, description, children }: { title: string; description?: string; children?: OrcaNode }) {
  return (
    <Box border="accent" radius="lg" padding="md" background="card" gap="sm">
      <Stack gap="none">
        <Text weight="semibold">{title}</Text>
        {description ? (
          <Text size="xs" muted>
            {description}
          </Text>
        ) : null}
      </Stack>
      {children}
    </Box>
  )
}

/**
 * 上標籤、下值的列表：側邊欄太窄，KeyValue 左右分欄會把值擠成一字一行。
 */
function FieldList({ label, items }: { label?: string; items: readonly KeyValueItem[] }) {
  return (
    <Stack gap="sm">
      {label ? (
        <Text size="sm" weight="medium">
          {label}
        </Text>
      ) : null}
      {items.map((item) => {
        const value = item.value === null ? '—' : String(item.value)
        return (
          <Stack gap="none">
            <Text size="xs" muted>
              {item.label}
            </Text>
            {item.code ? (
              <Code>{value}</Code>
            ) : (
              <Text size="sm" tone={item.tone}>
                {value}
              </Text>
            )}
          </Stack>
        )
      })}
    </Stack>
  )
}
