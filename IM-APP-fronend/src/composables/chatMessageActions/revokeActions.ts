import type { Ref } from 'vue'
import type { ChatMessage } from '@/types'

export function createRevokeActions(deps: {
  conversationId: Ref<string>
  businessId: Ref<string>
  selecting: Ref<boolean>
  isMine: (message: ChatMessage) => boolean
  canRevoke: (message: ChatMessage) => boolean
  cancelSelect: () => void
  recall: (
    conversationId: string,
    messageId: string,
    opts: { peerId?: string; reason?: string },
  ) => Promise<void>
}) {
  function promptRevokeReason(): Promise<string | null> {
    return new Promise((resolve) => {
      uni.showModal({
        title: '撤回消息',
        editable: true,
        placeholderText: '请输入撤回原因',
        success: (res) => resolve(res.confirm ? res.content?.trim() || '管理员撤回' : null),
        fail: () => resolve(null),
      })
    })
  }

  async function recallOne(
    message: ChatMessage,
    reason: string | undefined,
  ): Promise<{ ok: true } | { ok: false; error: Error }> {
    try {
      await deps.recall(deps.conversationId.value, message.id, {
        peerId: deps.businessId.value || undefined,
        reason: deps.isMine(message) ? undefined : reason,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e : new Error('撤回失败') }
    }
  }

  async function revokeMessages(messages: ChatMessage[]) {
    const targets = messages.filter((message) => deps.canRevoke(message))
    if (!targets.length) {
      uni.showToast({ title: '没有可撤回的消息', icon: 'none' })
      return
    }
    let reason: string | undefined
    if (targets.some((message) => !deps.isMine(message))) {
      const input = await promptRevokeReason()
      if (input === null) return
      reason = input
    }
    let failed = 0
    for (const message of targets) {
      const result = await recallOne(message, reason)
      if (result.ok) continue
      failed += 1
      if (targets.length === 1) {
        uni.showToast({ title: result.error.message || '撤回失败', icon: 'none' })
        return
      }
    }
    if (deps.selecting.value) deps.cancelSelect()
    if (failed > 0) {
      uni.showToast({
        title: `已撤回 ${targets.length - failed} 条，${failed} 条失败`,
        icon: 'none',
      })
    }
  }

  return { revokeMessages }
}
