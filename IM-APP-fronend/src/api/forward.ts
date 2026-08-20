import { request } from '@/utils/request'
import type {
  AffectedCountResult,
  CreateForwardTaskInput,
  ForwardSelector,
  ForwardTask,
  ForwardTaskPage,
  ForwardTaskTargetPage,
  OkResult,
} from '@/types/forward'

const TARGET_WRITE_BATCH = 1000

export function forwardTargetWriteBatch(): number {
  return TARGET_WRITE_BATCH
}

export async function createForwardTask(input: CreateForwardTaskInput): Promise<ForwardTask> {
  return request<ForwardTask>({
    url: '/forward-tasks',
    method: 'POST',
    data: input,
  })
}

export interface CreateForwardBatchInput {
  messages: Array<{
    sourceConversationId: string
    sourceClientMsgId: string
    sourceServerMsgId?: string
    sourceSnapshot: CreateForwardTaskInput['sourceSnapshot']
  }>
  targetUserIds?: string[]
  targetGroupIds?: string[]
  selector?: ForwardSelector
  excludeUserIds?: string[]
  idempotencyKey: string
}

export interface ForwardBatchAccepted {
  batchId: string
  taskIds: string[]
  status: 'queued'
}

export async function createForwardBatch(input: CreateForwardBatchInput): Promise<ForwardBatchAccepted> {
  return request<ForwardBatchAccepted>({ url: '/forward-batches', method: 'POST', data: input })
}

export async function fetchForwardTasks(params?: {
  status?: string
  cursor?: string
  limit?: number
}): Promise<ForwardTaskPage> {
  const data: Record<string, string | number> = {}
  if (params?.status) data.status = params.status
  if (params?.cursor) data.cursor = params.cursor
  if (params?.limit) data.limit = params.limit
  return request<ForwardTaskPage>({
    url: '/forward-tasks',
    method: 'GET',
    data,
  })
}

export async function fetchForwardTaskProgress(taskId: string): Promise<ForwardTask> {
  return request<ForwardTask>({
    url: '/forward-task-progress',
    method: 'GET',
    data: { taskId },
  })
}

export async function fetchForwardTaskTargets(params: {
  taskId: string
  status?: string
  cursor?: string
  limit?: number
}): Promise<ForwardTaskTargetPage> {
  const data: Record<string, string | number> = { taskId: params.taskId }
  if (params.status) data.status = params.status
  if (params.cursor) data.cursor = params.cursor
  if (params.limit) data.limit = params.limit
  return request<ForwardTaskTargetPage>({
    url: '/forward-task-targets',
    method: 'GET',
    data,
  })
}

export async function addForwardTaskTargets(
  taskId: string,
  targetUserIds: string[],
): Promise<AffectedCountResult> {
  return request<AffectedCountResult>({
    url: '/forward-task-targets/add',
    method: 'POST',
    data: { taskId, targetUserIds },
  })
}

export async function generateForwardTaskTargets(
  taskId: string,
  selector: ForwardSelector,
): Promise<AffectedCountResult> {
  return request<AffectedCountResult>({
    url: '/forward-task-targets/generate',
    method: 'POST',
    data: { taskId, selector },
  })
}

export async function removeForwardTaskTargets(
  taskId: string,
  targetUserIds: string[],
): Promise<AffectedCountResult> {
  return request<AffectedCountResult>({
    url: '/forward-task-targets/remove',
    method: 'POST',
    data: { taskId, targetUserIds },
  })
}

export async function submitForwardTask(taskId: string): Promise<OkResult> {
  return request<OkResult>({
    url: '/forward-tasks/submit',
    method: 'POST',
    data: { taskId },
  })
}

export async function cancelForwardTask(taskId: string, reason?: string): Promise<OkResult> {
  return request<OkResult>({
    url: '/forward-tasks/cancel',
    method: 'POST',
    data: { taskId, reason },
  })
}

export async function retryForwardTask(
  taskId: string,
  onlyFailed = true,
  targetUserIds?: string[],
): Promise<AffectedCountResult> {
  return request<AffectedCountResult>({
    url: '/forward-tasks/retry',
    method: 'POST',
    data: {
      taskId,
      onlyFailed,
      ...(targetUserIds?.length ? { targetUserIds } : {}),
    },
  })
}

export async function pauseForwardTask(taskId: string): Promise<OkResult> {
  return request<OkResult>({
    url: '/forward-tasks/pause',
    method: 'POST',
    data: { taskId },
  })
}

export async function resumeForwardTask(taskId: string): Promise<OkResult> {
  return request<OkResult>({
    url: '/forward-tasks/resume',
    method: 'POST',
    data: { taskId },
  })
}
