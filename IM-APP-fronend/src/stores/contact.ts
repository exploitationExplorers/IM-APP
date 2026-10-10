import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Contact, ContactListSort, FriendRequest, GroupPreview, SendFriendResult } from '@/types'
import {
  acceptFriendRequest,
  fetchContacts,
  fetchFriendRequests,
  fetchGroups,
  rejectFriendRequest,
  sendFriendRequest,
} from '@/api/contact'
import { fetchGroupDetail } from '@/api/group'
import { getToken, isAuthFailureError } from '@/utils/request'
import { isGroupUnavailableError, notifyGroupUnavailable } from '@/utils/im-notification'
import { writeFriendRequestBadge } from '@/utils/friend-request-badge'

const PAGE_SIZE = 50
/** 备注索引分页拉全量时用服务端上限，少打几轮 */
const REMARK_INDEX_PAGE_SIZE = 100
const REMARK_INDEX_MAX_PAGES = 50
/** 冷启动时等 token 落盘；鉴权失败不重试 */
const FRIEND_REQUEST_TOKEN_RETRY_MS = [0, 400, 1200]
const FRIEND_REQUEST_NETWORK_RETRY_MS = [0, 1500]

let friendRequestSyncInFlight: Promise<void> | null = null
let remarkIndexInFlight: Promise<void> | null = null
let groupsLoadErrorToastShown = false

/** 业务 UUID / OpenIM 32 位 id 统一成无横线小写，方便对会话 peer */
function normalizeUserKey(id: string): string {
  return id.trim().toLowerCase().replace(/-/g, '')
}

