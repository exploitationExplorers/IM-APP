<script setup lang="ts">
import { onMounted, reactive, shallowRef, watch } from "vue";
import { ElMessage } from "element-plus";
import { Delete, Search } from "@element-plus/icons-vue";

import {
  AdminUsers,
  getAdminUserDetailApi,
  getAdminUserForwardTasksApi,
  getAdminUserGroupsApi,
  getAdminUserReportsApi,
  getAdminUsersApi,
  getAdminUserForwardLimitApi,
  postAdminUserPhoneRevealApi,
  postAdminUserRevokeSessionsApi,
  putAdminUserBanApi,
  putAdminUserForwardLimitApi,
  putAdminUserLoginRestrictionApi,
  putAdminUserMessageRestrictionApi,
} from "@/api/modules/adminUsers";

type AppUserStatus = "normal" | "restricted" | "banned" | "cancelled";

interface AppUser {
  id: string;
  internalId: string;
  publicId: string;
  phone: string;
  countryCode: string;
  countryName: string;
  nickname: string;
  avatar: string;
  friendCount: number;
  groupCount: number;
  status: AppUserStatus;
  bannedLogin: boolean;
  bannedSendMessage: boolean;
  reportCount: number;
  createdAt: string;
  lastActiveAt: string;
}

interface UserFilters {
  keyword: string;
  searchType: "internalId" | "publicId" | "phone";
  status: "" | AppUserStatus;
}

const statusLabels: Record<AppUserStatus, string> = {
  normal: "正常",
  restricted: "限制",
  banned: "封禁",
  cancelled: "注销",
};

const statusTagTypes: Record<AppUserStatus, string> = {
  normal: "success",
  restricted: "warning",
  banned: "danger",
  cancelled: "info",
};

const filters = reactive<UserFilters>({
  keyword: "",
  searchType: "internalId",
  status: "",
});
const currentPage = shallowRef(1);
const pageSize = shallowRef(10);
const total = shallowRef(0);
const tableLoading = shallowRef(false);
const detailVisible = shallowRef(false);
const selectedUser = shallowRef<AppUser | null>(null);
const activeDetailTab = shallowRef<"base" | "reports" | "forward" | "groups">("base");
const detailLoading = shallowRef(false);
const forwardLoading = shallowRef(false);
const groupLoading = shallowRef(false);
const reportLoading = shallowRef(false);
const reports = shallowRef<AdminUsers.ReportItem[]>([]);
const reportTotal = shallowRef(0);
const reportPage = shallowRef(1);
const reportPageSize = shallowRef(20);
const forwardTasks = shallowRef<AdminUsers.ForwardTaskItem[]>([]);
const forwardTotal = shallowRef(0);
const forwardPage = shallowRef(1);
const forwardPageSize = shallowRef(20);
const groups = shallowRef<AdminUsers.GroupItem[]>([]);
const groupTotal = shallowRef(0);
const groupPage = shallowRef(1);
const groupPageSize = shallowRef(20);

const users = shallowRef<AppUser[]>([]);

type ActionMode = "loginRestriction" | "banUser" | "revokeSessions" | "forwardLimit" | "phoneReveal";

interface ActionFormModel {
  reason: string;
  ticketNo: string;
  until: Date | null;
  enabled: boolean;
  dailyLimit: number;
  hourlyLimit: number;
  singleTargets: number;
}

const actionVisible = shallowRef(false);
const actionLoading = shallowRef(false);
const actionMode = shallowRef<ActionMode>("loginRestriction");
const actionNext = shallowRef(false);
const actionUser = shallowRef<AppUser | null>(null);

const actionForm = reactive<ActionFormModel>({
  reason: "",
  ticketNo: "",
  until: null,
  enabled: false,
  dailyLimit: 0,
  hourlyLimit: 0,
  singleTargets: 0,
});

const forwardLimitLoading = shallowRef(false);
const forwardLimit = shallowRef<AdminUsers.ForwardLimitConfig | null>(null);
const revealedPhones = reactive<Record<string, string>>({});

function normalizeStatus(value?: string): AppUserStatus {
  const raw = (value || "").toLowerCase();
  if (raw === "active") return "normal";
  if (raw === "inactive") return "restricted";
  if (raw === "normal" || raw === "restricted" || raw === "banned" || raw === "cancelled") {
    return raw as AppUserStatus;
  }
  return "normal";
}

