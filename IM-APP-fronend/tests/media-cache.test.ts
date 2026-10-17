import { describe, expect, it } from 'vitest'
import { mediaCacheAcceptsSize, mediaCacheKey, pickCacheEvictions } from '@/utils/mediaCache'

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