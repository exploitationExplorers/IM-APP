<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { useRoute } from "vue-router";
import { getAdminHealth, getAdminMeta } from "@/api/modules/admin";
import type { Auth } from "@/api/interface";
import SystemHeader from "./components/SystemHeader.vue";
import SystemTabs from "./components/SystemTabs.vue";

const route = useRoute();
const isCollapse = shallowRef(false);
const activeMenu = computed(() => {
  const menu = route.meta.activeMenu;
  if (typeof menu === "string" && menu.trim()) return menu;
  return route.path;
});
const meta = shallowRef<Auth.ResMeta | null>(null);
const health = shallowRef<Auth.ResHealth | null>(null);

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
  return value.replace("T", " ").replace(/\.\d+/, "").replace(/\+08:00$/, "");
}

function toggleCollapse(): void {
  isCollapse.value = !isCollapse.value;
}

onMounted(async () => {
  const [metaRes, healthRes] = await Promise.allSettled([getAdminMeta(), getAdminHealth()]);
  meta.value = metaRes.status === "fulfilled" ? (metaRes.value.data ?? null) : null;
  health.value = healthRes.status === "fulfilled" ? (healthRes.value.data ?? null) : null;
});
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
                '/forward-risk',
                '/sms-operation-config',
                '/country-sms',
                '/runtime-observe',
                '/app-config',
                '/audit-log',
              ]"
              router
            >
              <el-menu-item index="/home">
                <el-icon><House /></el-icon>
                <template #title>工作台</template>
              </el-menu-item>
              <el-menu-item index="/app/users">
                <el-icon><UserFilled /></el-icon>
                <template #title>用户管理</template>
              </el-menu-item>
              <el-menu-item index="/app/groups">
                <el-icon><ChatSquare /></el-icon>
                <template #title>群组管理</template>
              </el-menu-item>
              <el-menu-item index="/app/reports">
                <el-icon><Warning /></el-icon>
                <template #title>举报处置</template>
              </el-menu-item>
              <el-menu-item index="/sensitive-words">
                <el-icon><Filter /></el-icon>
                <template #title>敏感词审核</template>
              </el-menu-item>
              <el-menu-item index="/auth-mine">
                <el-icon><User /></el-icon>
                <template #title>认证与我的</template>
              </el-menu-item>
              <el-sub-menu index="/forward-risk">
                <template #title>
                  <el-icon><Promotion /></el-icon>
                  <span>转发和群发管理</span>
                </template>
                <el-menu-item index="/forward-risk">
                  <el-icon><Warning /></el-icon>
                  <template #title>转发风控</template>
                </el-menu-item>
              </el-sub-menu>
              <el-sub-menu index="/app-config">
                <template #title>
                  <el-icon><Iphone /></el-icon>
                  <span>APP配置</span>
                </template>
                <el-menu-item index="/app-config/app-versions">
                  <el-icon><Document /></el-icon>
                  <template #title>APP 版本</template>
                </el-menu-item>
                <el-menu-item index="/app-config/legal-documents">
                  <el-icon><Tickets /></el-icon>
                  <template #title>协议文档</template>
                </el-menu-item>
                <el-menu-item index="/app-config/report-reasons">
                  <el-icon><Warning /></el-icon>
                  <template #title>举报原因</template>
                </el-menu-item>
                <el-menu-item index="/app-config/system-limits">
                  <el-icon><Setting /></el-icon>
                  <template #title>系统限制</template>
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
              <el-sub-menu index="/country-sms">
                <template #title>
                  <el-icon><Message /></el-icon>
                  <span>国家短信</span>
                </template>
                <el-menu-item index="/country-sms/countries">
                  <el-icon><Location /></el-icon>
                  <template #title>国家/地区</template>
                </el-menu-item>
                <el-menu-item index="/country-sms/sms-logs">
                  <el-icon><Document /></el-icon>
                  <template #title>短信发送日志</template>
                </el-menu-item>
                <el-menu-item index="/country-sms/sms-statistics">
                  <el-icon><TrendCharts /></el-icon>
                  <template #title>送达统计</template>
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
                <el-menu-item index="/runtime-observe/errors">
                  <el-icon><Warning /></el-icon>
                  <template #title>运行错误</template>
                </el-menu-item>
              </el-sub-menu>
              <el-sub-menu index="/other">
                <template #title>
                  <el-icon><MoreFilled /></el-icon>
                  <span>其他</span>
                </template>
                <el-menu-item index="/other/features">
                  <el-icon><SwitchButton /></el-icon>
                  <template #title>功能开关</template>
                </el-menu-item>
              </el-sub-menu>
              <el-sub-menu index="/system">
                <template #title>
                  <el-icon><Setting /></el-icon>
                  <span>系统管理</span>
                </template>
                <el-menu-item index="/system/users">
                  <el-icon><User /></el-icon>
                  <template #title>管理员</template>
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
        <el-footer>
          <div class="footer">
            <el-popover placement="top" :width="320" trigger="hover">
              <template #reference>
                <button class="meta-summary" type="button">{{ metaSummary }}</button>
              </template>
              <div class="meta-panel">
                <div class="meta-row">
                  <span>服务状态</span>
                  <strong>{{ health?.status || "-" }}</strong>
                </div>
                <div class="meta-row">
                  <span>版本</span>
                  <strong>{{ meta?.version || "-" }}</strong>
                </div>
                <div class="meta-row">
                  <span>Commit</span>
                  <strong>{{ meta?.commit || "-" }}</strong>
                </div>
                <div class="meta-row">
                  <span>构建时间</span>
                  <strong>{{ formatBuildTime(meta?.buildTime) }}</strong>
                </div>
                <div class="meta-features">
                  <div class="meta-features-title">功能开关</div>
                  <template v-if="featureEntries.length">
                    <div v-for="item in featureEntries" :key="item.key" class="meta-row">
                      <span>{{ item.key }}</span>
                      <strong>{{ item.value }}</strong>
                    </div>
                  </template>
                  <div v-else class="meta-empty">暂无功能开关</div>
                </div>
              </div>
            </el-popover>
          </div>
        </el-footer>
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

.meta-summary {
  max-width: 90vw;
  overflow: hidden;
  color: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 0;
  font: inherit;
}

.meta-summary:hover {
  color: var(--el-color-primary);
}

.meta-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  font-size: 13px;

  span {
    color: var(--el-text-color-secondary);
  }

  strong {
    max-width: 200px;
    overflow-wrap: anywhere;
    color: var(--el-text-color-primary);
    font-weight: 600;
    text-align: right;
  }
}

.meta-features {
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.meta-features-title {
  margin-bottom: 8px;
  color: var(--el-text-color-primary);
  font-size: 13px;
  font-weight: 600;
}

.meta-empty {
  color: var(--el-text-color-secondary);
  font-size: 12px;
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
