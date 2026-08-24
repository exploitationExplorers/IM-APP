<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { storeToRefs } from 'pinia'
import { useContactStore } from '@/stores/contact'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'
import { useChatStore } from '@/stores/chat'
import { resolveIMGroup } from '@/api/im'
import { GROUP_CREATED_WELCOME_TEXT } from '@/utils/im-notification'
import { APP_CONFIG } from '@/config'
import ImNavBar from '@/components/ImNavBar.vue'
import type { Contact, ContactListSort } from '@/types'

const contactStore = useContactStore()
const groupStore = useGroupStore()
const userStore = useUserStore()
const chatStore = useChatStore()
const { contacts } = storeToRefs(contactStore)

const step = ref<'select' | 'create'>('select')
const keyword = ref('')
const sortKey = ref<'recent' | 'name' | 'chat'>('recent')
const showSort = ref(false)
const selected = ref<Set<string>>(new Set())
const selectedById = ref<Map<string, Contact>>(new Map())
const groupName = ref('')
const loading = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined

const sortLabel = computed(() => {
  if (sortKey.value === 'name') return '名字'
  if (sortKey.value === 'chat') return '最近聊天'
  return '最近加入(默认)'
})

const listSort = computed<ContactListSort>(() => (sortKey.value === 'name' ? 'name' : 'recent'))

function refreshContacts() {
  return contactStore.reloadContacts({
    keyword: keyword.value,
    sort: listSort.value,
  })
}

const filteredContacts = computed(() => contacts.value)

const selectedContacts = computed(() => [...selectedById.value.values()])

const selectedCount = computed(() => selected.value.size)

const nameLen = computed(() => groupName.value.length)

const canConfirm = computed(() => selectedCount.value > 0)

const myAvatar = computed(
  () => userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl,
)

const memberPreview = computed(() => {
  const meName = userStore.profile?.nickname || '我'
  const names = [meName, ...selectedContacts.value.map((c) => c.nickname)]
  return names
})

function contactAvatar(url: string) {
  return url || APP_CONFIG.defaultAvatarUrl
}

onShow(() => {
  void Promise.all([refreshContacts(), contactStore.loadGroups(), userStore.loadProfile().catch(() => undefined)])
})

watch(keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void refreshContacts()
  }, 300)
})

function goBack() {
  if (step.value === 'create') {
    step.value = 'select'
    return
  }
  uni.navigateBack()
}

function isSelected(id: string) {
  return selected.value.has(id)
}

function toggle(c: Contact) {
  const ids = new Set(selected.value)
  const map = new Map(selectedById.value)
  if (ids.has(c.id)) {
    ids.delete(c.id)
    map.delete(c.id)
  } else {
    ids.add(c.id)
    map.set(c.id, c)
  }
  selected.value = ids
  selectedById.value = map
}

function removeSelected(id: string) {
  const ids = new Set(selected.value)
  const map = new Map(selectedById.value)
  ids.delete(id)
  map.delete(id)
  selected.value = ids
  selectedById.value = map
}

function setSort(key: 'recent' | 'name' | 'chat') {
  sortKey.value = key
  showSort.value = false
  void refreshContacts()
}

function onConfirmSelect() {
  if (!canConfirm.value) return
  const names = memberPreview.value
  const draft = names.join('、')
  groupName.value = draft.length > 50 ? `${draft.slice(0, 47)}...` : draft
  step.value = 'create'
}

