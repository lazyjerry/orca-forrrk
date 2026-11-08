import { assert, mockHost, mount, test } from 'orca/testing'

import * as panel from './panel'
import { sampleLoad } from './panel/sample'

const CAPABILITIES = ['workspace:read', 'workspace:write', 'terminal:send']

test('畫出 HEAD、專案、提交、忽略變更、設定五張卡', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, requests: { 'forrrk.load': () => sampleLoad() } })
  const view = await mount(panel, { host })
  const summary = view.summary().join('\n')
  for (const title of ['HEAD', '專案', '最近提交', '忽略變更', '其他設定']) {
    assert.ok(view.find({ type: 'Card', label: title }), `缺少卡片 ${title}\n${summary}`)
  }
  assert.ok(view.find({ type: 'Badge', text: 'main' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('切換忽略變更要先確認，確認後才呼叫 worker 並重讀', async () => {
  const calls: unknown[] = []
  let loads = 0
  const tracked = sampleLoad({
    activeFile: { path: '/work/demo/a.txt', relativePath: 'a.txt', tracked: true, assumeUnchanged: false, skipWorktree: false, excludedBy: null }
  })
  const host = mockHost({
    capabilities: CAPABILITIES,
    requests: {
      'forrrk.load': () => {
        loads += 1
        return tracked
      },
      'forrrk.setSkipWorktree': (input) => {
        calls.push(input)
        return { level: 'info', message: '已取消追蹤變更 a.txt' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '取消追蹤變更' })
  assert.deepEqual(calls, [], '按第一下只顯示確認，不能直接執行')
  assert.ok(view.find({ type: 'Callout', label: '要對 a.txt 取消追蹤變更嗎？' }))

  const before = loads
  await view.press({ text: '確認取消追蹤變更' })
  assert.deepEqual(calls, [{ scope: 'project', file: 'a.txt', ignore: true }])
  assert.equal(loads, before + 1)
  assert.ok(view.find({ type: 'Callout', label: '已取消追蹤變更 a.txt' }))
  await view.unmount()
})

test('點選忽略清單的檔案會帶著該檔案重讀', async () => {
  const inputs: unknown[] = []
  const host = mockHost({
    capabilities: CAPABILITIES,
    requests: {
      'forrrk.load': (input) => {
        inputs.push(input)
        return sampleLoad()
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'ListItem', label: 'config/local.php' })
  assert.deepEqual(inputs.at(-1), { scope: null, file: 'config/local.php' })
  await view.unmount()
})

test('不是 git 儲存庫時提示該資料夾沒有 git', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, requests: { 'forrrk.load': () => ({ ...sampleLoad(), repo: null }) } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'EmptyState', label: '這個資料夾沒有 git' }))
  await view.unmount()
})

test('範圍選單只有專案／資料夾與開啟檔案兩項；file 範圍不顯示手動輸入', async () => {
  const activeFile = { path: '/work/demo/a.txt', relativePath: 'a.txt', tracked: true, assumeUnchanged: false, skipWorktree: false, excludedBy: null }
  const host = mockHost({
    capabilities: CAPABILITIES,
    requests: { 'forrrk.load': () => ({ ...sampleLoad({ activeFile }), scope: 'file' as const, openFile: '/work/demo/a.txt' }) }
  })
  const view = await mount(panel, { host })
  const select = view.find({ type: 'Select', label: '範圍' })
  assert.equal(select?.props.value, 'file')
  assert.deepEqual(select?.props.options, [
    { value: 'project', label: '當前專案／資料夾（demo）' },
    { value: 'file', label: '當前開啟檔案（a.txt）' }
  ])
  assert.equal(view.find({ type: 'Input' }), null, '編輯區的檔案不能另外指定')
  await view.unmount()
})

test('worker 通知作用中檔案換了就回到自動範圍重讀', async () => {
  const inputs: unknown[] = []
  const host = mockHost({
    capabilities: CAPABILITIES,
    requests: {
      'forrrk.load': (input) => {
        inputs.push(input)
        return sampleLoad()
      }
    }
  })
  const view = await mount(panel, { host })
  const before = inputs.length
  await view.post('forrrk.focusChanged', null)
  assert.equal(inputs.length, before + 1)
  assert.deepEqual(inputs.at(-1), { scope: null, file: null })
  await view.unmount()
})
