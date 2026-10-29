import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { useChatComposerInput, type ComposerInputEvent } from '@/composables/useChatComposerInput'

const scopes: EffectScope[] = []

function createComposer(remount = true) {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useChatComposerInput(() => remount))!
}

function inputEvent(value: string, epoch: number): ComposerInputEvent {
  return { detail: { value }, currentTarget: { dataset: { composerEpoch: String(epoch) } } }
}

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
})

describe('聊天输入框发送事务', () => {
  it('iOS App 发送后清空文本并更换输入控件', () => {
    const composer = createComposer()
    composer.onInput(inputEvent('1', 0))

    composer.clearForSend()

    expect(composer.input.value).toBe('')
    expect(composer.inputEpoch.value).toBe(1)
  })

  it('H5 和 Android 清空时保留原来的输入控件', () => {
    const composer = createComposer(false)
    composer.onInput(inputEvent('hello', 0))
    composer.clearForSend()
    expect(composer.input.value).toBe('')
    expect(composer.inputEpoch.value).toBe(0)
    expect(composer.onInput(inputEvent('next', 0))).toBe(true)
    expect(composer.input.value).toBe('next')
  })

  it('H5 延迟事件采用 DOM 当前值，不能回写已发送文本或覆盖新草稿', () => {
    const composer = createComposer(false)
    composer.input.value = '已发送'
    composer.clearForSend()
    composer.onInput(inputEvent('已发送', 0), '')
    expect(composer.input.value).toBe('')
    composer.onInput(inputEvent('已发送', 0), '下一条')
    expect(composer.input.value).toBe('下一条')
  })

  it('过滤第三方输入法在发送后回写的旧 input 事件', () => {
    const composer = createComposer()
    composer.onInput(inputEvent('已发送', 0))
    composer.clearForSend()

    expect(composer.onInput(inputEvent('已发送', 0))).toBe(false)
    expect(composer.input.value).toBe('')
  })

  it('旧控件的 confirm、focus、blur 不能影响新控件', () => {
    const composer = createComposer()
    composer.clearForSend()
    expect(composer.isCurrentEvent(inputEvent('旧消息', 0))).toBe(false)
    expect(composer.isCurrentEvent(inputEvent('', 1))).toBe(true)
    expect(composer.isCurrentEvent({ target: { dataset: { composerEpoch: 0 } } })).toBe(false)
  })

  it('允许用户主动再次输入相同内容，不按文本内容屏蔽输入', () => {
    const composer = createComposer()
    composer.onInput(inputEvent('1', 0))
    composer.clearForSend()
    expect(composer.onInput(inputEvent('1', 1))).toBe(true)
    expect(composer.input.value).toBe('1')
  })

})

describe('发送失败后的草稿恢复', () => {
  it('发送失败且用户未编辑时恢复原始草稿，包括空格和换行', () => {
    const composer = createComposer()
    composer.input.value = '  消息\n'
    const snapshot = composer.clearForSend()
    expect(composer.restoreAfterFailure(snapshot)).toBe(true)
    expect(composer.input.value).toBe('  消息\n')
  })

  it('发送期间新输入的草稿不能被旧消息失败回调覆盖', () => {
    const composer = createComposer()
    composer.input.value = '第一条'
    const snapshot = composer.clearForSend()
    composer.onInput(inputEvent('第二条', 1))
    expect(composer.restoreAfterFailure(snapshot)).toBe(false)
    expect(composer.input.value).toBe('第二条')
  })

  it('用户主动清空新草稿后，失败回调也不能恢复旧消息', () => {
    const composer = createComposer()
    composer.input.value = '第一条'
    const snapshot = composer.clearForSend()
    composer.onInput(inputEvent('第二条', 1))
    composer.onInput(inputEvent('', 1))
    expect(composer.restoreAfterFailure(snapshot)).toBe(false)
    expect(composer.input.value).toBe('')
  })

  it('表情和 @ 提及等程序写入的草稿也受到保护', () => {
    const composer = createComposer()
    composer.input.value = '第一条'
    const snapshot = composer.clearForSend()
    composer.input.value = '@张三 😀'
    expect(composer.restoreAfterFailure(snapshot)).toBe(false)
    expect(composer.input.value).toBe('@张三 😀')
  })

  it('连续发送后，较早消息的失败不能恢复到最新的空输入框', () => {
    const composer = createComposer()
    composer.input.value = '第一条'
    const first = composer.clearForSend()
    composer.onInput(inputEvent('第二条', 1))
    const second = composer.clearForSend()
    expect(composer.restoreAfterFailure(first)).toBe(false)
    expect(composer.restoreAfterFailure(second)).toBe(true)
    expect(composer.input.value).toBe('第二条')
  })
})
