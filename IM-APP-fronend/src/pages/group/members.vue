<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchGroupMembers, updateMemberRemark } from '@/api/group'
import type { GroupMember } from '@/types'
import { getStatusBarHeight } from '@/utils/status-bar'

const statusBarHeight = getStatusBarHeight()
const groupId = ref('')
const keyword = ref('')
const members = ref<GroupMember[]>([])
const loading = ref(false)

const filteredMembers = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return members.value
  return members.value.filter((member) => {
    const displayName = member.groupNickname || member.nickname || ''
    return displayName.toLowerCase().includes(text)
  })
})

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }

  loading.value = true
  try {
    members.value = await fetchGroupMembers(groupId.value)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群成员失败', icon: 'none' })
  } finally {
    loading.value = false
  }
})

function goBack() {
  uni.navigateBack()
}

function roleLabel(member: GroupMember) {
  if (member.role === 'owner') return '群主'
  if (member.role === 'admin') return '管理员'
  return ''
}

async function editRemark(member: GroupMember) {
  const current = member.memberRemark?.trim() || ''
  const res = await uni.showModal({
    title: '设置成员备注',
    editable: true,
    placeholderText: '请输入备注名',
    content: current,
  })
  if (!res.confirm) return
  const value = (res.content || '').trim()
  try {
    await updateMemberRemark(groupId.value, member.id, value)
    member.memberRemark = value
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '保存失败', icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="back-btn" @click="goBack">‹</view>
      <text class="title">群聊成员</text>
      <text class="action">新增</text>
    </view>

    <view class="search-wrap">
      <view class="search-box">
        <text class="search-icon">⌕</text>
        <input
          class="search-input"
          v-model="keyword"
          placeholder="搜索"
          placeholder-class="placeholder"
        />
      </view>
    </view>

    <view class="section-head">
      <text class="section-title">群成员 ({{ filteredMembers.length }})</text>
    </view>

    <scroll-view scroll-y class="list">
      <view v-if="loading" class="loading">加载中...</view>
      <view
        v-for="member in filteredMembers"
        :key="member.id"
        class="member-row"
      >
        <image class="avatar" :src="member.avatar || '/static/avatar-me.png'" mode="aspectFill" />
        <view class="name-col">
          <text class="name">{{ member.memberRemark?.trim() || member.groupNickname || member.nickname }}</text>
          <text v-if="member.memberRemark?.trim()" class="name-sub">{{ member.groupNickname || member.nickname }}</text>
        </view>
        <view v-if="roleLabel(member)" class="badge">{{ roleLabel(member) }}</view>
        <view class="remark-btn" @click.stop="editRemark(member)">备注</view>
      </view>
      <view v-if="!loading && !filteredMembers.length" class="empty">暂无成员</view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 28rpx;
  box-sizing: content-box;
  background: #fff;
  border-bottom: 1rpx solid #f3f3f3;
}

.back-btn {
  font-size: 56rpx;
  color: #1b1b1b;
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.title {
  flex: 1;
  text-align: center;
  font-size: 46rpx;
  font-weight: 700;
  color: #1d1d1d;
}

.action {
  width: 60rpx;
  text-align: right;
  font-size: 30rpx;
  color: #1d1d1d;
}

.search-wrap {
  padding: 24rpx 34rpx 18rpx;
}

.search-box {
  height: 96rpx;
  border-radius: 18rpx;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  padding: 0 26rpx;
  border: 1rpx solid #efefef;
}

.search-icon {
  font-size: 42rpx;
  color: #7a7a7a;
  margin-right: 12rpx;
}

.search-input {
  flex: 1;
  font-size: 30rpx;
  color: #1f1f1f;
}

.placeholder {
  color: #aaa;
}

.section-head {
  padding: 8rpx 34rpx 18rpx;
}

.section-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #1a1a1a;
}

.list {
  flex: 1;
  padding: 0 20rpx 28rpx;
}

.member-row {
  display: flex;
  align-items: center;
  padding: 22rpx 18rpx;
  border-radius: 18rpx;
}

.avatar {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  background: #eee;
  margin-right: 22rpx;
}

.name {
  flex: 1;
  font-size: 38rpx;
  color: #1f1f1f;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  min-width: 96rpx;
  height: 52rpx;
  padding: 0 18rpx;
  border-radius: 26rpx;
  border: 1rpx solid #dfe3ea;
  color: #666;
  font-size: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 16rpx;
}

.empty,
.loading {
  padding: 120rpx 20rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}
.name-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.name-sub {
  font-size: 24rpx;
  color: #8a8f9c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remark-btn {
  margin-left: 16rpx;
  min-width: 88rpx;
  height: 56rpx;
  padding: 0 18rpx;
  border-radius: 28rpx;
  background: #f0f3ff;
  color: #0a2fc2;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
</style>
