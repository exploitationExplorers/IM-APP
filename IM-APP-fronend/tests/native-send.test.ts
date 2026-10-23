import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageItem } from 'openim-uniapp-polyfill'

const mocks = vi.hoisted(() => ({
  app: true,
  asyncApi: vi.fn(),
  sendMessage: vi.fn(),
  sendMessageNotOss: vi.fn(),
  reportSendFailure: vi.fn(),
  preserveForwardMedia: vi.fn(),
  fetchRetention: vi.fn(),
}))

vi.mock('openim-uniapp-polyfill', async () => ({
  ...(await import('../node_modules/openim-uniapp-polyfill/src/types/enum')),
  default: {
    asyncApi: mocks.asyncApi,
    uuid: () => 'operation-test',
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}))
vi.mock('@/utils/platform', () => ({
  isApp: () => mocks.app,
  isAppPlatform: () => mocks.app,
  isAndroid: () => false,
}))
vi.mock('@/api/im', () => ({ reportSendFailure: mocks.reportSendFailure }))
vi.mock('@/api/forward', () => ({ preserveForwardMedia: mocks.preserveForwardMedia }))
vi.mock('@/api/groupRetention', () => ({ fetchGroupRetentionStates: mocks.fetchRetention }))
vi.mock('@/utils/request', () => ({ getToken: () => '' }))
vi.mock('@/stores/contact', () => ({ useContactStore: vi.fn() }))

import { IMMethods, MessageStatus, SessionType } from 'openim-uniapp-polyfill'
import {
  sendImageUrlMessage,
  sendTextMessage,
  sendVoiceMessage,
  sendForwardMessage,
  sendQuoteMessage,
  getHistoryMessages,
  searchLocalMessages,
  findLocalMessage,
  toConversation,
  isLocalDatabaseWriteError,
} from '@/utils/openim'
import { groupRetention } from '@/utils/groupRetention'

const group = {
  conversationId: 'sg_group-test',
  sessionType: SessionType.Group,
  groupId: 'group-test',
  recvId: '',
}
const peer = {
  conversationId: 'si_self_peer',
  sessionType: SessionType.Single,
  groupId: '',
  recvId: 'peer',
}
type NativeParams = { recvID: string; groupID: string; message: MessageItem }
type NativeReply = (reply: { errCode: number; data: unknown }) => void

beforeEach(() => {
  vi.resetAllMocks()
  groupRetention.setOwner('')
  mocks.app = true
  const success = (_operation: string, params: NativeParams, callback: NativeReply) => {
    callback({
      errCode: 0,
      data: JSON.stringify({ ...params.message, status: MessageStatus.Succeed }),
    })
  }
  mocks.sendMessage.mockImplementation(success)
  mocks.sendMessageNotOss.mockImplementation(success)
  vi.stubGlobal('uni', {
    requireNativePlugin: () => ({
      initSDK: vi.fn(),
      sendMessage: mocks.sendMessage,
      sendMessageNotOss: mocks.sendMessageNotOss,
    }),
  })
})

describe.each([true, false])('SDK retention ingress (native=%s)', (app) => {
  const id = 'sg_aabbccdd112243448566778899aabbcc'
  const old = Object.freeze({ ClientMsgID: 'expired', ContentType: 101, Seq: '99', TextElem: { Content: 'expired text' } })
  const kept = Object.freeze({ ClientMsgID: 'kept', ContentType: 101, Seq: '100', TextElem: { Content: 'kept text' } })
  beforeEach(() => {
    mocks.app = app
    mocks.fetchRetention.mockResolvedValue({ items: [{ conversationId: id, minVisibleSeq: 100, revision: 1, updatedAt: '2026-10-18T06:00:00Z' }] })
    groupRetention.setOwner('retention-owner')
  })
  it('filters native/Web SDK history and terminates pagination at the prefix', async () => {
    mocks.asyncApi.mockResolvedValue({ MessageList: [old, kept], IsEnd: false })
    const result = await getHistoryMessages(id)
    expect(result.messageList.map((m) => m.clientMsgID)).toEqual(['kept'])
    expect(result.isEnd).toBe(true)
    expect(old.Seq).toBe('99')
  })
  it('does not expose expired search matches or allow locating them', async () => {
    mocks.asyncApi.mockResolvedValue({ SearchResultItems: [{ ConversationID: id, MessageCount: 2, MessageList: [old, kept] }] })
    const hits = await searchLocalMessages({ keyword: 'text', conversationID: id })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ messageCount: 1, clientMsgID: 'kept', preview: 'kept text' })
    mocks.asyncApi.mockResolvedValue({ FindResultItems: [{ ConversationID: id, MessageList: [old] }] })
    expect(await findLocalMessage(id, 'expired')).toBeNull()
  })
  it('clears stale native preview/@ badges and caps cached unread counts', async () => {
    await groupRetention.sync([id])
    const conversation = (latest: unknown) => Object.freeze({ ConversationID: id, ConversationType: 3, LatestMsg: JSON.stringify(latest), UnreadCount: 105, GroupAtType: 1, ShowName: 'group' })
    expect(toConversation(conversation(old) as never)).toMatchObject({ lastMessage: '', unreadCount: 0, groupAtType: 0, highlightTags: [] })
    expect(toConversation(conversation({ ...kept, Seq: '105' }) as never).unreadCount).toBe(6)
  })
})

