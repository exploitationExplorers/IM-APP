import type { UserInfo, Contact, GroupPreview, ChatMessage, Conversation, FriendRequest, GroupInfo, GroupMember } from '@/types'
import { SEED_USERS } from './seed/user'
import { SEED_CONTACTS, SEED_FRIEND_REQUESTS, SEED_GROUPS } from './seed/contact'
import { SEED_CONVERSATIONS, SEED_MESSAGES, SEED_CONV_MEMBERS } from './seed/chat'
import { SEED_GROUP_DETAILS, SEED_GROUP_MEMBERS } from './seed/group'

export interface MockFriendRequest extends FriendRequest {
  toUserId: string
}

export interface MockState {
  users: UserInfo[]
  passwords: Record<string, string>
  contacts: Contact[]
  groups: GroupPreview[]
  groupDetails: Record<string, GroupInfo>
  groupMembers: Record<string, GroupMember[]>
  friendRequests: MockFriendRequest[]
  conversations: Conversation[]
  messages: Record<string, ChatMessage[]>
  convMembers: Record<string, string[]>
  blockedUserIds: string[]
  currentUserId: string | null
  nextPublicId: number
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function createInitialState(): MockState {
  return {
    users: deepClone(SEED_USERS),
    passwords: { '13800138000': '123456' },
    contacts: deepClone(SEED_CONTACTS),
    groups: deepClone(SEED_GROUPS),
    groupDetails: deepClone(SEED_GROUP_DETAILS),
    groupMembers: deepClone(SEED_GROUP_MEMBERS),
    friendRequests: deepClone(SEED_FRIEND_REQUESTS),
    conversations: deepClone(SEED_CONVERSATIONS),
    messages: deepClone(SEED_MESSAGES),
    convMembers: deepClone(SEED_CONV_MEMBERS),
    blockedUserIds: [],
    currentUserId: null,
    nextPublicId: 10005,
  }
}

let state: MockState = createInitialState()

export function getMockState(): MockState {
  return state
}

export function resetMockState() {
  state = createInitialState()
}

export function mutateMockState(fn: (s: MockState) => void) {
  fn(state)
}

export function delay(ms = 300) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function genPublicId(n: number) {
  return `chat${n}`
}

export function findUserById(id: string): UserInfo | undefined {
  return state.users.find((u) => u.id === id)
}

export function findUserByPhone(phone: string): UserInfo | undefined {
  return state.users.find((u) => u.phone === phone)
}

export function findUserByPublicId(publicId: string): UserInfo | undefined {
  return state.users.find((u) => u.publicId === publicId)
}

export function toPublicUser(u: UserInfo): UserInfo {
  return {
    id: u.id,
    phone: u.phone,
    countryCode: u.countryCode,
    publicId: u.publicId,
    nickname: u.nickname,
    avatar: u.avatar,
    bio: u.bio,
    status: u.status,
  }
}

export function resolveCurrentUserId(token?: string): string {
  if (state.currentUserId) return state.currentUserId
  if (token?.startsWith('mock_token_')) {
    const phone = token.replace('mock_token_', '')
    const user = findUserByPhone(phone)
    if (user) return user.id
  }
  return 'u_me'
}
