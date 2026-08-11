/** @deprecated 请使用 mock/seed 与 mock/handlers */
export { delay } from './store'
export { SEED_USERS as mockCurrentUserSource } from './seed/user'

import type { UserInfo } from '@/types'
import { SEED_USERS } from './seed/user'
import { SEED_CONTACTS } from './seed/contact'
import { SEED_GROUPS, SEED_FRIEND_REQUESTS } from './seed/contact'
import { SEED_CONVERSATIONS, SEED_MESSAGES } from './seed/chat'

export const mockCurrentUser: UserInfo = SEED_USERS[0]
export const mockContacts = SEED_CONTACTS
export const mockGroups = SEED_GROUPS
export const mockConversations = SEED_CONVERSATIONS
export const mockMessages = SEED_MESSAGES
export const mockFriendRequests = SEED_FRIEND_REQUESTS