function pickAvatarText(nickname: string): string {
  const name = nickname?.trim();
  return name ? name.slice(0, 1) : "U";
}

function pickField(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value === 0) return "0";
    if (value === false) return "否";
    if (value) return String(value);
  }
  return "—";
}

function pickNumberField(row: Record<string, any> | null | undefined, keys: string[], fallback = 0): number {
  if (!row) return fallback;
  for (const key of keys) {
    const value = (row as any)[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  }
  return fallback;
}

function pickBoolField(row: Record<string, any> | null | undefined, keys: string[], fallback = false): boolean {
  if (!row) return fallback;
  for (const key of keys) {
    const value = (row as any)[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      if (lowered === "true") return true;
      if (lowered === "false") return false;
    }
  }
  return fallback;
}

function pickStringField(row: any, keys: string[]): string {
  if (!row) return "";
  if (typeof row === "string") return row;
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "";
}

function toIsoString(value: Date | null): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function getDisplayPhone(user: AppUser | null): string {
  if (!user) return "";
  const full = revealedPhones[user.id];
  return `${user.countryCode} ${full || user.phone}`.trim();
}

function syncUserPatch(userId: string, patch: Partial<AppUser>): void {
  users.value = users.value.map((u) => (u.id === userId ? { ...u, ...patch } : u));
  if (selectedUser.value?.id === userId) {
    selectedUser.value = { ...selectedUser.value, ...patch };
  }
}

function getActionTitle(): string {
  const userName = actionUser.value?.nickname ? `「${actionUser.value.nickname}」` : "";
  if (actionMode.value === "loginRestriction") return `${actionNext.value ? "禁止登录" : "恢复登录"}${userName}`;
  if (actionMode.value === "banUser") return `${actionNext.value ? "禁止发送消息" : "恢复发送消息"}${userName}`;
  if (actionMode.value === "revokeSessions") return `强制下线${userName}`;
  if (actionMode.value === "forwardLimit") return `转发权限设置${userName}`;
  if (actionMode.value === "phoneReveal") return `查看完整手机号${userName}`;
  return "操作";
}

function resetActionForm(): void {
  actionForm.reason = "";
  actionForm.ticketNo = "";
  actionForm.until = null;
  actionForm.enabled = false;
  actionForm.dailyLimit = 0;
  actionForm.hourlyLimit = 0;
  actionForm.singleTargets = 0;
}

async function fetchForwardLimit(userId: string): Promise<AdminUsers.ForwardLimitConfig> {
  forwardLimitLoading.value = true;
  try {
    const res = await getAdminUserForwardLimitApi(userId);
    const raw = res.data as any;
    const parsed: AdminUsers.ForwardLimitConfig = {
      enabled: pickBoolField(raw, ["enabled", "isEnabled"], false),
      dailyLimit: pickNumberField(raw, ["dailyLimit", "dayLimit", "daily"], 0),
      hourlyLimit: pickNumberField(raw, ["hourlyLimit", "hourLimit", "hourly"], 0),
      singleTargets: pickNumberField(raw, ["singleTargets", "singleTarget", "singleTargetLimit"], 0),
    };
    forwardLimit.value = parsed;
    return parsed;
  } catch {
    const fallback = { enabled: false, dailyLimit: 0, hourlyLimit: 0, singleTargets: 0 };
    forwardLimit.value = fallback;
    return fallback;
  } finally {
    forwardLimitLoading.value = false;
  }
}

async function openAction(mode: ActionMode, user: AppUser, next?: boolean): Promise<void> {
  actionMode.value = mode;
  actionUser.value = user;
  actionNext.value = Boolean(next);
  resetActionForm();

  if (mode === "forwardLimit") {
    const config = await fetchForwardLimit(user.id);
    actionForm.enabled = config.enabled;
    actionForm.dailyLimit = config.dailyLimit;
    actionForm.hourlyLimit = config.hourlyLimit;
    actionForm.singleTargets = config.singleTargets;
  }

  actionVisible.value = true;
}

async function submitAction(): Promise<void> {
  if (!actionUser.value) return;
  const userId = actionUser.value.id;

  const reason = actionForm.reason.trim();
  if (!reason) {
    ElMessage.warning("请填写操作原因");
    return;
  }

  if (actionMode.value === "banUser" || actionMode.value === "phoneReveal") {
    const ticketNo = actionForm.ticketNo.trim();
    if (!ticketNo) {
      ElMessage.warning("请填写关联工单号");
      return;
    }
  }

  actionLoading.value = true;
  try {
    if (actionMode.value === "loginRestriction") {
      await putAdminUserLoginRestrictionApi(userId, {
        banned: actionNext.value,
        reason,
        until: toIsoString(actionForm.until),
      });
      syncUserPatch(userId, { bannedLogin: actionNext.value });
      ElMessage.success(actionNext.value ? "已禁止登录" : "已恢复登录");
    }

    if (actionMode.value === "banUser") {
      const idempotencyKey =
        typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
          ? (crypto as any).randomUUID()
          : undefined;
      try {
        await putAdminUserMessageRestrictionApi(userId, {
          banned: actionNext.value,
          reason,
          until: toIsoString(actionForm.until),
        });
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 404 || status === 405) {
          await putAdminUserBanApi(userId, {
            banned: actionNext.value,
            idempotencyKey,
            reason,
            ticketNo: actionForm.ticketNo.trim(),
            until: toIsoString(actionForm.until),
          });
        } else {
          throw error;
        }
      }
      syncUserPatch(userId, { bannedSendMessage: actionNext.value });
      ElMessage.success(actionNext.value ? "已禁止发送消息" : "已恢复发送消息");
    }

    if (actionMode.value === "revokeSessions") {
      await postAdminUserRevokeSessionsApi(userId, { reason });
      ElMessage.success("已强制下线");
    }

    if (actionMode.value === "forwardLimit") {
      await putAdminUserForwardLimitApi(userId, {
        enabled: actionForm.enabled,
        dailyLimit: actionForm.dailyLimit,
        hourlyLimit: actionForm.hourlyLimit,
        singleTargets: actionForm.singleTargets,
        reason,
      });
      ElMessage.success("转发权限已更新");
      await fetchForwardLimit(userId);
    }

    if (actionMode.value === "phoneReveal") {
      const res = await postAdminUserPhoneRevealApi(userId, {
        reason,
        ticketNo: actionForm.ticketNo.trim(),
      });
      const raw = res.data as any;
      const phone = pickStringField(raw, ["phone", "phoneNumber", "mobile"]);
      if (phone) {
        revealedPhones[userId] = phone;
        ElMessage.success("已获取完整手机号");
      } else {
        ElMessage.success("操作成功");
      }
    }

    actionVisible.value = false;
    if (detailVisible.value && selectedUser.value?.id === userId) {
      fetchUserDetail(userId);
    }
    fetchUsers();
  } catch {
    // ignored
  } finally {
    actionLoading.value = false;
  }
}

