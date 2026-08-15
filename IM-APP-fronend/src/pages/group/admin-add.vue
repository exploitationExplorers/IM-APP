<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchGroupMembers } from '@/api/group'
import { useGroupStore } from '@/stores/group'
import type { GroupMember } from '@/types'

const groupStore = useGroupStore()
const groupId = ref('')
const keyword = ref('')
const members = ref<GroupMember[]>([])
const selected = ref<Set<string>>(new Set())
const saving = ref(false)

const candidates = computed(() =>
  members.value.filter((m) => m.role === 'member'),
)

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return candidates.value
  return candidates.value.filter((m) => {
    const name = `${m.memberRemark || ''} ${m.groupNickname || ''} ${m.nickname || ''}`.toLowerCase()
    return name.includes(text)
  })
})

const canSubmit = computed(() => selected.value.size > 0 && !saving.value)

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) return
  try {
    members.value = await fetchGroupMembers(groupId.value)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}

function displayName(member: GroupMember) {
  return member.memberRemark || member.groupNickname || member.nickname || '成员'
}

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

async function onSubmit() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    for (const userId of selected.value) {
      await groupStore.setMemberRole(groupId.value, userId, 'admin')
    }
    uni.showToast({ title: '已添加', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 300)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">新增群组管理员</text>
      <view class="nav-space" />
    </view>

    <view class="search-wrap">
      <view class="search-box">
        <text class="search-icon">⌕</text>
        <input
          class="search-input"
          v-model="keyword"
          placeholder="搜索"
          confirm-type="search"
        />
      </view>
    </view>

    <scroll-view scroll-y class="list">
      <view
        v-for="member in filtered"
        :key="member.id"
        class="row"
        @click="toggle(member.id)"
      >
        <image class="avatar" :src="member.avatar" mode="aspectFill" />
        <text class="name">{{ displayName(member) }}</text>
        <view class="check" :class="{ on: selected.has(member.id) }" />
      </view>
    </scroll-view>

    <view class="footer">
      <button class="btn" :disabled="!canSubmit" @click="onSubmit">确认</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.nav {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 26rpx;
}

.nav-back,
.nav-space {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  color: #1b1b1b;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 36rpx;
  font-weight: 700;
  color: #1f1f1f;
}

.search-wrap {
  padding: 8rpx 24rpx 16rpx;
}

.search-box {
  height: 72rpx;
  border-radius: 8rpx;
  background: #f3f4f7;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  gap: 12rpx;
}

.search-icon {
  color: #8a8f9c;
  font-size: 28rpx;
}

.search-input {
  flex: 1;
  font-size: 28rpx;
  height: 72rpx;
}

.list {
  flex: 1;
  height: 0;
}

.row {
  display: flex;
  align-items: center;
  padding: 20rpx 32rpx;
  gap: 20rpx;
}

.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: #eee;
}

.name {
  flex: 1;
  font-size: 30rpx;
  color: #1d1d1d;
}

.check {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid #c8ccd6;
}

.check.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
}

.footer {
  padding: 24rpx 32rpx calc(24rpx + env(safe-area-inset-bottom));
}

.btn {
  height: 96rpx;
  line-height: 96rpx;
  border-radius: 16rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
}

.btn[disabled] {
  opacity: 0.45;
}

.btn::after {
  border: none;
}
</style>
