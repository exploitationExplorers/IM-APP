<script setup lang="ts">
import { ExternalLink, RefreshCw, Smartphone } from "@lucide/vue";
import { computed, ref } from "vue";
import {
  H5_PREVIEW_DEFAULT_URL,
  H5_PREVIEW_DEVICE_PRESETS,
  type H5PreviewDevicePreset,
} from "../h5-preview-config";
import PageHeader from "../components/PageHeader.vue";

defineOptions({ name: "H5PreviewView" });

const previewUrl = H5_PREVIEW_DEFAULT_URL;
const selectedDeviceId = ref(H5_PREVIEW_DEVICE_PRESETS[1]?.id ?? H5_PREVIEW_DEVICE_PRESETS[0]!.id);
const frameKey = ref(0);

const selectedDevice = computed<H5PreviewDevicePreset>(() =>
  H5_PREVIEW_DEVICE_PRESETS.find((item) => item.id === selectedDeviceId.value) ?? H5_PREVIEW_DEVICE_PRESETS[0]!,
);

function refreshPreview() {
  frameKey.value += 1;
}
</script>

<template>
  <div class="h5-preview-view">
    <PageHeader :title="$t('H5 预览')">
      <template #actions>
        <span class="h5-preview-view__target"><Smartphone :size="15" />{{ previewUrl }}</span>
        <el-select v-model="selectedDeviceId" class="h5-preview-view__device-select" :aria-label="$t('预览设备')">
          <el-option
            v-for="device in H5_PREVIEW_DEVICE_PRESETS"
            :key="device.id"
            :label="`${device.label} (${device.width}×${device.height})`"
            :value="device.id"
          />
        </el-select>
        <button class="h5-preview-view__action" type="button" :aria-label="$t('刷新')" :title="$t('刷新')" @click="refreshPreview">
          <RefreshCw :size="15" />
        </button>
        <a class="h5-preview-view__action" :href="previewUrl" target="_blank" rel="noopener noreferrer" :aria-label="$t('在浏览器新标签页打开')" :title="$t('在浏览器新标签页打开')">
          <ExternalLink :size="15" />
        </a>
      </template>
    </PageHeader>

    <div class="h5-preview-stage">
      <div
        class="h5-preview-device"
        :style="{ width: `${selectedDevice.width}px`, height: `${selectedDevice.height}px` }"
        :aria-label="$t('{0} 预览框', [selectedDevice.label])"
      >
        <div class="h5-preview-device__chrome" aria-hidden="true">
          <span></span>
          <strong>{{ selectedDevice.label }}</strong>
          <span></span>
        </div>
        <iframe
          :key="frameKey"
          class="h5-preview-device__frame"
          :src="previewUrl"
          :title="$t('H5 预览页面')"
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<style scoped>
.h5-preview-view {
  height: var(--workbench-viewport-height, calc(100dvh - 32px));
  min-height: 520px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.h5-preview-view :deep(.page-header) { margin-block-end: 12px; }

.h5-preview-view__target {
  min-height: 30px;
  max-width: min(360px, 42vw);
  padding: 0 10px;
  border: 1px solid var(--ink-100);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink-500);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 700;
}

.h5-preview-view__device-select { width: 220px; }

.h5-preview-view__action {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--ink-100);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink-600);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.h5-preview-view__action:hover {
  border-color: var(--teal-200);
  color: var(--teal-700);
  background: color-mix(in srgb, var(--teal-50) 72%, var(--surface));
}

.h5-preview-stage {
  min-height: 0;
  padding: 12px;
  border: 1px solid var(--ink-100);
  border-radius: var(--radius-md);
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--teal-50) 56%, transparent), transparent 58%),
    linear-gradient(180deg, color-mix(in srgb, var(--ink-50) 48%, var(--surface)), var(--surface));
  overflow: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.h5-preview-device {
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--ink-800) 18%, var(--ink-100));
  border-radius: 28px;
  background: #101010;
  box-shadow: 0 24px 60px color-mix(in srgb, var(--ink-800) 18%, transparent);
  overflow: hidden;
  display: grid;
  grid-template-rows: 34px minmax(0, 1fr);
}

.h5-preview-device__chrome {
  padding: 0 16px;
  background: #151515;
  color: #d9dedc;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 8px;
}

.h5-preview-device__chrome span {
  width: 44px;
  height: 6px;
  border-radius: 999px;
  background: #2a2a2a;
}

.h5-preview-device__chrome strong {
  min-width: 0;
  color: #eef3f1;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
}

.h5-preview-device__frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: white;
  display: block;
}

@media (max-width: 820px) {
  .h5-preview-view { min-height: 480px; }
  .h5-preview-view__target { display: none; }
  .h5-preview-view__device-select { width: min(220px, 100%); }
}
</style>
