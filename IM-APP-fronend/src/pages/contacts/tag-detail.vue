<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ImNavBar from '@/components/ImNavBar.vue'
import {
  deleteContactTag,
  fetchTagMembers,
  setTagMembers,
  updateContactTag,
} from '@/api/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG, THEME } from '@/config'
import type { Contact } from '@/types'

useAuthGuard()

const TAG_MAX = 12
const tagId = ref('')
const tagName = ref('')
const keyword = ref('')
const members = ref<Contact[]>([])
const loading = ref(false)
const removing = ref(false)
const deleting = ref(false)
const renaming = ref(false)
const showMore = ref(false)
const showRename = ref(false)
const draftName = ref('')

const filtered = computed(() => {
  const k = keyword.value.trim()
  if (!k) return members.value
  return members.value.filter((c) => displayName(c).includes(k))
})

const draftCount = computed(() => draftName.value.length)
const canRename = computed(() => {
  const name = draftName.value.trim()
  return !!name && name !== tagName.value && !renaming.value
})

function displayName(c: Contact) {
  return c.remark?.trim() || c.nickname
}

onLoad((query) => {
  tagId.value = String(query?.id || '')
  tagName.value = decodeURIComponent(String(query?.name || '标签'))
})

onShow(() => {
  if (tagId.value) load()
})

