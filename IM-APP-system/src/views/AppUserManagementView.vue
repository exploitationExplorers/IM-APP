<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CirclePlus, Delete, Search } from "@element-plus/icons-vue";

type AppUserStatus = "normal" | "restricted" | "banned" | "cancelled";

interface AppUser {
  id: number;
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

interface ReportRecord {
  id: number;
  reporter: string;
  reporterId: string;
  reason: string;
  detail: string;
  createdAt: string;
  status: "pending" | "resolved";
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
const detailVisible = shallowRef(false);
const selectedUser = shallowRef<AppUser | null>(null);
const userReports = shallowRef<ReportRecord[]>([]);

const users = shallowRef<AppUser[]>([
  {
    id: 1,
    internalId: "U100001",
    publicId: "IM_8a3f2k",
    phone: "138****6621",
    countryCode: "+86",
    countryName: "中国大陆",
    nickname: "陈安",
    avatar: "陈",
    friendCount: 128,
    groupCount: 15,
    status: "normal",
    bannedLogin: false,
    bannedSendMessage: false,
    reportCount: 0,
    createdAt: "2026-03-08",
    lastActiveAt: "2026-08-12 10:41",
  },
  {
    id: 2,
    internalId: "U100002",
    publicId: "IM_x2m9p1",
    phone: "139****0085",
    countryCode: "+86",
    countryName: "中国大陆",
    nickname: "林诺",
    avatar: "林",
    friendCount: 56,
    groupCount: 8,
    status: "normal",
    bannedLogin: false,
    bannedSendMessage: false,
    reportCount: 1,
    createdAt: "2026-03-13",
    lastActiveAt: "2026-08-12 09:36",
  },
  {
    id: 3,
    internalId: "U100003",
    publicId: "IM_q7v4tw",
    phone: "090****1234",
    countryCode: "+81",
    countryName: "日本",
    nickname: "周米娅",
    avatar: "周",
    friendCount: 23,
    groupCount: 3,
    status: "restricted",
    bannedLogin: false,
    bannedSendMessage: true,
    reportCount: 3,
    createdAt: "2026-04-02",
    lastActiveAt: "2026-08-11 20:17",
  },
  {
    id: 4,
    internalId: "U100004",
    publicId: "IM_b5n8rc",
    phone: "010****5678",
    countryCode: "+1",
    countryName: "美国",
    nickname: "王磊",
    avatar: "王",
    friendCount: 5,
    groupCount: 1,
    status: "banned",
    bannedLogin: true,
    bannedSendMessage: true,
    reportCount: 8,
    createdAt: "2026-04-15",
    lastActiveAt: "2026-08-06 14:28",
  },
  {
    id: 5,
    internalId: "U100005",
    publicId: "IM_h3k6sf",
    phone: "852****9090",
    countryCode: "+852",
    countryName: "中国香港",
    nickname: "黄怡",
    avatar: "黄",
    friendCount: 89,
    groupCount: 12,
    status: "normal",
    bannedLogin: false,
    bannedSendMessage: false,
    reportCount: 0,
    createdAt: "2026-05-20",
    lastActiveAt: "2026-08-12 08:55",
  },
  {
    id: 6,
    internalId: "U100006",
    publicId: "IM_d9j2lm",
    phone: "040****3333",
    countryCode: "+61",
    countryName: "澳大利亚",
    nickname: "张博",
    avatar: "张",
    friendCount: 0,
    groupCount: 0,
    status: "cancelled",
    bannedLogin: false,
    bannedSendMessage: false,
    reportCount: 2,
    createdAt: "2026-06-01",
    lastActiveAt: "2026-07-15 16:22",
  },
]);

const allReports: Record<number, ReportRecord[]> = {
  3: [
    { id: 1, reporter: "陈安", reporterId: "U100001", reason: "发送广告骚扰", detail: "多次在群聊中发送推广链接", createdAt: "2026-08-10 14:30", status: "pending" },
    { id: 2, reporter: "林诺", reporterId: "U100002", reason: "辱骂他人", detail: "单聊中使用不文明用语", createdAt: "2026-08-09 11:20", status: "resolved" },
    { id: 3, reporter: "黄怡", reporterId: "U100005", reason: "频繁添加好友", detail: "短时间内向大量用户发送好友申请", createdAt: "2026-08-08 09:15", status: "pending" },
  ],
  4: [
    { id: 4, reporter: "周米娅", reporterId: "U100003", reason: "诈骗行为", detail: "冒充官方人员进行诈骗", createdAt: "2026-08-05 18:00", status: "pending" },
    { id: 5, reporter: "黄怡", reporterId: "U100005", reason: "传播违规内容", detail: "在群聊中传播违规图片", createdAt: "2026-08-04 10:45", status: "resolved" },
  ],
};

const filteredUsers = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  return users.value.filter((user) => {
    let matchesKeyword = true;
    if (keyword) {
      if (filters.searchType === "phone") {
        matchesKeyword = user.phone.includes(keyword);
      } else if (filters.searchType === "publicId") {
        matchesKeyword = user.publicId.toLowerCase().includes(keyword);
      } else {
        matchesKeyword = user.internalId.toLowerCase().includes(keyword);
      }
    }
    const matchesStatus = !filters.status || user.status === filters.status;
    return matchesKeyword && matchesStatus;
  });
});

const pageUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredUsers.value.slice(start, start + pageSize.value);
});

function queryUsers(): void {
  currentPage.value = 1;
}

function resetFilters(): void {
  filters.keyword = "";
  filters.searchType = "internalId";
  filters.status = "";
  currentPage.value = 1;
}