async function fetchUsers(): Promise<void> {
  tableLoading.value = true;
  try {
    const res = await getAdminUsersApi({
      page: currentPage.value,
      pageSize: pageSize.value,
      keyword: filters.keyword.trim() || undefined,
      searchType: filters.searchType,
      status: filters.status || undefined,
    });

    const items = res.data?.items ?? [];
    users.value = items.map((item) => ({
      id: item.id,
      internalId: item.id ? item.id.slice(0, 8) : "",
      publicId: item.publicId,
      phone: item.phoneMasked,
      countryCode: item.countryCode,
      countryName: "",
      nickname: item.nickname,
      avatar: item.avatar || pickAvatarText(item.nickname),
      friendCount: item.friendCount ?? 0,
      groupCount: item.groupCount ?? 0,
      status: normalizeStatus(item.status),
      bannedLogin: Boolean(item.loginBanned),
      bannedSendMessage: Boolean(item.messageBanned),
      reportCount: item.reportCount ?? 0,
      createdAt: item.createdAt || "",
      lastActiveAt: item.lastActiveAt || "",
    }));

    total.value = res.data?.total ?? users.value.length;
  } catch {
    users.value = [];
    total.value = 0;
  } finally {
    tableLoading.value = false;
  }
}

async function fetchUserDetail(id: string): Promise<void> {
  detailLoading.value = true;
  try {
    const res = await getAdminUserDetailApi(id);
    const data = res.data;
    selectedUser.value = {
      id: data.id,
      internalId: data.id ? data.id.slice(0, 8) : "",
      publicId: data.publicId,
      phone: data.phoneMasked,
      countryCode: data.countryCode,
      countryName: "",
      nickname: data.nickname,
      avatar: data.avatar || pickAvatarText(data.nickname),
      friendCount: data.friendCount ?? 0,
      groupCount: data.groupCount ?? 0,
      status: normalizeStatus(data.status),
      bannedLogin: Boolean(data.loginBanned),
      bannedSendMessage: Boolean(data.messageBanned),
      reportCount: data.reportCount ?? 0,
      createdAt: data.createdAt || "",
      lastActiveAt: data.lastActiveAt || "",
    };
  } catch {
    // ignored
  } finally {
    detailLoading.value = false;
  }
}