describe.each([true, false])('protected media sends (native=%s)', (app) => {
  beforeEach(() => {
    mocks.app = app
  })
  const oldURL = 'https://chat.example/source.jpg?Signature=a%2Bb'
  const savedURL = 'https://business.example/forwards/owner/copy'
  const source = Object.freeze({
    ClientMsgID: 'source-test',
    ContentType: 102,
    SendID: 'sender',
    SendTime: 1234,
    Content: JSON.stringify({ SourcePicture: { Url: oldURL } }),
    PictureElem: Object.freeze({
      SourcePicture: Object.freeze({ Url: oldURL, Type: 'image/jpeg' }),
    }),
  }) as unknown as MessageItem

  it('copies media before creating/sending a forward and uses the platform contract', async () => {
    mocks.preserveForwardMedia.mockResolvedValue({
      contentType: 102,
      content: {
        sourcePath: '',
        sourcePicture: { url: savedURL, type: 'image/jpeg' },
        bigPicture: { url: savedURL, type: 'image/jpeg' },
        snapshotPicture: { url: savedURL, type: 'image/jpeg' },
      },
    })
    const created = Object.freeze({ clientMsgID: 'forward-test', contentType: 102, status: 1 })
    mocks.asyncApi.mockResolvedValueOnce(created).mockResolvedValueOnce({ ...created, status: 2 })
    await expect(sendForwardMessage(group, source)).resolves.toMatchObject({ status: 2 })
    expect(mocks.preserveForwardMedia).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 102 }),
    )
    const create = mocks.asyncApi.mock.calls[0]
    expect(create[0]).toBe(IMMethods.CreateForwardMessage)
    const protectedSource = app ? create[2].message : create[2]
    expect(protectedSource).toMatchObject({
      clientMsgID: 'source-test',
      sendID: 'sender',
      sendTime: 1234,
      pictureElem: { sourcePicture: { url: savedURL } },
      PictureElem: { sourcePicture: { url: savedURL } },
    })
    expect(JSON.stringify(protectedSource)).not.toContain(oldURL)
    expect((source as unknown as { Content: string }).Content).toContain('chat.example')
    if (app) {
      expect(mocks.sendMessageNotOss).toHaveBeenCalledTimes(1)
      expect(mocks.sendMessage).not.toHaveBeenCalled()
    } else {
      expect(mocks.asyncApi.mock.calls[1][0]).toBe(IMMethods.SendMessageNotOss)
      expect(mocks.sendMessageNotOss).not.toHaveBeenCalled()
    }
  })

  it('quotes media without App rewrite; H5 still preserves a durable copy', async () => {
    mocks.preserveForwardMedia.mockResolvedValue({
      contentType: 102,
      content: { sourcePicture: { url: savedURL } },
    })
    const created = Object.freeze({ clientMsgID: 'quote-test', contentType: 114, status: 1 })
    mocks.asyncApi.mockResolvedValueOnce(created).mockResolvedValueOnce({ ...created, status: 2 })
    await expect(sendQuoteMessage(group, 'reply', source)).resolves.toMatchObject({ status: 2 })
    expect(mocks.asyncApi.mock.calls[0][0]).toBe(IMMethods.CreateQuoteMessage)
    const params = mocks.asyncApi.mock.calls[0][2] as { text: string; message: string }
    expect(params.text).toBe('reply')
    expect(typeof params.message).toBe('string')
    if (app) {
      // App 引用不走 withForwardSnapshot，避免 iOS「原生 SDK 创建消息结果无效」
      expect(mocks.preserveForwardMedia).not.toHaveBeenCalled()
      expect(params.message).toContain(oldURL)
    } else {
      expect(mocks.preserveForwardMedia).toHaveBeenCalled()
      expect(params.message).toContain(savedURL)
      expect(params.message).not.toContain('chat.example')
    }
  })

  it('does not invoke the SDK when forward preservation fails', async () => {
    mocks.preserveForwardMedia.mockRejectedValue(new Error('副本保存失败'))
    await expect(sendForwardMessage(group, source)).rejects.toThrow('副本保存失败')
    expect(mocks.asyncApi).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.sendMessageNotOss).not.toHaveBeenCalled()
  })

  it('App quote still creates when media preservation would fail', async () => {
    if (!app) return
    mocks.preserveForwardMedia.mockRejectedValue(new Error('副本保存失败'))
    const created = Object.freeze({ clientMsgID: 'quote-test', contentType: 114, status: 1 })
    mocks.asyncApi.mockResolvedValueOnce(created).mockResolvedValueOnce({ ...created, status: 2 })
    await expect(sendQuoteMessage(group, 'reply', source)).resolves.toMatchObject({ status: 2 })
    expect(mocks.preserveForwardMedia).not.toHaveBeenCalled()
  })

  it('keeps text-only forwarding independent of the preservation service', async () => {
    const created = { clientMsgID: 'text-forward', contentType: 101, status: 1 }
    mocks.asyncApi.mockResolvedValueOnce(created).mockResolvedValueOnce({ ...created, status: 2 })
    await sendForwardMessage(
      peer,
      Object.freeze({
        contentType: 101,
        textElem: Object.freeze({ content: oldURL }),
      }) as MessageItem,
    )
    expect(mocks.preserveForwardMedia).not.toHaveBeenCalled()
    if (app) expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    else expect(mocks.asyncApi.mock.calls[1][0]).toBe(IMMethods.SendMessage)
  })

  it('quotes plain text without rewriting content/textElem for the native SDK', async () => {
    const created = { clientMsgID: 'quote-text', contentType: 114, status: 1 }
    mocks.asyncApi.mockResolvedValueOnce(created).mockResolvedValueOnce({ ...created, status: 2 })
    const textSource = Object.freeze({
      clientMsgID: 'src-text',
      contentType: 101,
      sendID: 'sender',
      senderNickname: '团子',
      textElem: Object.freeze({ content: '只有你' }),
      TextElem: Object.freeze({ Content: '只有你' }),
    }) as MessageItem
    await expect(sendQuoteMessage(group, '能信吗', textSource)).resolves.toMatchObject({
      clientMsgID: 'quote-text',
    })
    expect(mocks.preserveForwardMedia).not.toHaveBeenCalled()
    const params = mocks.asyncApi.mock.calls[0][2] as { text: string; message: string }
    expect(params.text).toBe('能信吗')
    const parsed = JSON.parse(params.message) as Record<string, unknown>
    expect(parsed.textElem).toEqual({ content: '只有你' })
    expect(parsed.TextElem).toEqual({ Content: '只有你' })
    // 不能被 withForwardSnapshot 改成统一的 {"content":"..."} 字符串，否则部分基座创建结果为空
    expect(typeof parsed.content === 'string' && (parsed.content as string).startsWith('{')).toBe(
      false,
    )
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('native message sending with read-only bridge results', () => {
  it.each([group, peer])(
    'sends text without modifying the SDK message ($conversationId)',
    async (target) => {
      const original = Object.freeze({
        clientMsgID: 'text-test',
        contentType: 101,
        status: 1,
        groupID: '',
        recvID: '',
        sessionType: 0,
        textElem: Object.freeze({ content: 'test' }),
      })
      mocks.asyncApi.mockResolvedValue(original)

      await expect(sendTextMessage(target, 'test')).resolves.toMatchObject({
        clientMsgID: 'text-test',
        status: MessageStatus.Succeed,
      })
      const params = mocks.sendMessage.mock.calls[0][1] as NativeParams
      expect(params.message).not.toBe(original)
      expect(params.message).toMatchObject({
        groupID: target.groupId,
        recvID: target.recvId,
        sessionType: target.sessionType,
        textElem: { content: 'test' },
      })
      expect(original).toMatchObject({ groupID: '', recvID: '', sessionType: 0, status: 1 })
      expect(mocks.reportSendFailure).not.toHaveBeenCalled()
    },
  )

  it.each([false, true])(
    'sends an uploaded OSS image and preserves its signed URL (JSON=%s)',
    async (json) => {
      const url = 'https://chat.example/image.jpg?Signature=a%2Bb%3D'
      const original = Object.freeze({
        clientMsgID: 'image-test',
        contentType: 102,
        status: 1,
        groupID: '',
        pictureElem: Object.freeze({
          sourcePicture: Object.freeze({ url, width: 100, height: 200 }),
        }),
      })
      mocks.asyncApi.mockResolvedValue(
        json ? { errCode: 0, data: JSON.stringify(original) } : original,
      )

      await expect(sendImageUrlMessage(group, url)).resolves.toMatchObject({
        status: MessageStatus.Succeed,
      })
      expect(mocks.sendMessageNotOss.mock.calls[0][1].message.pictureElem.sourcePicture.url).toBe(
        url,
      )
      expect(mocks.sendMessage).not.toHaveBeenCalled()
      expect(original.groupID).toBe('')
    },
  )

  it('sends a local voice message through the native upload method', async () => {
    const original = Object.freeze({
      clientMsgID: 'voice-test',
      contentType: 103,
      status: 1,
      groupID: '',
      soundElem: Object.freeze({ soundPath: '/private/voice.m4a', duration: 2 }),
    })
    mocks.asyncApi.mockResolvedValue(original)

    await expect(sendVoiceMessage(group, '/private/voice.m4a', 2)).resolves.toMatchObject({
      status: 2,
    })
    expect(mocks.asyncApi).toHaveBeenCalledWith(
      IMMethods.CreateSoundMessageFromFullPath,
      'operation-test',
      {
        soundPath: '/private/voice.m4a',
        duration: 2,
      },
    )
    expect(mocks.sendMessage.mock.calls[0][1].message.soundElem).toEqual(original.soundElem)
    expect(mocks.sendMessageNotOss).not.toHaveBeenCalled()
  })

  it.each([
    (value: unknown) => JSON.stringify(value),
    (value: unknown) => ({ errCode: 0, data: JSON.stringify(value) }),
    (value: unknown) => value,
  ])('accepts JSON and PascalCase native creation results', async (wrap) => {
    const original = Object.freeze({
      ClientMsgID: 'ios-text-test',
      ContentType: 101,
      Status: 1,
      GroupID: '',
      RecvID: '',
      SessionType: 0,
      TextElem: Object.freeze({ Content: 'test' }),
    })
    mocks.asyncApi.mockResolvedValue(wrap(original))
    mocks.sendMessage.mockImplementation(
      (_operation: string, params: NativeParams, callback: NativeReply) => {
        callback({
          errCode: 0,
          data: JSON.stringify({
            ClientMsgID: params.message.clientMsgID,
            ContentType: params.message.contentType,
            Status: MessageStatus.Succeed,
            GroupID: params.groupID,
            SessionType: group.sessionType,
          }),
        })
      },
    )

    await expect(sendTextMessage(group, 'test')).resolves.toMatchObject({
      clientMsgID: 'ios-text-test',
      contentType: 101,
      groupID: group.groupId,
      status: 2,
    })
    expect(mocks.sendMessage.mock.calls[0][1].message).toMatchObject({
      clientMsgID: 'ios-text-test',
      contentType: 101,
      TextElem: { Content: 'test' },
    })
    expect(original.GroupID).toBe('')
  })

  it('rejects an invalid native creation result before sending', async () => {
    mocks.asyncApi.mockResolvedValue('invalid native result')
    await expect(sendTextMessage(group, 'test')).rejects.toThrow('原生 SDK 创建消息结果无效')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps a real native send error as a failure', async () => {
    mocks.asyncApi.mockResolvedValue(
      Object.freeze({ clientMsgID: 'denied-test', contentType: 101 }),
    )
    mocks.sendMessage.mockImplementation(
      (_operation: string, _params: NativeParams, callback: (reply: unknown) => void) => {
        callback({ errCode: 1002, errMsg: 'not in group', data: '' })
      },
    )
    await expect(sendTextMessage(group, 'test')).rejects.toThrow('not in group')
    expect(mocks.reportSendFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMsgId: 'denied-test',
        stage: 'send',
        contentType: 101,
      }),
    )
  })

  it('keeps H5 sending through the web SDK', async () => {
    mocks.app = false
    const original = Object.freeze({
      clientMsgID: 'web-test',
      contentType: 101,
      textElem: { content: 'test' },
    })
    mocks.asyncApi.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, status: 2 })

    await expect(sendTextMessage(group, 'test')).resolves.toMatchObject({
      clientMsgID: 'web-test',
      status: 2,
    })
    expect(mocks.asyncApi.mock.calls[1][0]).toBe(IMMethods.SendMessage)
    expect(mocks.asyncApi.mock.calls[1][2].message).toBe(original)
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })
})

