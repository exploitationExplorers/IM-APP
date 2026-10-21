import { describe, expect, it } from 'vitest'
import { mediaCacheAcceptsSize, mediaCacheKey, pickCacheEvictions } from '@/utils/mediaCache'
import {
  cacheableChatMediaUrl,
  mediaCacheIdentity,
  mediaCacheLegacyKey,
  previewMediaCacheKey,
} from '@/utils/mediaCacheIdentity'

describe('mediaCache', () => {
  it('同一地址得到稳定且不同的键', () => {
    const a = mediaCacheKey('https://cdn.example/object/a')
    const b = mediaCacheKey('https://cdn.example/object/b')
    expect(a).toHaveLength(16)
    expect(mediaCacheKey('https://cdn.example/object/a')).toBe(a)
    expect(a).not.toBe(b)
  })

  it('拒绝空文件和超过 4MB 的原图', () => {
    expect(mediaCacheAcceptsSize(0)).toBe(false)
    expect(mediaCacheAcceptsSize(-1)).toBe(false)
    expect(mediaCacheAcceptsSize(80 * 1024)).toBe(true)
    expect(mediaCacheAcceptsSize(4 * 1024 * 1024)).toBe(true)
    expect(mediaCacheAcceptsSize(4 * 1024 * 1024 + 1)).toBe(false)
  })

  it('忽略 OSS 临时签名，同一对象只产生一个缓存身份', () => {
    const a =
      'https://images.example/object/a.jpg?Expires=100&OSSAccessKeyId=fake&Signature=a%2Bb%3D'
    const b =
      'https://images.example/object/a.jpg?Security-Token=rotated&Expires=999&Signature=other'
    expect(mediaCacheIdentity(a)).toBe(mediaCacheIdentity(b))
    expect(mediaCacheIdentity(a)).toBe('https://images.example/object/a.jpg')
  })

  it('保留业务查询并规范化参数顺序和重复项', () => {
    const a = 'https://images.example/a.jpg?type=image&width=360&width=360'
    const b = 'https://images.example/a.jpg?width=360&type=image&width=360'
    expect(mediaCacheIdentity(a)).toBe(mediaCacheIdentity(b))
    expect(mediaCacheIdentity(a)).not.toBe(
      mediaCacheIdentity('https://images.example/a.jpg?type=image&width=1280'),
    )
  })

  it('不合并缩略处理参数、对象路径或不同 owner', () => {
    const original = 'https://images.example/chat/a.jpg?x-oss-process=image%2Fresize%2Cw_360'
    const preview = 'https://images.example/chat/a.jpg?x-oss-process=image%2Fresize%2Cw_1280'
    expect(mediaCacheIdentity(original)).not.toBe(mediaCacheIdentity(preview))
    expect(mediaCacheIdentity('https://images.example/chat/a.jpg')).not.toBe(
      mediaCacheIdentity('https://images.example/chat/b.jpg'),
    )
    expect(previewMediaCacheKey('a', original)).not.toBe(previewMediaCacheKey('b', original))
  })

  it('明确处理空地址、非 HTTP 地址和旧键', () => {
    expect(mediaCacheIdentity('')).toBe('')
    expect(mediaCacheIdentity('_doc/local.jpg')).toBe('_doc/local.jpg')
    expect(mediaCacheLegacyKey('a', ' https://images.example/a.jpg?token=x ')).toBe(
      JSON.stringify(['a', 'https://images.example/a.jpg?token=x']),
    )
  })

  it('只把 H5 聊天入口转换为同源绝对下载地址', () => {
    const origin = 'https://www.example.com'
    expect(
      cacheableChatMediaUrl('/object/chat/a.jpg?type=image&width=360&format=webp', origin),
    ).toBe('https://www.example.com/object/chat/a.jpg?type=image&width=360&format=webp')
    expect(
      cacheableChatMediaUrl(
        '/api/v1/public/oss-media?key=chat%2Fa.jpg&token=stable&variant=list',
        origin,
      ),
    ).toBe(
      'https://www.example.com/api/v1/public/oss-media?key=chat%2Fa.jpg&token=stable&variant=list',
    )
    expect(cacheableChatMediaUrl('/my/avatar.jpg', origin)).toBe('')
    expect(cacheableChatMediaUrl('/static/logo.png', origin)).toBe('')
    expect(cacheableChatMediaUrl('/api/v1/public/oss-file?key=a.jpg', origin)).toBe('')
  })

  it('保留聊天图片规格且忽略轮换签名后的缓存身份', () => {
    const origin = 'https://www.example.com'
    const list = cacheableChatMediaUrl('/object/chat/a.jpg?width=360&format=webp', origin)
    const preview = cacheableChatMediaUrl('/object/chat/a.jpg?width=1280&format=webp', origin)
    expect(mediaCacheIdentity(list)).not.toBe(mediaCacheIdentity(preview))

    const first = cacheableChatMediaUrl(
      '/object/chat/a.jpg?type=image&width=360&Expires=1&OSSAccessKeyId=a&Signature=one',
      origin,
    )
    const rotated = cacheableChatMediaUrl(
      '/object/chat/a.jpg?Signature=two&Expires=2&width=360&type=image&OSSAccessKeyId=b',
      origin,
    )
    expect(mediaCacheIdentity(first)).toBe(mediaCacheIdentity(rotated))
  })

  it('总量没超限时不淘汰', () => {
    expect(
      pickCacheEvictions(
        [
          { url: 'a', bytes: 100, at: 1 },
          { url: 'b', bytes: 100, at: 2 },
        ],
        50,
        1000,
      ),
    ).toEqual([])
  })

  it('超限时先淘汰最久没被用到的', () => {
    const drop = pickCacheEvictions(
      [
        { url: 'new', bytes: 400, at: 3 },
        { url: 'old', bytes: 400, at: 1 },
        { url: 'mid', bytes: 400, at: 2 },
      ],
      400,
      1000,
    )
    expect(drop[0]).toBe('old')
    expect(drop).toContain('mid')
    expect(drop).not.toContain('new')
  })
})
