<script setup lang="ts">
import { ExternalLink, RefreshCw } from "@lucide/vue";
import { computed, ref } from "vue";
import PageHeader from "../components/PageHeader.vue";
import { ADMIN_PREVIEW_DEFAULT_URL } from "../admin-preview-config";

defineOptions({ name: "AdminPreviewView" });

const previewUrl = ADMIN_PREVIEW_DEFAULT_URL;
const frameKey = ref(0);

function refreshPreview() {
  frameKey.value += 1;
}

const displayUrl = computed(() => previewUrl.replace(/^https?:\/\//, ""));
</script>

<template>
  <div class="admin-preview-view">
    <PageHeader :title="$t('后台管理预览')">
      <template #actions>
        <span class="admin-preview-view__target"><ExternalLink :size="15" />{{ displayUrl }}</span>
        <button class="admin-preview-view__action" type="button" :aria-label="$t('刷新')" :title="$t('刷新')" @click="refreshPreview">
          <RefreshCw :size="15" />
        </button>
        <a
          class="admin-preview-view__action"
          :href="previewUrl"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="$t('在浏览器新标签页打开')"
          :title="$t('在浏览器新标签页打开')"
        >
          <ExternalLink :size="15" />
        </a>
      </template>
    </PageHeader>

    <div class="admin-preview-stage">
      <iframe
        :key="frameKey"
        class="admin-preview-frame"
        :src="previewUrl"
        :title="$t('后台管理预览页面')"
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    </div>
  </div>
</template>

<style scoped>
.admin-preview-view {
  height: var(--workbench-viewport-height, calc(100dvh - 32px));
  min-height: 520px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.admin-preview-view :deep(.page-header) {
  margin-block-end: 12px;
}

.admin-preview-view__target {
  min-height: 30px;
  max-width: min(420px, 60vw);
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

.admin-preview-view__action {
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
  text-decoration: none;
}

.admin-preview-view__action:hover {
  border-color: var(--teal-200);
  color: var(--teal-700);
  background: color-mix(in srgb, var(--teal-50) 72%, var(--surface));
}

.admin-preview-stage {
  min-height: 0;
  padding: 12px;
  border: 1px solid var(--ink-100);
  border-radius: var(--radius-md);
  background: #0b1015;
  overflow: hidden;
  display: grid;
}

.admin-preview-frame {
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
  background: white;
  display: block;
}
</style>

