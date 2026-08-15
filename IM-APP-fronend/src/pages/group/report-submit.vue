<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import { safeBack } from '@/utils/nav'

const MAX_LEN = 200
const MIN_LEN = 5
const MAX_IMAGES = 9

const groupId = ref('')
const reason = ref('')
const description = ref('')
const images = ref<string[]>([])
const submitting = ref(false)

const descLen = computed(() => [...description.value].length)
const canSubmit = computed(
  () => descLen.value >= MIN_LEN && descLen.value <= MAX_LEN && !submitting.value,
)

onLoad((query) => {
  groupId.value = String(query?.id || '')
  reason.value = decodeURIComponent(String(query?.reason || ''))
})

function goBack() {
  safeBack('/pages/chat/index')
}

function addImages() {
  const remain = MAX_IMAGES - images.value.length
  if (remain <= 0) {
    uni.showToast({ title: `最多上传${MAX_IMAGES}张截图`, icon: 'none' })
    return
  }
  uni.chooseImage({
    count: remain,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const paths = Array.isArray(res.tempFilePaths) ? res.tempFilePaths : [res.tempFilePaths]
      images.value = [...images.value, ...(paths.filter(Boolean) as string[])].slice(0, MAX_IMAGES)
    },
  })
}

function removeImage(index: number) {
  images.value = images.value.filter((_, i) => i !== index)
}

function previewImage(index: number) {
  uni.previewImage({
    current: images.value[index],
    urls: images.value,
  })
}

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    // TODO: 检举接口未定。接口确定后在此提交：
    // 入参 groupId / reason / description(trim 后 5-200 字) / images(本地临时路径，需先上传换取 fileId 或 URL)
    await new Promise((r) => setTimeout(r, 300))
    uni.showToast({ title: '已送出', icon: 'success' })
    setTimeout(() => goBack(), 400)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar title="检举原因" @back="goBack" />

    <view class="section">
      <text class="section-title">检举原因</text>
      <view class="reason-box">
        <text>{{ reason }}</text>
      </view>
    </view>

    <view class="section">
      <text class="section-title">违规描述<text class="required">*</text></text>
      <view class="desc-box">
        <textarea
          v-model="description"
          class="textarea"
          placeholder="请透过5-200个字描述被投诉对象的违规行为"
          placeholder-class="placeholder"
          :maxlength="MAX_LEN"
        />
        <text class="counter">{{ descLen }}/{{ MAX_LEN }}</text>
      </view>
    </view>

    <view class="section">
      <text class="section-title">相关截图</text>
      <view class="images">
        <view v-for="(img, i) in images" :key="img" class="thumb">
          <image :src="img" class="thumb-img" mode="aspectFill" @click="previewImage(i)" />
          <view class="thumb-del" @click.stop="removeImage(i)">×</view>
        </view>
        <view v-if="images.length < MAX_IMAGES" class="add" @click="addImages">
          <text class="add-icon">+</text>
        </view>
      </view>
    </view>

    <view class="submit" :class="{ disabled: !canSubmit }" @click="onSubmit">
      {{ submitting ? '送出中…' : '送出' }}
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  padding-bottom: calc(48rpx + env(safe-area-inset-bottom));
}

.section {
  padding: 32rpx;
}

.section-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #1f1f1f;
  margin-bottom: 20rpx;
}

.required {
  color: #e54545;
}

.reason-box {
  background: #f2f3f5;
  border-radius: 12rpx;
  padding: 24rpx;
  font-size: 28rpx;
  color: #4b505c;
}

.desc-box {
  background: #f2f3f5;
  border-radius: 12rpx;
  padding: 24rpx;
}

.textarea {
  width: 100%;
  min-height: 200rpx;
  font-size: 28rpx;
  color: #222;
}

.placeholder {
  color: #a6abb8;
}

.counter {
  display: block;
  text-align: right;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #a6abb8;
}

.images {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx;
}

.thumb,
.add {
  width: 196rpx;
  height: 196rpx;
  border-radius: 12rpx;
  overflow: hidden;
}

.thumb {
  position: relative;
}

.thumb-img {
  width: 100%;
  height: 100%;
}

.thumb-del {
  position: absolute;
  top: 0;
  right: 0;
  width: 44rpx;
  height: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 30rpx;
  border-radius: 0 0 0 12rpx;
}

.add {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2rpx dashed #c8ccd6;
  box-sizing: border-box;
  background: #fafbfc;
}

.add-icon {
  font-size: 64rpx;
  color: #9aa0ad;
  font-weight: 300;
}

.submit {
  margin: 48rpx 32rpx 0;
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
  background: #e9eaee;
  color: #9aa0ad;
  pointer-events: none;
}
</style>
