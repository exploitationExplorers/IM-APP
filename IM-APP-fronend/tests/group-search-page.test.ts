import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageItem } from 'openim-uniapp-polyfill'
import type { ConversationMessageSearchPage } from '@/utils/openim'

// 执行真实页面的 setup，使用 Vue 响应式与 uni-app 生命周期桩，无需原生 WebView。
const source = readFileSync(new URL('../src/pages/group/search-history.vue', import.meta.url), 'utf8')
const compiled = compileScript(parse(source).descriptor, { id: 'group-search-test' }).content
const script = ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText

interface PageState {
  keyword: Vue.Ref<string>
  loading: Vue.Ref<boolean>
  results: Vue.Ref<MessageItem[]>
  searchError: Vue.Ref<string>
  loadMore(): Promise<void>
}

const search = vi.fn()
const events = new Map<string, () => void>()
let unload: () => void
let scope: Vue.EffectScope
let page: PageState

function result(ids: string[], hasMore = false): ConversationMessageSearchPage {
  return {
    messages: ids.map((id) => ({ clientMsgID: id, sendTime: Number(id) || 1 }) as MessageItem),
    hasMore,
    cursor: { sdkPage: 2, sdkDone: true, historyStartId: '', historyDone: !hasMore, seenIds: ids, pending: [] },
  }
}

beforeEach(async () => {
  vi.useFakeTimers()
  search.mockReset()
  events.clear()
  let load!: (query: { id: string }) => Promise<void>
  const imports: Record<string, unknown> = {
    vue: Vue,
    '@dcloudio/uni-app': {
      onLoad: (fn: typeof load) => { load = fn }, onReachBottom: vi.fn(),
      onUnload: (fn: () => void) => { unload = fn },
    },
    'openim-uniapp-polyfill': { IMEvents: { OnSyncServerFinish: 'sync-finish' } },
    '@/utils/openim': {
      searchConversationMessagesPage: search,
      resolveGroupConversationID: async () => 'sg_test',
      ensureLocalConversationHistory: async () => [],
      onIMEvent: (event: string, fn: () => void) => { events.set(event, fn); return () => events.delete(event) },
    },
    '@/utils/format': {},
    '@/components/ImNavBar.vue': {},
    '@/components/AppSearchBar.vue': {},
    '@/stores/contact': { useContactStore: () => ({ ensureRemarkIndex: async () => {} }) },
    '@/utils/groupRetention': { groupRetention: { filter: (_id: string, items: MessageItem[]) => items } },
  }
  const exports: { default?: { setup: (props: object, context: object) => PageState } } = {}
  runInNewContext(script, {
    exports, setTimeout, clearTimeout, uni: { showToast: vi.fn() },
    require: (name: string) => { if (!(name in imports)) throw new Error(`Unexpected import: ${name}`); return imports[name] },
  })
  scope = Vue.effectScope()
  page = scope.run(() => exports.default!.setup({}, { expose: () => {} }))!
  await load({ id: 'test' })
  await Vue.nextTick()
})

afterEach(() => { unload(); scope.stop(); vi.clearAllTimers(); vi.useRealTimers() })

async function typeKeyword(value: string) {
  page.keyword.value = value
  await Vue.nextTick()
  await vi.advanceTimersByTimeAsync(280)
}

describe('群搜索页面异步状态', () => {
  it('换词后的防抖期间，旧结果不能覆盖新查询', async () => {
    let finish!: (value: ConversationMessageSearchPage) => void
    search.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await typeKeyword('蛇')
    const oldQuery = search.mock.calls[0][0]
    page.keyword.value = '龙'
    await Vue.nextTick()
    expect(oldQuery.isCancelled()).toBe(true)
    finish(result(['old']))
    await vi.advanceTimersByTimeAsync(0)
    expect(page.results.value).toEqual([])
    expect(page.loading.value).toBe(true)
    search.mockResolvedValueOnce(result(['new']))
    await vi.advanceTimersByTimeAsync(280)
    expect(page.results.value.map((item) => item.clientMsgID)).toEqual(['new'])
  })

  it('同步完成会补查空结果，无需退出重进', async () => {
    search.mockResolvedValueOnce(result([])).mockResolvedValueOnce(result(['synced']))
    await typeKeyword('蛇')
    expect(page.results.value).toEqual([])
    events.get('sync-finish')!()
    await vi.advanceTimersByTimeAsync(0)
    expect(page.results.value.map((item) => item.clientMsgID)).toEqual(['synced'])
  })

  it('同步补查不能把已经翻出的搜索结果缩回第一页', async () => {
    search.mockResolvedValueOnce(result(['2'], true))
      .mockResolvedValueOnce(result(['1'], true))
      .mockResolvedValueOnce(result(['3', '2'], true))
    await typeKeyword('蛇')
    await page.loadMore()
    events.get('sync-finish')!()
    await vi.advanceTimersByTimeAsync(0)
    expect(page.results.value.map((item) => item.clientMsgID)).toEqual(['3', '2', '1'])
  })

  it('退出页面时注销同步监听并取消在途查询', async () => {
    let finish!: (value: ConversationMessageSearchPage) => void
    search.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await typeKeyword('蛇')
    unload()
    expect(events.size).toBe(0)
    expect(search.mock.calls[0][0].isCancelled()).toBe(true)
    finish(result(['late']))
    await vi.advanceTimersByTimeAsync(0)
    expect(page.results.value).toEqual([])
  })

  it('查询失败保留错误状态，不把失败显示成没有记录', async () => {
    search.mockRejectedValueOnce(new Error('聊天记录还在同步，请稍后再试'))
    await typeKeyword('蛇')
    expect(page.searchError.value).toBe('聊天记录还在同步，请稍后再试')
    expect(page.loading.value).toBe(false)
  })
})
