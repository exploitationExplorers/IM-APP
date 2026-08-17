/** 万人转发任务（与 api-contract 对齐） */

export type ForwardTaskStatus =
  | 'draft'
  | 'expanding'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'paused'
  | 'cancelled'

export type ForwardTargetStatus =
  | 'pending'
  | 'processing'
  | 'retrying'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type ForwardSelectorMode = 'all_friends' | 'tags' | 'search'

export interface ForwardSelector {
  mode: ForwardSelectorMode
  tagIds?: string[]
  keyword?: string
}

/** OpenIM send_msg 冻结内容；任务创建后不可改 */
export interface ForwardMessageSnapshot {
  contentType: number
  content: unknown
}

export interface ForwardTask {
  id: string
  sourceConversationId: string
  sourceClientMsgId: string
  sourceServerMsgId?: string
  sourceMessageId?: string
  sourceSnapshot: ForwardMessageSnapshot
  selector: ForwardSelector
  idempotencyKey: string
  status: ForwardTaskStatus
  targetCount: number
  doneCount: number
  successCount: number
  failedCount: number
  skippedCount: number
  cancelledCount: number
  pendingCount: number
  processingCount: number
  startedAt?: string
  finishedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ForwardTaskTarget {
  id: string
  taskId: string
  targetUserId: string
  status: ForwardTargetStatus
  attempts: number
  conversationId?: string
  sentClientMsgId?: string
  sentServerMsgId?: string
  failureCode?: string
  failureMessage?: string
  nextRetryAt: string
  finishedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ForwardTaskPage {
  items: ForwardTask[]
  nextCursor?: string
  hasMore: boolean
}

export interface ForwardTaskTargetPage {
  items: ForwardTaskTarget[]
  nextCursor?: string
  hasMore: boolean
}

export interface CreateForwardTaskInput {
  sourceConversationId?: string
  sourceClientMsgId?: string
  sourceServerMsgId?: string
  sourceMessageId?: string
  sourceSnapshot: ForwardMessageSnapshot
  selector?: ForwardSelector
  idempotencyKey?: string
  targetUserIds?: string[]
}

export interface AffectedCountResult {
  affectedCount: number
}

export interface OkResult {
  ok: boolean
}

export type FriendForwardPlan =
  | { kind: 'all_friends'; excludeUserIds: string[] }
  | { kind: 'generate'; selector: ForwardSelector; extraUserIds: string[] }
  | { kind: 'ids'; userIds: string[] }
