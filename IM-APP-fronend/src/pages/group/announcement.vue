<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import {
  createGroupAnnouncement,
  deleteGroupAnnouncement,
  fetchAnnouncementHistory,
  updateGroupAnnouncement,
} from '@/api/group'
import { useGroupStore } from '@/stores/group'
import type { GroupAnnouncementHistoryItem } from '@/types'
import { uploadReportImage } from '@/utils/file-upload'
import { previewImagesWithSave } from '@/utils/chatMedia'
import { formatRelativeTime } from '@/utils/format'

const ANNOUNCE_MAX = 500
const MAX_IMAGES = 9
const MAX_ITEMS = 10

const groupStore = useGroupStore()
const groupId = ref('')
const announcement = ref('')
const original = ref('')
/** 正在改的那一条；空表示在写新公告 */
const editingId = ref('')
const images = ref<string[]>([])
const originalImages = ref<string[]>([])
const canEdit = ref(false)
const saving = ref(false)
const history = ref<GroupAnnouncementHistoryItem[]>([])

const count = computed(() => announcement.value.length)
const atLimit = computed(() => !editingId.value && history.value.length >= MAX_ITEMS)

function imagesChanged() {
  if (images.value.length !== originalImages.value.length) return true
  return images.value.some((url, i) => url !== originalImages.value[i])
}

const canSubmit = computed(() => {
  if (!canEdit.value || saving.value || atLimit.value) return false
  if (!announcement.value.trim() && images.value.length === 0) return false
  if (!editingId.value) return true
  return announcement.value !== original.value || imagesChanged()
})

function resetComposer() {
  editingId.value = ''
  announcement.value = ''
  original.value = ''
  images.value = []
  originalImages.value = []
}

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
    resetComposer()
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
      const paths = (Array.isArray(res.tempFilePaths) ? res.tempFilePaths : [res.tempFilePaths]).filter(
        Boolean,
      ) as string[]
      const seen = new Set(images.value)
      const next = [...images.value]
      for (const p of paths) {
        if (seen.has(p)) continue
        seen.add(p)
        next.push(p)
        if (next.length >= MAX_IMAGES) break
      }
      images.value = next
    },
  })
}

function removeImage(index: number) {
  if (!canEdit.value) return
  images.value = images.value.filter((_, i) => i !== index)
}

function previewImage(list: string[], index: number) {
  if (!list.length) return
  void previewImagesWithSave(list, list[index])
}

function beginEdit(item: GroupAnnouncementHistoryItem) {
  editingId.value = item.id
  announcement.value = item.content || ''
  original.value = item.content || ''
  const imgs = historyImages(item)
  images.value = [...imgs]
  originalImages.value = [...imgs]
}

function onDelete(item: GroupAnnouncementHistoryItem) {
  if (!canEdit.value || saving.value) return
  uni.showModal({
    title: '删除公告',
    content: '删除后成员将看不到这一条',
    success: (res) => {
      if (!res.confirm) return
      void removeAnnouncement(item.id)
    },
  })
}

