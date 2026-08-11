import { APP_CONFIG } from '@/config'
import { request } from '@/utils/request'
import { mockCreateForwardTask, mockFetchForwardTask } from '@/mock/handlers/forward'

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
  if (APP_CONFIG.useMock) return mockCreateForwardTask(sourceMessageId, targetConvIds)
  return request<ForwardTask>({
    url: '/forward-tasks',
    method: 'POST',
    data: { sourceMessageId, targetConvIds },
  })
}

export async function fetchForwardTask(taskId: string): Promise<ForwardTask> {
  if (APP_CONFIG.useMock) return mockFetchForwardTask(taskId)
  return request<ForwardTask>({ url: `/forward-tasks/${taskId}`, method: 'GET' })
}
