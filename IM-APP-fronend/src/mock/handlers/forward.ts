import { delay } from '@/mock/store'
import type { ForwardTask } from '@/api/forward'

const tasks = new Map<string, ForwardTask>()

export async function mockCreateForwardTask(
  sourceMessageId: string,
  targetConvIds: string[],
): Promise<ForwardTask> {
  await delay(300)
  const id = `fwd_${Date.now()}`
  const task: ForwardTask = {
    id,
    status: 'pending',
    targetCount: targetConvIds.length,
    doneCount: 0,
    sourceMessageId,
  }
  tasks.set(id, task)
  setTimeout(() => {
    const t = tasks.get(id)
    if (t) {
      t.status = 'done'
      t.doneCount = t.targetCount
    }
  }, 1500)
  return task
}

export async function mockFetchForwardTask(taskId: string): Promise<ForwardTask> {
  await delay(100)
  const task = tasks.get(taskId)
  if (!task) throw new Error('任务不存在')
  return { ...task }
}
