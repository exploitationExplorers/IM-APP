<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import { createGroupReport, type GroupReportReason } from '@/api/report'
import { uploadReportImage } from '@/utils/file-upload'
import { safeBack } from '@/utils/nav'

const MIN_LEN = 5
const MAX_LEN = 200
const MAX_IMAGES = 9

const groupId = ref('')
const reason = ref<GroupReportReason>('other')
const reasonLabel = ref('')
const description = ref('')
const images = ref<string[]>([])
const submitting = ref(false)

const descLen = computed(() => [...description.value].length)
const canSubmit = computed(
  () =>
    !!groupId.value &&
    descLen.value >= MIN_LEN &&
    descLen.value <= MAX_LEN &&
    !submitting.value,
)

onLoad((query) => {
  groupId.value = String(query?.id || '')
  reason.value = String(query?.reason || 'other') as GroupReportReason
  reasonLabel.value = decodeURIComponent(String(query?.label || ''))
})

function goBack() {
  safeBack('/pages/chat/index')
}

/** 提交成功后越过检举原因页，直接回到群详情 */
function backToDetail() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  if (pages.length > 2) {
    uni.navigateBack({ delta: 2 })
    return
  }
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.reLaunch({ url: '/pages/chat/index' })
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
  uni.showLoading({ title: '送出中…', mask: true })
  try {
    // 截图先走文件上传任务换 fileId，再随举报一起提交
    const imageFileIds = await Promise.all(images.value.map((path) => uploadReportImage(path)))
    await createGroupReport({
      groupId: groupId.value,
      reason: reason.value,
      description: description.value.trim(),
      imageFileIds,
    })
    uni.hideLoading()
    uni.showToast({ title: '已送出', icon: 'success' })
    setTimeout(() => backToDetail(), 400)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message || '提交失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar title="检举原因" @back="goBack" />

    <view class="card">
      <view class="card-title">检举原因</view>
      <view class="reason-box">
        <text>{{ reasonLabel }}</text>
      </view>
    </view>

    <view class="card">
      <view class="card-title">违规描述<text class="required">*</text></view>
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

    <view class="card">
      <view class="card-title">相关截图</view>
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
  background: #f5f5f5;
  padding-bottom: calc(48rpx + env(safe-area-inset-bottom));
}

.card {
  margin: 24rpx;
  background: #fff;
  border-radius: 16rpx;
  overflow: hidden;
  padding: 8rpx 32rpx 32rpx;
}

.card-title {
  padding: 24rpx 0;
  font-size: 30rpx;
  font-weight: 600;
  color: #1f1f1f;
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
  margin: 48rpx 24rpx 0;
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
