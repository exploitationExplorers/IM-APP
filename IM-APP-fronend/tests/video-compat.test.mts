import assert from 'node:assert/strict'
import test from 'node:test'

import { parseVideoMeta, videoSnapshotTime } from '../src/utils/chatMedia.ts'

const { snapshotFromMessage } = await import('../src/utils/forwardSnapshot.ts')
const VIDEO_MESSAGE = 104

test('截帧位置避开首帧且不会越过视频结尾', () => {
  assert.equal(videoSnapshotTime(20), 1)
  assert.equal(videoSnapshotTime(5), 0.5)
  assert.ok(Math.abs(videoSnapshotTime(0.12) - 0.07) < 1e-9)
  assert.equal(videoSnapshotTime(0), 0)
})

test('解析 App 原生 PascalCase 视频和封面字段', () => {
  assert.deepEqual(
    parseVideoMeta({
      VideoElem: JSON.stringify({ VideoUrl: 'https://cdn.example/video.mp4', SnapshotUrl: 'https://cdn.example/cover.jpg', Duration: 8 }),
    }),
    { url: 'https://cdn.example/video.mp4', snapshotUrl: 'https://cdn.example/cover.jpg', duration: 8 },
  )
})

test('App 视频转发快照规范化成 OpenIM VideoElem', () => {
  const snapshot = snapshotFromMessage({
    ClientMsgID: 'app-video-1',
    ContentType: VIDEO_MESSAGE,
    VideoElem: {
      VideoUrl: 'https://cdn.example/video.mp4',
      SnapshotUrl: 'https://cdn.example/cover.jpg',
      Duration: '12',
    },
  } as never)
  assert.equal(snapshot.contentType, VIDEO_MESSAGE)
  assert.deepEqual(snapshot.content, {
    videoPath: '',
    videoUUID: 'app-video-1_video',
    videoUrl: 'https://cdn.example/video.mp4',
    videoType: 'mp4',
    videoSize: 0,
    duration: 12,
    snapshotPath: '',
    snapshotUUID: 'app-video-1_cover',
    snapshotSize: 0,
    snapshotUrl: 'https://cdn.example/cover.jpg',
    snapshotWidth: 0,
    snapshotHeight: 0,
  })
})

test('没有远程或本地视频地址时拒绝转发', () => {
  assert.throws(
    () => snapshotFromMessage({ contentType: VIDEO_MESSAGE, clientMsgID: 'empty', content: '{}' } as never),
    /视频地址不存在/,
  )
})