async function load() {
  loading.value = true
  try {
    members.value = await fetchTagMembers(tagId.value)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goBack() {
  if (showMore.value) {
    showMore.value = false
    return
  }
  uni.navigateBack()
}

function onMore() {
  showMore.value = !showMore.value
}

function closeMore() {
  showMore.value = false
}

function goAddMembers() {
  closeMore()
  uni.navigateTo({
    url: `/pages/contacts/tag-add-members?id=${encodeURIComponent(tagId.value)}&name=${encodeURIComponent(tagName.value)}`,
  })
}

function openContact(c: Contact) {
  closeMore()
  uni.navigateTo({ url: `/pages/contacts/friend-detail?id=${c.id}` })
}

function openRename() {
  closeMore()
  draftName.value = tagName.value
  showRename.value = true
}

function closeRename() {
  if (renaming.value) return
  showRename.value = false
  draftName.value = ''
}

async function confirmRename() {
  const name = draftName.value.trim()
  if (!name || renaming.value) return
  if (name.length > TAG_MAX) {
    uni.showToast({ title: `标签名称最多 ${TAG_MAX} 个字`, icon: 'none' })
    return
  }
  if (name === tagName.value) {
    closeRename()
    return
  }
  renaming.value = true
  try {
    const tag = await updateContactTag(tagId.value, name)
    tagName.value = tag.name
    showRename.value = false
    draftName.value = ''
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    renaming.value = false
  }
}

function onDeleteTag() {
  closeMore()
  if (deleting.value) return
  uni.showModal({
    title: '删除标签',
    content: `确定删除标签「${tagName.value}」吗？`,
    confirmText: '删除',
    confirmColor: THEME.danger,
    success: async (res) => {
      if (!res.confirm) return
      deleting.value = true
      try {
        await deleteContactTag(tagId.value)
        uni.navigateBack()
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      } finally {
        deleting.value = false
      }
    },
  })
}

function onRemove(c: Contact) {
  if (removing.value) return
  uni.showModal({
    title: '移除成员',
    content: `确定将「${displayName(c)}」从标签中移除吗？`,
    success: async (res) => {
      if (!res.confirm) return
      removing.value = true
      try {
        const nextIds = members.value.filter((m) => m.id !== c.id).map((m) => m.id)
        await setTagMembers(tagId.value, nextIds)
        members.value = members.value.filter((m) => m.id !== c.id)
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      } finally {
        removing.value = false
      }
    },
  })
}
</script>

<template>
  <view class="page" @click="closeMore">
    <ImNavBar :title="`${tagName} (${members.length})`" @back="goBack">
      <template #right>
        <view class="nav-more" @click.stop="onMore">
          <image class="nav-more-icon" src="/static/icons/icon-more.svg" mode="aspectFit" />
          <view v-if="showMore" class="more-menu" @click.stop>
            <view class="more-item" @click="openRename">变更名称</view>
            <view class="more-item danger" @click="onDeleteTag">删除标签</view>
          </view>
        </view>
      </template>
    </ImNavBar>

    <AppSearchBar v-model="keyword" placeholder="搜索" />

    <scroll-view scroll-y class="body">
      <view v-if="filtered.length" class="list">
        <view v-for="c in filtered" :key="c.id" class="row" @click="openContact(c)">
          <image
            class="avatar"
            :src="c.avatar || APP_CONFIG.defaultAvatarUrl"
            mode="aspectFill"
          />
          <text class="name">{{ displayName(c) }}</text>
          <view class="remove" @click.stop="onRemove(c)">移除</view>
        </view>
      </view>
      <view v-else-if="!loading" class="empty">暂无成员</view>
    </scroll-view>

    <view class="footer">
      <view class="add-btn" @click="goAddMembers">新增</view>
    </view>

    <view v-if="showRename" class="mask" @click="closeRename">
      <view class="dialog" @click.stop>
        <text class="dialog-title">变更名称</text>
        <input
          class="dialog-input"
          v-model="draftName"
          :maxlength="TAG_MAX"
          confirm-type="done"
          @confirm="confirmRename"
        />
        <view class="dialog-meta">
          <text class="dialog-hint">标签名称最多 {{ TAG_MAX }} 个字</text>
          <text class="dialog-count">{{ draftCount }}/{{ TAG_MAX }}</text>
        </view>
        <view class="dialog-actions">
          <view class="dialog-btn ghost" @click="closeRename">取消</view>
          <view
            class="dialog-btn solid"
            :class="{ disabled: !canRename }"
            @click="confirmRename"
          >确认</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(128rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.nav-more {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
}

.nav-more-icon {
  width: 36rpx;
  height: 36rpx;
  transform: rotate(90deg);
}

.more-menu {
  position: absolute;
  top: 72rpx;
  right: 0;
  min-width: 212rpx;
  padding: 16rpx;
  background: #ffffff;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
  z-index: 30;
  box-sizing: border-box;
}

.more-item {
  height: 96rpx;
  padding: 0 32rpx;
  display: flex;
  align-items: center;
  font-size: 28rpx;
  font-weight: 600;
  color: #212121;
  white-space: nowrap;
}

.more-item.danger {
  color: #dc2828;
}

.body {
  flex: 1;
  height: 0;
}

.empty {
  margin-top: 80rpx;
  text-align: center;
  font-size: 32rpx;
  color: #626e8d;
}

.row {
  display: flex;
  align-items: center;
  height: 128rpx;
  padding: 0 40rpx;
  gap: 32rpx;
  box-sizing: border-box;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.name {
  flex: 1;
  min-width: 0;
  font-size: 34rpx;
  font-weight: 600;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove {
  flex-shrink: 0;
  height: 64rpx;
  padding: 0 24rpx;
  border-radius: 8rpx;
  background: #0a2fc2;
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16rpx 40rpx calc(16rpx + env(safe-area-inset-bottom));
  background: #ffffff;
}

.add-btn {
  height: 80rpx;
  border-radius: 8rpx;
  background: #0a2fc2;
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
}

.dialog {
  width: 640rpx;
  max-width: 100%;
  background: #ffffff;
  border-radius: 32rpx;
  padding: 16rpx 48rpx 32rpx;
  box-sizing: border-box;
}

.dialog-title {
  display: block;
  margin: 32rpx 0;
  font-size: 32rpx;
  font-weight: 700;
  color: #212121;
}

.dialog-input {
  width: 100%;
  height: 96rpx;
  padding: 0 32rpx;
  background: #f3f4f7;
  border-radius: 8rpx;
  border: 2rpx solid #0a2fc2;
  font-size: 32rpx;
  color: #212121;
  box-sizing: border-box;
}

.dialog-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 8rpx 0;
}

.dialog-hint {
  font-size: 24rpx;
  color: #212121;
}

.dialog-count {
  font-size: 28rpx;
  color: #212121;
}

.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
  margin-top: 48rpx;
}

.dialog-btn {
  height: 80rpx;
  min-width: 120rpx;
  padding: 0 32rpx;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
}

.dialog-btn.ghost {
  color: #212121;
}

.dialog-btn.solid {
  color: #ffffff;
  background: #0a2fc2;
}

.dialog-btn.disabled {
  opacity: 0.4;
}
</style>
