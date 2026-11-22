import { describe, expect, it, vi } from 'vitest'
import { createDirectForward } from '@/utils/directForward'

const target = (id: string) => ({ resolveConversation: async () => id })

describe('direct forwarding', () => {
  it('continues after an image fails and only retries unconfirmed deliveries', async () => {
    const error = new Error('图片发送失败')
    let shouldFail = true
    const send = vi.fn(async (id: string, image: string, _clientMsgID: string) => {
      if (id === 'first' && image === 'image-2' && shouldFail) {
        shouldFail = false
        throw error
      }
    })
    const run = createDirectForward(
      [target('first'), target('second'), target('second')],
      ['image-1', 'image-2', 'image-3'],
      send,
    )

    expect(await run()).toEqual({ sentCount: 5, failedCount: 1, firstError: error })
    for (const id of ['first', 'second']) {
      expect(send.mock.calls.filter(([peer]) => peer === id).map(([peer, image]) => [peer, image])).toEqual([
        [id, 'image-1'], [id, 'image-2'], [id, 'image-3'],
      ])
    }

    expect(await run()).toMatchObject({ sentCount: 6, failedCount: 0 })
    expect(send.mock.calls.slice(6)).toEqual([send.mock.calls.find(([id, image]) => id === 'first' && image === 'image-2')])
  })

  it('continues processing other recipients when a conversation cannot be resolved', async () => {
    const error = new Error('会话已失效')
    const resolveConversation = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('first')
    const send = vi.fn(async (_id: string, _image: string, _clientMsgID: string) => {})
    const run = createDirectForward(
      [{ resolveConversation }, target('second'), target('third'), target('fourth'), target('fifth')],
      ['image-1', 'image-2'],
      send,
    )

    expect(await run()).toEqual({ sentCount: 8, failedCount: 2, firstError: error })
    expect(await run()).toMatchObject({ sentCount: 10, failedCount: 0 })
    expect(send.mock.calls.slice(8).map(([id, image]) => [id, image])).toEqual([
      ['first', 'image-1'], ['first', 'image-2'],
    ])
  })
})
