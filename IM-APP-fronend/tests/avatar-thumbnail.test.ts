import { describe, expect, it } from 'vitest'
import { avatarThumbnailUrl } from '@/utils/chatMedia'

describe('avatarThumbnailUrl', () => {
  it('uses the server-side avatar variant for stable OSS media', () => {
    const url = avatarThumbnailUrl(
      'https://www.example.com/api/v1/public/oss-media?key=oss-test%2Fbusiness%2Favatars%2Fa.jpg&token=stable-token',
    )
    expect(new URL(url).searchParams.get('variant')).toBe('avatar')
  })

  it('adds a 128px WebP process to unsigned public avatar URLs', () => {
    const url = avatarThumbnailUrl(
      'https://oss-business.whs188.xin/im-app-production/business/avatars/2026/a.jpg?versionId=1',
    )
    const parsed = new URL(url)
    expect(parsed.searchParams.get('versionId')).toBe('1')
    // `q_70` without the `quality` action makes OSS answer 400 InvalidArgument.
    expect(parsed.searchParams.get('x-oss-process')).toBe(
      'image/resize,w_128/quality,q_70/format,webp',
    )
  })

  it('supports root-relative public avatar paths', () => {
    const url = avatarThumbnailUrl('/im-app-production/business/avatars/a.png')
    const parsed = new URL(url, 'https://relative.invalid')
    expect(parsed.searchParams.get('x-oss-process')).toContain('w_128')
  })

  it.each([
    'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/business/avatars/a.jpg?x-oss-signature=a%2Bb%2F',
    'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/business/avatars/a.jpg?X-Amz-Signature=a%2Bb',
    'https://bucket.oss-cn-hongkong.aliyuncs.com/oss-test/business/avatars/a.jpg?OSSAccessKeyId=fake&Signature=a%2Bb%3D',
  ])('keeps signed OSS avatar URLs byte-for-byte unchanged: %s', (source) => {
    expect(avatarThumbnailUrl(source)).toBe(source)
  })

  it('does not retry an existing OSS process or process video and non-avatar URLs', () => {
    const processed =
      'https://oss-business.whs188.xin/im-app-production/business/avatars/a.jpg?x-oss-process=image/resize,w_64'
    expect(avatarThumbnailUrl(processed)).toBe(processed)
    const video = 'https://oss-business.whs188.xin/im-app-production/business/avatars/a.mp4'
    expect(avatarThumbnailUrl(video)).toBe(video)
    const other = 'https://oss-business.whs188.xin/im-app-production/business/images/a.jpg'
    expect(avatarThumbnailUrl(other)).toBe(other)
    const chatCdn = 'https://oss-chat.whs188.xin/im-app-production/chat/avatars/a.jpg'
    expect(avatarThumbnailUrl(chatCdn)).toBe(chatCdn)
    const unknownCdn = 'https://cdn.example/im-app-production/business/avatars/a.jpg'
    expect(avatarThumbnailUrl(unknownCdn)).toBe(unknownCdn)
  })

  it('is idempotent and leaves empty values untouched', () => {
    const once = avatarThumbnailUrl(
      'https://oss-business.whs188.xin/im-app-production/business/avatars/a.jpg',
    )
    expect(avatarThumbnailUrl(once)).toBe(once)
    expect(avatarThumbnailUrl('')).toBe('')
  })
})
