<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useGroupStore } from '@/stores/group'

const ANNOUNCE_MAX = 500
const groupStore = useGroupStore()
const groupId = ref('')
const announcement = ref('')
const original = ref('')
const canEdit = ref(false)
const saving = ref(false)

const count = computed(() => announcement.value.length)
const canSubmit = computed(
  () => canEdit.value && announcement.value !== original.value && !saving.value,
)

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
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 300)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">群公告</text>
      <view class="nav-space" />
    </view>

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

.nav {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 26rpx;
  background: #fff;
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
  font-size: 40rpx;
  font-weight: 700;
  color: #1f1f1f;
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

.footer {
  margin-top: auto;
  padding: 32rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
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