async function fetchForwardTasks(id: string): Promise<void> {
  forwardLoading.value = true;
  try {
    const res = await getAdminUserForwardTasksApi(id, {
      page: forwardPage.value,
      pageSize: forwardPageSize.value,
    });
    forwardTasks.value = res.data?.items ?? [];
    forwardTotal.value = res.data?.total ?? forwardTasks.value.length;
  } catch {
    forwardTasks.value = [];
    forwardTotal.value = 0;
  } finally {
    forwardLoading.value = false;
  }
}

async function fetchGroups(id: string): Promise<void> {
  groupLoading.value = true;
  try {
    const res = await getAdminUserGroupsApi(id, {
      page: groupPage.value,
      pageSize: groupPageSize.value,
    });
    const data = res.data;
    if (Array.isArray(data)) {
      groups.value = data;
      groupTotal.value = data.length;
    } else if (Array.isArray(data?.items)) {
      groups.value = data.items;
      groupTotal.value = data.total ?? data.items.length;
    } else if (Array.isArray(data?.list)) {
      groups.value = data.list;
      groupTotal.value = data.total ?? data.list.length;
    } else {
      groups.value = [];
      groupTotal.value = 0;
    }
  } catch {
    groups.value = [];
    groupTotal.value = 0;
  } finally {
    groupLoading.value = false;
  }
}

async function fetchReports(id: string): Promise<void> {
  reportLoading.value = true;
  try {
    const res = await getAdminUserReportsApi(id, {
      page: reportPage.value,
      pageSize: reportPageSize.value,
    });
    reports.value = res.data?.items ?? [];
    reportTotal.value = res.data?.total ?? reports.value.length;
  } catch {
    reports.value = [];
    reportTotal.value = 0;
  } finally {
    reportLoading.value = false;
  }
}

function queryUsers(): void {
  currentPage.value = 1;
  fetchUsers();
}

function resetFilters(): void {
  filters.keyword = "";
  filters.searchType = "internalId";
  filters.status = "";
  currentPage.value = 1;
  fetchUsers();
}

function openUserDetail(user: AppUser): void {
  selectedUser.value = { ...user };
  detailVisible.value = true;
  activeDetailTab.value = "base";
  reportPage.value = 1;
  forwardPage.value = 1;
  groupPage.value = 1;
  reports.value = [];
  forwardTasks.value = [];
  groups.value = [];
  fetchUserDetail(user.id);
  forwardLimit.value = null;
  fetchForwardLimit(user.id);
}

async function toggleBanLogin(user: AppUser): Promise<void> {
  await openAction("loginRestriction", user, !user.bannedLogin);
}

async function toggleBanMessage(user: AppUser): Promise<void> {
  await openAction("banUser", user, !user.bannedSendMessage);
}

onMounted(() => {
  fetchUsers();
});

watch([currentPage, pageSize], () => {
  fetchUsers();
});

watch([forwardPage, forwardPageSize], () => {
  if (!detailVisible.value || !selectedUser.value || activeDetailTab.value !== "forward") return;
  fetchForwardTasks(selectedUser.value.id);
});

watch([groupPage, groupPageSize], () => {
  if (!detailVisible.value || !selectedUser.value || activeDetailTab.value !== "groups") return;
  fetchGroups(selectedUser.value.id);
});

watch([reportPage, reportPageSize], () => {
  if (!detailVisible.value || !selectedUser.value || activeDetailTab.value !== "reports") return;
  fetchReports(selectedUser.value.id);
});

watch(activeDetailTab, (tab) => {
  if (!detailVisible.value || !selectedUser.value) return;
  if (tab === "base") {
    fetchUserDetail(selectedUser.value.id);
    fetchForwardLimit(selectedUser.value.id);
  }
  if (tab === "reports") fetchReports(selectedUser.value.id);
  if (tab === "forward") fetchForwardTasks(selectedUser.value.id);
  if (tab === "groups") fetchGroups(selectedUser.value.id);
});

