import { request } from '@/utils/request'

export interface ForwardTask {
  id: string
  status: string
  targetCount: number
  doneCount: number
  sourceMessageId: string
}

export async function createForwardTask(
  sourceMessageId: string,
  targetConvIds: string[],
): Promise<ForwardTask> {
  return request<ForwardTask>({
    url: '/forward-tasks',
    method: 'POST',
    data: { sourceMessageId, targetConvIds },
  })
}

export async function fetchForwardTask(taskId: string): Promise<ForwardTask> {
  return request<ForwardTask>({ url: `/forward-tasks/${taskId}`, method: 'GET' })
}
