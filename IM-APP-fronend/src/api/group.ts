import { request } from '@/utils/request'
import { parseQrcodePayload } from '@/utils/qrcode'
import type {
  GroupInfo,
  GroupJoinRequestItem,
  GroupMember,
  GroupMemberPage,
  GroupMemberMuteResult,
  GroupMessagePurge,
  GroupQRCodeResolveResult,
  JoinGroupByQRCodeResult,
  GroupSettingsInput,
} from '@/types'

export async function createGroup(name: string, memberIds: string[]): Promise<GroupInfo> {
  return request<GroupInfo>({
    url: '/groups',
    method: 'POST',
    data: { name, memberIds },
  })
}

/** ????????? /groups/detail?groupId=?? canChat/isMuted ??????? */
export async function fetchGroupDetail(groupId: string): Promise<GroupInfo> {
  return request<GroupInfo>({ url: '/groups/detail', method: 'GET', data: { groupId } })
}

/**
 * 群成员单页条数，由前端决定（后端只按 limit 取数）。一页几百条会让后端一次查/
 * 序列化一大坨、客户端一次解析一大坨，取 40 把单次请求的压力摊薄。
 */
export const GROUP_MEMBERS_PAGE_SIZE = 40

/** ???????? cursor ????? cursor ???????? */
export async function fetchGroupMembers(
  groupId: string,
  opts?: { cursor?: string; limit?: number },
): Promise<GroupMemberPage | GroupMember[]> {
  const data: Record<string, string | number> = {
    groupId,
    limit: opts?.limit ?? GROUP_MEMBERS_PAGE_SIZE,
  }
  if (opts?.cursor) data.cursor = opts.cursor
  const result = await request<GroupMemberPage | GroupMember[] | unknown>({
    url: '/group-members',
    method: 'GET',
    data,
  })
  if (Array.isArray(result)) return normalizeMemberList(result)
  if (result && typeof result === 'object' && Array.isArray((result as GroupMemberPage).items)) {
    const page = result as GroupMemberPage
    return { ...page, items: normalizeMemberList(page.items) }
  }
  return { items: [], hasMore: false }
}

function normalizeMember(raw: unknown): GroupMember | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const id = String(obj.id ?? obj.ID ?? '').trim()
  if (!id) return null
  const role = String(obj.role ?? obj.Role ?? 'member').trim().toLowerCase()
  return {
    id,
    nickname: String(obj.nickname ?? obj.Nickname ?? ''),
    groupNickname: String(obj.groupNickname ?? obj.GroupNickname ?? '') || undefined,
    displayName: String(obj.displayName ?? obj.DisplayName ?? '') || undefined,
    avatar: String(obj.avatar ?? obj.Avatar ?? ''),
    role: (role === 'owner' || role === 'admin' ? role : 'member') as GroupMember['role'],
    memberRemark: String(obj.memberRemark ?? obj.MemberRemark ?? '') || undefined,
    isMuted: obj.isMuted === true || obj.IsMuted === true,
    mutedUntil: (obj.mutedUntil ?? obj.MutedUntil) as string | null | undefined,
  }
}

function normalizeMemberList(raw: unknown[]): GroupMember[] {
  return raw.map(normalizeMember).filter((m): m is GroupMember => !!m)
}

/** 拉全量群成员；按 id 去重，避免分页游标异常时群主/管理员重复 */
export async function fetchAllGroupMembers(groupId: string): Promise<GroupMember[]> {
  const all: GroupMember[] = []
  const seen = new Set<string>()
  let cursor = ''
  for (;;) {
    const page = await fetchGroupMembers(groupId, { cursor, limit: GROUP_MEMBERS_PAGE_SIZE })
    if (Array.isArray(page)) {
      for (const m of page) {
        if (seen.has(m.id)) continue
        seen.add(m.id)
        all.push(m)
      }
      return all
    }
    for (const m of page.items) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      all.push(m)
    }
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return all
}

