import { describe, expect, it } from 'vitest'
import { parseVideoMeta, videoPosterUrlFromContent } from '@/utils/chatMedia'
import { snapshotFromMessage } from '@/utils/forwardSnapshot'

const videoUrl = 'https://chat.oss-cn-hangzhou.aliyuncs.com/oss-test/chat/video.mp4?OSSAccessKeyId=fake&Signature=a%2Bb%3D'
const coverUrl = 'https://chat.oss-cn-hangzhou.aliyuncs.com/oss-test/chat/cover.jpg?x-oss-signature=a%2Fb'

describe('OSS media protocol regression across H5 and native App', () => {
  it.each([
    { contentType: 104, clientMsgID: 'web-1', videoElem: { videoUrl, snapshotUrl: coverUrl, duration: 8 } },
    { ContentType: 104, ClientMsgID: 'app-1', VideoElem: { VideoUrl: videoUrl, SnapshotUrl: coverUrl, Duration: 8 } },
    { ContentType: 104, ClientMsgID: 'app-json-1', VideoElem: JSON.stringify({ VideoUrl: videoUrl, SnapshotUrl: coverUrl, Duration: 8 }) },
  ])('preserves signed video and independent cover through parsing and forwarding', (message) => {
    expect(parseVideoMeta(message)).toEqual({ url: videoUrl, snapshotUrl: coverUrl, duration: 8 })
    const snapshot = snapshotFromMessage(message as never)
    expect(snapshot.contentType).toBe(104)
    expect(snapshot.content).toMatchObject({ videoUrl, snapshotUrl: coverUrl, duration: 8 })
    expect(videoPosterUrlFromContent(JSON.stringify(snapshot.content))).toBe(coverUrl)
  })

  it('does not replace a distinct image thumbnail with the original image', () => {
    const original = 'https://chat.oss-cn-hangzhou.aliyuncs.com/oss-test/chat/original.jpg?Signature=o%2Bb&OSSAccessKeyId=fake'
    const thumb = 'https://chat.oss-cn-hangzhou.aliyuncs.com/oss-test/chat/thumbnail.jpg?Signature=t%2Bb&OSSAccessKeyId=fake'
    const snapshot = snapshotFromMessage({ contentType: 102, pictureElem: {
      sourcePicture: { url: original, type: 'image/jpeg', width: 1080 },
      bigPicture: { url: original, type: 'image/jpeg' },
      snapshotPicture: { url: thumb, type: 'image/jpeg', width: 240 },
    } } as never)
    expect(snapshot.content).toMatchObject({ sourcePicture: { url: original }, snapshotPicture: { url: thumb, width: 240 } })
  })
})