function openUserDetail(user: AppUser): void {
  selectedUser.value = user;
  userReports.value = allReports[user.id] ?? [];
  detailVisible.value = true;
}

async function toggleBanLogin(user: AppUser): Promise<void> {
  const next = !user.bannedLogin;
  const action = next ? "禁止登录" : "恢复登录";
  try {
    await ElMessageBox.confirm(`确认对用户「${user.nickname}」${action}？`, action, {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    users.value = users.value.map((u) =>
      u.id === user.id ? { ...u, bannedLogin: next } : u,
    );
    ElMessage.success(`${action}操作成功`);
  } catch {
    // dismissed
  }
}

async function toggleBanMessage(user: AppUser): Promise<void> {
  const next = !user.bannedSendMessage;
  const action = next ? "禁止发送消息" : "恢复发送消息";
  try {
    await ElMessageBox.confirm(`确认对用户「${user.nickname}」${action}？`, action, {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    users.value = users.value.map((u) =>
      u.id === user.id ? { ...u, bannedSendMessage: next } : u,
    );
    ElMessage.success(`${action}操作成功`);
  } catch {
    // dismissed
  }
}

async function changeStatus(user: AppUser, status: AppUserStatus): Promise<void> {
  if (user.status === status) return;
  try {
    await ElMessageBox.confirm(
      `确认将用户「${user.nickname}」状态修改为「${statusLabels[status]}」？`,
      "修改用户状态",
      { type: "warning", confirmButtonText: "确定", cancelButtonText: "取消" },
    );
    users.value = users.value.map((u) =>
      u.id === user.id ? { ...u, status } : u,
    );
    ElMessage.success("用户状态修改成功");
    if (selectedUser.value?.id === user.id) {
      selectedUser.value = { ...selectedUser.value, status };
    }
  } catch {
    // dismissed
  }
}
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
      <el-table :data="pageUsers" style="width: 100%">
        <el-table-column label="用户" min-width="200">
          <template #default="{ row }">
            <div class="user-cell">
              <span class="user-avatar">{{ row.avatar }}</span>
              <div>
                <strong>{{ row.nickname }}</strong>
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
          :total="filteredUsers.length"
        />
      </div>
    </section>

    <!-- 用户详情抽屉 -->
    <el-drawer v-model="detailVisible" title="用户详情" size="560px">
      <template v-if="selectedUser">
        <div class="detail-header">
          <span class="user-avatar lg">{{ selectedUser.avatar }}</span>
          <div class="detail-header-info">
            <h3>{{ selectedUser.nickname }}</h3>
            <span>{{ selectedUser.internalId }} · {{ selectedUser.publicId }}</span>
          </div>
          <el-tag :type="statusTagTypes[selectedUser.status]" effect="light">
            {{ statusLabels[selectedUser.status] }}
          </el-tag>
        </div>

        <el-descriptions :column="2" border size="small" class="detail-desc">
          <el-descriptions-item label="手机号">{{ selectedUser.countryCode }} {{ selectedUser.phone }}</el-descriptions-item>
          <el-descriptions-item label="国家/地区">{{ selectedUser.countryName }}</el-descriptions-item>
          <el-descriptions-item label="好友数">{{ selectedUser.friendCount }}</el-descriptions-item>
          <el-descriptions-item label="群组数">{{ selectedUser.groupCount }}</el-descriptions-item>
          <el-descriptions-item label="举报次数">{{ selectedUser.reportCount }}</el-descriptions-item>
          <el-descriptions-item label="禁止登录">
            <el-tag :type="selectedUser.bannedLogin ? 'danger' : 'success'" size="small">
              {{ selectedUser.bannedLogin ? "是" : "否" }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="禁止发消息">
            <el-tag :type="selectedUser.bannedSendMessage ? 'danger' : 'success'" size="small">
              {{ selectedUser.bannedSendMessage ? "是" : "否" }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ selectedUser.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="最近活跃">{{ selectedUser.lastActiveAt }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-section">
          <h4>状态操作</h4>
          <el-radio-group
            :model-value="selectedUser.status"
            @change="(val: AppUserStatus) => changeStatus(selectedUser!, val)"
          >
            <el-radio-button value="normal">正常</el-radio-button>
            <el-radio-button value="restricted">限制</el-radio-button>
            <el-radio-button value="banned">封禁</el-radio-button>
            <el-radio-button value="cancelled">注销</el-radio-button>
          </el-radio-group>
        </div>

        <div class="detail-section">
          <div class="detail-section-header">
            <h4>举报记录</h4>
            <el-tag v-if="userReports.length" type="danger" size="small">{{ userReports.length }} 条</el-tag>
          </div>
          <el-table v-if="userReports.length" :data="userReports" size="small" style="width: 100%">
            <el-table-column prop="reason" label="原因" min-width="120" />
            <el-table-column prop="reporter" label="举报人" min-width="90" />
            <el-table-column prop="createdAt" label="时间" min-width="150" />
            <el-table-column label="状态" min-width="80">
              <template #default="{ row }">
                <el-tag :type="row.status === 'pending' ? 'warning' : 'success'" size="small">
                  {{ row.status === "pending" ? "待处理" : "已处理" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="detail" label="详情" min-width="200" show-overflow-tooltip />
          </el-table>
          <el-empty v-else description="暂无举报记录" :image-size="60" />
        </div>
      </template>
    </el-drawer>
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
  font-size: 13px;
  font-weight: 700;

  &.lg {
    width: 56px;
    height: 56px;
    font-size: 20px;
    flex-shrink: 0;
  }
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
.detail-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
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
}
</style>