export async function joinGroup(groupId: string): Promise<GroupInfo> {
  return request<GroupInfo>({
    url: `/groups/${encodeURIComponent(groupId)}/join`,
    method: 'POST',
  })
}

/** 群主改群号（一生一次） */
export async function updateGroupPublicId(groupId: string, publicId: string): Promise<GroupInfo> {
  return request<GroupInfo>({
    url: '/groups/public-id/update',
    method: 'POST',
    data: { groupId, publicId },
  })
}

/** 需审核的群：提交入群申请。groupId 为群公开 ID */
export async function createJoinRequest(groupId: string, remark = ''): Promise<GroupJoinRequestItem> {
  return request<GroupJoinRequestItem>({
    url: `/groups/${encodeURIComponent(groupId)}/join-requests`,
    method: 'POST',
    data: { remark },
  })
}

/** ??????????? POST /groups/settings/update?groupId ???? */
export async function updateGroupSettings(groupId: string, input: GroupSettingsInput) {
  return request<GroupInfo>({
    url: '/groups/settings/update',
    method: 'POST',
    data: { groupId, ...input },
  })
}

export async function fetchJoinRequests(groupId: string): Promise<GroupJoinRequestItem[]> {
  return request<GroupJoinRequestItem[]>({
    url: `/groups/${groupId}/join-requests`,
    method: 'GET',
  })
}

export async function approveJoinRequest(groupId: string, requestId: string): Promise<GroupInfo> {
  return request<GroupInfo>({
    url: `/groups/${groupId}/join-requests/${requestId}/approve`,
    method: 'POST',
  })
}

export async function rejectJoinRequest(groupId: string, requestId: string): Promise<void> {
  await request<{ ok: boolean }>({
    url: `/groups/${groupId}/join-requests/${requestId}/reject`,
    method: 'POST',
  })
}

