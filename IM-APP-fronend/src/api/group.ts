import { request } from '@/utils/request'
import { parseQrcodePayload } from '@/utils/qrcode'
import type {
  GroupInfo,
  GroupMember,
  GroupQRCodeResolveResult,
  JoinGroupByQRCodeResult,
} from '@/types'

export async function createGroup(name: string, memberIds: string[]): Promise<GroupInfo> {
  return request<GroupInfo>({
    url: '/groups',
    method: 'POST',
    data: { name, memberIds },
  })
}

export async function fetchGroupDetail(groupId: string): Promise<GroupInfo> {
  return request<GroupInfo>({ url: `/groups/${groupId}`, method: 'GET' })
}

export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  return request<GroupMember[]>({ url: `/groups/${groupId}/members`, method: 'GET' })
}

export async function joinGroup(groupId: string): Promise<GroupInfo> {
  return request<GroupInfo>({ url: `/groups/${groupId}/join`, method: 'POST' })
}

export async function updateGroupSettings(
  groupId: string,
  input: { announcement?: string; allowMemberAddFriend?: boolean },
) {
  return request<{ ok: boolean }>({
    url: `/groups/${groupId}/settings`,
    method: 'PUT',
    data: input,
  })
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

export async function muteGroupMember(
  groupId: string,
  memberUserId: string,
  mutedSeconds: number,
): Promise<void> {
  await request<{ ok: boolean }>({
    url: `/groups/${groupId}/members/${memberUserId}/mute`,
    method: 'PUT',
    data: { mutedSeconds },
  })
}

export async function removeGroupMember(groupId: string, memberUserId: string): Promise<void> {
  await request<{ ok: boolean }>({
    url: `/groups/${groupId}/members/${memberUserId}`,
    method: 'DELETE',
  })
}

