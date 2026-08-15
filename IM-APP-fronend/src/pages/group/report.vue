<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import { safeBack } from '@/utils/nav'

/** 检举原因（接口未定，先按原型写死，接口确定后改为拉取） */
const REASONS = [
  '该群组发布色情，广告等不良信息',
  '该群组存在诈骗钱财的行为',
  '该群组发布广告骚扰信息',
  '其他违规行为',
]

const groupId = ref('')

onLoad((query) => {
  groupId.value = String(query?.id || '')
})

function goBack() {
  safeBack('/pages/chat/index')
}

function chooseReason(reason: string) {
  uni.navigateTo({
    url: `/pages/group/report-submit?id=${encodeURIComponent(groupId.value)}&reason=${encodeURIComponent(reason)}`,
  })
}
</script>

<template>
  <view class="page">
    <ImNavBar title="检举原因" @back="goBack" />

    <view class="card">
      <view
        v-for="(reason, i) in REASONS"
        :key="reason"
        class="row"
        :class="{ last: i === REASONS.length - 1 }"
        @click="chooseReason(reason)"
      >
        <text class="row-text">{{ reason }}</text>
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