describe('isLocalDatabaseWriteError（本地库写不进去，需重开库后重发）', () => {
  it('认得线上实际报的 readonly database 原文', () => {
    const real =
      'error *errors.withStack not implement CodeError: InsertMessage failed: attempt to write a readonly database（sendMessage errCode=10005）'
    expect(isLocalDatabaseWriteError(new Error(real))).toBe(true)
    expect(isLocalDatabaseWriteError(real)).toBe(true)
  })

  // 单独锁 readonly：线上原文同时含 InsertMessage，只测它会漏掉这条规则。
  it('只报 readonly 也认（不依赖 InsertMessage 关键词）', () => {
    expect(isLocalDatabaseWriteError(new Error('attempt to write a readonly database'))).toBe(true)
    expect(isLocalDatabaseWriteError(new Error('disk I/O error'))).toBe(true)
  })

  it('认得库被关掉的 database is closed', () => {
    expect(isLocalDatabaseWriteError(new Error('GetGroups failed: database is closed'))).toBe(true)
  })

  it('认得 initDB / 库文件不存在（管理后台中午那批失败原文）', () => {
    const real =
      'error *errors.withStack not implement CodeError: init database initDB failed /var/mobile/.../doc/openim/xxx/: open db failed .../OpenIM_v3_xxx.db: unable to open database file: no such file or directory: 10006 Internal SDK error (login errCode=10005)'
    expect(isLocalDatabaseWriteError(new Error(real))).toBe(true)
    expect(isLocalDatabaseWriteError(new Error('open db failed: no such file or directory'))).toBe(true)
  })

  it('不把断线、好友关系等无关错误当成库问题', () => {
    expect(
      isLocalDatabaseWriteError(new Error('network error, ws not connected (sendMessageNotOss errCode=10000)')),
    ).toBe(false)
    expect(isLocalDatabaseWriteError(new Error('5001 not_friend'))).toBe(false)
    expect(isLocalDatabaseWriteError(undefined)).toBe(false)
    expect(isLocalDatabaseWriteError(new Error('发送超时'))).toBe(false)
  })
})
