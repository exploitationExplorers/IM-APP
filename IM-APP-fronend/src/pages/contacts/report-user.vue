<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { createUserReport, fetchReportReasons, type ReportReason } from '@/api/report'
import { safeBack } from '@/utils/nav'
import ImNavBar from '@/components/ImNavBar.vue'

const userId = ref('')
const reasons = ref<ReportReason[]>([])
const selectedId = ref('')
const description = ref('')
const submitting = ref(false)

onLoad(async (query) => {
  userId.value = String(query?.id || '')
  try {
    reasons.value = await fetchReportReasons('user')
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
  }
})

function goBack() {
  safeBack('/pages/chat/index')
}

async function onSubmit() {
  if (!userId.value || !selectedId.value || submitting.value) return
  submitting.value = true
  try {
    await createUserReport({
      targetId: userId.value,
      reasonId: selectedId.value,
      description: description.value.trim(),
    })
    uni.showToast({ title: '已提交', icon: 'success' })
    setTimeout(() => goBack(), 400)
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '提交失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar title="检举" @back="goBack" />

    <view class="card">
      <view
        v-for="item in reasons"
        :key="item.id"
        class="row"
        @click="selectedId = item.id"
      >
        <text>{{ item.reason }}</text>
        <view class="check" :class="{ on: selectedId === item.id }" />
      </view>
    </view>

    <view class="card desc">
      <textarea
        v-model="description"
        class="textarea"
        placeholder="补充说明（选填）"
        maxlength="1000"
      />
    </view>

    <view class="submit" :class="{ disabled: !selectedId || submitting }" @click="onSubmit">提交</view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f5f5;
}

.card {
  margin: 24rpx;
  background: #fff;
  border-radius: 16rpx;
  overflow: hidden;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
  font-size: 30rpx;
  color: #222;
}

.check {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  border: 3rpx solid #c8ccd6;
}

.check.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
}

.desc {
  padding: 20rpx 24rpx;
}

.textarea {
  width: 100%;
  min-height: 160rpx;
  font-size: 28rpx;
}

.submit {
  margin: 48rpx 24rpx;
  height: 88rpx;
  border-radius: 16rpx;
  background: #0a2fc2;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  font-weight: 600;
}

.submit.disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
