<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowRight } from "@element-plus/icons-vue";
import { useRoute, useRouter } from "vue-router";
import logo from "../../assets/images/logo.svg";
import { getAdminHealth } from "@/api/modules/admin";
import { logoutApi } from "@/api/modules/auth";
import { useAuthStore } from "../../stores/auth";

const props = defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ toggle: [] }>();

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

type HealthState = "checking" | "ok" | "error";

const healthState = shallowRef<HealthState>("checking");
const healthStatus = shallowRef("");

const healthLabel = computed(() => {
  if (healthState.value === "checking") return "检查中";
  if (healthState.value === "ok") return "服务正常";
  return "服务异常";
});

const healthTagType = computed(() => {
  if (healthState.value === "ok") return "success";
  if (healthState.value === "error") return "danger";
  return "info";
});

const breadcrumbItems = computed(() => {
  const currentTitle = String(route.meta.title ?? "首页");
  const items = [{ path: "/home", title: "首页", icon: "House" }];
  if (route.path.startsWith("/system/")) {
    items.push({ path: "/system", title: "系统管理", icon: "" });
  }
  if (route.path !== "/home") {
    items.push({ path: route.path, title: currentTitle, icon: "" });
  }
  return items;
});

async function checkHealth(showToast = false): Promise<void> {
  healthState.value = "checking";
  try {
    const res = await getAdminHealth();
    const status = String(res.data?.status || "").trim().toLowerCase();
    healthStatus.value = status || "ok";
    healthState.value = status === "" || status === "ok" ? "ok" : "error";
    if (showToast) {
      ElMessage.success(
        healthState.value === "ok" ? "服务存活检查通过" : `服务状态：${healthStatus.value}`,
      );
    }
  } catch {
    healthStatus.value = "";
    healthState.value = "error";
  }
}

function navigateBreadcrumb(path: string): void {
  if (path !== route.path) void router.push(path);
}

function showNotice(): void {
  ElMessage.info("暂无新通知");
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    ElMessage.warning("当前浏览器不支持全屏");
  }
}

async function handleLogout(): Promise<void> {
  try {
    await ElMessageBox.confirm("退出后需要重新登录才能进入管理系统。", "退出登录", {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    const refreshToken = auth.refreshToken;
    if (refreshToken) {
      try {
        await logoutApi({ refreshToken });
      } catch {
      }
    }
    auth.logout();
    ElMessage.success("退出登录成功");
    await router.push("/login");
  } catch {
    // Dismissing the confirmation leaves the current session unchanged.
  }
}

onMounted(() => {
  void checkHealth(false);
});
</script>

<template>
  <el-header class="system-header">
    <div class="header-lf mask-image">
      <div class="logo flx-center">
        <img class="logo-img" :src="logo" alt="IM-APP" />
        <span class="logo-text">IM-APP</span>
      </div>
      <div class="tool-bar-lf">
        <el-tooltip :content="props.collapsed ? '展开菜单' : '收起菜单'" placement="bottom">
          <el-button
            class="header-action collapse-icon"
            text
            aria-label="切换菜单"
            @click="emit('toggle')"
          >
            <el-icon><component :is="props.collapsed ? 'Expand' : 'Fold'" /></el-icon>
          </el-button>
        </el-tooltip>
        <div class="breadcrumb-box mask-image">
          <el-breadcrumb :separator-icon="ArrowRight">
            <el-breadcrumb-item v-for="(item, index) in breadcrumbItems" :key="item.path">
              <button
                class="breadcrumb-item"
                :class="{ 'is-current': index === breadcrumbItems.length - 1 }"
                type="button"
                @click="navigateBreadcrumb(item.path)"
              >
                <el-icon v-if="item.icon" class="breadcrumb-icon"
                  ><component :is="item.icon"
                /></el-icon>
                <span>{{ item.title }}</span>
              </button>
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
      </div>
    </div>

    <div class="tool-bar-ri">
      <div class="header-icon">
        <el-tooltip content="点击重新检查服务存活" placement="bottom">
          <button class="health-chip" type="button" @click="checkHealth(true)">
            <el-tag :type="healthTagType" effect="plain" round size="small">
              {{ healthLabel }}
            </el-tag>
          </button>
        </el-tooltip>
        <el-tooltip content="消息" placement="bottom">
          <el-button class="header-action" text aria-label="查看消息" @click="showNotice">
            <el-icon><Bell /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="全屏" placement="bottom">
          <el-button class="header-action" text aria-label="切换全屏" @click="toggleFullscreen">
            <el-icon><FullScreen /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
      <span class="username">{{ auth.profile.name }}</span>
      <el-dropdown trigger="click">
        <button class="avatar" type="button" :aria-label="`${auth.profile.name} 的账户菜单`">
          {{ auth.profile.name.slice(0, 1) }}
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item disabled>{{ auth.profile.role }}</el-dropdown-item>
            <el-dropdown-item divided @click="handleLogout">
              <el-icon><SwitchButton /></el-icon>退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </el-header>
</template>

<style scoped lang="scss">
.system-header {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 55px;
  padding: 0 15px 0 0;
  background-color: var(--el-header-bg-color);
  border-bottom: 1px solid var(--el-header-border-color);
}

.header-lf,
.tool-bar-lf,
.tool-bar-ri,
.header-icon,
.breadcrumb-box,
.breadcrumb-item {
  display: flex;
  align-items: center;
}

.header-lf {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.logo {
  flex-shrink: 0;
  width: 210px;
  margin-right: 16px;
}

.logo-img {
  width: 28px;
  object-fit: contain;
}

.logo-text {
  margin-left: 6px;
  color: var(--el-header-logo-text-color);
  font-size: 21.5px;
  font-weight: 700;
  white-space: nowrap;
}

.tool-bar-lf {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.header-action {
  width: 22px;
  height: 40px;
  padding: 0;
  color: var(--el-header-text-color);
  font-size: 17px;
}

.header-action:hover,
.breadcrumb-item:hover {
  color: var(--el-color-primary);
}

.collapse-icon {
  width: 22px;
  margin-right: 20px;
  font-size: 22px;
}

.breadcrumb-box {
  min-width: 0;
  overflow: hidden;
}

.breadcrumb-item {
  padding: 0;
  color: var(--el-header-text-color);
  cursor: pointer;
  background: transparent;
  border: 0;
  font: inherit;
}

.breadcrumb-item.is-current {
  color: var(--el-header-text-color-regular);
  cursor: default;
}

.breadcrumb-icon {
  margin-right: 6px;
  font-size: 16px;
}

.tool-bar-ri {
  flex-shrink: 0;
  justify-content: center;
  padding-right: 25px;
}

.header-icon {
  gap: 16px;
}

.health-chip {
  display: inline-flex;
  align-items: center;
  padding: 0;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.username {
  margin: 0 20px;
  color: var(--el-header-text-color);
  font-size: 15px;
}

.avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  overflow: hidden;
  color: #fff;
  cursor: pointer;
  background: var(--el-color-primary);
  border: 0;
  border-radius: 50%;
  font: inherit;
  font-weight: 600;
}

@media (max-width: 900px) {
  .header-icon > :nth-child(-n + 4),
  .username {
    display: none;
  }
}

@media (max-width: 620px) {
  .logo {
    width: 56px;
    margin-right: 8px;
  }

  .logo-text,
  .breadcrumb-box,
  .header-icon {
    display: none;
  }

  .tool-bar-ri {
    padding-right: 0;
  }
}
</style>
