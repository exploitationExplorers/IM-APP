<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import type { TabPaneName, TabsPaneContext } from "element-plus";
import { useRoute, useRouter } from "vue-router";

interface TabItem {
  path: string;
  title: string;
  icon: string;
  close: boolean;
}

const route = useRoute();
const router = useRouter();
const tabs = shallowRef<TabItem[]>([{ path: "/home", title: "首页", icon: "House", close: false }]);
const activeTab = computed(() => route.fullPath);

watch(
  () => route.fullPath,
  (path) => {
    if (tabs.value.some((tab) => tab.path === path)) return;
    tabs.value = [
      ...tabs.value,
      {
        path,
        title: String(route.meta.title ?? "页面"),
        icon: String(route.meta.icon ?? "Document"),
        close: path !== "/home",
      },
    ];
  },
  { immediate: true },
);

function openTab(tab: TabsPaneContext): void {
  void router.push(String(tab.props.name));
}

function closeTab(path: TabPaneName): void {
  const targetPath = String(path);
  const currentIndex = tabs.value.findIndex((tab) => tab.path === targetPath);
  if (currentIndex < 0) return;

  const nextTabs = tabs.value.filter((tab) => tab.path !== targetPath);
  tabs.value = nextTabs;
  if (route.fullPath === targetPath)
    void router.push(nextTabs[Math.max(0, currentIndex - 1)]?.path ?? "/home");
}

function closeOtherTabs(): void {
  tabs.value = tabs.value.filter((tab) => !tab.close || tab.path === route.fullPath);
}

function closeAllTabs(): void {
  tabs.value = tabs.value.filter((tab) => !tab.close);
  void router.push("/home");
}
</script>

<template>
  <div class="tabs-box">
    <div class="tabs-menu">
      <el-tabs :model-value="activeTab" type="card" @tab-click="openTab" @tab-remove="closeTab">
        <el-tab-pane
          v-for="tab in tabs"
          :key="tab.path"
          :label="tab.title"
          :name="tab.path"
          :closable="tab.close"
        >
          <template #label>
            <el-icon class="tabs-icon"><component :is="tab.icon" /></el-icon>
            {{ tab.title }}
          </template>
        </el-tab-pane>
      </el-tabs>
      <el-dropdown trigger="click">
        <button class="more-button" type="button" aria-label="页签操作">
          <el-icon><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item :disabled="route.path === '/home'" @click="closeTab(route.path)"
              >关闭当前页</el-dropdown-item
            >
            <el-dropdown-item @click="closeOtherTabs">关闭其他页</el-dropdown-item>
            <el-dropdown-item @click="closeAllTabs">关闭全部页</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tabs-box {
  background-color: var(--el-bg-color);
}

.tabs-menu {
  position: relative;
  width: 100%;
}

.tabs-menu > .el-dropdown {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
}

.more-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 43px;
  height: 40px;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-left: 1px solid var(--el-border-color-light);
  transition: background-color 0.2s ease;
}

.more-button:hover {
  background-color: var(--el-color-info-light-9);
}

.tabs-box :deep(.el-tabs__header) {
  box-sizing: border-box;
  height: 40px;
  padding: 0 10px;
  margin: 0;
}

.tabs-box :deep(.el-tabs__nav-wrap) {
  position: absolute;
  width: calc(100% - 70px);
}

.tabs-box :deep(.el-tabs__nav) {
  display: flex;
  border: 0;
}

.tabs-box :deep(.el-tabs__item) {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #afafaf;
  border: 0;
}

.tabs-box :deep(.el-tabs__item.is-active) {
  color: var(--el-color-primary);
}

.tabs-box :deep(.el-tabs__item.is-active::before) {
  position: absolute;
  bottom: 0;
  width: 100%;
  content: "";
  border-bottom: 2px solid var(--el-color-primary);
}

.tabs-icon {
  margin: 1.5px 4px 0 0;
  font-size: 15px;
}
</style>