watch(detailVisible, (visible) => {
  if (visible) return;
  if (selectedUser.value?.id) {
    delete revealedPhones[selectedUser.value.id];
  }
  selectedUser.value = null;
  activeDetailTab.value = "base";
  reports.value = [];
  forwardTasks.value = [];
  groups.value = [];
  forwardLimit.value = null;
  reportTotal.value = 0;
  forwardTotal.value = 0;
  groupTotal.value = 0;
});
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent="queryUsers">
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-input
                v-model="filters.keyword"
                clearable
                :placeholder="filters.searchType === 'phone' ? '请输入手机号（需管理员权限）' : filters.searchType === 'publicId' ? '请输入公开ID' : '请输入内部ID'"
                :prefix-icon="Search"
                @keyup.enter="queryUsers"
              />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.searchType" placeholder="查询方式">
                <el-option label="内部ID" value="internalId" />
                <el-option label="公开ID" value="publicId" />
                <el-option label="手机号" value="phone" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.status" placeholder="用户状态" clearable>
                <el-option label="正常" value="normal" />
                <el-option label="限制" value="restricted" />
                <el-option label="封禁" value="banned" />
                <el-option label="注销" value="cancelled" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-operation">
            <el-button type="primary" :icon="Search" @click="queryUsers">搜索</el-button>
            <el-button :icon="Delete" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <el-table v-loading="tableLoading" :data="users" style="width: 100%">
        <el-table-column label="用户" min-width="200">
          <template #default="{ row }">
            <div class="user-cell">
              <span class="user-avatar clickable" @click="openUserDetail(row)">
                <img v-if="row.avatar && row.avatar.startsWith('http')" :src="row.avatar" alt="" />
                <span v-else>{{ row.avatar || row.nickname.slice(0, 1) }}</span>
              </span>
              <div>
                <strong class="clickable" @click="openUserDetail(row)">{{ row.nickname }}</strong>
                <span>{{ row.internalId }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="公开ID" min-width="130">
          <template #default="{ row }">
            <span class="mono-text">{{ row.publicId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="手机号" min-width="150">
          <template #default="{ row }">
            <span class="phone-cell">{{ row.countryCode }} {{ row.phone }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="countryName" label="国家/地区" min-width="120" />
        <el-table-column label="好友/群" min-width="100" align="center">
          <template #default="{ row }">
            <span>{{ row.friendCount }} / {{ row.groupCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagTypes[row.status as AppUserStatus]" effect="light">
              {{ statusLabels[row.status as AppUserStatus] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="举报" min-width="80" align="center">
          <template #default="{ row }">
            <el-badge v-if="row.reportCount > 0" :value="row.reportCount" type="danger" />
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="lastActiveAt" label="最近活跃" min-width="170" />
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <div class="action-buttons">
              <el-button link type="primary" @click="openUserDetail(row)">详情</el-button>
              <el-button
                link
                :type="row.bannedLogin ? 'success' : 'danger'"
                :disabled="row.status === 'cancelled'"
                @click="toggleBanLogin(row)"
              >
                {{ row.bannedLogin ? "恢复登录" : "禁止登录" }}
              </el-button>
              <el-button
                link
                :type="row.bannedSendMessage ? 'success' : 'danger'"
                :disabled="row.status === 'cancelled'"
                @click="toggleBanMessage(row)"
              >
                {{ row.bannedSendMessage ? "恢复发送" : "禁止发送" }}
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-footer">
        <el-pagination
          background
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 25, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
        />
      </div>
    </section>

    <!-- 用户详情抽屉 -->
    <el-drawer v-model="detailVisible" title="用户详情" size="50%" class="user-detail-drawer">
      <template v-if="selectedUser">
        <el-tabs v-model="activeDetailTab" class="detail-tabs">
          <el-tab-pane label="基础信息" name="base">
            <div class="detail-header" v-loading="detailLoading">
              <span class="user-avatar lg">
                <img v-if="selectedUser.avatar && selectedUser.avatar.startsWith('http')" :src="selectedUser.avatar" alt="" />
                <span v-else>{{ selectedUser.avatar || selectedUser.nickname.slice(0, 1) }}</span>
              </span>
              <div class="detail-header-info">
                <h3>{{ selectedUser.nickname }}</h3>
                <span>{{ selectedUser.internalId }} · {{ selectedUser.publicId }}</span>
              </div>
              <el-tag :type="statusTagTypes[selectedUser.status]" effect="light">
                {{ statusLabels[selectedUser.status] }}
              </el-tag>
            </div>

            <div class="kv-grid">
              <div class="kv-item">
                <div class="kv-label">用户ID</div>
                <el-tooltip :content="selectedUser.id" placement="top">
                  <span class="kv-value mono-text">{{ selectedUser.id }}</span>
                </el-tooltip>
              </div>
              <div class="kv-item">
                <div class="kv-label">公开ID</div>
                <el-tooltip :content="selectedUser.publicId" placement="top">
                  <span class="kv-value mono-text">{{ selectedUser.publicId }}</span>
                </el-tooltip>
              </div>
              <div class="kv-item">
                <div class="kv-label">手机号</div>
                <div class="kv-value phone-reveal">
                  <span>{{ getDisplayPhone(selectedUser) }}</span>
                  <el-button
                    v-if="!revealedPhones[selectedUser.id]"
                    link
                    type="primary"
                    size="small"
                    @click="openAction('phoneReveal', selectedUser!)"
                  >
                    查看完整
                  </el-button>
                </div>
              </div>
              <div class="kv-item">
                <div class="kv-label">国家/地区</div>
                <span class="kv-value">{{ selectedUser.countryName || "—" }}</span>
              </div>
              <div class="kv-item">
                <div class="kv-label">好友数</div>
                <span class="kv-value">{{ selectedUser.friendCount }}</span>
              </div>
              <div class="kv-item">
                <div class="kv-label">群组数</div>
                <span class="kv-value">{{ selectedUser.groupCount }}</span>
              </div>
              <div class="kv-item">
                <div class="kv-label">举报次数</div>
                <span class="kv-value">{{ selectedUser.reportCount }}</span>
              </div>
              <div class="kv-item">
                <div class="kv-label">禁止登录</div>
                <span class="kv-value">
                  <el-tag :type="selectedUser.bannedLogin ? 'danger' : 'success'" size="small">
                    {{ selectedUser.bannedLogin ? "是" : "否" }}
                  </el-tag>
                </span>
              </div>
              <div class="kv-item">
                <div class="kv-label">禁止发消息</div>
                <span class="kv-value">
                  <el-tag :type="selectedUser.bannedSendMessage ? 'danger' : 'success'" size="small">
                    {{ selectedUser.bannedSendMessage ? "是" : "否" }}
                  </el-tag>
                </span>
              </div>
              <div class="kv-item">
                <div class="kv-label">注册时间</div>
                <el-tooltip :content="selectedUser.createdAt || '—'" placement="top">
                  <span class="kv-value">{{ selectedUser.createdAt || "—" }}</span>
                </el-tooltip>
              </div>
              <div class="kv-item">
                <div class="kv-label">最近活跃</div>
                <el-tooltip :content="selectedUser.lastActiveAt || '—'" placement="top">
                  <span class="kv-value">{{ selectedUser.lastActiveAt || "—" }}</span>
                </el-tooltip>
              </div>
            </div>

            <div class="detail-section">
              <h4>用户状态</h4>
              <el-radio-group :model-value="selectedUser.status" disabled>
                <el-radio-button value="normal">正常</el-radio-button>
                <el-radio-button value="restricted">限制</el-radio-button>
                <el-radio-button value="banned">封禁</el-radio-button>
                <el-radio-button value="cancelled">注销</el-radio-button>
              </el-radio-group>
            </div>

            <div class="detail-section">
              <h4>账号操作</h4>
              <div class="detail-action-bar">
                <el-button
                  :type="selectedUser.bannedLogin ? 'success' : 'danger'"
                  :disabled="selectedUser.status === 'cancelled'"
                  @click="toggleBanLogin(selectedUser!)"
                >
                  {{ selectedUser.bannedLogin ? "恢复登录" : "禁止登录" }}
                </el-button>
                <el-button
                  :type="selectedUser.bannedSendMessage ? 'success' : 'danger'"
                  :disabled="selectedUser.status === 'cancelled'"
                  @click="toggleBanMessage(selectedUser!)"
                >
                  {{ selectedUser.bannedSendMessage ? "恢复发送" : "禁止发送" }}
                </el-button>
                <el-button
                  type="warning"
                  :disabled="selectedUser.status === 'cancelled'"
                  @click="openAction('revokeSessions', selectedUser!)"
                >
                  强制下线
                </el-button>
              </div>
            </div>

            <div class="detail-section">
              <div class="detail-section-header">
                <h4>转发权限限制</h4>
                <el-button link type="primary" @click="openAction('forwardLimit', selectedUser!)">设置</el-button>
              </div>
              <div class="forward-limit-card" v-loading="forwardLimitLoading">
                <div class="forward-limit-item">
                  <span class="forward-limit-label">是否启用</span>
                  <el-tag :type="(forwardLimit?.enabled ?? false) ? 'warning' : 'info'" size="small" effect="light">
                    {{ (forwardLimit?.enabled ?? false) ? "启用" : "未启用" }}
                  </el-tag>
                </div>
                <div class="forward-limit-item">
                  <span class="forward-limit-label">每小时上限</span>
                  <span class="forward-limit-value">{{ forwardLimit?.hourlyLimit ?? 0 }}</span>
                </div>
                <div class="forward-limit-item">
                  <span class="forward-limit-label">每日上限</span>
                  <span class="forward-limit-value">{{ forwardLimit?.dailyLimit ?? 0 }}</span>
                </div>
                <div class="forward-limit-item">
                  <span class="forward-limit-label">单次目标上限</span>
                  <span class="forward-limit-value">{{ forwardLimit?.singleTargets ?? 0 }}</span>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="举报记录" name="reports">
            <div class="detail-table" v-loading="reportLoading">
              <el-table :data="reports" size="small" style="width: 100%">
                <el-table-column label="举报ID" min-width="160">
                  <template #default="{ row }">
                    <span class="mono-text">{{ pickField(row, ["id", "reportId"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="类型" min-width="120">
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["type", "category"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="原因" min-width="150" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["reason", "title"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="状态" min-width="110">
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["status", "state"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="时间" min-width="180">
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["createdAt", "createTime", "created_at", "reportedAt"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="详情" min-width="240" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["detail", "content", "message", "remark", "note"]) }}</span>
                  </template>
                </el-table-column>
              </el-table>

              <div class="table-footer">
                <el-pagination
                  background
                  v-model:current-page="reportPage"
                  v-model:page-size="reportPageSize"
                  :page-sizes="[20, 50, 100]"
                  layout="total, sizes, prev, pager, next"
                  :total="reportTotal"
                />
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="转发任务" name="forward">
            <div class="detail-table" v-loading="forwardLoading">
              <el-table :data="forwardTasks" size="small" style="width: 100%">
                <el-table-column label="任务ID" min-width="160">
                  <template #default="{ row }">
                    <span class="mono-text">{{ pickField(row, ["id", "taskId", "forwardTaskId"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="状态" min-width="120">
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["status", "state"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="创建时间" min-width="180">
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["createdAt", "createTime", "created_at"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="说明" min-width="220" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["remark", "note", "content", "detail", "message"]) }}</span>
                  </template>
                </el-table-column>
              </el-table>

              <div class="table-footer">
                <el-pagination
                  background
                  v-model:current-page="forwardPage"
                  v-model:page-size="forwardPageSize"
                  :page-sizes="[20, 50, 100]"
                  layout="total, sizes, prev, pager, next"
                  :total="forwardTotal"
                />
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="加入群" name="groups">
            <div class="detail-table" v-loading="groupLoading">
              <el-table :data="groups" size="small" style="width: 100%">
                <el-table-column label="群ID" min-width="160">
                  <template #default="{ row }">
                    <span class="mono-text">{{ pickField(row, ["id", "groupId"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="群名称" min-width="180" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["name", "groupName", "title"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="成员数" min-width="120">
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["memberCount", "members", "memberTotal"]) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="加入时间" min-width="180">
                  <template #default="{ row }">
                    <span>{{ pickField(row, ["joinedAt", "joinTime", "createdAt"]) }}</span>
                  </template>
                </el-table-column>
              </el-table>

              <div class="table-footer">
                <el-pagination
                  background
                  v-model:current-page="groupPage"
                  v-model:page-size="groupPageSize"
                  :page-sizes="[20, 50, 100]"
                  layout="total, sizes, prev, pager, next"
                  :total="groupTotal"
                />
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-drawer>

    <el-dialog v-model="actionVisible" :title="getActionTitle()" width="520px" destroy-on-close>
      <el-form :model="actionForm" label-width="90px" class="action-form">
        <template v-if="actionMode === 'forwardLimit'">
          <el-form-item label="启用限制">
            <el-switch v-model="actionForm.enabled" />
          </el-form-item>
          <el-form-item label="每小时上限">
            <el-input-number v-model="actionForm.hourlyLimit" :min="0" :max="999999" />
          </el-form-item>
          <el-form-item label="每日上限">
            <el-input-number v-model="actionForm.dailyLimit" :min="0" :max="999999" />
          </el-form-item>
          <el-form-item label="单次目标">
            <el-input-number v-model="actionForm.singleTargets" :min="0" :max="999999" />
          </el-form-item>
        </template>

        <template v-if="actionMode === 'loginRestriction' || actionMode === 'banUser'">
          <el-form-item label="截止时间">
            <el-date-picker
              v-model="actionForm.until"
              type="datetime"
              clearable
              placeholder="不填表示永久"
              style="width: 100%"
            />
          </el-form-item>
        </template>

        <template v-if="actionMode === 'banUser' || actionMode === 'phoneReveal'">
          <el-form-item label="工单号">
            <el-input v-model="actionForm.ticketNo" placeholder="请输入工单号" maxlength="64" show-word-limit />
          </el-form-item>
        </template>

        <el-form-item label="操作原因">
          <el-input
            v-model="actionForm.reason"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            placeholder="请填写本次操作原因（必填）"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button :disabled="actionLoading" @click="actionVisible = false">取消</el-button>
          <el-button type="primary" :loading="actionLoading" @click="submitAction">确定</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.table-box,
.table-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.table-search {
  padding: 18px 18px 0;
  margin-bottom: 10px;

  .search-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0 18px;
  }

  .search-item :deep(.el-form-item) {
    margin-bottom: 18px;
  }

  .search-item :deep(.el-form-item__content > *) {
    width: 100%;
  }

  .search-operation {
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    gap: 12px;
    margin-bottom: 18px;

    .el-button {
      margin-left: 0;
    }
  }
}

:deep(.el-table) {
  flex: 1;

  .el-table__header th {
    height: 45px;
    font-size: 15px;
    font-weight: bold;
    color: var(--el-text-color-primary);
    background: var(--el-fill-color-light);
  }

  .el-table__row {
    height: 45px;
    font-size: 14px;
  }
}

.table-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 64px;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;

  div {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  strong {
    color: var(--el-text-color-primary);
    font-size: 14px;
  }

  div span {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}

.user-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  color: #08766f;
  background: #dff6f2;
  border-radius: 50%;
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &.lg {
    width: 56px;
    height: 56px;
    font-size: 20px;
    flex-shrink: 0;
  }
}

.clickable {
  cursor: pointer;
}

.mono-text {
  font-family: "Courier New", monospace;
}

.action-buttons {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;

  :deep(.el-button) {
    margin-left: 0;
    padding: 0 4px;
  }
}

.phone-cell {
  color: var(--el-text-color-secondary);
}

/* Drawer detail */
.user-detail-drawer {
  :deep(.el-drawer__body) {
    padding: 12px 16px 16px;
  }
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 12px;
  margin-bottom: 12px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.detail-header-info {
  flex: 1;

  h3 {
    margin: 0 0 4px;
    font-size: 18px;
  }

  span {
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
}

.detail-desc {
  margin-bottom: 20px;
}

.kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  overflow: hidden;
  background: var(--el-bg-color);
}

.kv-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  min-width: 0;
  border-right: 1px solid var(--el-border-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.kv-item:nth-child(2n) {
  border-right: none;
}

.kv-label {
  width: 72px;
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.kv-value {
  flex: 1;
  min-width: 0;
  display: block;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.phone-reveal {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.phone-reveal > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-section {
  margin-bottom: 24px;

  h4 {
    margin: 0 0 12px;
    font-size: 15px;
    color: var(--el-text-color-primary);
  }
}

.detail-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.detail-action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.forward-limit-card {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-light);
}

.forward-limit-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.forward-limit-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.forward-limit-value {
  font-weight: 600;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.detail-tabs {
  :deep(.el-tabs__header) {
    margin: 0 0 12px;
  }

  :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
  }
}

.detail-table {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 1100px) {
  .table-search .search-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .table-search .search-operation {
    justify-content: flex-start;
  }
}

@media (max-width: 700px) {
  .table-search .search-grid {
    grid-template-columns: 1fr;
  }

  .table-search .search-operation {
    justify-content: flex-start;
  }

  .table-footer {
    justify-content: center;
  }

  .user-detail-drawer :deep(.el-drawer) {
    width: 100% !important;
  }
}
</style>
