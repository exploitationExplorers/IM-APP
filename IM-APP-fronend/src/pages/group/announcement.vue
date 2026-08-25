<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import { fetchAnnouncementHistory } from '@/api/group'
import { useGroupStore } from '@/stores/group'
import type { GroupAnnouncementHistoryItem } from '@/types'
import { formatRelativeTime } from '@/utils/format'

const ANNOUNCE_MAX = 500
const groupStore = useGroupStore()
const groupId = ref('')
const announcement = ref('')
const original = ref('')
const canEdit = ref(false)
const saving = ref(false)
const history = ref<GroupAnnouncementHistoryItem[]>([])

const count = computed(() => announcement.value.length)
const canSubmit = computed(
  () => canEdit.value && announcement.value !== original.value && !saving.value,
)

async function loadHistory() {
  try {
    history.value = await fetchAnnouncementHistory(groupId.value)
  } catch {
    history.value = []
  }
}

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }
  try {
    const detail = await groupStore.loadDetail(groupId.value)
    announcement.value = detail.announcement || ''
    original.value = detail.announcement || ''
    canEdit.value =
      detail.permissions?.canEditAnnouncement ??
      (detail.myRole === 'owner' || detail.myRole === 'admin')
    await loadHistory()
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群公告失败', icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}

async function onSubmit() {
  if (!canSubmit.value) return
  if (announcement.value.length > ANNOUNCE_MAX) {
    uni.showToast({ title: `公告最多 ${ANNOUNCE_MAX} 个字`, icon: 'none' })
    return
  }
  saving.value = true
  try {
    await groupStore.updateSettings(groupId.value, { announcement: announcement.value })
    original.value = announcement.value
    await loadHistory()
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function historyTime(item: GroupAnnouncementHistoryItem) {
  return formatRelativeTime(item.createdAt)
}
</script>

<template>
  <view class="page">
    <ImNavBar title="群公告" @back="goBack" />

    <scroll-view scroll-y class="body">
      <view v-if="canEdit" class="form">
        <textarea
          class="textarea"
          v-model="announcement"
          :maxlength="ANNOUNCE_MAX"
          placeholder="请输入公告内容"
          auto-height
        />
        <view class="meta">
          <text class="count">{{ count }}/ {{ ANNOUNCE_MAX }}</text>
        </view>
      </view>
      <view v-else class="content">
        <text class="announcement">{{ announcement || '暂无群公告' }}</text>
      </view>

      <view class="history-head">
        <text class="history-title">近期公告（最多 10 条）</text>
      </view>
      <view v-if="!history.length" class="history-empty">暂无历史公告</view>
      <view v-for="item in history" :key="item.id" class="history-card">
        <view class="history-meta">
          <text class="history-author">{{ item.publisherName || '管理员' }}</text>
          <text class="history-time">{{ historyTime(item) }}</text>
        </view>
        <text class="history-content">{{ item.content || '（空公告）' }}</text>
      </view>
    </scroll-view>

    <view v-if="canEdit" class="footer">
      <button class="btn" :disabled="!canSubmit" @click="onSubmit">确认</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f4f7;
  display: flex;
  flex-direction: column;
}

.body {
  flex: 1;
  height: 0;
  min-height: 60vh;
}

.form,
.content {
  margin-top: 16rpx;
  background: #fff;
  padding: 32rpx 28rpx;
  min-height: 240rpx;
}

.textarea {
  width: 100%;
  min-height: 280rpx;
  font-size: 30rpx;
  color: #2a2a2a;
  line-height: 1.7;
}

.meta {
  display: flex;
  justify-content: flex-end;
}

.count {
  font-size: 24rpx;
  color: #636e86;
}

.announcement {
  font-size: 30rpx;
  color: #2a2a2a;
  line-height: 1.8;
  white-space: pre-wrap;
}

.history-head {
  padding: 28rpx 28rpx 12rpx;
}

.history-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #212121;
}

.history-empty {
  padding: 40rpx 28rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 26rpx;
}

.history-card {
  margin: 0 16rpx 16rpx;
  background: #fff;
  border-radius: 12rpx;
  padding: 24rpx 28rpx;
}

.history-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.history-author {
  font-size: 24rpx;
  color: #636e86;
}

.history-time {
  font-size: 22rpx;
  color: #999;
}

.history-content {
  font-size: 28rpx;
  color: #2a2a2a;
  line-height: 1.7;
  white-space: pre-wrap;
}

.footer {
  padding: 24rpx 32rpx calc(24rpx + env(safe-area-inset-bottom));
  flex-shrink: 0;
  background: #f3f4f7;
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