export const useContactStore = defineStore('contact', () => {
  const contacts = ref<Contact[]>([])
  const contactTotal = ref(0)
  const contactCursor = ref('')
  const contactHasMore = ref(false)
  const contactsLoading = ref(false)
  const contactKeyword = ref('')
  const contactSort = ref<ContactListSort>('recent')
  const groups = ref<GroupPreview[]>([])
  const pendingFriendRequests = ref<FriendRequest[]>([])
  const recentFriendRequests = ref<FriendRequest[]>([])
  const groupsExpanded = ref(false)
  /**
   * 备注索引与通讯录分页列表解耦。
   * 列表只保留当前页，会话标题要用全量备注，否则超过一页的好友只能看到昵称。
   */
  const remarkByUserId = ref<Record<string, string>>({})
  const pendingDesktopChat = ref<{
    type: 'private' | 'group'
    businessId: string
    title: string
    avatar: string
  } | null>(null)

  /** 待处理的收到申请数，对齐参考站通讯录 / 新的朋友角标 */
  const pendingFriendRequestCount = computed(() => pendingFriendRequests.value.length)

  function mergeRemarks(items: Contact[]) {
    if (!items.length) return
    let changed = false
    const next = { ...remarkByUserId.value }
    for (const item of items) {
      const key = normalizeUserKey(item.id)
      if (!key) continue
      const remark = item.remark?.trim() || ''
      if (remark) {
        if (next[key] !== remark) {
          next[key] = remark
          changed = true
        }
      } else if (next[key]) {
        delete next[key]
        changed = true
      }
    }
    if (changed) remarkByUserId.value = next
  }

  /** 会话列表 / 聊天顶栏统一走这里，不依赖通讯录当前页有没有这个人 */
  function remarkOf(userId?: string): string {
    if (!userId) return ''
    return remarkByUserId.value[normalizeUserKey(userId)] || ''
  }

  /** 改备注后立刻写进索引和当前列表，不必等整页 reload */
  function patchContactRemark(contactId: string, remark: string) {
    const key = normalizeUserKey(contactId)
    if (!key) return
    const value = remark.trim()
    const next = { ...remarkByUserId.value }
    if (value) next[key] = value
    else delete next[key]
    remarkByUserId.value = next
    contacts.value = contacts.value.map((c) =>
      normalizeUserKey(c.id) === key ? { ...c, remark: value } : c,
    )
  }

  /** 翻页拉全量备注；通讯录 UI 仍用分页，互不覆盖 */
  async function ensureRemarkIndex() {
    if (!getToken()) return
    if (remarkIndexInFlight) return remarkIndexInFlight
    remarkIndexInFlight = (async () => {
      const collected: Record<string, string> = {}
      let cursor = ''
      for (let pageNo = 0; pageNo < REMARK_INDEX_MAX_PAGES; pageNo += 1) {
        const page = await fetchContacts({
          keyword: '',
          sort: 'recent',
          cursor: cursor || undefined,
          limit: REMARK_INDEX_PAGE_SIZE,
        })
        for (const item of page.items) {
          const key = normalizeUserKey(item.id)
          const remark = item.remark?.trim() || ''
          if (key && remark) collected[key] = remark
        }
        if (!page.hasMore || !page.nextCursor) break
        cursor = page.nextCursor
      }
      remarkByUserId.value = collected
    })()
      .catch((e) => {
        if (import.meta.env.DEV) console.warn('[contact] 备注索引加载失败', e)
      })
      .finally(() => {
        remarkIndexInFlight = null
      })
    return remarkIndexInFlight
  }

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
      mergeRemarks(page.items)
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
      mergeRemarks(page.items)
    } finally {
      contactsLoading.value = false
    }
  }

  async function loadGroups() {
    try {
      groups.value = await fetchGroups()
    } catch (e) {
      groups.value = []
      if (import.meta.env.DEV) {
        console.warn('[contact] 群列表加载失败', e)
      }
      if (!groupsLoadErrorToastShown) {
        groupsLoadErrorToastShown = true
        uni.showToast({ title: '群列表加载失败', icon: 'none', duration: 2000 })
      }
    }
  }

  async function loadDirectory() {
    await Promise.all([reloadContacts(), loadGroups()])
    void ensureRemarkIndex()
  }

  async function loadFriendRequests() {
    if (!getToken()) return
    if (friendRequestSyncInFlight) return friendRequestSyncInFlight

    friendRequestSyncInFlight = (async () => {
      let lastError: unknown
      try {
        for (const delayMs of FRIEND_REQUEST_TOKEN_RETRY_MS) {
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }
          if (!getToken()) return
          try {
            const list = await fetchFriendRequests(getToken())
            pendingFriendRequests.value = list.pending
            recentFriendRequests.value = list.recent
            writeFriendRequestBadge(list.pending.length)
            return
          } catch (err) {
            if (isAuthFailureError(err)) return
            lastError = err
            break
          }
        }

        for (const delayMs of FRIEND_REQUEST_NETWORK_RETRY_MS) {
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }
          if (!getToken()) return
          try {
            const list = await fetchFriendRequests(getToken())
            pendingFriendRequests.value = list.pending
            recentFriendRequests.value = list.recent
            writeFriendRequestBadge(list.pending.length)
            return
          } catch (err) {
            if (isAuthFailureError(err)) return
            lastError = err
          }
        }
      } finally {
        friendRequestSyncInFlight = null
      }
      if (lastError && import.meta.env.DEV) {
        console.warn('[contact] 好友申请同步失败', lastError)
      }
    })()

    return friendRequestSyncInFlight
  }

  async function loadAll() {
    await Promise.all([loadDirectory(), loadFriendRequests()])
  }

  async function acceptRequest(id: string) {
    await acceptFriendRequest(id)
    await Promise.all([loadFriendRequests(), loadDirectory()])
  }

  async function rejectRequest(id: string) {
    await rejectFriendRequest(id)
    await loadFriendRequests()
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

  /** H5 PC 三栏：切到聊天 tab 并在右侧内嵌打开私聊 */
  function openChatWithContactDesktop(contactId: string, nickname: string, avatar: string) {
    pendingDesktopChat.value = {
      type: 'private',
      businessId: contactId,
      title: nickname,
      avatar,
    }
    uni.switchTab({ url: '/pages/chat/index' })
  }

  function openChatWithGroup(groupId: string, groupName: string, avatar: string) {
    uni.navigateTo({
      url: `/pages/chat/room?type=group&targetId=${encodeURIComponent(groupId)}&title=${encodeURIComponent(groupName)}&avatar=${encodeURIComponent(avatar)}`,
    })
  }

  /** H5 PC 三栏：切到聊天 tab 并在右侧内嵌打开群聊；进房前校验群是否仍有效 */
  async function openChatWithGroupDesktop(groupId: string, groupName: string, avatar: string) {
    try {
      await fetchGroupDetail(groupId)
    } catch (e) {
      const msg = (e as Error)?.message || ''
      if (isGroupUnavailableError(msg)) {
        notifyGroupUnavailable(true)
        return
      }
      uni.showToast({ title: msg || '打开群聊失败', icon: 'none' })
      return
    }
    pendingDesktopChat.value = {
      type: 'group',
      businessId: groupId,
      title: groupName,
      avatar,
    }
    uni.switchTab({ url: '/pages/chat/index' })
  }

  function takePendingDesktopChat() {
    const pending = pendingDesktopChat.value
    pendingDesktopChat.value = null
    return pending
  }

  function toggleGroupsExpanded() {
    groupsExpanded.value = !groupsExpanded.value
  }

  function reset() {
    contacts.value = []
    contactTotal.value = 0
    contactCursor.value = ''
    contactHasMore.value = false
    remarkByUserId.value = {}
    groups.value = []
    pendingFriendRequests.value = []
    recentFriendRequests.value = []
    groupsExpanded.value = false
    writeFriendRequestBadge(0)
  }

  return {
    contacts,
    contactTotal,
    contactHasMore,
    contactsLoading,
    contactKeyword,
    contactSort,
    remarkByUserId,
    groups,
    pendingFriendRequests,
    recentFriendRequests,
    pendingFriendRequestCount,
    groupsExpanded,
    remarkOf,
    patchContactRemark,
    ensureRemarkIndex,
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
    openChatWithContactDesktop,
    openChatWithGroup,
    openChatWithGroupDesktop,
    takePendingDesktopChat,
    toggleGroupsExpanded,
    reset,
  }
})
