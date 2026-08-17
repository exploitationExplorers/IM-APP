import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  addForwardTaskTargets,
  createForwardTask,
  fetchForwardTaskProgress,
  forwardTargetWriteBatch,
  generateForwardTaskTargets,
  removeForwardTaskTargets,
  submitForwardTask,
} from '@/api/forward'
import type { FriendForwardPlan, ForwardMessageSnapshot, ForwardTask } from '@/types/forward'
import { chunkIds, createIdempotencyKey } from '@/utils/forwardSnapshot'

export interface ForwardSourcePayload {
  sourceConversationId: string
  sourceClientMsgId: string
  sourceServerMsgId?: string
  snapshot: ForwardMessageSnapshot
}

export const useForwardStore = defineStore('forward', () => {
  const sourceConversationId = ref('')
  const messageIds = ref<string[]>([])
  const lastTaskIds = ref<string[]>([])
  const justSucceeded = ref(false)

  function start(conversationId: string, ids: string[]) {
    sourceConversationId.value = conversationId
    messageIds.value = [...new Set(ids)]
    lastTaskIds.value = []
  }

  function markSucceeded() {
    justSucceeded.value = true
  }

  function consumeSucceeded() {
    const ok = justSucceeded.value
    justSucceeded.value = false
    return ok
  }

  function clear() {
    sourceConversationId.value = ''
    messageIds.value = []
  }

  async function submitFriendPlan(
    sources: ForwardSourcePayload[],
    plan: FriendForwardPlan,
  ): Promise<string[]> {
    if (!sources.length) throw new Error('没有可转发的消息')
    const batchKey = createIdempotencyKey()
    const taskIds: string[] = []
    for (let i = 0; i < sources.length; i += 1) {
      const task = await createAndFillTask(sources[i], plan, `${batchKey}-${i}`)
      if (task.targetCount <= 0) throw new Error('没有可转发的好友')
      await submitForwardTask(task.id)
      taskIds.push(task.id)
    }
    lastTaskIds.value = taskIds
    return taskIds
  }

  return {
    sourceConversationId,
    messageIds,
    lastTaskIds,
    start,
    markSucceeded,
    consumeSucceeded,
    clear,
    submitFriendPlan,
  }
})

async function createAndFillTask(
  source: ForwardSourcePayload,
  plan: FriendForwardPlan,
  idempotencyKey: string,
): Promise<ForwardTask> {
  const batch = forwardTargetWriteBatch()
  const firstIds = initialTargetIds(plan).slice(0, batch)
  const task = await createForwardTask({
    sourceConversationId: source.sourceConversationId,
    sourceClientMsgId: source.sourceClientMsgId,
    sourceServerMsgId: source.sourceServerMsgId,
    sourceSnapshot: source.snapshot,
    idempotencyKey,
    targetUserIds: firstIds,
    ...(plan.kind === 'generate' ? { selector: plan.selector } : {}),
  })
  await fillRemainingTargets(task.id, plan, firstIds.length)
  return fetchForwardTaskProgress(task.id)
}

function initialTargetIds(plan: FriendForwardPlan): string[] {
  if (plan.kind === 'ids') return uniqueIds(plan.userIds)
  if (plan.kind === 'generate') return uniqueIds(plan.extraUserIds)
  return []
}

async function fillRemainingTargets(
  taskId: string,
  plan: FriendForwardPlan,
  alreadySent: number,
): Promise<void> {
  const batch = forwardTargetWriteBatch()
  if (plan.kind === 'all_friends') {
    await generateForwardTaskTargets(taskId, { mode: 'all_friends' })
    for (const ids of chunkIds(uniqueIds(plan.excludeUserIds), batch)) {
      await removeForwardTaskTargets(taskId, ids)
    }
    return
  }
  if (plan.kind === 'generate') {
    await generateForwardTaskTargets(taskId, plan.selector)
    const extras = uniqueIds(plan.extraUserIds).slice(alreadySent)
    for (const ids of chunkIds(extras, batch)) {
      await addForwardTaskTargets(taskId, ids)
    }
    return
  }
  const rest = uniqueIds(plan.userIds).slice(alreadySent)
  for (const ids of chunkIds(rest, batch)) {
    await addForwardTaskTargets(taskId, ids)
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}
