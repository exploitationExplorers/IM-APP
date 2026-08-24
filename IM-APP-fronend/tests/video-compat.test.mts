import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseVideoMeta,
  videoSnapshotTime,
  formatVideoDuration,
  isUsableVideoPoster,
  mergeVideoContent,
  videoPosterUrlFromContent,
} from '../src/utils/chatMedia.ts'

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
    videoSize: 1,
    duration: 12,
    snapshotPath: '',
    snapshotUUID: 'app-video-1_cover',
    snapshotSize: 0,
    snapshotUrl: 'https://cdn.example/cover.jpg',
    snapshotWidth: 720,
    snapshotHeight: 1280,
  })
})

test('转发优先远程封面，忽略发送端本地 snapshotPath', () => {
  const snapshot = snapshotFromMessage({
    clientMsgID: 'mix-1',
    contentType: VIDEO_MESSAGE,
    videoElem: {
      videoUrl: 'https://cdn.example/a.mp4',
      snapshotPath: '/storage/emulated/0/cover.jpg',
      snapshotUrl: 'https://cdn.example/a.jpg',
      duration: 3,
      videoSize: 1024,
      snapshotWidth: 360,
      snapshotHeight: 640,
    },
  } as never)
  assert.equal((snapshot.content as { snapshotUrl: string }).snapshotUrl, 'https://cdn.example/a.jpg')
  assert.equal((snapshot.content as { videoSize: number }).videoSize, 1024)
})

test('解析时优先远程封面 URL', () => {
  assert.deepEqual(
    parseVideoMeta({
      videoUrl: 'https://cdn.example/a.mp4',
      snapshotPath: '/storage/emulated/0/cover.jpg',
      snapshotUrl: 'https://cdn.example/a.jpg',
      duration: 3,
    }),
    { url: 'https://cdn.example/a.mp4', snapshotUrl: 'https://cdn.example/a.jpg', duration: 3 },
  )
})

test('没有远程或本地视频地址时拒绝转发', () => {
  assert.throws(
    () => snapshotFromMessage({ contentType: VIDEO_MESSAGE, clientMsgID: 'empty', content: '{}' } as never),
    /视频地址不存在/,
  )
})

test('仅有本地视频路径时拒绝转发', () => {
  assert.throws(
    () =>
      snapshotFromMessage({
        contentType: VIDEO_MESSAGE,
        clientMsgID: 'local-only',
        videoElem: { videoPath: '/storage/emulated/0/a.mp4', duration: 2 },
      } as never),
    /视频地址不存在/,
  )
})

test('视频时长格式化为 mm:ss', () => {
  assert.equal(formatVideoDuration(9), '00:09')
  assert.equal(formatVideoDuration(65), '01:05')
  assert.equal(formatVideoDuration(0), '00:00')
})

test('合并封面时远程 URL 优先于发送端本地路径', () => {
  assert.equal(
    mergeVideoContent(
      JSON.stringify({
        url: 'https://cdn.example/a.mp4',
        snapshotUrl: '/storage/emulated/0/cover.jpg',
        duration: 3,
      }),
      JSON.stringify({
        url: 'https://cdn.example/a.mp4',
        snapshotUrl: 'https://cdn.example/a.jpg',
        duration: 3,
      }),
    ),
    JSON.stringify({
      url: 'https://cdn.example/a.mp4',
      snapshotUrl: 'https://cdn.example/a.jpg',
      duration: 3,
    }),
  )
})

test('本地封面路径可用作气泡封面，视频地址不行', () => {
  assert.equal(isUsableVideoPoster('/storage/emulated/0/cover.jpg'), true)
  assert.equal(isUsableVideoPoster('https://cdn.example/a.jpg'), true)
  assert.equal(isUsableVideoPoster('https://cdn.example/a.mp4'), false)
})

test('仅有本地 snapshotPath 时解析仍能得到路径，但远程优先逻辑可筛掉死链', () => {
  const meta = parseVideoMeta({
    videoUrl: 'https://cdn.example/a.mp4',
    snapshotPath: '/storage/emulated/0/cover.jpg',
    duration: 2,
  })
  assert.equal(meta.url, 'https://cdn.example/a.mp4')
  assert.equal(meta.snapshotUrl, '/storage/emulated/0/cover.jpg')
  // 气泡入库时应只留远程封面：本地路径对接收端无效
  assert.equal(/^https?:\/\//i.test(meta.snapshotUrl), false)
})

test('snapshotUrl 为对象时取出内部 url', () => {
  assert.deepEqual(
    parseVideoMeta({
      videoUrl: 'https://cdn.example/a.mp4',
      snapshotUrl: { url: 'https://cdn.example/a.jpg' },
      duration: 2,
    }),
    { url: 'https://cdn.example/a.mp4', snapshotUrl: 'https://cdn.example/a.jpg', duration: 2 },
  )
})

test('播放页使用消息封面作为视频缓冲首屏', () => {
  assert.equal(
    videoPosterUrlFromContent(JSON.stringify({ snapshotUrl: 'https://cdn.example/a.jpg' })),
    'https://cdn.example/a.jpg',
  )
  assert.equal(videoPosterUrlFromContent(JSON.stringify({ snapshotUrl: 'https://cdn.example/a.mp4' })), '')
})
