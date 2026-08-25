<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import { fetchAllGroupMembers } from '@/api/group'
import { useGroupStore } from '@/stores/group'
import { APP_CONFIG } from '@/config'
import type { GroupMember } from '@/types'

const groupStore = useGroupStore()
const groupId = ref('')
const keyword = ref('')
const members = ref<GroupMember[]>([])
const selected = ref<Set<string>>(new Set())
const saving = ref(false)
const loading = ref(false)

function normalizeRole(role?: string) {
  return (role || '').trim().toLowerCase()
}

const candidates = computed(() =>
  members.value.filter((m) => normalizeRole(m.role) === 'member'),
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
  loading.value = true
  try {
    members.value = await fetchAllGroupMembers(groupId.value)
  } catch (e) {
    members.value = []
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
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
    <ImNavBar title="新增群组管理员" @back="goBack" />

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

    <view class="section-head">
      <text class="section-title">可选成员 ({{ loading ? '…' : filtered.length }})</text>
    </view>

    <scroll-view scroll-y class="list" :show-scrollbar="false">
      <text v-if="loading" class="empty">加载中...</text>
      <block v-else>
        <view
          v-for="member in filtered"
          :key="member.id"
          class="row"
          @click="toggle(member.id)"
        >
          <image
            class="avatar"
            :src="member.avatar || APP_CONFIG.defaultAvatarUrl"
            mode="aspectFill"
          />
          <text class="name">{{ displayName(member) }}</text>
          <view class="check" :class="{ on: selected.has(member.id) }" />
        </view>
        <text v-if="!filtered.length" class="empty">
          {{ candidates.length ? '无匹配成员' : '暂无可设为管理员的普通成员' }}
        </text>
      </block>
    </scroll-view>

    <view class="footer">
      <button class="btn" :disabled="!canSubmit" @click="onSubmit">确认</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  height: 100dvh;
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-wrap {
  padding: 8rpx 24rpx 16rpx;
  flex-shrink: 0;
}

.section-head {
  padding: 0 32rpx 12rpx;
  flex-shrink: 0;
}

.section-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #212121;
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
  min-height: 0;
  padding-bottom: 16rpx;
  box-sizing: border-box;
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
  flex-shrink: 0;
}

.name {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  color: #1d1d1d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid #c8ccd6;
  flex-shrink: 0;
}

.check.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
}

.empty {
  display: block;
  padding: 120rpx 40rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}

.footer {
  padding: 24rpx 32rpx calc(24rpx + env(safe-area-inset-bottom));
  flex-shrink: 0;
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
