<script setup lang="ts">
import { computed, ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import {
  cancelForwardTask,
  fetchForwardTaskProgress,
  retryForwardTask,
} from '@/api/forward'
import { useAuthGuard } from '@/composables/useAuthGuard'
import type { ForwardTask, ForwardTaskStatus } from '@/types'
import { safeBack } from '@/utils/nav'

useAuthGuard()

const POLL_MS = 2000
const TERMINAL: ForwardTaskStatus[] = [
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
]

const taskIds = ref<string[]>([])
const tasks = ref<ForwardTask[]>([])
const loading = ref(true)
const acting = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const merged = computed(() => {
  const list = tasks.value
  if (!list.length) return null
  if (list.length === 1) return list[0]
  return {
    status: mergedStatus(list),
    targetCount: sum(list, (t) => t.targetCount),
    doneCount: sum(list, (t) => t.doneCount),
    successCount: sum(list, (t) => t.successCount),
    failedCount: sum(list, (t) => t.failedCount),
    skippedCount: sum(list, (t) => t.skippedCount),
    cancelledCount: sum(list, (t) => t.cancelledCount),
    pendingCount: sum(list, (t) => t.pendingCount),
    processingCount: sum(list, (t) => t.processingCount),
  }
})

const percent = computed(() => {
  const t = merged.value
  if (!t || t.targetCount <= 0) return 0
  return Math.min(100, Math.round((t.doneCount / t.targetCount) * 100))
})

const statusText = computed(() => (merged.value ? labelOf(merged.value.status) : '加载中'))
const running = computed(() => {
  const status = merged.value?.status
  return !!status && !TERMINAL.includes(status)
})
const canRetry = computed(() => {
  const t = merged.value
  if (!t) return false
  return (t.status === 'failed' || t.status === 'partially_completed') && t.failedCount > 0
})
const canCancel = computed(() => running.value && !acting.value)

onLoad((query) => {
  const raw = String(query?.taskIds || query?.taskId || '')
  taskIds.value = raw.split(',').map((id) => id.trim()).filter(Boolean)
  if (!taskIds.value.length) {
    uni.showToast({ title: '缺少转发任务', icon: 'none' })
    safeBack('/pages/chat/index')
    return
  }
  void refresh(true)
  startPoll()
})

onShow(() => {
  if (taskIds.value.length) startPoll()
})
onHide(() => stopPoll())
onUnload(() => stopPoll())

function startPoll() {
  stopPoll()
  timer = setInterval(() => {
    void refresh(false)
  }, POLL_MS)
}

function stopPoll() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function refresh(showLoading: boolean) {
  if (showLoading) loading.value = true
  try {
    const list = await Promise.all(taskIds.value.map((id) => fetchForwardTaskProgress(id)))
    tasks.value = list
    if (list.every((t) => TERMINAL.includes(t.status))) stopPoll()
  } catch (e) {
    if (showLoading) {
      uni.showToast({ title: e instanceof Error ? e.message : '进度加载失败', icon: 'none' })
    }
  } finally {
    loading.value = false
  }
}

async function onCancel() {
  if (!canCancel.value) return
  const ok = await confirm('确定取消未发送的转发吗？', '取消任务')
  if (!ok) return
  acting.value = true
  try {
    await Promise.all(taskIds.value.map((id) => cancelForwardTask(id, '用户取消')))
    await refresh(false)
    uni.showToast({ title: '已取消', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '取消失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

async function onRetry() {
  if (!canRetry.value || acting.value) return
  acting.value = true
  try {
    await Promise.all(taskIds.value.map((id) => retryForwardTask(id, true)))
    startPoll()
    await refresh(false)
    uni.showToast({ title: '已开始重试', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '重试失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

function confirm(content: string, confirmText: string) {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '提示',
      content,
      confirmText,
      cancelText: '再想想',
      success: (res) => resolve(!!res.confirm),
    })
  })
}

function goBack() {
  safeBack('/pages/chat/index')
}

function sum(list: ForwardTask[], pick: (t: ForwardTask) => number) {
  return list.reduce((n, t) => n + pick(t), 0)
}

function mergedStatus(list: ForwardTask[]): ForwardTaskStatus {
  if (list.some((t) => t.status === 'processing' || t.status === 'pending' || t.status === 'expanding')) {
    return 'processing'
  }
  if (list.every((t) => t.status === 'completed')) return 'completed'
  if (list.every((t) => t.status === 'cancelled')) return 'cancelled'
  if (list.every((t) => t.status === 'failed')) return 'failed'
  if (list.some((t) => t.status === 'paused')) return 'paused'
  return 'partially_completed'
}

function labelOf(status: ForwardTaskStatus) {
  const map: Record<ForwardTaskStatus, string> = {
    draft: '草稿',
    expanding: '准备中',
    pending: '排队中',
    processing: '发送中',
    completed: '已完成',
    partially_completed: '部分完成',
    failed: '失败',
    paused: '已暂停',
    cancelled: '已取消',
  }
  return map[status]
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="back" @click="goBack">‹</view>
      <text class="title">转发进度</text>
      <view class="nav-right"></view>
    </view>

    <view v-if="merged" class="card">
      <text class="status">{{ statusText }}</text>
      <view class="bar">
        <view class="bar-inner" :style="{ width: percent + '%' }"></view>
      </view>
      <text class="percent">{{ percent }}%</text>
      <view class="stats">
        <view class="stat">
          <text class="num">{{ merged.targetCount }}</text>
          <text class="label">目标</text>
        </view>
        <view class="stat">
          <text class="num ok">{{ merged.successCount }}</text>
          <text class="label">成功</text>
        </view>
        <view class="stat">
          <text class="num wait">{{ merged.pendingCount + merged.processingCount }}</text>
          <text class="label">进行中</text>
        </view>
        <view class="stat">
          <text class="num fail">{{ merged.failedCount }}</text>
          <text class="label">失败</text>
        </view>
        <view class="stat">
          <text class="num">{{ merged.skippedCount }}</text>
          <text class="label">跳过</text>
        </view>
      </view>
      <text class="hint">好友会陆续收到，互不可见。可离开此页，发送会在后台继续。</text>
    </view>
    <view v-else-if="!loading" class="empty">暂无进度</view>

    <view class="actions">
      <view v-if="canCancel" class="btn ghost" :class="{ disabled: acting }" @click="onCancel">取消未发送</view>
      <view v-if="canRetry" class="btn primary" :class="{ disabled: acting }" @click="onRetry">重试失败</view>
      <view v-if="!running" class="btn primary" @click="goBack">完成</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
}

.nav {
  height: 96rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  background: #fff;
}

.back {
  width: 72rpx;
  font-size: 52rpx;
  color: #111;
}

.title {
  flex: 1;
  text-align: center;
  font-size: 36rpx;
  font-weight: 700;
  color: #111;
}

.nav-right {
  width: 72rpx;
}

.card {
  margin: 24rpx 32rpx;
  padding: 40rpx 32rpx;
  background: #fff;
  border-radius: 16rpx;
}

.status {
  display: block;
  text-align: center;
  font-size: 34rpx;
  font-weight: 700;
  color: #212121;
}

.bar {
  margin-top: 32rpx;
  height: 16rpx;
  border-radius: 8rpx;
  background: #f3f4f7;
  overflow: hidden;
}

.bar-inner {
  height: 100%;
  background: #0a2fc2;
}

.percent {
  display: block;
  margin-top: 12rpx;
  text-align: right;
  font-size: 24rpx;
  color: #8a8f9c;
}

.stats {
  display: flex;
  margin-top: 36rpx;
}

.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.num {
  font-size: 32rpx;
  font-weight: 700;
  color: #212121;
}

.num.ok {
  color: #0a2fc2;
}

.num.wait {
  color: #636e86;
}

.num.fail {
  color: #e54d42;
}

.label {
  font-size: 22rpx;
  color: #8a8f9c;
}

.hint {
  display: block;
  margin-top: 32rpx;
  font-size: 24rpx;
  color: #8a8f9c;
  line-height: 1.5;
}

.empty {
  padding: 80rpx 0;
  text-align: center;
  color: #8a8f9c;
}

.actions {
  padding: 24rpx 32rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.btn {
  height: 88rpx;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
}

.btn.primary {
  background: #0a2fc2;
  color: #fff;
}

.btn.ghost {
  background: #fff;
  color: #212121;
}

.btn.disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
