import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ platform: 'ios', asyncApi: vi.fn() }))
vi.mock('openim-uniapp-polyfill', async () => ({
  ...(await import('../node_modules/openim-uniapp-polyfill/src/types/enum')),
  default: { asyncApi: mocks.asyncApi, uuid: () => 'search-test', subscribe: vi.fn(), unsubscribe: vi.fn() },
}))
vi.mock('@/utils/platform', () => ({
  isApp: () => mocks.platform !== 'h5', isAndroid: () => mocks.platform === 'android',
}))
vi.mock('@/utils/request', () => ({ getToken: () => '' }))
vi.mock('@/stores/contact', () => ({ useContactStore: vi.fn() }))

import { IMMethods } from 'openim-uniapp-polyfill'
let search: typeof import('@/utils/openim')
const conversationID = 'sg_search-test'

function message(index: number, content = '蛇') {
  const fields = { clientMsgID: `msg-${index}`, contentType: 101, sendTime: 1792843200000 - index, textElem: { content } }
  return mocks.platform === 'h5' ? fields : {
    ClientMsgID: fields.clientMsgID, ContentType: 101, SendTime: fields.sendTime, TextElem: { Content: content },
  }
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  mocks.asyncApi.mockReset()
  vi.stubGlobal('uni', { requireNativePlugin: () => ({ initSDK: vi.fn() }) })
  search = await import('@/utils/openim')
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe.each(['ios', 'android', 'h5'])('聊天搜索分页（%s）', (platform) => {
  beforeEach(() => { mocks.platform = platform })

  it('本地索引有 230 条命中时不能在前 100 条后提前结束', async () => {
    const all = Array.from({ length: 230 }, (_, i) => message(i))
    mocks.asyncApi.mockImplementation(async (method, _id, params) => {
      if (method === IMMethods.SearchLocalMessages) {
        const page = params.pageIndex - (platform === 'android' ? 0 : 1)
        return { SearchResultItems: [{ ConversationID: conversationID, MessageCount: all.length,
          MessageList: all.slice(page * params.count, (page + 1) * params.count) }] }
      }
      if (method === IMMethods.GetAdvancedHistoryMessageList) return { messageList: [], isEnd: true }
      throw new Error(`Unexpected method: ${method}`)
    })
    const results = await search.searchConversationMessages(conversationID, '蛇')
    expect(results).toHaveLength(230)
    expect(new Set(results.map((item) => item.clientMsgID)).size).toBe(230)
    expect(results.at(-1)?.clientMsgID).toBe('msg-229')
  })

  it('本地索引为空时按页向更早历史查找，不会一次拉满整个会话', async () => {
    const all = Array.from({ length: 350 }, (_, i) => message(i, i === 280 ? '蛇' : '普通消息'))
    const pageSizes: number[] = []
    mocks.asyncApi.mockImplementation(async (method, _id, params) => {
      if (method === IMMethods.SearchLocalMessages) return { searchResultItems: [] }
      if (method === IMMethods.GetAdvancedHistoryMessageList) {
        pageSizes.push(params.count)
        const offset = params.startClientMsgID ? Number(params.startClientMsgID.slice(4)) + 1 : 0
        return { MessageList: all.slice(offset, offset + params.count), IsEnd: offset + params.count >= all.length }
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    const result = await search.searchConversationMessagesPage({ conversationID, keyword: '蛇', continueOnEmpty: true })
    expect(result.messages.map((item) => item.clientMsgID)).toEqual(['msg-280'])
    expect(pageSizes.length).toBeGreaterThan(0)
    expect(pageSizes.every((count) => count <= 50)).toBe(true)
  })
})