async function waitForGroupConversation(groupId: string) {
  const deadline = Date.now() + 12000
  const welcome = GROUP_CREATED_WELCOME_TEXT
  let found: { id: string; lastMessage: string } | undefined
  while (Date.now() < deadline) {
    try {
      const target = await resolveIMGroup(groupId)
      await chatStore.loadConversations()
      found = chatStore.conversations.find(
        (c) => c.type === 'group' && c.groupId === target.imGroupId,
      )
      // 等欢迎语落到会话预览即可返回；不要 markAsRead，保留未读红点（对齐参考站）
      if (found && found.lastMessage.includes(welcome)) {
        return
      }
    } catch {
      /* OpenIM 群尚未同步完成 */
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

async function onCreate() {
  const name = groupName.value.trim()
  if (!name) {
    uni.showToast({ title: '请输入群名称', icon: 'none' })
    return
  }
  loading.value = true
  uni.showLoading({ title: '创建中...', mask: true })
  try {
    const g = await groupStore.create(name, [...selected.value])
    await contactStore.loadDirectory().catch(() => undefined)
    await waitForGroupConversation(g.id)
    uni.hideLoading()
    uni.switchTab({
      url: '/pages/chat/index',
      success: () => {
        uni.showToast({ title: '创建成功', icon: 'success' })
      },
    })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
    uni.hideLoading()
  }
}
</script>

<template>
  <view class="page" @click="showSort = false">
    <!-- Step 1: 选择联络人 -->
    <template v-if="step === 'select'">
      <ImNavBar title="选择联络人" @back="goBack">
        <template #right>
          <view
            class="confirm-btn"
            :class="{ enabled: canConfirm }"
            @click="onConfirmSelect"
          >
            {{ canConfirm ? `确认(${selectedCount})` : '确认' }}
          </view>
        </template>
      </ImNavBar>

      <view v-if="selectedCount > 0" class="chips">
        <view
          v-for="c in selectedContacts"
          :key="c.id"
          class="chip"
          @click.stop="removeSelected(c.id)"
        >
          <image class="chip-avatar" :src="contactAvatar(c.avatar)" mode="aspectFill" />
          <text class="chip-name">{{ c.nickname }}</text>
        </view>
      </view>

      <view class="search-wrap">
        <view class="search-box">
          <text class="search-glyph">⌕</text>
          <input
            class="search-input"
            v-model="keyword"
            placeholder="搜索"
            placeholder-class="search-ph"
          />
        </view>
      </view>

      <view class="section-head">
        <text class="section-count">联络人 ({{ filteredContacts.length }})</text>
        <view class="sort-wrap" @click.stop="showSort = !showSort">
          <text class="sort">{{ sortLabel }}</text>
          <image class="sort-caret" src="/static/icons/icon-caret.svg" mode="aspectFit" />
          <view v-if="showSort" class="sort-menu">
            <view
              class="sort-item"
              :class="{ active: sortKey === 'recent' }"
              @click="setSort('recent')"
            >最近加入(默认)</view>
            <view
              class="sort-item"
              :class="{ active: sortKey === 'name' }"
              @click="setSort('name')"
            >名字</view>
            <view
              class="sort-item"
              :class="{ active: sortKey === 'chat' }"
              @click="setSort('chat')"
            >最近聊天</view>
          </view>
        </view>
      </view>

      <scroll-view scroll-y class="list" :lower-threshold="80" @scrolltolower="contactStore.loadMoreContacts">
        <view
          v-for="c in filteredContacts"
          :key="c.id"
          class="row"
          @click="toggle(c)"
        >
          <image class="avatar" :src="contactAvatar(c.avatar)" mode="aspectFill" />
          <text class="name">{{ c.nickname }}</text>
          <view class="check" :class="{ on: isSelected(c.id) }" />
        </view>
      </scroll-view>
    </template>

    <!-- Step 2: 创建群聊 -->
    <template v-else>
      <ImNavBar title="创建群聊" @back="goBack" />

      <scroll-view scroll-y class="create-body">
        <view class="avatar-picker">
          <image class="group-avatar" :src="APP_CONFIG.defaultGroupAvatarUrl" mode="aspectFit" />
        </view>

        <view class="name-field">
          <input
            class="name-input"
            v-model="groupName"
            maxlength="50"
            placeholder="请输入群名称"
            placeholder-class="search-ph"
          />
          <view class="name-meta">
            <text class="name-hint">群组名称最多 50 个字</text>
            <text class="name-count">{{ nameLen }}/50</text>
          </view>
        </view>

        <text class="members-title">群成员 ({{ selectedCount + 1 }})</text>
        <view class="members">
          <view class="member">
            <image
              class="member-avatar"
              :src="myAvatar"
              mode="aspectFill"
            />
            <text class="member-name">{{ userStore.profile?.nickname || '我' }}</text>
          </view>
          <view v-for="c in selectedContacts" :key="c.id" class="member">
            <image class="member-avatar" :src="contactAvatar(c.avatar)" mode="aspectFill" />
            <text class="member-name">{{ c.nickname }}</text>
          </view>
        </view>
      </scroll-view>

      <view class="footer">
        <view class="primary-btn" :class="{ disabled: loading }" @click="onCreate">创建</view>
      </view>
    </template>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.confirm-btn {
  min-width: 104rpx;
  height: 64rpx;
  padding: 0 24rpx;
  border-radius: 8rpx;
  background: #e1e3ea;
  color: #848ea9;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.confirm-btn.enabled {
  background: #0a2fc2;
  color: #fff;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  padding: 8rpx 40rpx 16rpx;
}

.chip {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 4rpx 12rpx 4rpx 4rpx;
  background: #f3f4f7;
  border-radius: 999rpx;
}

.chip-avatar {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #eee;
}

.chip-name {
  font-size: 24rpx;
  color: #212121;
  max-width: 160rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-wrap {
  padding: 8rpx 40rpx 16rpx;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 16rpx;
  height: 72rpx;
  padding: 0 32rpx;
  background: #f3f4f7;
  border-radius: 8rpx;
}

.search-glyph {
  color: #626e8d;
  font-size: 30rpx;
}

.search-input {
  flex: 1;
  height: 72rpx;
  font-size: 28rpx;
  color: #212121;
}

.search-ph {
  color: #626e8d;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 48rpx;
  margin: 8rpx 40rpx 16rpx;
}

.section-count {
  font-size: 28rpx;
  font-weight: 700;
  color: #212121;
}

.sort-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.sort {
  color: #626e8d;
  font-size: 24rpx;
}

.sort-caret {
  width: 16rpx;
  height: 16rpx;
}

.sort-menu {
  position: absolute;
  top: 48rpx;
  right: 0;
  min-width: 320rpx;
  padding: 16rpx;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.1);
  z-index: 20;
}

.sort-item {
  padding: 16rpx 32rpx;
  font-size: 28rpx;
  color: #212121;
  text-align: center;
  border-radius: 8rpx;
}

.sort-item.active {
  color: #0a2fc2;
}

.list {
  flex: 1;
  height: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 32rpx;
  height: 128rpx;
  padding: 0 40rpx;
  box-sizing: border-box;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.name {
  flex: 1;
  font-size: 34rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  border: 2rpx solid #e1e3ea;
  background: #f3f4f7;
  box-sizing: border-box;
  flex-shrink: 0;
}

.check.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
  position: relative;
}

.check.on::after {
  content: '';
  position: absolute;
  left: 14rpx;
  top: 8rpx;
  width: 12rpx;
  height: 22rpx;
  border: 4rpx solid #fff;
  border-top: 0;
  border-left: 0;
  transform: rotate(45deg);
}

.create-body {
  flex: 1;
  height: 0;
  padding: 24rpx 40rpx;
  box-sizing: border-box;
}

.avatar-picker {
  display: flex;
  justify-content: center;
  margin-bottom: 32rpx;
}

.group-avatar {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
}

.name-field {
  margin-bottom: 40rpx;
}

.name-input {
  height: 96rpx;
  padding: 0 32rpx;
  background: #f3f4f7;
  border-radius: 8rpx;
  font-size: 32rpx;
  color: #212121;
}

.name-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 12rpx;
}

.name-hint,
.name-count {
  font-size: 24rpx;
  color: #626e8d;
}

.members-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #212121;
  margin-bottom: 24rpx;
}

.members {
  display: flex;
  flex-wrap: wrap;
  gap: 24rpx 32rpx;
}

.member {
  width: 120rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.member-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f3f4f7;
}

.member-name {
  font-size: 22rpx;
  color: #212121;
  max-width: 120rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.footer {
  padding: 16rpx 32rpx;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
}

.primary-btn {
  height: 96rpx;
  border-radius: 8rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.primary-btn.disabled {
  opacity: 0.7;
}
</style>
