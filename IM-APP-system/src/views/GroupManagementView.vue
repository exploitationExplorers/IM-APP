<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from "element-plus";
import { Search, Delete } from "@element-plus/icons-vue";
import { getGroupMembersApi, postGroupRecallMessageApi, putGroupMemberAddFriendApi } from "@/api/modules/adminGroups";
import type { AdminGroups } from "@/api/modules/adminGroups";

type GroupStatus = "normal" | "muted" | "banned" | "dissolved";

interface GroupMember {
  userId: string;
  nickname: string;
  role: "member" | "owner";
  joinedAt?: string;
  mutedUntil?: string | null;
}

interface RecallRecord {
  id: number;
  operator: string;
  operatorRole: string;
  targetSender: string;
  messagePreview: string;
  reason: string;
  createdAt: string;
}

interface GroupInfo {
  id: number;
  groupId: string;
  name: string;
  avatar: string;
  owner: string;
  ownerInternalId: string;
  memberCount: number;
  adminCount: number;
  status: GroupStatus;
  muted: boolean;
  memberAddFriendEnabled: boolean;
  createdAt: string;
  notice: string;
  recallCount: number;
}

interface GroupFilters {
  keyword: string;
  status: "" | GroupStatus;
}

const statusLabels: Record<GroupStatus, string> = {
  normal: "正常",
  muted: "全员禁言",
  banned: "封禁",
  dissolved: "已解散",
};

const statusTagTypes: Record<GroupStatus, string> = {
  normal: "success",
  muted: "warning",
  banned: "danger",
  dissolved: "info",
};

const filters = reactive<GroupFilters>({ keyword: "", status: "" });
const currentPage = shallowRef(1);
const pageSize = shallowRef(10);
const detailVisible = shallowRef(false);
const selectedGroup = shallowRef<GroupInfo | null>(null);
const groupMembers = shallowRef<GroupMember[]>([]);
const recallRecords = shallowRef<RecallRecord[]>([]);
const recallFormRef = shallowRef<FormInstance>();
const recallLoading = shallowRef(false);

const groups = shallowRef<GroupInfo[]>([
  {
    id: 1,
    groupId: "G200001",
    name: "产品研发组",
    avatar: "研",
    owner: "陈安",
    ownerInternalId: "U100001",
    memberCount: 28,
    adminCount: 3,
    status: "normal",
    muted: false,
    memberAddFriendEnabled: true,
    createdAt: "2026-03-10",
    notice: "每周五下午3点开周会",
    recallCount: 0,
  },
  {
    id: 2,
    groupId: "G200002",
    name: "海外运营交流",
    avatar: "运",
    owner: "林诺",
    ownerInternalId: "U100002",
    memberCount: 156,
    adminCount: 5,
    status: "normal",
    muted: false,
    memberAddFriendEnabled: false,
    createdAt: "2026-03-20",
    notice: "禁止在群内发送广告",
    recallCount: 2,
  },
  {
    id: 3,
    groupId: "G200003",
    name: "技术分享群",
    avatar: "技",
    owner: "黄怡",
    ownerInternalId: "U100005",
    memberCount: 89,
    adminCount: 2,
    status: "muted",
    muted: true,
    memberAddFriendEnabled: true,
    createdAt: "2026-04-05",
    notice: "全员禁言中，仅管理员可发言",
    recallCount: 1,
  },
  {
    id: 4,
    groupId: "G200004",
    name: "游戏交流群",
    avatar: "游",
    owner: "王磊",
    ownerInternalId: "U100004",
    memberCount: 500,
    adminCount: 8,
    status: "banned",
    muted: true,
    memberAddFriendEnabled: false,
    createdAt: "2026-04-18",
    notice: "该群因违规已被封禁",
    recallCount: 15,
  },
  {
    id: 5,
    groupId: "G200005",
    name: "旧版公告群",
    avatar: "公",
    owner: "张博",
    ownerInternalId: "U100006",
    memberCount: 12,
    adminCount: 1,
    status: "dissolved",
    muted: false,
    memberAddFriendEnabled: true,
    createdAt: "2026-05-01",
    notice: "",
    recallCount: 0,
  },
  {
    id: 6,
    groupId: "G200006",
    name: "客户支持群",
    avatar: "客",
    owner: "周米娅",
    ownerInternalId: "U100003",
    memberCount: 42,
    adminCount: 3,
    status: "normal",
    muted: false,
    memberAddFriendEnabled: false,
    createdAt: "2026-06-15",
    notice: "工作时间：9:00-18:00",
    recallCount: 0,
  },
]);

