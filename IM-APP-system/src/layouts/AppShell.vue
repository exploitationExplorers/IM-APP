<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { useRoute } from "vue-router";
import SystemHeader from "./components/SystemHeader.vue";
import SystemTabs from "./components/SystemTabs.vue";

const route = useRoute();
const isCollapse = shallowRef(false);
const activeMenu = computed(() => route.path);
const meta = shallowRef<Auth.ResMeta | null>(null);

const metaSummary = computed(() => {
  const data = meta.value;
  if (!data) return "IM-APP 管理系统";
  const parts = ["IM-APP 管理系统"];
  if (data.version) parts.push(`v${data.version}`);
  if (data.commit) parts.push(data.commit.slice(0, 8));
  return parts.join(" · ");
});

const featureEntries = computed(() => {
  const features = meta.value?.features;
  if (!features || typeof features !== "object") return [];
  return Object.entries(features).map(([key, value]) => ({
    key,
    value: typeof value === "boolean" ? (value ? "开启" : "关闭") : String(value ?? "-"),
  }));
});

function formatBuildTime(value?: string): string {
  if (!value) return "-";
  return value
    .replace("T", " ")
    .replace(/\.\d+/, "")
    .replace(/\+08:00$/, "");
}

function toggleCollapse(): void {
  isCollapse.value = !isCollapse.value;
}
</script>

<template>
  <el-container class="layout classic" direction="vertical">
    <SystemHeader :collapsed="isCollapse" @toggle="toggleCollapse" />
    <el-container class="classic-content">
      <el-aside>
        <div class="aside-box" :style="{ width: isCollapse ? '65px' : '210px' }">
          <el-scrollbar>
            <el-menu
              :default-active="activeMenu"
              :collapse="isCollapse"
              :collapse-transition="false"
              :default-openeds="[
                '/system',
                '/forward-group-send',
                '/sms-operation-config',
                '/runtime-observe',
              ]"
              router
            >
              <el-menu-item index="/home">
                <el-icon><House /></el-icon>
                <template #title>首页</template>
              </el-menu-item>
              <el-menu-item index="/app/users">
                <el-icon><UserFilled /></el-icon>
                <template #title>用户管理</template>
              </el-menu-item>
              <el-menu-item index="/app/groups">
                <el-icon><ChatSquare /></el-icon>
                <template #title>群组管理</template>
              </el-menu-item>
              <el-sub-menu index="/forward-group-send">
                <template #title>
                  <el-icon><Promotion /></el-icon>
                  <span>转发和群发管理</span>
                </template>
                <el-menu-item index="/forward-group-send">
                  <el-icon><List /></el-icon>
                  <template #title>任务列表</template>
                </el-menu-item>
              </el-sub-menu>
              <el-sub-menu index="/sms-operation-config">
                <template #title>
                  <el-icon><Message /></el-icon>
                  <span>短信和运营配置</span>
                </template>
                <el-menu-item index="/sms-operation-config">
                  <el-icon><Operation /></el-icon>
                  <template #title>配置管理</template>
                </el-menu-item>
              </el-sub-menu>
              <el-sub-menu index="/runtime-observe">
                <template #title>
                  <el-icon><Monitor /></el-icon>
                  <span>运行观测</span>
                </template>
                <el-menu-item index="/runtime-observe/exports">
                  <el-icon><Document /></el-icon>
                  <template #title>导出任务</template>
                </el-menu-item>
              </el-sub-menu>
              <el-sub-menu index="/system">
                <template #title>
                  <el-icon><Setting /></el-icon>
                  <span>系统管理</span>
                </template>
                <el-menu-item index="/system/users">
                  <el-icon><User /></el-icon>
                  <template #title>平台用户管理</template>
                </el-menu-item>
                <el-menu-item index="/system/roles">
                  <el-icon><Lock /></el-icon>
                  <template #title>角色权限</template>
                </el-menu-item>
                <el-menu-item index="/system/logs">
                  <el-icon><Document /></el-icon>
                  <template #title>操作日志</template>
                </el-menu-item>
              </el-sub-menu>
              <el-sub-menu index="/audit-log">
                <template #title>
                  <el-icon><Memo /></el-icon>
                  <span>审计日志</span>
                </template>
                <el-menu-item index="/audit-log/admin-login-log">
                  <el-icon><Memo /></el-icon>
                  <template #title>管理员登录日志</template>
                </el-menu-item>
                <el-menu-item index="/audit-log/admin-audit-log">
                  <el-icon><Memo /></el-icon>
                  <template #title>管理操作审计日志</template>
                </el-menu-item>
              </el-sub-menu>
            </el-menu>
          </el-scrollbar>
        </div>
      </el-aside>
      <el-container class="classic-main">
        <SystemTabs />
        <el-main>
          <router-view v-slot="{ Component, route: activeRoute }">
            <transition appear name="fade-transform" mode="out-in">
              <component :is="Component" :key="activeRoute.fullPath" />
            </transition>
          </router-view>
        </el-main>
        <el-footer><div class="footer">IM-APP 管理系统</div></el-footer>
      </el-container>
    </el-container>
  </el-container>
</template>

<style scoped lang="scss">
.layout {
  width: 100%;
  height: 100%;
}

.classic-content {
  height: calc(100% - 55px);
}

.classic-content :deep(.el-aside) {
  width: auto;
  background-color: var(--el-menu-bg-color);
  border-right: 1px solid var(--el-aside-border-color);
}

.aside-box {
  display: flex;
  flex-direction: column;
  height: 100%;
  transition: width 0.3s ease;
}

.aside-box .el-menu {
  width: 100%;
  overflow-x: hidden;
  border-right: 0;
}

.classic-content :deep(.el-menu-item) {
  position: relative;
}

.classic-content :deep(.el-menu-item:hover) {
  color: var(--el-menu-hover-text-color);
}

.classic-content :deep(.el-menu-item.is-active) {
  color: var(--el-menu-active-color);
  background-color: var(--el-menu-active-bg-color);
}

.classic-content :deep(.el-menu-item.is-active::before) {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  content: "";
  background-color: var(--el-color-primary);
}

.classic-main {
  display: flex;
  flex-direction: column;
}

.classic-main :deep(.el-main) {
  box-sizing: border-box;
  padding: 10px 12px;
  overflow-x: hidden;
  background-color: var(--el-bg-color-page);
}

.classic-main :deep(.el-footer) {
  height: auto;
  padding: 0;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  color: var(--el-text-color-secondary);
  background-color: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color-light);
  font-size: 14px;
}

@media (max-width: 700px) {
  .classic-content :deep(.el-aside) {
    position: absolute;
    z-index: 10;
    height: calc(100% - 55px);
    box-shadow: 2px 0 8px rgb(0 0 0 / 8%);
  }
}
</style>
