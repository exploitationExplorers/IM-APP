import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Contact, ContactListSort, FriendRequest, GroupPreview, SendFriendResult } from '@/types'
import {
  acceptFriendRequest,
  fetchContacts,
  fetchFriendRequests,
  fetchGroups,
  rejectFriendRequest,
  sendFriendRequest,
} from '@/api/contact'

const PAGE_SIZE = 50

export const useContactStore = defineStore('contact', () => {
  const contacts = ref<Contact[]>([])
  const contactTotal = ref(0)
  const contactCursor = ref('')
  const contactHasMore = ref(false)
  const contactsLoading = ref(false)
  const contactKeyword = ref('')
  const contactSort = ref<ContactListSort>('recent')
  const groups = ref<GroupPreview[]>([])
  const friendRequests = ref<FriendRequest[]>([])
  const groupsExpanded = ref(false)

  async function reloadContacts(opts?: { keyword?: string; sort?: ContactListSort }) {
    if (opts?.keyword !== undefined) contactKeyword.value = opts.keyword
    if (opts?.sort) contactSort.value = opts.sort
    contactsLoading.value = true
    try {
      const page = await fetchContacts({
        keyword: contactKeyword.value,
        sort: contactSort.value,
        limit: PAGE_SIZE,
      })
      contacts.value = page.items
      contactTotal.value = page.total
      contactCursor.value = page.nextCursor || ''
      contactHasMore.value = page.hasMore
    } finally {
      contactsLoading.value = false
    }
  }

  async function loadMoreContacts() {
    if (!contactHasMore.value || contactsLoading.value || !contactCursor.value) return
    contactsLoading.value = true
    try {
      const page = await fetchContacts({
        keyword: contactKeyword.value,
        sort: contactSort.value,
        cursor: contactCursor.value,
        limit: PAGE_SIZE,
      })
      const seen = new Set(contacts.value.map((c) => c.id))
      contacts.value = contacts.value.concat(page.items.filter((c) => !seen.has(c.id)))
      contactCursor.value = page.nextCursor || ''
      contactHasMore.value = page.hasMore
      contactTotal.value = page.total
    } finally {
      contactsLoading.value = false
    }
  }

  async function loadGroups() {
    groups.value = await fetchGroups()
  }

  async function loadDirectory() {
    await Promise.all([reloadContacts(), loadGroups()])
  }

  async function loadFriendRequests() {
    friendRequests.value = await fetchFriendRequests()
  }

  async function loadAll() {
    await Promise.all([loadDirectory(), loadFriendRequests()])
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
      await loadDirectory()
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
    contactTotal,
    contactHasMore,
    contactsLoading,
    contactKeyword,
    contactSort,
    groups,
    friendRequests,
    groupsExpanded,
    reloadContacts,
    loadMoreContacts,
    loadGroups,
    loadAll,
    loadDirectory,
    loadFriendRequests,
    acceptRequest,
    rejectRequest,
    addFriend,
    goToContacts,
    openChatWithContact,
    openChatWithGroup,
    toggleGroupsExpanded,
  }
})
