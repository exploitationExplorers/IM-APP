import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageItem } from 'openim-uniapp-polyfill'

const mocks = vi.hoisted(() => ({
  app: true,
  asyncApi: vi.fn(),
  sendMessage: vi.fn(),
  sendMessageNotOss: vi.fn(),
  reportSendFailure: vi.fn(),
}))

vi.mock('openim-uniapp-polyfill', async () => ({
  ...await import('../node_modules/openim-uniapp-polyfill/src/types/enum'),
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
vi.mock('@/utils/request', () => ({ getToken: () => '' }))
vi.mock('@/stores/contact', () => ({ useContactStore: vi.fn() }))

import { IMMethods, MessageStatus, SessionType } from 'openim-uniapp-polyfill'
import { sendImageUrlMessage, sendTextMessage, sendVoiceMessage } from '@/utils/openim'

const group = {
  conversationId: 'sg_group-test', sessionType: SessionType.Group,
  groupId: 'group-test', recvId: '',
}
const peer = {
  conversationId: 'si_self_peer', sessionType: SessionType.Single,
  groupId: '', recvId: 'peer',
}
type NativeParams = { recvID: string; groupID: string; message: MessageItem }
type NativeReply = (reply: { errCode: number; data: unknown }) => void

beforeEach(() => {
  vi.clearAllMocks()
  mocks.app = true
  const success = (_operation: string, params: NativeParams, callback: NativeReply) => {
    callback({ errCode: 0, data: JSON.stringify({ ...params.message, status: MessageStatus.Succeed }) })
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
afterEach(() => vi.unstubAllGlobals())

describe('native message sending with read-only bridge results', () => {
  it.each([group, peer])('sends text without modifying the SDK message ($conversationId)', async (target) => {
    const original = Object.freeze({
      clientMsgID: 'text-test', contentType: 101, status: 1,
      groupID: '', recvID: '', sessionType: 0,
      textElem: Object.freeze({ content: 'test' }),
    })
    mocks.asyncApi.mockResolvedValue(original)

    await expect(sendTextMessage(target, 'test')).resolves.toMatchObject({
      clientMsgID: 'text-test', status: MessageStatus.Succeed,
    })
    const params = mocks.sendMessage.mock.calls[0][1] as NativeParams
    expect(params.message).not.toBe(original)
    expect(params.message).toMatchObject({
      groupID: target.groupId, recvID: target.recvId, sessionType: target.sessionType,
      textElem: { content: 'test' },
    })
    expect(original).toMatchObject({ groupID: '', recvID: '', sessionType: 0, status: 1 })
    expect(mocks.reportSendFailure).not.toHaveBeenCalled()
  })

  it.each([false, true])('sends an uploaded OSS image and preserves its signed URL (JSON=%s)', async (json) => {
    const url = 'https://chat.example/image.jpg?Signature=a%2Bb%3D'
    const original = Object.freeze({
      clientMsgID: 'image-test', contentType: 102, status: 1, groupID: '',
      pictureElem: Object.freeze({ sourcePicture: Object.freeze({ url, width: 100, height: 200 }) }),
    })
    mocks.asyncApi.mockResolvedValue(json ? { errCode: 0, data: JSON.stringify(original) } : original)

    await expect(sendImageUrlMessage(group, url)).resolves.toMatchObject({ status: MessageStatus.Succeed })
    expect(mocks.sendMessageNotOss.mock.calls[0][1].message.pictureElem.sourcePicture.url).toBe(url)
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(original.groupID).toBe('')
  })

  it('sends a local voice message through the native upload method', async () => {
    const original = Object.freeze({
      clientMsgID: 'voice-test', contentType: 103, status: 1, groupID: '',
      soundElem: Object.freeze({ soundPath: '/private/voice.m4a', duration: 2 }),
    })
    mocks.asyncApi.mockResolvedValue(original)

    await expect(sendVoiceMessage(group, '/private/voice.m4a', 2)).resolves.toMatchObject({ status: 2 })
    expect(mocks.asyncApi).toHaveBeenCalledWith(IMMethods.CreateSoundMessageFromFullPath, 'operation-test', {
      soundPath: '/private/voice.m4a', duration: 2,
    })
    expect(mocks.sendMessage.mock.calls[0][1].message.soundElem).toEqual(original.soundElem)
    expect(mocks.sendMessageNotOss).not.toHaveBeenCalled()
  })

  it.each([
    (value: unknown) => JSON.stringify(value),
    (value: unknown) => ({ errCode: 0, data: JSON.stringify(value) }),
    (value: unknown) => value,
  ])('accepts JSON and PascalCase native creation results', async (wrap) => {
    const original = Object.freeze({
      ClientMsgID: 'ios-text-test', ContentType: 101, Status: 1,
      GroupID: '', RecvID: '', SessionType: 0,
      TextElem: Object.freeze({ Content: 'test' }),
    })
    mocks.asyncApi.mockResolvedValue(wrap(original))
    mocks.sendMessage.mockImplementation((_operation: string, params: NativeParams, callback: NativeReply) => {
      callback({ errCode: 0, data: JSON.stringify({
        ClientMsgID: params.message.clientMsgID, ContentType: params.message.contentType,
        Status: MessageStatus.Succeed, GroupID: params.groupID, SessionType: group.sessionType,
      }) })
    })

    await expect(sendTextMessage(group, 'test')).resolves.toMatchObject({
      clientMsgID: 'ios-text-test', contentType: 101, groupID: group.groupId, status: 2,
    })
    expect(mocks.sendMessage.mock.calls[0][1].message).toMatchObject({
      clientMsgID: 'ios-text-test', contentType: 101, TextElem: { Content: 'test' },
    })
    expect(original.GroupID).toBe('')
  })

  it('rejects an invalid native creation result before sending', async () => {
    mocks.asyncApi.mockResolvedValue('invalid native result')
    await expect(sendTextMessage(group, 'test')).rejects.toThrow('原生 SDK 创建消息结果无效')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps a real native send error as a failure', async () => {
    mocks.asyncApi.mockResolvedValue(Object.freeze({ clientMsgID: 'denied-test', contentType: 101 }))
    mocks.sendMessage.mockImplementation((_operation: string, _params: NativeParams, callback: (reply: unknown) => void) => {
      callback({ errCode: 1002, errMsg: 'not in group', data: '' })
    })
    await expect(sendTextMessage(group, 'test')).rejects.toThrow('not in group')
    expect(mocks.reportSendFailure).toHaveBeenCalledWith(expect.objectContaining({
      clientMsgId: 'denied-test', stage: 'send', contentType: 101,
    }))
  })

  it('keeps H5 sending through the web SDK', async () => {
    mocks.app = false
    const original = Object.freeze({ clientMsgID: 'web-test', contentType: 101, textElem: { content: 'test' } })
    mocks.asyncApi.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, status: 2 })

    await expect(sendTextMessage(group, 'test')).resolves.toMatchObject({ clientMsgID: 'web-test', status: 2 })
    expect(mocks.asyncApi.mock.calls[1][0]).toBe(IMMethods.SendMessage)
    expect(mocks.asyncApi.mock.calls[1][2].message).toBe(original)
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })
})
