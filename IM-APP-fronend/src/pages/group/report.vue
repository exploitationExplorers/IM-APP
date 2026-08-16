<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import type { GroupReportReason } from '@/api/report'
import { safeBack } from '@/utils/nav'

/** 检举原因：文案按原型展示，value 为后端 /groups/reports 的 reason 枚举 */
const REASONS: { value: GroupReportReason; label: string }[] = [
  { value: 'pornography', label: '该群组发布色情，广告等不良信息' },
  { value: 'fraud', label: '该群组存在诈骗钱财的行为' },
  { value: 'spam', label: '该群组发布广告骚扰信息' },
  { value: 'other', label: '其他违规行为' },
]

const groupId = ref('')

onLoad((query) => {
  groupId.value = String(query?.id || '')
})

function goBack() {
  safeBack('/pages/chat/index')
}

function chooseReason(reason: { value: GroupReportReason; label: string }) {
  uni.navigateTo({
    url: `/pages/group/report-submit?id=${encodeURIComponent(groupId.value)}&reason=${reason.value}&label=${encodeURIComponent(reason.label)}`,
  })
}
</script>

<template>
  <view class="page">
    <ImNavBar title="检举原因" @back="goBack" />

    <view class="card">
      <view
        v-for="(reason, i) in REASONS"
        :key="reason.value"
        class="row"
        :class="{ last: i === REASONS.length - 1 }"
        @click="chooseReason(reason)"
      >
        <text class="row-text">{{ reason.label }}</text>
        <text class="arrow">›</text>
      </view>
    </view>
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
  padding: 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.row.last {
  border-bottom: none;
}

.row-text {
  font-size: 30rpx;
  color: #222;
}

.arrow {
  color: #c8ccd6;
  font-size: 36rpx;
}
</style>