const allRecalls: Record<number, RecallRecord[]> = {
  2: [
    { id: 1, operator: "陈安", operatorRole: "管理员", targetSender: "某用户", messagePreview: "[图片消息]", reason: "广告推广", createdAt: "2026-08-10 14:30" },
    { id: 2, operator: "林诺", operatorRole: "群主", targetSender: "某用户", messagePreview: "加我微信xxx", reason: "违规引流", createdAt: "2026-08-08 10:15" },
  ],
  3: [
    { id: 3, operator: "黄怡", operatorRole: "群主", targetSender: "某用户", messagePreview: "[不当言论]", reason: "违反群规", createdAt: "2026-08-05 16:20" },
  ],
  4: [
    { id: 4, operator: "王磊", operatorRole: "群主", targetSender: "用户A", messagePreview: "[违规图片]", reason: "传播违规内容", createdAt: "2026-08-06 12:00" },
    { id: 5, operator: "管理员A", operatorRole: "管理员", targetSender: "用户B", messagePreview: "赌博网站链接", reason: "违法信息", createdAt: "2026-08-05 18:30" },
  ],
};

const filteredGroups = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  return groups.value.filter((g) => {
    const matchesKeyword =
      !keyword ||
      [g.name, g.groupId, g.owner].some((v) => v.toLowerCase().includes(keyword));
    const matchesStatus = !filters.status || g.status === filters.status;
    return matchesKeyword && matchesStatus;
  });
});

const pageGroups = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredGroups.value.slice(start, start + pageSize.value);
});

function queryGroups(): void {
  currentPage.value = 1;
}

function resetFilters(): void {
  filters.keyword = "";
  filters.status = "";
  currentPage.value = 1;
}

const recallForm = reactive({ messageId: "", reason: "", ticketNo: "" });

const recallRules: FormRules<typeof recallForm> = {
  messageId: [{ required: true, message: "请输入消息 ID", trigger: "blur" }],
  reason: [{ required: true, message: "请填写撤回原因", trigger: "blur" }],
};

async function fetchGroupMembers(groupId: string): Promise<void> {
  try {
    const res = await getGroupMembersApi(groupId);
    const list: AdminGroups.GroupMember[] = Array.isArray(res.data) ? res.data : [];
    groupMembers.value = list.map((m) => ({
      userId: m.userId,
      nickname: m.nickname || m.userId,
      role: m.role === "owner" ? "owner" : "member",
      joinedAt: m.joinedAt,
      mutedUntil: m.mutedUntil ?? null,
    }));
  } catch {
    groupMembers.value = [];
  }
}

function openGroupDetail(group: GroupInfo): void {
  selectedGroup.value = group;
  groupMembers.value = [];
  recallRecords.value = allRecalls[group.id] ?? [];
  recallForm.messageId = "";
  recallForm.reason = "";
  recallForm.ticketNo = "";
  detailVisible.value = true;
  fetchGroupMembers(group.groupId);
}

