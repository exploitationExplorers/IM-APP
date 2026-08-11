import { APP_CONFIG } from '@/config'
import { request } from '@/utils/request'
import type { GroupInfo, GroupMember } from '@/types'
import {
  mockCreateGroup,
  mockFetchGroupDetail,
  mockFetchGroupMembers,
  mockJoinGroup,
  mockLeaveGroup,
  mockUpdateGroupSettings,
} from '@/mock/handlers/group'

export async function createGroup(name: string, memberIds: string[]): Promise<GroupInfo> {
  if (APP_CONFIG.useMock) return mockCreateGroup(name, memberIds)
  return request<GroupInfo>({
    url: '/groups',
    method: 'POST',
    data: { name, memberIds },
  })
}

export async function fetchGroupDetail(groupId: string): Promise<GroupInfo> {
  if (APP_CONFIG.useMock) return mockFetchGroupDetail(groupId)
  return request<GroupInfo>({ url: `/groups/${groupId}`, method: 'GET' })
}

export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  if (APP_CONFIG.useMock) return mockFetchGroupMembers(groupId)
  return request<GroupMember[]>({ url: `/groups/${groupId}/members`, method: 'GET' })
}

export async function joinGroup(groupId: string): Promise<GroupInfo> {
  if (APP_CONFIG.useMock) return mockJoinGroup(groupId)
  return request<GroupInfo>({ url: `/groups/${groupId}/join`, method: 'POST' })
}

export async function updateGroupSettings(
  groupId: string,
  input: { announcement?: string; allowMemberAddFriend?: boolean },
) {
  if (APP_CONFIG.useMock) return mockUpdateGroupSettings(groupId, input)
  return request<{ ok: boolean }>({
    url: `/groups/${groupId}/settings`,
    method: 'PUT',
    data: input,
  })
}

export async function leaveGroup(groupId: string) {
  if (APP_CONFIG.useMock) return mockLeaveGroup(groupId)
  return request<{ ok: boolean }>({ url: `/groups/${groupId}/leave`, method: 'POST' })
}
