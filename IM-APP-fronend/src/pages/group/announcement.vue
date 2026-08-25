<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import { fetchAnnouncementHistory } from '@/api/group'
import { useGroupStore } from '@/stores/group'
import type { GroupAnnouncementHistoryItem } from '@/types'
import { uploadReportImage } from '@/utils/file-upload'
import { formatRelativeTime } from '@/utils/format'

const ANNOUNCE_MAX = 500
const MAX_IMAGES = 9

const groupStore = useGroupStore()
const groupId = ref('')
const announcement = ref('')
const original = ref('')
const images = ref<string[]>([])
const originalImages = ref<string[]>([])
const canEdit = ref(false)
const saving = ref(false)
const history = ref<GroupAnnouncementHistoryItem[]>([])

const count = computed(() => announcement.value.length)

function imagesChanged() {
  if (images.value.length !== originalImages.value.length) return true
  return images.value.some((url, i) => url !== originalImages.value[i])
}

const canSubmit = computed(
  () =>
    canEdit.value &&
    !saving.value &&
    (announcement.value !== original.value || imagesChanged()),
)

function isRemoteUrl(path: string) {
  return /^https?:\/\//i.test(path)
}

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
    const imgs = Array.isArray(detail.announcementImages) ? [...detail.announcementImages] : []
    images.value = imgs
    originalImages.value = [...imgs]
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

function addImages() {
  if (!canEdit.value) return
  const remain = MAX_IMAGES - images.value.length
  if (remain <= 0) {
    uni.showToast({ title: `最多上传${MAX_IMAGES}张图片`, icon: 'none' })
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
  if (!canEdit.value) return
  images.value = images.value.filter((_, i) => i !== index)
}

function previewImage(list: string[], index: number) {
  if (!list.length) return
  uni.previewImage({
    current: list[index],
    urls: list,
  })
}

async function onSubmit() {
  if (!canSubmit.value) return
  if (announcement.value.length > ANNOUNCE_MAX) {
    uni.showToast({ title: `公告最多 ${ANNOUNCE_MAX} 个字`, icon: 'none' })
    return
  }
  saving.value = true
  uni.showLoading({ title: '保存中…', mask: true })
  try {
    const keepAnnouncementImages = images.value.filter(isRemoteUrl)
    const localPaths = images.value.filter((p) => !isRemoteUrl(p))
    const announcementImageFileIds = await Promise.all(localPaths.map((p) => uploadReportImage(p)))
    const updated = await groupStore.updateSettings(groupId.value, {
      announcement: announcement.value,
      announcementImageFileIds,
      keepAnnouncementImages,
    })
    original.value = announcement.value
    const nextImages = Array.isArray(updated.announcementImages) ? [...updated.announcementImages] : []
    images.value = nextImages
    originalImages.value = [...nextImages]
    await loadHistory()
    uni.hideLoading()
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error)?.message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function historyTime(item: GroupAnnouncementHistoryItem) {
  return formatRelativeTime(item.createdAt)
}

function historyImages(item: GroupAnnouncementHistoryItem) {
  return Array.isArray(item.images) ? item.images.filter(Boolean) : []
}
</script>

<template>
  <view class="page">
    <ImNavBar title="群公告" @back="goBack" />

    <scroll-view scroll-y class="body" :show-scrollbar="false">
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
        <view class="images">
          <view v-for="(img, i) in images" :key="`${img}-${i}`" class="thumb">
            <image class="thumb-img" :src="img" mode="aspectFill" @click="previewImage(images, i)" />
            <view class="thumb-del" @click.stop="removeImage(i)">
              <text class="thumb-del-text">×</text>
            </view>
          </view>
          <view v-if="images.length < MAX_IMAGES" class="add" @click="addImages">
            <text class="add-icon">+</text>
            <text class="add-label">图片</text>
          </view>
        </view>
      </view>
      <view v-else class="content">
        <text class="announcement">{{ announcement || '暂无群公告' }}</text>
        <view v-if="images.length" class="images readonly">
          <view v-for="(img, i) in images" :key="`${img}-${i}`" class="thumb">
            <image class="thumb-img" :src="img" mode="aspectFill" @click="previewImage(images, i)" />
          </view>
        </view>
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
        <view v-if="historyImages(item).length" class="images readonly">
          <view
            v-for="(img, i) in historyImages(item)"
            :key="`${item.id}-${i}`"
            class="thumb"
          >
            <image
              class="thumb-img"
              :src="img"
              mode="aspectFill"
              @click="previewImage(historyImages(item), i)"
            />
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-if="canEdit" class="footer">
      <button class="btn" :disabled="!canSubmit" @click="onSubmit">确认</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  height: 100dvh;
  background: #f3f4f7;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.body {
  flex: 1;
  min-height: 0;
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

.images {
  margin-top: 24rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.images.readonly {
  margin-top: 20rpx;
}

.thumb {
  position: relative;
  width: 160rpx;
  height: 160rpx;
  border-radius: 12rpx;
  overflow: hidden;
  background: #f3f4f7;
}

.thumb-img {
  width: 100%;
  height: 100%;
}

.thumb-del {
  position: absolute;
  top: 0;
  right: 0;
  width: 40rpx;
  height: 40rpx;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom-left-radius: 12rpx;
}

.thumb-del-text {
  color: #fff;
  font-size: 28rpx;
  line-height: 1;
}

.add {
  width: 160rpx;
  height: 160rpx;
  border-radius: 12rpx;
  background: #f3f4f7;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}

.add-icon {
  font-size: 48rpx;
  color: #8a8f9c;
  line-height: 1;
}

.add-label {
  font-size: 22rpx;
  color: #8a8f9c;
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
