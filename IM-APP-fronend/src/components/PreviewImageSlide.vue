<script setup lang="ts">
import { shallowRef, watch, onBeforeUnmount } from 'vue'
import { loadPreviewImage, forgetPreviewImage, previewImageDebug } from '@/utils/previewImageCache'

const props = defineProps<{ url: string; owner: string; active: boolean; thumbnail?: string }>()
const emit = defineEmits<{ zoom: [value: boolean]; ready: [path: string]; save: [] }>()
const path = shallowRef('')
const error = shallowRef('')
const loaded = shallowRef(false)
const scale = shallowRef(1)
const actualScale = shallowRef(1)
let version = 0
let started = 0
let deadline: ReturnType<typeof setTimeout> | undefined

function cancelDeadline() {
  if (deadline) clearTimeout(deadline)
  deadline = undefined
}

async function load(retry = false) {
  const run = ++version
  started = Date.now()
  cancelDeadline()
  path.value = ''
  loaded.value = false
  error.value = ''
  emit('ready', '')
  try {
    if (retry) await forgetPreviewImage(props.url, props.owner)
    const row = await loadPreviewImage(props.url, props.owner)
    if (run !== version) return
    path.value = row.path
    // Network completion isn't decode completion. Broken images must not spin forever.
    deadline = setTimeout(() => failed('图片显示超时，请重试'), 15000)
  } catch (cause) {
    if (run === version) {
      error.value = cause instanceof Error ? cause.message : '图片加载失败，请重试'
      previewImageDebug('load_failed', { ms: Date.now() - started })
    }
  }
}

function ready() {
  if (!path.value || error.value) return
  cancelDeadline()
  loaded.value = true
  error.value = ''
  emit('ready', path.value)
  previewImageDebug('display_ready', { ms: Date.now() - started })
}

function failed(message = '图片内容无效或格式不受支持') {
  cancelDeadline()
  error.value = message
  loaded.value = false
  emit('ready', '')
  previewImageDebug('decode_failed', { ms: Date.now() - started })
  void forgetPreviewImage(props.url, props.owner).catch(() => undefined)
}

function onScale(event: { detail: { scale: number } }) {
  actualScale.value = event.detail.scale
  emit('zoom', actualScale.value > 1.05)
}
function zoomBy(delta: number) {
  scale.value = Math.min(4, Math.max(1, actualScale.value + delta))
  emit('zoom', scale.value > 1.05)
}
watch(
  () => [props.url, props.owner],
  () => {
    void load()
  },
  { immediate: true },
)
watch(
  () => props.active,
  (active) => {
    if (!active) {
      scale.value = 1
      actualScale.value = 1
      emit('zoom', false)
    }
  },
)
onBeforeUnmount(() => {
  version += 1
  cancelDeadline()
})
</script>

<template>
  <view class="preview-slide">
    <image
      v-if="thumbnail && thumbnail !== url && !loaded"
      class="preview-thumb"
      :src="thumbnail"
      mode="aspectFit"
    />
    <movable-area v-if="path && !error" class="preview-area">
      <movable-view
        class="preview-pan"
        :direction="actualScale > 1.05 ? 'all' : 'none'"
        scale
        :scale-min="1"
        :scale-max="4"
        :scale-value="scale"
        @scale="onScale"
      >
        <image
          :key="path"
          class="preview-image"
          :src="path"
          mode="aspectFit"
          @load="ready"
          @error="failed()"
          @longpress="loaded && emit('save')"
        />
      </movable-view>
    </movable-area>
    <view v-if="!loaded" class="preview-state">
      <view v-if="!error" class="preview-spinner" />
      <text v-if="error" class="preview-message">{{ error }}</text>
      <button v-if="error" class="preview-retry" size="mini" @click.stop="load(true)">
        重新加载
      </button>
    </view>
    <view v-if="loaded" class="preview-zoom">
      <button class="zoom-control" size="mini" aria-label="缩小图片" @click.stop="zoomBy(-1)">
        −
      </button>
      <button class="zoom-control" size="mini" aria-label="放大图片" @click.stop="zoomBy(1)">
        +
      </button>
    </view>
  </view>
</template>

<style scoped>
.preview-slide,
.preview-area,
.preview-pan,
.preview-image,
.preview-thumb {
  width: 100%;
  height: 100%;
}
.preview-slide {
  position: relative;
  overflow: hidden;
}
.preview-area,
.preview-thumb {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}
.preview-thumb {
  opacity: 0.5;
}
.preview-state {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  pointer-events: none;
}
.preview-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.28);
  border-top-color: #fff;
  border-radius: 50%;
  animation: preview-spin 0.75s linear infinite;
}
@keyframes preview-spin {
  to {
    transform: rotate(360deg);
  }
}
.preview-message {
  color: #ddd;
  font-size: 14px;
  text-align: center;
  background: rgba(0, 0, 0, 0.55);
  padding: 10px 14px;
  border-radius: 8px;
  margin: 0 16px;
}
.preview-retry {
  color: #fff;
  background: #333;
  border: 1px solid #777;
  pointer-events: auto;
}
.preview-zoom {
  position: absolute;
  bottom: 6px;
  right: 12px;
  display: flex;
  gap: 12px;
}
.zoom-control {
  margin: 0;
  color: #fff;
  background: #333;
  font-size: 22px;
}
</style>
