<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { MessageType } from 'openim-uniapp-polyfill'
import type { MessageItem } from 'openim-uniapp-polyfill'
import EmptyState from '@/components/EmptyState.vue'
import ImNavBar from '@/components/ImNavBar.vue'
import { collectHistoryMessages, resolveGroupConversationID } from '@/utils/openim'

type MediaTab = 'all' | 'image' | 'video' | 'file'

interface MediaItem {
  id: string
  kind: 'image' | 'video' | 'file'
  url: string
  thumb: string
  name: string
}

const tabs: Array<{ key: MediaTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'file', label: '档案' },
]

const groupId = ref('')
const tab = ref<MediaTab>('all')
const loading = ref(false)
const items = ref<MediaItem[]>([])

const visible = computed(() => {
  if (tab.value === 'all') return items.value
  return items.value.filter((item) => item.kind === tab.value)
})

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) return
  loading.value = true
  try {
    const conversationId = await resolveGroupConversationID(groupId.value)
    const history = await collectHistoryMessages(conversationId)
    items.value = history.map(toMedia).filter((item): item is MediaItem => !!item)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
})

function goBack() {
  uni.navigateBack()
}

function toMedia(item: MessageItem): MediaItem | null {
  if (item.contentType === MessageType.PictureMessage) {
    const url =
      item.pictureElem?.sourcePicture?.url ||
      item.pictureElem?.snapshotPicture?.url ||
      item.pictureElem?.sourcePath ||
      ''
    if (!url) return null
    return {
      id: item.clientMsgID,
      kind: 'image',
      url,
      thumb: item.pictureElem?.snapshotPicture?.url || url,
      name: '',
    }
  }
  if (item.contentType === MessageType.VideoMessage) {
    const url = item.videoElem?.videoUrl || ''
    const thumb = item.videoElem?.snapshotUrl || url
    if (!url && !thumb) return null
    return {
      id: item.clientMsgID,
      kind: 'video',
      url,
      thumb,
      name: '',
    }
  }
  if (item.contentType === MessageType.FileMessage) {
    const url = item.fileElem?.sourceUrl || ''
    if (!url) return null
    return {
      id: item.clientMsgID,
      kind: 'file',
      url,
      thumb: '',
      name: item.fileElem?.fileName || '文件',
    }
  }
  return null
}

function onPreview(item: MediaItem) {
  if (item.kind === 'image') {
    const urls = visible.value.filter((row) => row.kind === 'image').map((row) => row.url)
    uni.previewImage({ current: item.url, urls })
    return
  }
  if (item.url) {
    uni.setClipboardData({
      data: item.url,
      success: () => uni.showToast({ title: item.kind === 'file' ? '链接已复制' : '视频地址已复制', icon: 'none' }),
    })
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar title="图片与视频" @back="goBack" />

    <view class="tabs">
      <view
        v-for="item in tabs"
        :key="item.key"
        class="tab"
        :class="{ on: tab === item.key }"
        @click="tab = item.key"
      >
        {{ item.label }}
      </view>
    </view>

    <view v-if="tab !== 'file'" class="grid">
      <view v-for="item in visible" :key="item.id" class="cell" @click="onPreview(item)">
        <image class="thumb" :src="item.thumb || item.url" mode="aspectFill" />
        <view v-if="item.kind === 'video'" class="play">▶</view>
      </view>
    </view>
    <view v-else class="files">
      <view v-for="item in visible" :key="item.id" class="file-row" @click="onPreview(item)">
        <text class="file-name">{{ item.name }}</text>
      </view>
    </view>

    <EmptyState v-if="!loading && !visible.length" text="暂无图片和视频" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.tabs {
  display: flex;
  padding: 8rpx 16rpx 16rpx;
  gap: 8rpx;
}

.tab {
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  text-align: center;
  font-size: 28rpx;
  color: #666;
  border-radius: 8rpx;
}

.tab.on {
  color: #0a2fc2;
  font-weight: 600;
  background: #eef2ff;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  padding: 0 8rpx;
}

.cell {
  width: 33.33%;
  padding: 8rpx;
  box-sizing: border-box;
  position: relative;
}

.thumb {
  width: 100%;
  height: 230rpx;
  border-radius: 8rpx;
  background: #f3f4f7;
}

.play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-row {
  padding: 28rpx 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.file-name {
  font-size: 28rpx;
  color: #1d1d1d;
}
</style>
