<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useMassSendStore } from '@/stores/massSend'

const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
const massStore = useMassSendStore()

const list = computed(() => massStore.history)
const isEmpty = computed(() => !list.value.length)

const editing = ref(false)
const selectedIds = ref<string[]>([])

const selectedCount = computed(() => selectedIds.value.length)
const deleteLabel = computed(() => `删除(${selectedCount.value})`)

onShow(() => {
  massStore.hydrate()
})

function goBack() {
  uni.navigateBack()
}

function toggleEdit() {
  if (editing.value) {
    editing.value = false
    selectedIds.value = []
    return
  }
  editing.value = true
}

function goCreate() {
  massStore.resetAll()
  uni.navigateTo({ url: '/pages/mine/mass-select-contacts' })
}

function goSendAgain(id: string) {
  if (editing.value) return
  const record = list.value.find((r) => r.id === id)
  if (!record) return
  massStore.setSelectedTargets(record.targets)
  massStore.resetDraft()
  uni.navigateTo({ url: '/pages/mine/mass-compose' })
}

function isSelected(id: string) {
  return selectedIds.value.includes(id)
}

function toggleSelect(id: string) {
  if (!editing.value) return
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

function onDelete() {
  if (!selectedCount.value) return
  uni.showModal({
    title: '提示',
    content: `确定删除这 ${selectedCount.value} 条群发记录吗？`,
    confirmColor: '#ff4d4f',
    success: (res) => {
      if (!res.confirm) return
      massStore.removeRecords(selectedIds.value)
      selectedIds.value = []
      editing.value = false
      uni.showToast({ title: '已删除', icon: 'success' })
    },
  })
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()

  let h = d.getHours()
  const m = d.getMinutes()
  const ap = h >= 12 ? '下午' : '上午'
  h = h % 12
  if (h === 0) h = 12
  const mm = String(m).padStart(2, '0')
  return `${isToday ? '今日' : ''} ${h}:${mm} ${ap}`.trim()
}

function renderSummary(r: (typeof list.value)[number]) {
  const c = r.content
  if (c.type === 'text') return c.text || ''
  if (c.type === 'image') {
    const names = c.imageNames
    if (names && names.length) {
      if (names.length === 1) return `[图片] ${names[0]}`
      return `[图片] ${names[0]} 等${names.length}个文件`
    }
    const count = (c.images || []).length
    return count > 1 ? `[图片] 共${count}张` : '[图片]'
  }
  if (c.type === 'audio') return '[语音]'
  if (c.type === 'file') return c.fileName ? `[文件] ${c.fileName}` : '[文件]'
  return '[收藏]'
}

function renderTargets(r: (typeof list.value)[number]) {
  const names = r.targets.map((t) => t.name).filter(Boolean)
  return names.slice(0, 3).join('，') + (names.length > 3 ? '...' : '')
}
</script>

<template>
  <view class="page">
    <view class="nav-bar-wrap">
      <view class="status-bar" :style="{ height: statusBarHeight + 'px' }"></view>
      <view class="nav-bar">
        <view class="nav-left">
          <text class="back-icon" @click="goBack">‹</text>
        </view>
        <view class="nav-center">
          <text class="title">群发助手</text>
        </view>
        <view class="nav-right" @click="toggleEdit">
          <text class="edit-text">{{ editing ? '取消' : '编辑' }}</text>
        </view>
      </view>
    </view>

    <view v-if="isEmpty" class="empty">
      <text class="empty-text">暂无资料</text>
    </view>

    <scroll-view v-else scroll-y class="list">
      <view v-for="r in list" :key="r.id" class="record">
        <view class="time">{{ formatTime(r.createdAt) }}</view>
        <view class="row" @click="toggleSelect(r.id)">
          <view class="card" :class="{ 'card-edit': editing }">
            <view class="card-main">
              <text class="msg">{{ renderSummary(r) }}</text>
              <view class="to">
                <text class="to-label">已发送给</text>
                <text class="to-names">{{ renderTargets(r) }}</text>
              </view>
            </view>
            <view class="again" :class="{ disabled: editing }" @click.stop="goSendAgain(r.id)">再发一条</view>
          </view>
          <view v-if="editing" class="selector" :class="{ on: isSelected(r.id) }">
            <text v-if="isSelected(r.id)" class="selector-tick">✓</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-if="!editing" class="bottom safe-bottom">
      <view class="primary-btn" @click="goCreate">新建群发</view>
    </view>

    <view v-else class="delete-bar safe-bottom">
      <view
        class="delete-btn"
        :class="{ disabled: selectedCount === 0, active: selectedCount > 0 }"
        @click="onDelete"
      >
        {{ deleteLabel }}
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
}

.nav-bar-wrap {
  background: #ffffff;
}

.nav-bar {
  height: 96rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  box-sizing: border-box;
}

.nav-left,
.nav-right {
  width: 160rpx;
  display: flex;
  align-items: center;
}

.nav-right {
  justify-content: flex-end;
}

.nav-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.back-icon {
  font-size: 52rpx;
  color: #111;
  line-height: 1;
  padding: 8rpx 12rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 700;
  color: #111;
}

.edit-text {
  font-size: 30rpx;
  color: #111;
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-text {
  color: #8a8f9c;
  font-size: 28rpx;
}

.list {
  flex: 1;
  height: 0;
  background: #ffffff;
}

.record {
  padding: 24rpx 32rpx 0;
  box-sizing: border-box;
}

.time {
  text-align: center;
  color: #8a8f9c;
  font-size: 24rpx;
  padding-bottom: 18rpx;
}

.row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.card {
  background: #f3f4f7;
  border-radius: 14rpx;
  padding: 24rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  flex: 1;
  min-width: 0;
}

.card-main {
  flex: 1;
  min-width: 0;
}

.msg {
  font-size: 30rpx;
  color: #212121;
  line-height: 42rpx;
  word-break: break-all;
}

.to {
  margin-top: 18rpx;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.to-label {
  font-size: 24rpx;
  color: #8a8f9c;
}

.to-names {
  font-size: 24rpx;
  color: #212121;
  line-height: 34rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.again {
  height: 64rpx;
  padding: 0 22rpx;
  border-radius: 10rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.again.disabled {
  background: #d9dde6;
  color: #ffffff;
}

.selector {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  border: 2rpx solid #d9dde6;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.selector.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
}

.selector-tick {
  color: #ffffff;
  font-size: 26rpx;
  line-height: 1;
}

.bottom {
  background: #ffffff;
  padding: 24rpx 48rpx;
  box-sizing: border-box;
}

.primary-btn {
  height: 88rpx;
  border-radius: 12rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-bar {
  background: #ffffff;
  padding: 24rpx 32rpx;
  box-sizing: border-box;
}

.delete-btn {
  height: 88rpx;
  border-radius: 12rpx;
  background: #e6e8ee;
  color: #a0a6b3;
  font-size: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-btn.active {
  background: #ff4d4f;
  color: #ffffff;
}

.delete-btn.disabled {
  opacity: 1;
}
</style>
