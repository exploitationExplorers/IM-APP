import { describe, expect, it } from 'vitest'
import { isGroupPurgeTipText } from '@/utils/im-notification'

describe('isGroupPurgeTipText', () => {
  it('识别服务端 groupPurgeTipText 生成的文案', () => {
    expect(isGroupPurgeTipText('群主清除了「小王」的全部消息')).toBe(true)
    expect(isGroupPurgeTipText(' 管理员清除了「广告 号」的全部消息 ')).toBe(true)
    expect(isGroupPurgeTipText('管理员清除了「该成员」的全部消息')).toBe(true)
  })

  it('不误判普通文本', () => {
    expect(isGroupPurgeTipText('群主清除了「」的全部消息')).toBe(false)
    expect(isGroupPurgeTipText('我清除了「小王」的全部消息')).toBe(false)
    expect(isGroupPurgeTipText('群主清除了「小王」的全部消息，大家注意')).toBe(false)
  })
})
