<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  createSticker,
  deleteStickers,
  fetchStickers,
  type StickerItem,
} from '@/api/sticker'
import ImNavBar from '@/components/ImNavBar.vue'
import { uploadSticker } from '@/utils/file-upload'
import { safeBack } from '@/utils/nav'

const VALID_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp']

const isEditMode = ref(false)
const emotions = shallowRef<StickerItem[]>([])
const selectedIds = ref<string[]>([])
const loading = ref(false)
const uploading = ref(false)

const hasSelected = computed(() => selectedIds.value.length > 0)

function goBack() {
  safeBack()
}

function toggleEdit() {
  if (!emotions.value.length && !isEditMode.value) {
    uni.showToast({ title: '暂无表情可编辑', icon: 'none' })
    return
  }
  isEditMode.value = !isEditMode.value
  if (!isEditMode.value) {
    selectedIds.value = []
  }
}

async function loadStickers() {
  if (loading.value) return
  loading.value = true
  try {
    emotions.value = await fetchStickers({ page: 1, size: 100 })
  } catch (e) {
    uni.showToast({
      title: e instanceof Error ? e.message : '加载失败',
      icon: 'none',
    })
  } finally {
    loading.value = false
  }
}

function isValidImagePath(path: string, file?: { name?: string; type?: string }): boolean {
  const name = (file?.name || path).toLowerCase()
  const extMatch = name.match(/\.[0-9a-z]+$/i)
  const ext = extMatch ? extMatch[0] : ''
  if (ext && VALID_EXTS.includes(ext)) return true
  if (file?.type && file.type.startsWith('image/')) return true
  // App 临时路径常无扩展名，仍按图片处理
  if (!ext) return true
  return false
}

function onUpload() {
  if (isEditMode.value || uploading.value) return

  uni.chooseImage({
    count: 9,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const tempFiles = (res.tempFiles || []) as unknown as { path: string; name?: string; type?: string }[]
      const paths = (res.tempFilePaths || []) as string[]
      const validPaths: string[] = []
      let hasInvalid = false

      paths.forEach((path, index) => {
        const file = tempFiles[index]
        if (isValidImagePath(path, file)) {
          validPaths.push(path)
        } else {
          hasInvalid = true
        }
      })

      if (hasInvalid) {
        uni.showToast({ title: '仅支持上传图片格式', icon: 'none' })
      }
      if (!validPaths.length) return

      uploading.value = true
      uni.showLoading({ title: '上传中...', mask: true })
      let ok = 0
      let fail = 0
      try {
        for (const path of validPaths) {
          try {
            const fileId = await uploadSticker(path)
            await createSticker(fileId)
            ok++
          } catch {
            fail++
          }
        }
        await loadStickers()
        if (ok && !fail) {
          uni.showToast({ title: '上传成功', icon: 'success' })
        } else if (ok && fail) {
          uni.showToast({ title: `${ok} 张成功，${fail} 张失败`, icon: 'none' })
        } else {
          uni.showToast({ title: '上传失败', icon: 'none' })
        }
      } finally {
        uni.hideLoading()
        uploading.value = false
      }
    },
  })
}

function onEmotionClick(item: StickerItem) {
  if (isEditMode.value) {
    const index = selectedIds.value.indexOf(item.id)
    if (index > -1) {
      selectedIds.value.splice(index, 1)
    } else {
      selectedIds.value.push(item.id)
    }
    return
  }
  uni.previewImage({
    urls: emotions.value.map((e) => e.url),
    current: item.url,
  })
}

function onDelete() {
  if (!hasSelected.value) return

  uni.showModal({
    title: '提示',
    content: `确定删除这 ${selectedIds.value.length} 个表情吗？`,
    confirmColor: '#ff4d4f',
    success: async (res) => {
      if (!res.confirm) return
      uni.showLoading({ title: '删除中...', mask: true })
      try {
        await deleteStickers([...selectedIds.value])
        selectedIds.value = []
        await loadStickers()
        if (emotions.value.length === 0) {
          isEditMode.value = false
        }
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        uni.showToast({
          title: e instanceof Error ? e.message : '删除失败',
          icon: 'none',
        })
      } finally {
        uni.hideLoading()
      }
    },
  })
}

onShow(() => {
  void loadStickers()
})
</script>

<template>
  <view class="page">
    <ImNavBar title="我的表情" @back="goBack">
      <template #right>
        <view class="edit-btn" :class="{ 'cancel-btn': isEditMode }" @click="toggleEdit">
          {{ isEditMode ? '取消' : '编辑' }}
        </view>
      </template>
    </ImNavBar>

    <scroll-view scroll-y class="content" :class="{ 'has-bottom-bar': isEditMode }">
      <view class="grid-container">
        <view v-if="!isEditMode" class="emotion-item add-btn-wrap" @click="onUpload">
          <view class="add-btn">
            <text class="add-icon">+</text>
          </view>
        </view>

        <view
          v-for="item in emotions"
          :key="item.id"
          class="emotion-item"
          @click="onEmotionClick(item)"
        >
          <image class="emotion-img" :src="item.url" mode="aspectFill" />
          <view v-if="isEditMode" class="checkbox-wrap">
            <view class="checkbox" :class="{ checked: selectedIds.includes(item.id) }">
              <view v-if="selectedIds.includes(item.id)" class="check-mark"></view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-if="isEditMode" class="bottom-bar">
      <view class="delete-btn" :class="{ active: hasSelected }" @click="onDelete">
        删除
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

.edit-btn {
  font-size: 28rpx;
  color: #333;
  padding: 8rpx 16rpx;
  border-radius: 8rpx;
}
.edit-btn.cancel-btn {
  background: #f5f6f8;
}

.content {
  flex: 1;
  width: 100%;
  box-sizing: border-box;
  padding: 32rpx;
}
.content.has-bottom-bar {
  padding-bottom: calc(140rpx + env(safe-area-inset-bottom));
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20rpx;
}

.emotion-item {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12rpx;
  position: relative;
  overflow: hidden;
  background: #f5f6f8;
}

.emotion-img {
  width: 100%;
  height: 100%;
  display: block;
}

.add-btn-wrap {
  background: transparent;
}
.add-btn {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 2rpx dashed #a0a5b3;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.add-icon {
  font-size: 50rpx;
  color: #a0a5b3;
  font-weight: 300;
}

.checkbox-wrap {
  position: absolute;
  top: 0;
  right: 0;
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 8rpx;
  box-sizing: border-box;
  background: linear-gradient(to bottom left, rgba(0, 0, 0, 0.2), transparent);
}
.checkbox {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  border: 2rpx solid #ffffff;
  background: rgba(0, 0, 0, 0.3);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.checkbox.checked {
  background: #0a2fc2;
  border-color: #0a2fc2;
}
.check-mark {
  width: 10rpx;
  height: 18rpx;
  border-right: 3rpx solid #fff;
  border-bottom: 3rpx solid #fff;
  transform: rotate(45deg);
  margin-bottom: 4rpx;
}

.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 20rpx 32rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  box-sizing: border-box;
  border-top: 1rpx solid #f0f0f0;
}
.delete-btn {
  width: 100%;
  height: 88rpx;
  background: #e5e5e5;
  color: #999999;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  font-weight: 500;
}
.delete-btn.active {
  background: #ff4d4f;
  color: #ffffff;
}
</style>
