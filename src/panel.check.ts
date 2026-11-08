// `orca plugin check` 每個情境畫一次面板，worker 跑在假 host 上。
import { defineCheck } from 'orca/testing'

import { sampleLoad } from './panel/sample'

const capabilities = ['workspace:read', 'workspace:write', 'terminal:send']

export default defineCheck({
  /** 沒有聚焦任何 workspace：worker 真的去讀，回空清單。 */
  noWorkspace: {
    capabilities,
    results: { 'workspace.list': { workspaces: [], truncated: false }, 'workspace.readContext': null }
  },
  /** 有完整 repo 資訊時的版面。 */
  sample: {
    capabilities,
    requests: { 'forrrk.load': () => sampleLoad() }
  }
})
