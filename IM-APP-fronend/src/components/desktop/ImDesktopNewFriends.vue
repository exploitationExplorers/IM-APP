<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import EmptyState from '@/components/EmptyState.vue'
import { useContactStore } from '@/stores/contact'
import { APP_CONFIG } from '@/config'
import { formatRelativeTime } from '@/utils/format'
import type { FriendRequest } from '@/types'

const PAGE_SIZE = 20

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const contactStore = useContactStore()
const { pendingFriendRequests, recentFriendRequests } = storeToRefs(contactStore)
const loaded = ref(false)
const recentVisibleCount = ref(PAGE_SIZE)

const hasMoreRecent = computed(
  () => recentVisibleCount.value < recentFriendRequests.value.length,
)
const visibleRecent = computed(() =>
  recentFriendRequests.value.slice(0, recentVisibleCount.value),
)
const showEmpty = computed(
  () =>
    loaded.value &&
    !pendingFriendRequests.value.length &&
    !recentFriendRequests.value.length,
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    recentVisibleCount.value = PAGE_SIZE
    void contactStore.loadFriendRequests().finally(() => {
      loaded.value = true
    })
  },
)

function close() {
  emit('update:modelValue', false)
}

function messageOf(item: FriendRequest): string {
  const text = item.message?.trim()
  if (text) return text
  const name = item.fromUser.nickname?.trim() || '用户'
  return `你好，我是 ${name}`
}

function recentActionLabel(item: FriendRequest): string {
  return item.status === 'rejected' ? '拒绝' : '同意'
}

async function onAccept(id: string) {
  try {
    await contactStore.acceptRequest(id)
    uni.showToast({ title: '已添加', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

async function onReject(id: string) {
  try {
    await contactStore.rejectRequest(id)
    uni.showToast({ title: '已拒绝', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function loadMore() {
  if (hasMoreRecent.value) recentVisibleCount.value += PAGE_SIZE
}
</script>

<template>
  <view v-if="modelValue" class="nf-layer" @click="close">
    <view class="nf-modal" @click.stop>
      <view class="nf-nav">
        <text class="nf-title">新的朋友</text>
        <text class="nf-close" @click="close">关闭</text>
      </view>

      <scroll-view scroll-y class="nf-body" @scrolltolower="loadMore">
        <EmptyState v-if="showEmpty" text="暂无好友申请" />

        <view v-if="pendingFriendRequests.length" class="section">
          <view class="section-title">待处理</view>
          <view v-for="item in pendingFriendRequests" :key="item.id" class="row">
            <image
              class="avatar"
              :src="item.fromUser.avatar || APP_CONFIG.defaultAvatarUrl"
              mode="aspectFill"
            />
            <view class="meta">
              <text class="name">{{ item.fromUser.nickname || '用户' }}</text>
              <text class="msg">{{ messageOf(item) }}</text>
            </view>
            <view class="actions">
              <view class="btn ghost" @click="onReject(item.id)">拒绝</view>
              <view class="btn primary" @click="onAccept(item.id)">同意</view>
            </view>
          </view>
        </view>

        <view v-if="visibleRecent.length" class="section">
          <view class="section-title">近三天</view>
          <view v-for="item in visibleRecent" :key="item.id" class="row">
            <image
              class="avatar"
              :src="item.fromUser.avatar || APP_CONFIG.defaultAvatarUrl"
              mode="aspectFill"
            />
            <view class="meta">
              <text class="name">{{ item.fromUser.nickname || '用户' }}</text>
              <text class="msg">{{ messageOf(item) }}</text>
              <text class="time">{{ formatRelativeTime(item.createdAt) }} · {{ recentActionLabel(item) }}</text>
            </view>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.nf-layer {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.nf-modal {
  width: 100%;
  max-width: 420px;
  max-height: min(720px, 82vh);
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
}

.nf-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #ececec;
}

.nf-title {
  font-size: 16px;
  font-weight: 700;
  color: #212121;
}

.nf-close {
  font-size: 13px;
  color: #0a2fc2;
  cursor: pointer;
}

.nf-body {
  flex: 1;
  min-height: 240px;
  max-height: calc(82vh - 56px);
  padding: 8px 0 16px;
}

.section-title {
  padding: 10px 18px 6px;
  font-size: 12px;
  color: #8e8d92;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
}

.avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font-size: 14px;
  font-weight: 600;
  color: #212121;
}

.msg,
.time {
  font-size: 12px;
  color: #8e8d92;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.btn {
  min-width: 52px;
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.btn.ghost {
  background: #f3f4f7;
  color: #212121;
}

.btn.primary {
  background: #0a2fc2;
  color: #fff;
}
</style>