async function removeAnnouncement(id: string) {
  saving.value = true
  uni.showLoading({ title: '删除中…', mask: true })
  try {
    await deleteGroupAnnouncement(groupId.value, id)
    if (editingId.value === id) resetComposer()
    await loadHistory()
    void groupStore.loadDetail(groupId.value)
    uni.hideLoading()
    uni.showToast({ title: '已删除', icon: 'success' })
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error)?.message || '删除失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

async function onSubmit() {
  // 先卡锁：不要只靠 canSubmit（disabled 下一帧才生效，连点会打出两条公告）
  if (saving.value || !canEdit.value) return
  if (atLimit.value) {
    uni.showToast({ title: '最多 10 条，请先删除或编辑已有公告', icon: 'none' })
    return
  }
  if (!announcement.value.trim() && images.value.length === 0) {
    uni.showToast({ title: '请填写公告内容或图片', icon: 'none' })
    return
  }
  if (editingId.value && announcement.value === original.value && !imagesChanged()) {
    uni.showToast({ title: '内容未变化', icon: 'none' })
    return
  }
  if (announcement.value.length > ANNOUNCE_MAX) {
    uni.showToast({ title: `公告最多 ${ANNOUNCE_MAX} 个字`, icon: 'none' })
    return
  }
  saving.value = true
  uni.showLoading({ title: '保存中…', mask: true })
  const editing = editingId.value
  try {
    const localPaths = images.value.filter((p) => !isRemoteUrl(p))
    const announcementImageFileIds = await Promise.all(localPaths.map((p) => uploadReportImage(p)))
    if (editing) {
      await updateGroupAnnouncement(
        groupId.value,
        editing,
        announcement.value,
        announcementImageFileIds,
        images.value.filter(isRemoteUrl),
      )
    } else {
      await createGroupAnnouncement(groupId.value, announcement.value, announcementImageFileIds)
    }
    resetComposer()
    await loadHistory()
    void groupStore.loadDetail(groupId.value)
    uni.hideLoading()
    uni.showToast({ title: editing ? '已保存' : '已发布', icon: 'success' })
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
    <ImNavBar
      title="群公告"
      @back="goBack"
    />

    <scroll-view
      scroll-y
      class="body"
      :show-scrollbar="false"
    >
      <view
        v-if="canEdit"
        class="form"
      >
        <text class="section-label">
          {{ editingId ? '编辑这一条' : '发布新公告' }}
        </text>
        <text class="section-hint">
          最多 10 条，互不影响。改某一条请点下面的编辑，不会再复制出一条。
        </text>
        <textarea
          v-model="announcement"
          class="textarea"
          :maxlength="ANNOUNCE_MAX"
          :placeholder="editingId ? '修改这条公告' : '请输入新的公告内容'"
          auto-height
        />
        <view class="meta">
          <text class="count">
            {{ count }}/ {{ ANNOUNCE_MAX }}
          </text>
        </view>
        <view class="images">
          <view
            v-for="(img, i) in images"
            :key="`${img}-${i}`"
            class="thumb"
          >
            <image
              class="thumb-img"
              :src="img"
              mode="aspectFill"
              @click="previewImage(images, i)"
            />
            <view
              class="thumb-del"
              @click.stop="removeImage(i)"
            >
              <text class="thumb-del-text">
                ×
              </text>
            </view>
          </view>
          <view
            v-if="images.length < MAX_IMAGES"
            class="add"
            @click="addImages"
          >
            <text class="add-icon">
              +
            </text>
            <text class="add-label">
              图片
            </text>
          </view>
        </view>
      </view>

      <view class="history-head">
        <text class="history-title">
          已发布（{{ history.length }}/{{ MAX_ITEMS }}）
        </text>
      </view>
      <view
        v-if="!history.length"
        class="history-empty"
      >
        暂无群公告
      </view>
      <view
        v-for="(item, index) in history"
        :key="item.id"
        class="history-card"
        :class="{ editing: editingId === item.id }"
      >
        <view class="history-meta">
          <text class="history-author">
            {{ item.publisherName || '管理员' }}{{ index === 0 ? ' · 最新' : '' }}
          </text>
          <text class="history-time">
            {{ historyTime(item) }}
          </text>
        </view>
        <text class="history-content">
          {{ item.content || '（仅图片）' }}
        </text>
        <view
          v-if="historyImages(item).length"
          class="images readonly"
        >
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
        <view
          v-if="canEdit"
          class="history-actions"
        >
          <text
            class="history-action"
            @click="beginEdit(item)"
          >
            编辑
          </text>
          <text
            class="history-action danger"
            @click="onDelete(item)"
          >
            删除
          </text>
        </view>
      </view>
    </scroll-view>

    <view
      v-if="canEdit"
      class="footer"
    >
      <view
        v-if="editingId"
        class="btn ghost"
        @click="resetComposer"
      >
        取消
      </view>
      <view
        class="btn"
        :class="{ disabled: !canSubmit }"
        @click="onSubmit"
      >
        {{ editingId ? '保存' : '发布' }}
      </view>
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

.section-label {
  display: block;
  margin-bottom: 8rpx;
  font-size: 26rpx;
  color: #636e86;
}

.section-hint {
  display: block;
  margin-bottom: 16rpx;
  font-size: 22rpx;
  color: #8a8f9c;
  line-height: 1.5;
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

.history-card.editing {
  box-shadow: inset 0 0 0 2rpx #0a2fc2;
}

.history-actions {
  display: flex;
  justify-content: flex-end;
  gap: 32rpx;
  margin-top: 16rpx;
}

.history-action {
  font-size: 26rpx;
  color: #0a2fc2;
}

.history-action.danger {
  color: #e54d42;
}

.footer {
  display: flex;
  gap: 16rpx;
  padding: 24rpx 32rpx calc(24rpx + env(safe-area-inset-bottom));
  flex-shrink: 0;
  background: #f3f4f7;
}

.btn {
  flex: 1;
  height: 96rpx;
  line-height: 96rpx;
  border-radius: 16rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  text-align: center;
}

.btn.ghost {
  background: #fff;
  color: #212121;
  border: 1rpx solid #e1e3ea;
}

.btn.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
