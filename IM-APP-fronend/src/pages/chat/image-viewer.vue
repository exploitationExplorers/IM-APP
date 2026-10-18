<script setup lang="ts">
import { computed, ref, shallowRef, onMounted, onBeforeUnmount } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PreviewImageSlide from '@/components/PreviewImageSlide.vue'
import { takeImagePreviewSession, type ImagePreviewSession } from '@/utils/imagePreviewSession'
import { saveImageToDevice } from '@/utils/chatMedia'
import { safeBack } from '@/utils/nav'
import { getStatusBarHeight } from '@/utils/status-bar'

const session = shallowRef<ImagePreviewSession>()
const current = shallowRef(0)
const readyPaths = ref<Record<number, string>>({})
const zoomed = shallowRef(false)
const saving = shallowRef(false)
const top = getStatusBarHeight() + 10
const count = computed(() => session.value?.urls.length || 0)

onLoad((query) => {
  session.value = takeImagePreviewSession(String(query?.session || ''))
  if (session.value) current.value = session.value.current
})

function change(event: { detail: { current: number } }) {
  current.value = event.detail.current
  zoomed.value = false
}

function move(delta: number) {
  const next = current.value + delta
  if (next >= 0 && next < count.value) change({ detail: { current: next } })
}

function saveMenu() {
  if (!readyPaths.value[current.value]) return
  uni.showActionSheet({
    itemList: ['保存图片'],
    success: ({ tapIndex }) => {
      if (tapIndex === 0) void save()
    },
  })
}

// #ifdef H5
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') safeBack()
  if (event.key === 'ArrowLeft') move(-1)
  if (event.key === 'ArrowRight') move(1)
}
onMounted(() => document.addEventListener('keydown', keydown))
onBeforeUnmount(() => document.removeEventListener('keydown', keydown))
// #endif

async function save() {
  const path = readyPaths.value[current.value]
  if (!path || saving.value) return
  saving.value = true
  try {
    await saveImageToDevice(path)
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (cause) {
    uni.showToast({ title: cause instanceof Error ? cause.message : '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="image-viewer">
    <view class="viewer-header" :style="{ top: `${top}px` }">
      <button class="viewer-control viewer-close" aria-label="关闭图片预览" @click="safeBack()">
        关闭
      </button>
      <text class="viewer-counter">{{ count ? `${current + 1} / ${count}` : '图片预览' }}</text>
      <button
        class="viewer-control"
        :disabled="!readyPaths[current] || saving"
        :aria-disabled="!readyPaths[current] || saving"
        @click="save"
      >
        保存
      </button>
    </view>
    <swiper
      v-if="session"
      class="viewer-swiper"
      :current="current"
      :disable-touch="zoomed"
      :duration="200"
      @change="change"
    >
      <swiper-item v-for="(url, index) in session.urls" :key="`${index}:${url}`">
        <PreviewImageSlide
          v-if="current === index"
          :url="url"
          :owner="session.owner"
          :thumbnail="session.thumbnails[index]"
          :active="current === index"
          @zoom="
            (value) => {
              if (current === index) zoomed = value
            }
          "
          @ready="(path) => (readyPaths[index] = path)"
          @save="saveMenu"
        />
      </swiper-item>
    </swiper>
    <button
      v-if="current > 0"
      class="viewer-arrow viewer-prev"
      aria-label="上一张图片"
      @click="move(-1)"
    >
      ‹
    </button>
    <button
      v-if="current + 1 < count"
      class="viewer-arrow viewer-next"
      aria-label="下一张图片"
      @click="move(1)"
    >
      ›
    </button>
    <text v-if="!session" class="viewer-expired">预览已结束，请返回聊天重新打开</text>
    <text class="viewer-hint">双指缩放 · 左右滑动切换</text>
  </view>
</template>

<style scoped>
.image-viewer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: #080808;
  color: #fff;
}
.viewer-header {
  position: absolute;
  left: 14px;
  right: 14px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 5;
  pointer-events: none;
}
.viewer-control {
  margin: 0;
  padding: 0 16px;
  height: 36px;
  line-height: 36px;
  color: #fff;
  background: rgba(40, 40, 40, 0.85);
  border: 1px solid #555;
  border-radius: 20px;
  font-size: 14px;
  pointer-events: auto;
}
.viewer-control[aria-disabled='true'] {
  color: #777;
  background: #282828;
}
.viewer-counter {
  font-size: 14px;
  text-shadow: 0 1px 3px #000;
}
.viewer-swiper {
  position: absolute;
  top: 80px;
  bottom: 64px;
  width: 100%;
  height: auto;
}
.viewer-arrow {
  position: absolute;
  top: 45%;
  width: 34px;
  padding: 0;
  background: rgba(40, 40, 40, 0.6);
  color: #fff;
  border: 0;
  font-size: 30px;
}
.viewer-prev {
  left: 4px;
}
.viewer-next {
  right: 4px;
}
.viewer-hint {
  position: absolute;
  bottom: calc(22px + env(safe-area-inset-bottom));
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12px;
  color: #aaa;
  pointer-events: none;
}
.viewer-expired {
  position: absolute;
  top: 45%;
  left: 20px;
  right: 20px;
  text-align: center;
  color: #ddd;
}
</style>
