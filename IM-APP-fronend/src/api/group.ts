import { request } from '@/utils/request'
import { parseQrcodePayload } from '@/utils/qrcode'
import type {
  GroupInfo,
  GroupJoinRequestItem,
  GroupMember,
  GroupMemberPage,
  GroupMemberMuteResult,
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

/** ???????? cursor ????? cursor ???????? */
export async function fetchGroupMembers(
  groupId: string,
  opts?: { cursor?: string; limit?: number },
): Promise<GroupMemberPage | GroupMember[]> {
  const data: Record<string, string | number> = { groupId, limit: opts?.limit ?? 100 }
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

/** ???????????? API? */
export async function fetchAllGroupMembers(groupId: string): Promise<GroupMember[]> {
  const all: GroupMember[] = []
  let cursor = ''
  for (;;) {
    const page = await fetchGroupMembers(groupId, { cursor, limit: 100 })
    if (Array.isArray(page)) return page
    all.push(...page.items)
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return all
}

export async function joinGroup(groupId: string): Promise<GroupInfo> {
  return request<GroupInfo>({ url: `/groups/${groupId}/join`, method: 'POST' })
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

export async function removeGroupMember(groupId: string, memberUserId: string): Promise<void> {
  await request<{ ok: boolean }>({
    url: `/groups/${groupId}/members/${memberUserId}`,
    method: 'DELETE',
  })
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
