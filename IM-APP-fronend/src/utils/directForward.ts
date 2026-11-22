import { createIdempotencyKey } from './forwardSnapshot'

interface DirectForwardTarget {
  resolveConversation: () => Promise<string>
}

export function createDirectForward<T>(
  targets: DirectForwardTarget[],
  messages: T[],
  send: (conversationId: string, message: T, clientMsgID: string) => Promise<void>,
) {
  const deliveries = new Map<string, Array<{ clientMsgID: string; sent: boolean }>>()
  const jobs = targets.map((target) => ({ ...target, conversationId: '' }))

  return async function sendPending() {
    let cursor = 0
    let failedCount = 0
    let firstError: unknown
    const claimedConversations = new Set<string>()

    function recordFailure(error: unknown, count: number) {
      if (failedCount === 0) firstError = error
      failedCount += count
    }

    async function run() {
      while (cursor < jobs.length) {
        const job = jobs[cursor]
        cursor += 1
        try {
          if (!job.conversationId) job.conversationId = await job.resolveConversation()
        } catch (error) {
          recordFailure(error, messages.length)
          continue
        }
        const { conversationId } = job
        if (claimedConversations.has(conversationId)) continue
        claimedConversations.add(conversationId)

        let entries = deliveries.get(conversationId)
        if (!entries) {
          entries = messages.map(() => ({ clientMsgID: createIdempotencyKey(), sent: false }))
          deliveries.set(conversationId, entries)
        }
        // 同一个会话按选中顺序发送，各会话之间可并行。
        for (const [index, message] of messages.entries()) {
          const entry = entries[index]
          if (entry.sent) continue
          try {
            await send(conversationId, message, entry.clientMsgID)
            entry.sent = true
          } catch (error) {
            recordFailure(error, 1)
          }
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, run))
    const sentCount = [...deliveries.values()].reduce(
      (total, entries) => total + entries.filter((entry) => entry.sent).length,
      0,
    )
    return { sentCount, failedCount, firstError }
  }
}
