import { request } from '@/utils/request'
import type { GroupInfo, GroupMember } from '@/types'

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

export async function leaveGroup(groupId: string) {
  return request<{ ok: boolean }>({ url: `/groups/${groupId}/leave`, method: 'POST' })
}