async function toggleMute(group: GroupInfo): Promise<void> {
  if (group.status === "dissolved" || group.status === "banned") return;
  const next = !group.muted;
  const action = next ? "全员禁言" : "解除禁言";
  try {
    await ElMessageBox.confirm(`确认对群「${group.name}」${action}？`, action, {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    groups.value = groups.value.map((g) =>
      g.id === group.id ? { ...g, muted: next, status: next ? "muted" : "normal" } : g,
    );
    ElMessage.success(`${action}操作成功`);
    if (selectedGroup.value?.id === group.id) {
      selectedGroup.value = { ...selectedGroup.value, muted: next, status: next ? "muted" : "normal" };
    }
  } catch {
    // dismissed
  }
}

async function toggleMemberAddFriend(group: GroupInfo, next?: boolean): Promise<void> {
  if (group.status === "dissolved") return;
  const enabled = typeof next === "boolean" ? next : !group.memberAddFriendEnabled;
  const action = enabled ? "允许群内互加好友" : "禁止群内互加好友";
  try {
    const { value: reason } = await ElMessageBox.prompt("请输入操作原因", action, {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputType: "textarea",
      inputPlaceholder: "必填",
      inputValidator: (value) => (String(value).trim() ? true : "请填写操作原因"),
    });
    await putGroupMemberAddFriendApi(group.groupId, { enabled, reason: String(reason).trim() });
    groups.value = groups.value.map((g) => (g.id === group.id ? { ...g, memberAddFriendEnabled: enabled } : g));
    ElMessage.success("操作成功");
    if (selectedGroup.value?.id === group.id) {
      selectedGroup.value = { ...selectedGroup.value, memberAddFriendEnabled: enabled };
    }
  } catch {
    // dismissed
  }
}

async function submitRecall(): Promise<void> {
  const ok = await recallFormRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!ok || recallLoading.value || !selectedGroup.value) return;

  const messageId = recallForm.messageId.trim();
  const reason = recallForm.reason.trim();
  const ticketNo = recallForm.ticketNo.trim();

  const idempotencyKey =
    typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
      ? (crypto as any).randomUUID()
      : undefined;

  recallLoading.value = true;
  try {
    await postGroupRecallMessageApi(selectedGroup.value.groupId, messageId, {
      idempotencyKey,
      reason,
      ticketNo: ticketNo || undefined,
    });
    ElMessage.success("已提交撤回请求");
    recallForm.messageId = "";
    recallForm.reason = "";
    recallForm.ticketNo = "";
    recallFormRef.value?.clearValidate();
  } catch {
  } finally {
    recallLoading.value = false;
  }
}

async function dissolveGroup(group: GroupInfo): Promise<void> {
  if (group.status === "dissolved") return;
  try {
    await ElMessageBox.confirm(
      `确认解散群「${group.name}」？解散后所有成员将被移出，不可恢复。`,
      "解散违规群",
      { type: "error", confirmButtonText: "确认解散", cancelButtonText: "取消" },
    );
    groups.value = groups.value.map((g) =>
      g.id === group.id ? { ...g, status: "dissolved", muted: false } : g,
    );
    ElMessage.success("群已解散");
    if (selectedGroup.value?.id === group.id) {
      selectedGroup.value = { ...selectedGroup.value, status: "dissolved", muted: false };
    }
  } catch {
    // dismissed
  }
}

const roleLabels: Record<string, string> = { owner: "群主", admin: "管理员", member: "成员" };
const roleTagTypes: Record<string, string> = { owner: "danger", admin: "warning", member: "info" };
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent="queryGroups">
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-input
                v-model="filters.keyword"
                clearable
                placeholder="群名称/群ID/群主"
                :prefix-icon="Search"
                @keyup.enter="queryGroups"
              />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.status" placeholder="群状态" clearable>
                <el-option label="正常" value="normal" />
                <el-option label="全员禁言" value="muted" />
                <el-option label="封禁" value="banned" />
                <el-option label="已解散" value="dissolved" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-item" />
          <div class="search-operation">
            <el-button type="primary" :icon="Search" @click="queryGroups">搜索</el-button>
            <el-button :icon="Delete" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <el-table :data="pageGroups" style="width: 100%">
        <el-table-column label="群名称" min-width="180">
          <template #default="{ row }">
            <div class="group-cell">
              <span class="group-avatar">{{ row.avatar }}</span>
              <div>
                <strong>{{ row.name }}</strong>
                <span>{{ row.groupId }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="owner" label="群主" min-width="100" />
        <el-table-column label="成员数" min-width="90" align="center">
          <template #default="{ row }">
            {{ row.memberCount }}
          </template>
        </el-table-column>
        <el-table-column label="群状态" min-width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagTypes[row.status as GroupStatus]" effect="light">
              {{ statusLabels[row.status as GroupStatus] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="禁言" min-width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.muted ? 'danger' : 'success'" size="small" effect="plain">
              {{ row.muted ? "是" : "否" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="群内互加好友" min-width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="row.memberAddFriendEnabled ? 'success' : 'danger'" size="small" effect="plain">
              {{ row.memberAddFriendEnabled ? "允许" : "禁止" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="撤回记录" min-width="90" align="center">
          <template #default="{ row }">
            <el-badge v-if="row.recallCount > 0" :value="row.recallCount" type="warning" />
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" min-width="120" />
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <div class="action-buttons">
              <el-button link type="primary" @click="openGroupDetail(row)">详情</el-button>
              <el-button
                link
                :type="row.muted ? 'success' : 'warning'"
                :disabled="row.status === 'dissolved' || row.status === 'banned'"
                @click="toggleMute(row)"
              >
                {{ row.muted ? "解除禁言" : "全员禁言" }}
              </el-button>
              <el-button
                link
                type="danger"
                :disabled="row.status === 'dissolved'"
                @click="dissolveGroup(row)"
              >
                解散
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
          :total="filteredGroups.length"
        />
      </div>
    </section>

    <!-- 群详情抽屉 -->
    <el-drawer v-model="detailVisible" title="群详情" size="600px">
      <template v-if="selectedGroup">
        <div class="detail-header">
          <span class="group-avatar lg">{{ selectedGroup.avatar }}</span>
          <div class="detail-header-info">
            <h3>{{ selectedGroup.name }}</h3>
            <span>{{ selectedGroup.groupId }}</span>
          </div>
          <el-tag :type="statusTagTypes[selectedGroup.status]" effect="light">
            {{ statusLabels[selectedGroup.status] }}
          </el-tag>
        </div>

        <el-descriptions :column="2" border size="small" class="detail-desc">
          <el-descriptions-item label="群主">{{ selectedGroup.owner }}</el-descriptions-item>
          <el-descriptions-item label="群主ID">{{ selectedGroup.ownerInternalId }}</el-descriptions-item>
          <el-descriptions-item label="成员数">{{ selectedGroup.memberCount }}</el-descriptions-item>
          <el-descriptions-item label="管理员数">{{ selectedGroup.adminCount }}</el-descriptions-item>
          <el-descriptions-item label="全员禁言">
            <el-tag :type="selectedGroup.muted ? 'danger' : 'success'" size="small">
              {{ selectedGroup.muted ? "是" : "否" }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="群内互加好友">
            <el-tag :type="selectedGroup.memberAddFriendEnabled ? 'success' : 'danger'" size="small">
              {{ selectedGroup.memberAddFriendEnabled ? "允许" : "禁止" }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ selectedGroup.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="撤回记录">{{ selectedGroup.recallCount }} 条</el-descriptions-item>
          <el-descriptions-item label="群公告" :span="2">
            {{ selectedGroup.notice || "未设置" }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 开关操作 -->
        <div class="detail-section">
          <h4>群设置</h4>
          <div class="switch-row">
            <span>全员禁言</span>
            <el-switch
              :model-value="selectedGroup.muted"
              :disabled="selectedGroup.status === 'dissolved' || selectedGroup.status === 'banned'"
              @change="() => toggleMute(selectedGroup!)"
            />
          </div>
          <div class="switch-row">
            <span>群内互加好友</span>
            <el-switch
              :model-value="selectedGroup.memberAddFriendEnabled"
              :disabled="selectedGroup.status === 'dissolved'"
              @change="(val: boolean) => toggleMemberAddFriend(selectedGroup!, val)"
            />
          </div>
          <el-button
            v-if="selectedGroup.status !== 'dissolved'"
            type="danger"
            plain
            class="dissolve-btn"
            @click="dissolveGroup(selectedGroup)"
          >
            解散该群
          </el-button>
        </div>

        <!-- 成员列表 -->
        <div class="detail-section">
          <h4>群成员（部分）</h4>
          <div v-if="groupMembers.length" class="member-list">
            <div v-for="m in groupMembers" :key="m.userId" class="member-item">
              <span class="member-avatar">{{ m.nickname.slice(0, 1) }}</span>
              <div class="member-content">
                <span class="member-name">{{ m.nickname }}</span>
                <span class="member-sub mono-text">{{ m.userId }}</span>
              </div>
              <el-tag :type="roleTagTypes[m.role]" size="small" effect="plain">{{ roleLabels[m.role] }}</el-tag>
            </div>
          </div>
          <el-empty v-else description="暂无成员数据" :image-size="60" />
        </div>

        <div class="detail-section">
          <h4>管理撤回指定消息</h4>
          <el-form
            ref="recallFormRef"
            :model="recallForm"
            :rules="recallRules"
            label-width="90px"
            @submit.prevent="submitRecall"
          >
            <el-form-item label="消息ID" prop="messageId">
              <el-input v-model="recallForm.messageId" placeholder="UUID" />
            </el-form-item>
            <el-form-item label="撤回原因" prop="reason">
              <el-input v-model="recallForm.reason" type="textarea" :rows="2" placeholder="必填" />
            </el-form-item>
            <el-form-item label="工单号" prop="ticketNo">
              <el-input v-model="recallForm.ticketNo" placeholder="可选" />
            </el-form-item>
            <el-form-item>
              <el-button type="danger" :loading="recallLoading" @click="submitRecall">撤回消息</el-button>
            </el-form-item>
          </el-form>
        </div>

        <!-- 撤回记录 -->
        <div class="detail-section">
          <div class="detail-section-header">
            <h4>群管理撤回记录</h4>
            <el-tag v-if="recallRecords.length" type="warning" size="small">{{ recallRecords.length }} 条</el-tag>
          </div>
          <el-table v-if="recallRecords.length" :data="recallRecords" size="small" style="width: 100%">
            <el-table-column prop="operator" label="操作人" min-width="90" />
            <el-table-column prop="operatorRole" label="角色" min-width="80" />
            <el-table-column prop="messagePreview" label="消息内容" min-width="100" show-overflow-tooltip />
            <el-table-column prop="reason" label="撤回原因" min-width="100" />
            <el-table-column prop="createdAt" label="时间" min-width="150" />
          </el-table>
          <el-empty v-else description="暂无撤回记录" :image-size="60" />
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

.group-cell {
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

.group-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  color: #fff;
  background: var(--el-color-primary);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;

  &.lg {
    width: 56px;
    height: 56px;
    font-size: 22px;
    border-radius: 10px;
    flex-shrink: 0;
  }
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

/* Drawer */
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

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
}

.dissolve-btn {
  width: 100%;
  margin-top: 12px;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.member-avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  border-radius: 50%;
  font-size: 13px;
  font-weight: 600;
}

.member-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.member-name {
  font-size: 14px;
}

.member-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