export async function updateMemberRole(
  groupId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<void> {
  await request<{ ok: boolean }>({
    url: `/groups/${groupId}/members/${userId}/role`,
    method: 'PUT',
    data: { role },
  })
}

export async function dismissGroup(groupId: string): Promise<void> {
  await request<{ ok: boolean }>({
    url: `/groups/${groupId}/dismiss`,
    method: 'POST',
  })
}

/** ?????????????????? */
export async function fetchDissolvedGroup(groupId: string): Promise<{
  id: string
  name: string
  avatar: string
  status: string
}> {
  return request({ url: `/groups/${groupId}/dissolved`, method: 'GET' })
}

/** ?????????????????????? OpenIM? */
export async function removeDissolvedGroup(groupId: string): Promise<void> {
  await request({ url: `/groups/${groupId}/dissolved/remove`, method: 'POST' })
}

export async function updateGroupMyNickname(groupId: string, nickname: string) {
  return request<{ nickname: string } | null>({
    url: `/groups/${groupId}/me/nickname`,
    method: 'PUT',
    data: { nickname },
  })
}

export async function leaveGroup(groupId: string) {
  return request<{ ok: boolean }>({ url: `/groups/${groupId}/leave`, method: 'POST' })
}

export interface GroupQRCodeResult {
  groupId: string
  payload: string
  expiresAt?: string
}

export async function fetchGroupQrcode(groupId: string): Promise<GroupQRCodeResult> {
  return request<GroupQRCodeResult>({ url: `/groups/${groupId}/qrcode`, method: 'GET' })
}

export async function resolveGroupQRCode(tokenOrPayload: string): Promise<GroupQRCodeResolveResult> {
  const parsed = parseQrcodePayload(tokenOrPayload)
  const token = parsed.token || tokenOrPayload
  return request<GroupQRCodeResolveResult>({
    url: '/groups/qrcode/resolve',
    method: 'POST',
    data: {
      token,
      payload: tokenOrPayload,
      qrcode: tokenOrPayload.startsWith('http') ? tokenOrPayload : undefined,
    },
  })
}

export async function joinGroupByQRCode(
  tokenOrPayload: string,
  remark = '',
): Promise<JoinGroupByQRCodeResult> {
  const parsed = parseQrcodePayload(tokenOrPayload)
  const token = parsed.token || tokenOrPayload
  return request<JoinGroupByQRCodeResult>({
    url: '/groups/qrcode/join',
    method: 'POST',
    data: {
      token,
      payload: tokenOrPayload,
      qrcode: tokenOrPayload.startsWith('http') ? tokenOrPayload : undefined,
      remark,
    },
  })
}


export async function updateMyNickname(groupId: string, nickname: string): Promise<GroupInfo> {
  return request<GroupInfo>({
    url: `/groups/${groupId}/me/nickname`,
    method: 'PUT',
    data: { nickname },
  })
}

export async function updateGroupRemark(groupId: string, remark: string): Promise<GroupInfo> {
  return request<GroupInfo>({
    url: `/groups/${groupId}/remark`,
    method: 'PUT',
    data: { remark },
  })
}

export async function updateMemberRemark(
  groupId: string,
  memberUserId: string,
  remark: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>({
    url: `/groups/${groupId}/members/${memberUserId}/remark`,
    method: 'PUT',
    data: { remark },
  })
}

/** ?????????? POST /group-members/mute?groupId/?????? */
export async function muteGroupMember(
  groupId: string,
  memberUserId: string,
  mutedSeconds: number,
): Promise<GroupMemberMuteResult> {
  return request<GroupMemberMuteResult>({
    url: '/group-members/mute',
    method: 'POST',
    data: { groupId, memberUserId, mutedSeconds },
  })
}

/** ?????POST /group-members/unmute????????? */
export async function unmuteGroupMember(
  groupId: string,
  memberUserId: string,
): Promise<GroupMemberMuteResult> {
  return request<GroupMemberMuteResult>({
    url: '/group-members/unmute',
    method: 'POST',
    data: { groupId, memberUserId },
  })
}

/**
 * 移出群成员。deleteMessages=true 时后端同时记一条消息清理水位，
 * 群内所有客户端都会隐藏该成员的历史消息 —— 以前只在前端本地删，
 * 结果只有执行操作的管理员看不到，别人照旧能看见。
 */
export async function removeGroupMember(
  groupId: string,
  memberUserId: string,
  deleteMessages = false,
): Promise<void> {
  await request<{ ok: boolean }>({
    url: `/groups/${groupId}/members/${memberUserId}`,
    method: 'DELETE',
    data: { deleteMessages },
  })
}

/** 群内被「移除并删除消息」清理过的成员；进群时拉一次，用于隐藏其历史消息。 */
export async function fetchGroupMessagePurges(groupId: string): Promise<GroupMessagePurge[]> {
  const res = await request<{ items?: GroupMessagePurge[] }>({
    url: `/groups/${groupId}/message-purges`,
    method: 'GET',
  })
  return Array.isArray(res?.items) ? res.items : []
}

export async function inviteGroupMembers(
  groupId: string,
  userIds: string[],
): Promise<{ ok: boolean; invitedCount: number; pendingCount: number; cardFailedCount?: number }> {
  return request<{ ok: boolean; invitedCount: number; pendingCount: number; cardFailedCount?: number }>({
    url: `/groups/${groupId}/invitations`,
    method: 'POST',
    data: { userIds },
  })
}

/** ???????????????????????????? */
export async function acceptGroupInvitation(token: string): Promise<{
  nextAction: 'joined' | 'pending_approval' | 'already_member'
  group?: import('@/types').GroupInfo
}> {
  return request({
    url: `/group-invitations/${encodeURIComponent(token)}/accept`,
    method: 'POST',
  })
}


/** ????????????? 10 ???? */
export async function fetchAnnouncementHistory(groupId: string) {
  const res = await request<{ items: import('@/types').GroupAnnouncementHistoryItem[] }>({
    url: '/group-announcements',
    method: 'GET',
    data: { groupId },
  })
  return res?.items || []
}
