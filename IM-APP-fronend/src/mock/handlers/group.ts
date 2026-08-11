import type { GroupInfo, GroupMember } from '@/types'
import {
  delay,
  findUserById,
  genId,
  getMockState,
  mutateMockState,
  resolveCurrentUserId,
} from '../store'

export async function mockCreateGroup(name: string, memberIds: string[]): Promise<GroupInfo> {
  await delay(200)
  const uid = resolveCurrentUserId()
  if (!name.trim()) throw new Error('群名称不能为空')
  let created!: GroupInfo
  mutateMockState((s) => {
    const groupId = genId('g')
    const convId = genId('c')
    const members: GroupMember[] = [{ id: uid, nickname: findUserById(uid)!.nickname, avatar: findUserById(uid)!.avatar, role: 'owner' }]
    const memberSet = new Set([uid])
    for (const mid of memberIds) {
      if (memberSet.has(mid)) continue
      memberSet.add(mid)
      const u = findUserById(mid)
      if (u) members.push({ id: u.id, nickname: u.nickname, avatar: u.avatar, role: 'member' })
    }
    created = {
      id: groupId,
      name,
      avatar: '',
      ownerId: uid,
      memberCount: members.length,
      announcement: '',
      allowMemberAddFriend: true,
      conversationId: convId,
    }
    s.groups.unshift({ id: groupId, name, avatar: '' })
    s.groupDetails[groupId] = created
    s.groupMembers[groupId] = members
    s.conversations.unshift({
      id: convId,
      type: 'group',
      title: name,
      avatar: '',
      lastMessage: '',
      lastMessageAt: new Date().toISOString(),
      unreadCount: 0,
    })
    s.convMembers[convId] = members.map((m) => m.id)
    s.messages[convId] = []
  })
  return JSON.parse(JSON.stringify(created!)) as GroupInfo
}

export async function mockFetchGroupDetail(groupId: string): Promise<GroupInfo> {
  await delay()
  const uid = resolveCurrentUserId()
  const s = getMockState()
  const g = s.groupDetails[groupId]
  if (!g) throw new Error('群不存在')
  const members = s.groupMembers[groupId] || []
  if (!members.some((m) => m.id === uid)) throw new Error('无权访问')
  return JSON.parse(JSON.stringify(g)) as GroupInfo
}

export async function mockFetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  await delay()
  const uid = resolveCurrentUserId()
  const s = getMockState()
  const members = s.groupMembers[groupId] || []
  if (!members.some((m) => m.id === uid)) throw new Error('无权访问')
  return JSON.parse(JSON.stringify(members)) as GroupMember[]
}

export async function mockJoinGroup(groupId: string): Promise<GroupInfo> {
  await delay(200)
  const uid = resolveCurrentUserId()
  const u = findUserById(uid)!
  mutateMockState((s) => {
    const g = s.groupDetails[groupId]
    if (!g) throw new Error('群不存在')
    if (!s.groupMembers[groupId]) s.groupMembers[groupId] = []
    if (!s.groupMembers[groupId].some((m) => m.id === uid)) {
      s.groupMembers[groupId].push({ id: uid, nickname: u.nickname, avatar: u.avatar, role: 'member' })
      g.memberCount = s.groupMembers[groupId].length
      if (g.conversationId) {
        s.convMembers[g.conversationId] = [...(s.convMembers[g.conversationId] || []), uid]
      }
      if (!s.groups.find((x) => x.id === groupId)) {
        s.groups.push({ id: groupId, name: g.name, avatar: g.avatar })
      }
    }
  })
  return mockFetchGroupDetail(groupId)
}

export async function mockUpdateGroupSettings(
  groupId: string,
  input: { announcement?: string; allowMemberAddFriend?: boolean },
) {
  await delay(200)
  const uid = resolveCurrentUserId()
  mutateMockState((s) => {
    const g = s.groupDetails[groupId]
    if (!g) throw new Error('群不存在')
    const me = s.groupMembers[groupId]?.find((m) => m.id === uid)
    if (!me || (me.role !== 'owner' && me.role !== 'admin')) throw new Error('无权限')
    if (input.announcement !== undefined) g.announcement = input.announcement
    if (input.allowMemberAddFriend !== undefined) g.allowMemberAddFriend = input.allowMemberAddFriend
  })
  return { ok: true }
}

export async function mockLeaveGroup(groupId: string) {
  await delay(200)
  const uid = resolveCurrentUserId()
  mutateMockState((s) => {
    const g = s.groupDetails[groupId]
    if (g?.conversationId) {
      s.convMembers[g.conversationId] = (s.convMembers[g.conversationId] || []).filter((id) => id !== uid)
    }
    if (s.groupMembers[groupId]) {
      s.groupMembers[groupId] = s.groupMembers[groupId].filter((m) => m.id !== uid)
      if (g) g.memberCount = s.groupMembers[groupId].length
    }
    s.groups = s.groups.filter((x) => x.id !== groupId)
  })
  return { ok: true }
}
