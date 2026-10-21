import { afterEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ apiBaseUrl: '/api/v1' }))
vi.mock('@/config', () => ({ APP_CONFIG: config }))

import { listThumbnailUrl, previewThumbnailUrl } from '@/utils/chatMedia'
import { mediaCacheIdentity } from '@/utils/mediaCacheIdentity'

const signedChatUrls = [
  [
    'V4 OSS signature',
    'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/chat/2026/a.jpg?x-oss-signature=a%2Bb%2F',
  ],
  [
    'V4 S3 signature',
    'https://bucket.oss-cn-hongkong.aliyuncs.com/im-app-production/chat/2026/a.jpg?X-Amz-Signature=a%2Bb',
  ],
  [
    'V2 signature',
    'https://bucket.oss-cn-hongkong.aliyuncs.com/im-app-production/chat/2026/a.jpg?OSSAccessKeyId=fake&Signature=a%2Bb%3D',
  ],
] as const

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listThumbnailUrl', () => {
  it('给对象存储图片加上 360 WebP 缩略参数', () => {
    const url = listThumbnailUrl(
      'http://8.154.44.197/object/user/msg_picture_a.jpg',
    )
    const parsed = new URL(url)
    expect(parsed.searchParams.get('type')).toBe('image')
    expect(parsed.searchParams.get('width')).toBe('360')
    expect(parsed.searchParams.get('height')).toBe('360')
    expect(parsed.searchParams.get('format')).toBe('webp')
    expect(parsed.pathname).toBe('/object/user/msg_picture_a.jpg')
  })

  it('稳定 OSS 媒体列表使用服务端 360 缩略图规格', () => {
    const url = listThumbnailUrl(
      'https://www.example.com/api/v1/public/oss-media?key=oss-test%2Fchat%2Fa.jpg&token=stable-token',
    )
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/api/v1/public/oss-media')
    expect(parsed.searchParams.get('key')).toBe('oss-test/chat/a.jpg')
    expect(parsed.searchParams.get('token')).toBe('stable-token')
    expect(parsed.searchParams.get('variant')).toBe('list')
    expect(parsed.searchParams.has('x-oss-process')).toBe(false)
  })

  it('稳定 OSS 媒体预览覆盖列表规格为桌面中图规格', () => {
    const url = previewThumbnailUrl(
      'https://www.example.com/api/v1/public/oss-media?key=oss-test%2Fchat%2Fa.jpg&token=stable-token&variant=list',
    )
    expect(new URL(url).searchParams.get('variant')).toBe('preview')
  })

  it('手机 H5 使用 960 WebP 中图规格', () => {
    vi.stubGlobal('window', { innerWidth: 390 })
    const stable = previewThumbnailUrl(
      'https://www.example.com/api/v1/public/oss-media?key=oss-test%2Fchat%2Fa.jpg&token=stable-token&variant=list',
    )
    expect(new URL(stable).searchParams.get('variant')).toBe('preview-mobile')

    const legacy = previewThumbnailUrl(
      'http://8.154.44.197/object/user/a.jpg?type=image&width=360&height=360',
    )
    const parsed = new URL(legacy)
    expect(parsed.searchParams.get('width')).toBe('960')
    expect(parsed.searchParams.get('height')).toBe('960')
    expect(parsed.searchParams.get('format')).toBe('webp')
  })

  it('桌面 H5 保持 1280 WebP 中图规格', () => {
    vi.stubGlobal('window', { innerWidth: 1440 })
    const stable = previewThumbnailUrl(
      'https://www.example.com/api/v1/public/oss-media?key=oss-test%2Fchat%2Fa.jpg&token=stable-token',
    )
    expect(new URL(stable).searchParams.get('variant')).toBe('preview')
    const legacy = new URL(previewThumbnailUrl('http://8.154.44.197/object/user/a.jpg'))
    expect(legacy.searchParams.get('width')).toBe('1280')
  })

  it('稳定 OSS 媒体地址不处理视频文件', () => {
    const url =
      'https://www.example.com/api/v1/public/oss-media?key=oss-test%2Fchat%2Fa.mp4&token=stable-token'
    expect(listThumbnailUrl(url)).toBe(url)
    expect(previewThumbnailUrl(url)).toBe(url)
  })

  it('已经是缩略图时只补 WebP 且保持幂等', () => {
    const url = 'http://8.154.44.197/object/user/a.jpg?type=image&width=360&height=360'
    const once = listThumbnailUrl(url)
    expect(new URL(once).searchParams.get('format')).toBe('webp')
    expect(listThumbnailUrl(once)).toBe(once)
  })

  it('预览把对象图放到 1280 WebP，并覆盖列表上的 360', () => {
    const url = previewThumbnailUrl(
      'http://8.154.44.197/object/user/a.jpg?type=image&width=360&height=360',
    )
    const parsed = new URL(url)
    expect(parsed.searchParams.get('type')).toBe('image')
    expect(parsed.searchParams.get('width')).toBe('1280')
    expect(parsed.searchParams.get('height')).toBe('1280')
    expect(parsed.searchParams.get('format')).toBe('webp')
  })

  it.each(signedChatUrls)('聊天 OSS 签名直链 %s 转稳定 360 入口', (_name, source) => {
    const result = listThumbnailUrl(source)
    const parsed = new URL(result, 'https://app.example')
    expect(parsed.pathname).toBe('/object/2026/a.jpg')
    expect(parsed.searchParams.get('width')).toBe('360')
    expect(parsed.searchParams.get('format')).toBe('webp')
    expect(parsed.searchParams.has('x-oss-signature')).toBe(false)
    expect(parsed.searchParams.has('X-Amz-Signature')).toBe(false)
    expect(parsed.searchParams.has('Signature')).toBe(false)
  })

  it('聊天 OSS 签名直链预览转稳定 1280 入口', () => {
    const result = previewThumbnailUrl(signedChatUrls[0][1])
    const parsed = new URL(result, 'https://app.example')
    expect(parsed.pathname).toBe('/object/2026/a.jpg')
    expect(parsed.searchParams.get('width')).toBe('1280')
    expect(parsed.searchParams.get('format')).toBe('webp')
  })

  // 2026-10-22 踩坑：CHAT_CDN_HOSTS 为了能追加 x-oss-process，把签名直连域名
  // oss-chat-test.* 和真 CDN 域名塞进了同一个集合。logicalChatKeyFromOSS 复用它
  // 做「是否永不过期」的判断后，老消息里的签名地址被当成 CDN 跳过还原，
  // 签名一过期就 403，老图永远显示不出来。
  // 下面两条锁定两种域名必须区别对待，别再把它们合并回同一个判断。
  it.each([
    'https://oss-chat-test.xn--jprz53bj9s.com/im-app-production/chat/2026/a.jpg?OSSAccessKeyId=fake&Expires=1&Signature=a%2Bb%3D',
    'https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/2026/a.jpg?x-oss-signature=a%2Bb',
  ])('签名直连域名上的老图还原成 /object/ 重新签名：%s', (source) => {
    const result = listThumbnailUrl(source)
    const parsed = new URL(result, 'https://app.example')
    expect(parsed.pathname).toBe('/object/2026/a.jpg')
    expect(parsed.searchParams.has('Expires')).toBe(false)
    expect(parsed.searchParams.has('Signature')).toBe(false)
    expect(parsed.searchParams.has('x-oss-signature')).toBe(false)
  })

  it('真 CDN 域名上的无签名地址不回退到 /object/', () => {
    const url = 'https://oss-chat.whs188.xin/im-app-production/chat/2026/a.jpg'
    const result = listThumbnailUrl(url)
    // 地址无签名、不会过期，直接让 OSS 实时出图即可，无需重新签名。
    expect(result.startsWith('https://oss-chat.whs188.xin/')).toBe(true)
    expect(result).not.toContain('/object/')
  })

  it('保留聊天逻辑 key 的目录、中文和空格编码', () => {
    const result = listThumbnailUrl(
      'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/chat/中文/空 格.jpg?x-oss-signature=test',
    )
    const parsed = new URL(result, 'https://app.example')
    expect(decodeURIComponent(parsed.pathname)).toBe('/object/中文/空 格.jpg')
    expect(parsed.pathname.startsWith('/object/')).toBe(true)
  })

  it('聊天 OSS 绝对入口跟随 App API 域名', () => {
    config.apiBaseUrl = 'https://api.example.com/api/v1'
    try {
      const result = listThumbnailUrl(signedChatUrls[0][1])
      expect(result.startsWith('https://api.example.com/object/2026/a.jpg?')).toBe(true)
    } finally {
      config.apiBaseUrl = '/api/v1'
    }
  })

  it.each([
    'https://cdn.example/oss-test/chat/a.jpg',
    'https://custom.example/object/a.jpg?OSSAccessKeyId=fake&Signature=a%2Bb%3D',
    'https://custom.example/object/a.jpg?x-oss-credential=a%2Fb&x-oss-signature=c%2Bd',
    'https://custom.example/object/a.jpg?X-Amz-Signature=a%2Bb',
    'https://legacy.example/openim/bucket/a.jpg',
    'https://bucket.example/im-app-production/business/a.jpg?x-oss-signature=a',
  ])('业务桶、未知路径和已签名代理地址保持原样：%s', (url) => {
    expect(listThumbnailUrl(url)).toBe(url)
  })

  it('不处理聊天 OSS 视频地址', () => {
    const url =
      'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/chat/clip.mp4?x-oss-signature=a%2Bb%2F'
    expect(listThumbnailUrl(url)).toBe(url)
    expect(previewThumbnailUrl(url)).toBe(url)
  })

  it.each([
    ['生产', 'https://oss-chat.whs188.xin/im-app-production/chat/2026/a.jpg'],
    ['测试', 'https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/2026/a.jpg'],
  ])('聊天 %s CDN 图片列表使用 360 WebP 处理', (_environment, source) => {
    const url = listThumbnailUrl(source)
    expect(new URL(url).searchParams.get('x-oss-process')).toBe(
      'image/resize,w_360/quality,q_60/format,webp',
    )
    expect(listThumbnailUrl(url)).toBe(url)
  })

  it.each([
    [390, 'image/resize,w_960/quality,q_72/format,webp'],
    [1440, 'image/resize,w_1280/quality,q_75/format,webp'],
  ])('聊天 CDN 图片在 %ipx 视口使用预览规格', (width, process) => {
    vi.stubGlobal('window', { innerWidth: width })
    const url = previewThumbnailUrl(
      'https://oss-chat.whs188.xin/im-app-production/chat/2026/a.jpg',
    )
    expect(new URL(url).searchParams.get('x-oss-process')).toBe(process)
  })

  it('签名聊天 CDN 地址不追加处理参数且保持原样', () => {
    const source =
      'https://oss-chat.whs188.xin/im-app-production/chat/2026/a.jpg?x-oss-signature=a%2Bb'
    expect(listThumbnailUrl(source)).toBe(source)
    expect(previewThumbnailUrl(source)).toBe(source)
  })

  it.each([
    'https://oss-business.whs188.xin/im-app-production/chat/2026/a.jpg',
    'https://oss-chat.whs188.xin/im-app-production/business/images/a.jpg',
    'https://cdn.example/im-app-production/chat/2026/a.jpg',
    'https://oss-chat.whs188.xin.evil.example/im-app-production/chat/2026/a.jpg',
  ])('不处理跨桶、未知域名或仿冒域名的 CDN 地址：%s', (source) => {
    expect(listThumbnailUrl(source)).toBe(source)
  })

  it('业务桶 CDN 直链列表并入 360 WebP 处理参数', () => {
    const url = listThumbnailUrl(
      'https://oss-business.whs188.xin/im-app-production/business/images/a.jpg',
    )
    expect(new URL(url).searchParams.get('x-oss-process')).toBe(
      'image/resize,w_360/quality,q_60/format,webp',
    )
    expect(listThumbnailUrl(url)).toBe(url)
  })

  it('业务桶直链预览按视口宽度出图，语音文件不受影响', () => {
    vi.stubGlobal('window', { innerWidth: 1440 })
    const url = previewThumbnailUrl(
      'https://oss-business.whs188.xin/im-app-production/business/images/a.jpg',
    )
    expect(new URL(url).searchParams.get('x-oss-process')).toBe(
      'image/resize,w_1280/quality,q_75/format,webp',
    )
    const voice =
      'https://oss-business.whs188.xin/im-app-production/business/voice/a.m4a'
    expect(listThumbnailUrl(voice)).toBe(voice)
    expect(previewThumbnailUrl(voice)).toBe(voice)
  })

  it('签名轮换不改变缓存身份', () => {
    const a =
      'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/chat/a.jpg?x-oss-credential=old&x-oss-signature=a'
    const b =
      'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/chat/a.jpg?x-oss-credential=new&x-oss-signature=b'
    expect(mediaCacheIdentity(a)).toBe(mediaCacheIdentity(b))
  })
})