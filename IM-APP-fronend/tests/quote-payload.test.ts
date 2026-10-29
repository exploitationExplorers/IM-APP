import { describe, expect, it } from 'vitest'
import type { MessageItem } from 'openim-uniapp-polyfill'
import {
  describeNativeCreateResult,
  inferNativeMessageType,
  isNativeCreateResultError,
  slimQuotedMessage,
} from '@/utils/quotePayload'

const asMessage = (value: Record<string, unknown>) => value as unknown as MessageItem

describe('inferNativeMessageType', () => {
  it('prefers the declared contentType', () => {
    expect(inferNativeMessageType({ contentType: 102, textElem: {} })).toBe(102)
    expect(inferNativeMessageType({ ContentType: 104 })).toBe(104)
  })

  it('falls back to the elem present in the native result', () => {
    expect(inferNativeMessageType({ pictureElem: {} })).toBe(102)
    expect(inferNativeMessageType({ videoElem: {} })).toBe(104)
    expect(inferNativeMessageType({ soundElem: {} })).toBe(103)
    expect(inferNativeMessageType({ fileElem: {} })).toBe(105)
    expect(inferNativeMessageType({ mergeElem: {} })).toBe(107)
    expect(inferNativeMessageType({ quoteElem: {} })).toBe(114)
    expect(inferNativeMessageType({ textElem: {} })).toBe(101)
  })

  it('accepts PascalCase elem names', () => {
    expect(inferNativeMessageType({ PictureElem: {} })).toBe(102)
    expect(inferNativeMessageType({ VideoElem: {} })).toBe(104)
  })

  it('returns 0 when nothing can be inferred', () => {
    expect(inferNativeMessageType({})).toBe(0)
    expect(inferNativeMessageType({ status: 1 })).toBe(0)
  })
})

describe('slimQuotedMessage', () => {
  it('keeps only the render-relevant envelope fields', () => {
    const slim = slimQuotedMessage(
      asMessage({
        clientMsgID: 'src-1',
        contentType: 101,
        sendID: 'sender',
        senderNickname: '团子',
        textElem: { content: '只有你' },
        attachedInfo: 'x'.repeat(4000),
        ex: 'noise',
      }),
    )
    expect(slim).toMatchObject({
      clientMsgID: 'src-1',
      contentType: 101,
      sendID: 'sender',
      senderNickname: '团子',
    })
    expect(slim).not.toHaveProperty('attachedInfo')
    expect(slim).not.toHaveProperty('ex')
  })

  it('keeps pictureElem for image quotes', () => {
    const slim = slimQuotedMessage(
      asMessage({ contentType: 102, pictureElem: { sourcePicture: { url: 'https://cdn/a.jpg' } } }),
    )
    expect((slim as unknown as Record<string, unknown>).pictureElem).toEqual({
      sourcePicture: { url: 'https://cdn/a.jpg' },
    })
  })

  // 回归：视频/语音/文件/合并消息以前会走「原样返回」，等于没降级，必然再失败一次
  it('keeps videoElem for video quotes', () => {
    const elem = { videoUrl: 'https://cdn/a.mp4', snapshotUrl: 'https://cdn/a.jpg' }
    const slim = slimQuotedMessage(asMessage({ contentType: 104, videoElem: elem }))
    expect((slim as unknown as Record<string, unknown>).videoElem).toEqual(elem)
  })

  it('keeps soundElem for voice quotes', () => {
    const elem = { sourceUrl: 'https://cdn/a.amr', duration: 12 }
    const slim = slimQuotedMessage(asMessage({ contentType: 103, soundElem: elem }))
    expect((slim as unknown as Record<string, unknown>).soundElem).toEqual(elem)
  })

  it('reads PascalCase envelopes', () => {
    const slim = slimQuotedMessage(asMessage({ ContentType: 102, PictureElem: { url: 'u' } }))
    expect((slim as unknown as Record<string, unknown>).contentType).toBe(102)
    expect((slim as unknown as Record<string, unknown>).pictureElem).toEqual({ url: 'u' })
  })

  it('never carries local file paths into the native payload', () => {
    const slim = slimQuotedMessage(
      asMessage({ contentType: 105, fileElem: { filePath: '/var/mobile/x.pdf', sourceUrl: 'https://cdn/a.pdf' } }),
    )
    const fileElem = (slim as unknown as Record<string, unknown>).fileElem as Record<string, unknown>
    expect(fileElem.sourceUrl).toBe('https://cdn/a.pdf')
    expect(fileElem.filePath).toBe('/var/mobile/x.pdf')
  })
})

describe('isNativeCreateResultError', () => {
  it('matches the native-create failure text', () => {
    expect(isNativeCreateResultError(new Error('原生 SDK 创建消息结果无效'))).toBe(true)
  })

  it('does not swallow business or network failures', () => {
    expect(isNativeCreateResultError(new Error('发送失败'))).toBe(false)
    expect(isNativeCreateResultError(new Error('网络超时'))).toBe(false)
    expect(isNativeCreateResultError(undefined)).toBe(false)
  })
})

describe('describeNativeCreateResult', () => {
  it('summarises empty and non-object payloads', () => {
    expect(describeNativeCreateResult(null)).toContain('null')
    expect(describeNativeCreateResult(undefined)).toContain('undefined')
    expect(describeNativeCreateResult(42)).toContain('42')
  })

  it('lists the keys and declared contentType of an object payload', () => {
    const text = describeNativeCreateResult({ clientMsgID: 'a', quoteElem: {} })
    expect(text).toContain('keys=[clientMsgID,quoteElem]')
    expect(text).toContain('contentType=∅')
  })

  it('truncates long string payloads', () => {
    const text = describeNativeCreateResult('x'.repeat(500))
    expect(text.length).toBeLessThan(260)
  })
})
