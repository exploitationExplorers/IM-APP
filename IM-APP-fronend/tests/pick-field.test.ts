import { describe, expect, it } from 'vitest'
import { pickField } from '@/utils/pickField'

describe('pickField', () => {
  it('优先读 camelCase', () => {
    expect(pickField({ videoUrl: 'a', VideoUrl: 'b' }, 'videoUrl')).toBe('a')
  })

  it('camelCase 为空时回退 PascalCase', () => {
    expect(pickField({ VideoUrl: 'b', videoUrl: '' }, 'videoUrl')).toBe('b')
  })

  it('保留数字 0', () => {
    expect(pickField({ width: 0, Width: 12 }, 'width')).toBe(0)
  })

  it('非对象返回 undefined', () => {
    expect(pickField(null, 'videoUrl')).toBeUndefined()
    expect(pickField('x', 'videoUrl')).toBeUndefined()
  })
})
