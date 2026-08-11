import type { Contact, FriendRequest, GroupPreview } from '@/types'
import {
  delay,
  findUserById,
  genId,
  getMockState,
  mutateMockState,
  resolveCurrentUserId,
  toPublicUser,
} from '../store'

export async function mockFetchContacts(): Promise<Contact[]> {
  await delay()
  const s = getMockState()
  const uid = resolveCurrentUserId()
  return JSON.parse(JSON.stringify(s.contacts.filter((c) => {
    const userId = c.id
    return !s.blockedUserIds.includes(userId) && s.users.some((u) => u.id === userId)
  }))) as Contact[]
}

export async function mockFetchGroups(): Promise<GroupPreview[]> {
  await delay()
  return JSON.parse(JSON.stringify(getMockState().groups)) as GroupPreview[]
}

export async function mockFetchFriendRequests(): Promise<FriendRequest[]> {
  await delay()
  const uid = resolveCurrentUserId()
  const s = getMockState()
  return JSON.parse(
    JSON.stringify(
      s.friendRequests.filter((fr) => fr.toUserId === uid && fr.status === 'pending'),
    ),
  ) as FriendRequest[]
}

export async function mockSendFriendRequest(toUserId: string, message: string) {
  await delay(200)
  const uid = resolveCurrentUserId()
  const s = getMockState()
  if (uid === toUserId) throw new Error('不能添加自己')
  if (s.blockedUserIds.includes(toUserId)) throw new Error('无法发送好友申请')
  const target = findUserById(toUserId)
  if (!target) throw new Error('用户不存在')
  const alreadyFriend = s.contacts.some((c) => c.id === toUserId)
  if (alreadyFriend) throw new Error('已经是好友')
  const fromUser = findUserById(uid)!
  const dup = s.friendRequests.find(
    (fr) => fr.fromUser.id === uid && fr.toUserId === toUserId && fr.status === 'pending',
  )
  if (dup) throw new Error('已发送好友申请，请等待对方处理')

  const fr = {
    id: genId('fr'),
    toUserId: toUserId,
    fromUser: {
      id: fromUser.id,
      publicId: fromUser.publicId,
      nickname: fromUser.nickname,
      avatar: fromUser.avatar,
    },
    message: message || '请求添加你为好友',
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  }
  mutateMockState((st) => {
    st.friendRequests.unshift(fr)
  })
  return { ok: true, id: fr.id }
}

export async function mockAcceptFriendRequest(requestId: string) {
  await delay(200)
  const uid = resolveCurrentUserId()
  mutateMockState((s) => {
    const fr = s.friendRequests.find((r) => r.id === requestId)
    if (!fr || fr.status !== 'pending' || fr.toUserId !== uid) throw new Error('申请不存在')
    fr.status = 'accepted'
    const from = fr.fromUser
    if (!s.contacts.find((c) => c.id === from.id)) {
      s.contacts.push({ ...from })
    }
  })
  return { ok: true }
}

export async function mockRejectFriendRequest(requestId: string) {
  await delay(200)
  mutateMockState((s) => {
    const fr = s.friendRequests.find((r) => r.id === requestId)
    if (!fr) throw new Error('申请不存在')
    fr.status = 'rejected'
  })
  return { ok: true }
}

export async function mockDeleteContact(contactId: string) {
  await delay(200)
  mutateMockState((s) => {
    s.contacts = s.contacts.filter((c) => c.id !== contactId)
  })
  return { ok: true }
}

export async function mockBlockContact(contactId: string) {
  await delay(200)
  mutateMockState((s) => {
    if (!s.blockedUserIds.includes(contactId)) s.blockedUserIds.push(contactId)
    s.contacts = s.contacts.filter((c) => c.id !== contactId)
  })
  return { ok: true }
}

export async function mockUnblockContact(contactId: string) {
  await delay(200)
  mutateMockState((s) => {
    s.blockedUserIds = s.blockedUserIds.filter((id) => id !== contactId)
  })
  return { ok: true }
}

export async function mockGetContactConversationId(contactId: string): Promise<string | null> {
  await delay(50)
  const uid = resolveCurrentUserId()
  const s = getMockState()
  for (const conv of s.conversations) {
    if (conv.type === 'private' && conv.peerUserId === contactId) {
      return conv.id
    }
  }
  // 查找已有私聊
  for (const [convId, members] of Object.entries(s.convMembers)) {
    if (
      members.length === 2 &&
      members.includes(uid) &&
      members.includes(contactId)
    ) {
      return convId
    }
  }
  // 创建新私聊
  let newConvId = ''
  mutateMockState((st) => {
    const contact = findUserById(contactId)
    if (!contact) throw new Error('联系人不存在')
    newConvId = genId('c')
    st.conversations.unshift({
      id: newConvId,
      type: 'private',
      title: contact.nickname,
      avatar: contact.avatar,
      lastMessage: '',
      lastMessageAt: new Date().toISOString(),
      unreadCount: 0,
      peerUserId: contactId,
    })
    st.convMembers[newConvId] = [uid, contactId]
    st.messages[newConvId] = []
  })
  return newConvId
}
