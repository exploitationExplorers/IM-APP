import { ref, shallowRef, watch } from 'vue'

interface ComposerInputTarget {
  dataset?: { composerEpoch?: string | number }
}

export interface ComposerInputEvent {
  detail?: { value?: string } | number
  currentTarget?: EventTarget | ComposerInputTarget | null
  target?: EventTarget | ComposerInputTarget | null
}

/** 隔离原生输入控件的延迟事件，并保护发送期间新输入的草稿。 */
export function useChatComposerInput(remountOnClear: () => boolean) {
  const input = ref('')
  const inputEpoch = shallowRef(0)
  let revision = 0

  watch(input, () => {
    revision += 1
  }, { flush: 'sync' })

  function isCurrentEvent(event?: ComposerInputEvent): boolean {
    const currentTarget = event?.currentTarget as ComposerInputTarget | undefined
    const target = event?.target as ComposerInputTarget | undefined
    const epoch = currentTarget?.dataset?.composerEpoch ?? target?.dataset?.composerEpoch
    return epoch === undefined || Number(epoch) === inputEpoch.value
  }

  function onInput(event: ComposerInputEvent, currentValue?: string): boolean {
    if (!isCurrentEvent(event)) return false
    const detail = event.detail
    // H5 使用 DOM 当前值，不能让节流队列中的旧 detail 覆盖清空或后续输入。
    if (currentValue !== undefined) input.value = currentValue
    else if (typeof detail === 'object' && typeof detail?.value === 'string') input.value = detail.value
    return true
  }

  function clearForSend() {
    const text = input.value
    input.value = ''
    // iOS 输入法的延迟 input 会取消 uni-textarea 内部的 value 同步，换实例以清掉内部状态。
    if (remountOnClear()) inputEpoch.value += 1
    return { text, revision, epoch: inputEpoch.value }
  }

  function restoreAfterFailure(snapshot: ReturnType<typeof clearForSend>): boolean {
    if (snapshot.revision !== revision || snapshot.epoch !== inputEpoch.value) return false
    input.value = snapshot.text
    return true
  }

  return { input, inputEpoch, isCurrentEvent, onInput, clearForSend, restoreAfterFailure }
}
