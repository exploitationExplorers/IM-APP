import { describe, expect, it } from 'vitest'
import { snapshotFromMessage, withForwardSnapshot } from '@/utils/forwardSnapshot'

describe('cross-platform forward snapshots', () => {
  const url = 'https://chat.example/chat/a?Signature=a%2Bb%3D'
  it.each([
    { contentType: 103, soundElem: { sourceUrl: url, duration: 2, dataSize: 45 } },
    { ContentType: 103, SoundElem: JSON.stringify({ SourceUrl: url, Duration: 2, DataSize: 45 }) },
    { ContentType: 103, Content: JSON.stringify({ SoundPath: url, Duration: 2, DataSize: 45 }) },
  ])('retains voice metadata and remote fallback URLs', (message) => {
    expect(snapshotFromMessage(message as never)).toMatchObject({
      contentType: 103,
      content: { sourceUrl: url, soundPath: '', duration: 2, dataSize: 45 },
    })
  })
  it.each([
    { contentType: 105, fileElem: { sourceUrl: url, fileName: '文件.zip', fileSize: 80 } },
    { ContentType: 105, FileElem: { SourceUrl: url, FileName: '文件.zip', FileSize: 80 } },
  ])('retains file names and sizes', (message) => {
    expect(snapshotFromMessage(message as never)).toMatchObject({
      contentType: 105,
      content: { sourceUrl: url, filePath: '', fileName: '文件.zip', fileSize: 80 },
    })
  })
  it('normalizes merged quotes without modifying frozen native messages', () => {
    const image = Object.freeze({
      ContentType: 102,
      ClientMsgID: 'native-image',
      PictureElem: Object.freeze({
        SourcePicture: Object.freeze({ Url: url, Type: 'image/png', Width: 80 }),
      }),
    })
    const quote = Object.freeze({
      ContentType: 114,
      QuoteElem: Object.freeze({ Text: 'reply', QuoteMessage: image }),
    })
    const merged = {
      ContentType: 107,
      MergeElem: { Title: 'merged', MultiMessage: JSON.stringify([quote]) },
    }
    const snapshot = snapshotFromMessage(merged as never)
    expect(snapshot).toMatchObject({
      contentType: 107,
      content: {
        title: 'merged',
        multiMessage: [
          {
            contentType: 114,
            quoteElem: {
              text: 'reply',
              quoteMessage: {
                clientMsgID: 'native-image',
                contentType: 102,
                pictureElem: { sourcePicture: { url, width: 80, type: 'image/png' } },
              },
            },
          },
        ],
      },
    })
    expect(image.PictureElem.SourcePicture.Url).toBe(url)
  })
  it('updates both alias shapes on a plain copy, not the SDK object', () => {
    const source = Object.freeze({
      ContentType: 103,
      Content: 'old',
      SoundElem: Object.freeze({ SourceUrl: url }),
      ClientMsgID: 'id',
    })
    const result = withForwardSnapshot(source as never, {
      contentType: 103,
      content: { sourceUrl: 'https://business.example/forwards/copy' },
    })
    expect(result).toMatchObject({
      clientMsgID: 'id',
      soundElem: { sourceUrl: 'https://business.example/forwards/copy' },
      SoundElem: { sourceUrl: 'https://business.example/forwards/copy' },
    })
    expect(JSON.stringify(result)).not.toContain('chat.example')
    expect(source.SoundElem.SourceUrl).toBe(url)
  })
  it('rejects cyclic or excessively nested references before stack overflow', () => {
    const message = {
      contentType: 114,
      quoteElem: { text: 'reply', quoteMessage: null as unknown },
    }
    message.quoteElem.quoteMessage = message
    expect(() => snapshotFromMessage(message as never)).toThrow('层级过深')
  })
  it('normalizes native mention identities inside media references', () => {
    expect(
      snapshotFromMessage({
        ContentType: 106,
        AtTextElem: {
          Text: '@name reply',
          AtUserList: ['user'],
          AtUsersInfo: [{ AtUserID: 'user', GroupNickname: 'name' }],
          QuoteMessage: { ContentType: 105, FileElem: { SourceUrl: url, FileName: 'a.zip' } },
        },
      } as never),
    ).toMatchObject({
      contentType: 106,
      content: {
        atUserList: ['user'],
        atUsersInfo: [{ atUserID: 'user', groupNickname: 'name' }],
        quoteMessage: { contentType: 105, fileElem: { sourceUrl: url, fileName: 'a.zip' } },
      },
    })
  })
})
