import { describe, expect, it } from 'vitest'
import { listThumbnailUrl, previewThumbnailUrl } from '@/utils/chatMedia'

describe('listThumbnailUrl', () => {
  it('给对象存储图片加上等比缩略参数', () => {
    const url = listThumbnailUrl(
      'http://8.154.44.197/object/user/msg_picture_a.jpg',
    )
    const parsed = new URL(url)
    expect(parsed.searchParams.get('type')).toBe('image')
    expect(parsed.searchParams.get('width')).toBe('360')
    expect(parsed.searchParams.get('height')).toBe('360')
    expect(parsed.pathname).toBe('/object/user/msg_picture_a.jpg')
  })

  it('已经是缩略图时不重复加参数', () => {
    const url = 'http://8.154.44.197/object/user/a.jpg?type=image&width=360&height=360'
    expect(listThumbnailUrl(url)).toBe(url)
  })

  it('预览把对象图放到 1280，并覆盖列表上的 360', () => {
    const url = previewThumbnailUrl(
      'http://8.154.44.197/object/user/a.jpg?type=image&width=360&height=360',
    )
    const parsed = new URL(url)
    expect(parsed.searchParams.get('type')).toBe('image')
    expect(parsed.searchParams.get('width')).toBe('1280')
    expect(parsed.searchParams.get('height')).toBe('1280')
  })

  it('预览不改签名直链', () => {
    const url = 'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/chat/a.jpg?x-oss-signature=a%2Bb%2F'
    expect(previewThumbnailUrl(url)).toBe(url)
  })

  it('不处理视频地址', () => {
    const url = 'http://8.154.44.197/object/user/clip.mp4'
    expect(listThumbnailUrl(url)).toBe(url)
  })

  it.each([
    'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/chat/a.jpg?x-oss-signature=a%2Bb%2F',
    'https://custom.example/object/a.jpg?OSSAccessKeyId=fake&Signature=a%2Bb%3D',
    'https://custom.example/object/a.jpg?x-oss-credential=a%2Fb&x-oss-signature=c%2Bd',
    'https://custom.example/object/a.jpg?X-Amz-Signature=a%2Bb',
    'https://cdn.example/oss-test/chat/a.jpg',
    'https://legacy.example/openim/bucket/a.jpg',
  ])('原样保留直连存储地址与签名参数：%s', (url) => {
    expect(listThumbnailUrl(url)).toBe(url)
  })
})
