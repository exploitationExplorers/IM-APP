import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Contact, FriendRequest, GroupPreview, SendFriendResult } from '@/types'
import {
  acceptFriendRequest,
  fetchContacts,
  fetchFriendRequests,
  fetchGroups,
  rejectFriendRequest,
  sendFriendRequest,
} from '@/api/contact'

export const useContactStore = defineStore('contact', () => {
  const contacts = ref<Contact[]>([])
  const groups = ref<GroupPreview[]>([])
  const friendRequests = ref<FriendRequest[]>([])
  const groupsExpanded = ref(false)

  async function loadAll() {
    const [c, g, fr] = await Promise.all([
      fetchContacts(),
      fetchGroups(),
      fetchFriendRequests(),
    ])
    contacts.value = c
    groups.value = g
    friendRequests.value = fr
  }

  async function acceptRequest(id: string) {
    await acceptFriendRequest(id)
    await loadAll()
    goToContacts()
  }

  async function rejectRequest(id: string) {
    await rejectFriendRequest(id)
    friendRequests.value = friendRequests.value.filter((fr) => fr.id !== id)
  }

  /** 只有真正成为好友才回通讯录；仅发出申请时留在原页面等对方通过 */
  async function addFriend(toUserId: string, message: string): Promise<SendFriendResult> {
    const result = await sendFriendRequest(toUserId, message)
    if (result.status === 'accepted') {
      await loadAll()
      goToContacts()
    }
    return result
  }

  /** 通讯录是 tabBar 页，只能用 switchTab；跳转前列表已经拉过最新的 */
  function goToContacts() {
    uni.switchTab({ url: '/pages/contacts/index' })
  }

  // 只带业务好友 ID，OpenIM 会话 ID 由聊天页向后端换取
  function openChatWithContact(contactId: string, nickname: string, avatar: string) {
    uni.navigateTo({
      url: `/pages/chat/room?type=private&targetId=${encodeURIComponent(contactId)}&title=${encodeURIComponent(nickname)}&avatar=${encodeURIComponent(avatar)}`,
    })
  }

  function openChatWithGroup(groupId: string, groupName: string, avatar: string) {
    uni.navigateTo({
      url: `/pages/chat/room?type=group&targetId=${encodeURIComponent(groupId)}&title=${encodeURIComponent(groupName)}&avatar=${encodeURIComponent(avatar)}`,
    })
  }

  function toggleGroupsExpanded() {
    groupsExpanded.value = !groupsExpanded.value
  }

  return {
    contacts,
    groups,
    friendRequests,
    groupsExpanded,
    loadAll,
    acceptRequest,
    rejectRequest,
    addFriend,
    goToContacts,
    openChatWithContact,
    openChatWithGroup,
    toggleGroupsExpanded,
  }
})
