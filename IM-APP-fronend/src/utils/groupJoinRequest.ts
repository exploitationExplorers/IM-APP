import type { GroupJoinRequestPayload } from '@/types'
import { pickField } from '@/utils/pickField'

function parseObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function parseGroupJoinRequestPayload(raw: unknown): GroupJoinRequestPayload | null {
  const obj = parseObject(raw)
  if (!obj) return null
  const businessKey = String(pickField(obj, 'businessKey') ?? '')
  // toChatMessage 会把原始 customElem.data 归一化成 message.content，归一化结果不再携带 businessKey。
  // 因此这里既要接受原始 payload，也要接受已经归一化的 payload。
  if (businessKey && businessKey !== 'group_join_request') return null
  const requestId = String(pickField(obj, 'requestId') ?? '').trim()
  const groupId = String(pickField(obj, 'groupId') ?? '').trim()
  if (!requestId || !groupId) return null
  return {
    requestId,
    groupId,
    groupName: String(pickField(obj, 'groupName') ?? '群聊'),
    applicantId: String(pickField(obj, 'applicantId') ?? '').trim(),
    applicantNickname: String(pickField(obj, 'applicantNickname') ?? '申请人').trim(),
    applicantAvatar: String(pickField(obj, 'applicantAvatar') ?? ''),
  }
}
