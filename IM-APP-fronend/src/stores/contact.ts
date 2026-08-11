import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Contact, FriendRequest, GroupPreview } from '@/types'
import {
  acceptFriendRequest,
  fetchContacts,
  fetchFriendRequests,
  fetchGroups,
  getContactConversationId,
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
  }

  async function rejectRequest(id: string) {
    await rejectFriendRequest(id)
    friendRequests.value = friendRequests.value.filter((fr) => fr.id !== id)
  }

  async function addFriend(toUserId: string, message: string) {
    await sendFriendRequest(toUserId, message)
  }

  async function openChatWithContact(contactId: string, nickname: string, avatar: string) {
    const convId = await getContactConversationId(contactId)
    if (!convId) {
      uni.showToast({ title: '无法打开会话', icon: 'none' })
      return
    }
    uni.navigateTo({
      url: `/pages/chat/room?id=${convId}&title=${encodeURIComponent(nickname)}&avatar=${encodeURIComponent(avatar)}`,
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
    openChatWithContact,
    toggleGroupsExpanded,
  }
})
