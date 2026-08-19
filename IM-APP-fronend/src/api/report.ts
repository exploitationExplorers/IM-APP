import { request } from '@/utils/request'

export interface ReportReason {
  id: string
  targetType: string
  reason: string
  language: string
  sortOrder: number
}

export async function fetchReportReasons(targetType = 'user'): Promise<ReportReason[]> {
  return request<ReportReason[]>({
    url: `/report-reasons?targetType=${encodeURIComponent(targetType)}&language=zh`,
    method: 'GET',
  })
}

export async function createUserReport(input: {
  targetId: string
  reasonId: string
  description?: string
}): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>({
    url: '/reports',
    method: 'POST',
    data: {
      targetType: 'user',
      targetId: input.targetId,
      reasonId: input.reasonId,
      description: input.description || '',
    },
  })
}

/** 群举报原因枚举，对齐后端 /groups/reports 契约 */
export type GroupReportReason =
  | 'spam'
  | 'fraud'
  | 'pornography'
  | 'violence'
  | 'harassment'
  | 'other'

export async function createGroupReport(input: {
  groupId: string
  reason: GroupReportReason
  description?: string
  imageFileIds?: string[]
}): Promise<{ id: string; status: string; imagePaths?: string[]; createdAt?: string }> {
  return request<{ id: string; status: string; imagePaths?: string[]; createdAt?: string }>({
    url: '/groups/reports',
    method: 'POST',
    data: {
      groupId: input.groupId,
      reason: input.reason,
      description: input.description || '',
      imageFileIds: input.imageFileIds || [],
    },
  })
}
