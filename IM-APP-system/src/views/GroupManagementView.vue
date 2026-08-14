<script setup lang="ts">
import { onMounted, reactive, shallowRef, watch } from "vue";
import { ElMessage } from "element-plus";
import { Delete, RefreshLeft, Search } from "@element-plus/icons-vue";
import { getGroups, getGroupDetail, dissolveGroup as dissolveGroupApi, muteGroupAll, getGroupRecallLogs, getGroupReports } from "@/api/modules/admin";
import type { Groups, Reports } from "@/api/interface";

type GroupStatus = "normal" | "muted" | "banned" | "dissolved";

const statusLabels: Record<string, string> = {
  normal: "正常",
  muted: "全员禁言",
  banned: "封禁",
  dissolved: "已解散",
};

const statusTagTypes: Record<string, "info" | "warning" | "success" | "danger" | "primary"> = {
  normal: "success",
  muted: "warning",
  banned: "danger",
  dissolved: "info",
};

const joinModeLabels: Record<string, string> = {
  open: "开放加入",
  direct: "直接加入",
  approval: "需审批",
};

const filters = reactive({
  keyword: "",
  status: "" as "" | GroupStatus,
});
const page = shallowRef(1);
const size = shallowRef(20);
const total = shallowRef(0);
const loading = shallowRef(false);
const items = shallowRef<Groups.GroupItem[]>([]);

const detailVisible = shallowRef(false);
const detailLoading = shallowRef(false);
const selectedGroup = shallowRef<Groups.GroupDetail | null>(null);

const dissolveVisible = shallowRef(false);
const dissolveSubmitting = shallowRef(false);
const dissolveTarget = shallowRef<Groups.GroupItem | Groups.GroupDetail | null>(null);
const dissolveForm = reactive({
  reason: "",
  ticketNo: "",
});

const muteVisible = shallowRef(false);
const muteSubmitting = shallowRef(false);
const muteTarget = shallowRef<Groups.GroupItem | Groups.GroupDetail | null>(null);
const muteNext = shallowRef(false);
const muteForm = reactive({
  reason: "",
});

const recallLogs = shallowRef<Groups.RecallLogItem[]>([]);
const recallLoading = shallowRef(false);
const recallPage = shallowRef(1);
const recallSize = shallowRef(10);
const recallTotal = shallowRef(0);

const groupReports = shallowRef<Reports.ReportItem[]>([]);
const groupReportsLoading = shallowRef(false);
const groupReportsPage = shallowRef(1);
const groupReportsSize = shallowRef(10);
const groupReportsTotal = shallowRef(0);

const operatorTypeLabels: Record<string, string> = {
  owner: "群主",
  admin: "管理员",
  member: "成员",
  system: "系统",
};

const reportStatusLabels: Record<string, string> = {
  pending: "待处理",
  processing: "处理中",
  resolved: "已处理",
  rejected: "已驳回",
  reopened: "已重开",
};

const reportStatusTagTypes: Record<string, "info" | "warning" | "success" | "danger" | "primary"> = {
  pending: "warning",
  processing: "primary",
  resolved: "success",
  rejected: "danger",
  reopened: "info",
};

const actionTakenLabels: Record<string, string> = {
  ban: "封禁",
  mute: "禁言",
  warn: "警告",
  none: "无处置",
  restrict_login: "限制登录",
  restrict_message: "限制发消息",
  mute_all: "全员禁言",
  recall: "撤回",
  dissolve: "解散",
};

function formatStatus(status?: string): string {
  if (!status) return "-";
  return statusLabels[status] ?? status;
}

function formatJoinMode(mode?: string): string {
  if (!mode) return "-";
  return joinModeLabels[mode] ?? mode;
}

function formatOperatorType(type?: string): string {
  if (!type) return "-";
  return operatorTypeLabels[type] ?? type;
}

function formatReportStatus(status?: string): string {
  if (!status) return "-";
  return reportStatusLabels[status] ?? status;
}

function formatActionTaken(action?: string): string {
  if (!action) return "-";
  return actionTakenLabels[action] ?? action;
}

function formatTime(value?: string): string {
  if (!value) return "-";
  return value.replace("T", " ").replace(/\.\d+/, "").replace(/\+08:00$/, "");
}

function avatarText(row: Pick<Groups.GroupItem, "name">): string {
  const name = (row.name || "").trim();
  return name ? name.slice(0, 1) : "群";
}

function isImageAvatar(avatar?: string): boolean {
  const value = (avatar || "").trim();
  return /^https?:\/\//i.test(value) || value.startsWith("/");
}

async function loadGroups(): Promise<void> {
  loading.value = true;
  try {
    const res = await getGroups({
      page: page.value,
      size: size.value,
      keyword: filters.keyword.trim() || undefined,
      status: filters.status || undefined,
    });
    items.value = res.data?.items ?? [];
    total.value = res.data?.total ?? 0;
  } catch {
    items.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function queryGroups(): void {
  page.value = 1;
  void loadGroups();
}

function resetFilters(): void {
  filters.keyword = "";
  filters.status = "";
  page.value = 1;
  void loadGroups();
}

async function loadRecallLogs(groupId: string): Promise<void> {
  recallLoading.value = true;
  try {
    const res = await getGroupRecallLogs(groupId, {
      page: recallPage.value,
      size: recallSize.value,
    });
    recallLogs.value = res.data?.items ?? [];
    recallTotal.value = res.data?.total ?? 0;
  } catch {
    recallLogs.value = [];
    recallTotal.value = 0;
  } finally {
    recallLoading.value = false;
  }
}

async function loadGroupReports(groupId: string): Promise<void> {
  groupReportsLoading.value = true;
  try {
    const res = await getGroupReports(groupId, {
      page: groupReportsPage.value,
      size: groupReportsSize.value,
    });
    groupReports.value = res.data?.items ?? [];
    groupReportsTotal.value = res.data?.total ?? 0;
  } catch {
    groupReports.value = [];
    groupReportsTotal.value = 0;
  } finally {
    groupReportsLoading.value = false;
  }
}

async function openGroupDetail(group: Groups.GroupItem): Promise<void> {
  detailVisible.value = true;
  selectedGroup.value = null;
  recallLogs.value = [];
  recallTotal.value = 0;
  recallPage.value = 1;
  groupReports.value = [];
  groupReportsTotal.value = 0;
  groupReportsPage.value = 1;
  detailLoading.value = true;
  try {
    const [detailRes] = await Promise.all([
      getGroupDetail(group.id),
      loadRecallLogs(group.id),
      loadGroupReports(group.id),
    ]);
    selectedGroup.value = detailRes.data ?? null;
  } catch {
    selectedGroup.value = null;
  } finally {
    detailLoading.value = false;
  }
}

function closeGroupDetail(): void {
  detailVisible.value = false;
  selectedGroup.value = null;
  recallLogs.value = [];
  recallTotal.value = 0;
  recallPage.value = 1;
  groupReports.value = [];
  groupReportsTotal.value = 0;
  groupReportsPage.value = 1;
  closeDissolveDialog();
  closeMuteDialog();
}

function openMuteDialog(group: Groups.GroupItem | Groups.GroupDetail): void {
  if (group.status === "dissolved" || group.status === "banned") return;
  muteTarget.value = group;
  muteNext.value = !group.allMuted;
  muteForm.reason = "";
  muteVisible.value = true;
}

function closeMuteDialog(): void {
  muteVisible.value = false;
  muteTarget.value = null;
  muteForm.reason = "";
}

async function submitMute(): Promise<void> {
  const target = muteTarget.value;
  const reason = muteForm.reason.trim();
  if (!target) return;
  if (!reason) {
    ElMessage.warning("请填写操作原因");
    return;
  }
  if (muteSubmitting.value) return;

  muteSubmitting.value = true;
  try {
    await muteGroupAll(target.id, {
      muted: muteNext.value,
      reason,
    });
    ElMessage.success(muteNext.value ? "已全员禁言" : "已解除禁言");
    closeMuteDialog();
    if (detailVisible.value && selectedGroup.value?.id === target.id) {
      try {
        const res = await getGroupDetail(target.id);
        selectedGroup.value = res.data ?? null;
      } catch {
        if (selectedGroup.value) {
          selectedGroup.value = {
            ...selectedGroup.value,
            allMuted: muteNext.value,
            status: muteNext.value ? "muted" : selectedGroup.value.status === "muted" ? "normal" : selectedGroup.value.status,
          };
        }
      }
    }
    await loadGroups();
  } catch {
  } finally {
    muteSubmitting.value = false;
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dissolve-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDissolveDialog(group: Groups.GroupItem | Groups.GroupDetail): void {
  if (group.status === "dissolved") return;
  dissolveTarget.value = group;
  dissolveForm.reason = "";
  dissolveForm.ticketNo = "";
  dissolveVisible.value = true;
}

function closeDissolveDialog(): void {
  dissolveVisible.value = false;
  dissolveTarget.value = null;
  dissolveForm.reason = "";
  dissolveForm.ticketNo = "";
}

async function submitDissolve(): Promise<void> {
  const target = dissolveTarget.value;
  const reason = dissolveForm.reason.trim();
  const ticketNo = dissolveForm.ticketNo.trim();
  if (!target) return;
  if (!reason) {
    ElMessage.warning("请填写解散原因");
    return;
  }
  if (dissolveSubmitting.value) return;

  dissolveSubmitting.value = true;
  try {
    await dissolveGroupApi(target.id, {
      reason,
      ticketNo: ticketNo || undefined,
      idempotencyKey: createIdempotencyKey(),
    });
    ElMessage.success("群已解散");
    closeDissolveDialog();
    if (detailVisible.value && selectedGroup.value?.id === target.id) {
      try {
        const res = await getGroupDetail(target.id);
        selectedGroup.value = res.data ?? null;
      } catch {
        if (selectedGroup.value) {
          selectedGroup.value = { ...selectedGroup.value, status: "dissolved" };
        }
      }
    }
    await loadGroups();
  } catch {
  } finally {
    dissolveSubmitting.value = false;
  }
}

watch([page, size], () => {
  void loadGroups();
});

watch([recallPage, recallSize], () => {
  if (!detailVisible.value || !selectedGroup.value?.id) return;
  void loadRecallLogs(selectedGroup.value.id);
});

watch([groupReportsPage, groupReportsSize], () => {
  if (!detailVisible.value || !selectedGroup.value?.id) return;
  void loadGroupReports(selectedGroup.value.id);
});

onMounted(() => {
  void loadGroups();
});
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
                placeholder="群名称/群ID"
                :prefix-icon="Search"
                @clear="queryGroups"
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
            <el-button :icon="RefreshLeft" :loading="loading" @click="loadGroups">刷新</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <el-table v-loading="loading" :data="items" style="width: 100%">
        <el-table-column label="群名称" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="group-cell">
              <el-avatar v-if="isImageAvatar(row.avatar)" :src="row.avatar" :size="36" shape="square" />
              <span v-else class="group-avatar">{{ avatarText(row) }}</span>
              <div class="group-meta">
                <strong>{{ row.name || "-" }}</strong>
                <span>{{ row.id }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="群主" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.ownerName || "-" }}</template>
        </el-table-column>
        <el-table-column label="群主 ID" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.ownerId || "-" }}</template>
        </el-table-column>
        <el-table-column label="成员数" min-width="90" align="center">
          <template #default="{ row }">{{ row.memberCount ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="群状态" min-width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagTypes[row.status] ?? 'info'" effect="light">
              {{ formatStatus(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="全员禁言" min-width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.allMuted ? 'danger' : 'success'" size="small" effect="plain">
              {{ row.allMuted ? "是" : "否" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <div class="action-buttons">
              <el-button link type="primary" @click="openGroupDetail(row)">详情</el-button>
              <el-button
                link
                :type="row.allMuted ? 'success' : 'warning'"
                :disabled="row.status === 'dissolved' || row.status === 'banned'"
                @click="openMuteDialog(row)"
              >
                {{ row.allMuted ? "解除禁言" : "全员禁言" }}
              </el-button>
              <el-button
                link
                type="danger"
                :disabled="row.status === 'dissolved'"
                @click="openDissolveDialog(row)"
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
          v-model:current-page="page"
          v-model:page-size="size"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
        />
      </div>
    </section>

    <el-drawer v-model="detailVisible" title="群详情" size="720px" @closed="closeGroupDetail">
      <div v-loading="detailLoading">
        <template v-if="selectedGroup">
          <div class="detail-header">
            <el-avatar
              v-if="isImageAvatar(selectedGroup.avatar)"
              :src="selectedGroup.avatar"
              :size="56"
              shape="square"
            />
            <span v-else class="group-avatar lg">{{ avatarText(selectedGroup) }}</span>
            <div class="detail-header-info">
              <h3>{{ selectedGroup.name || "-" }}</h3>
              <span>{{ selectedGroup.id }}</span>
            </div>
            <el-tag :type="statusTagTypes[selectedGroup.status] ?? 'info'" effect="light">
              {{ formatStatus(selectedGroup.status) }}
            </el-tag>
          </div>

          <el-descriptions :column="2" border size="small" class="detail-desc">
            <el-descriptions-item label="群主">{{ selectedGroup.ownerName || "-" }}</el-descriptions-item>
            <el-descriptions-item label="群主 ID">{{ selectedGroup.ownerId || "-" }}</el-descriptions-item>
            <el-descriptions-item label="成员数">{{ selectedGroup.memberCount ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="加群方式">{{ formatJoinMode(selectedGroup.joinMode) }}</el-descriptions-item>
            <el-descriptions-item label="全员禁言">
              <el-tag :type="selectedGroup.allMuted ? 'danger' : 'success'" size="small">
                {{ selectedGroup.allMuted ? "是" : "否" }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="允许互加好友">
              <el-tag :type="selectedGroup.allowMemberAddFriend ? 'success' : 'danger'" size="small">
                {{ selectedGroup.allowMemberAddFriend ? "是" : "否" }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="创建时间" :span="2">
              {{ formatTime(selectedGroup.createdAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="群公告" :span="2">
              {{ selectedGroup.announcement || "未设置" }}
            </el-descriptions-item>
          </el-descriptions>

          <div class="detail-section">
            <h4>群设置</h4>
            <div class="switch-row">
              <span>全员禁言</span>
              <el-switch
                :model-value="!!selectedGroup.allMuted"
                :disabled="selectedGroup.status === 'dissolved' || selectedGroup.status === 'banned'"
                @change="() => openMuteDialog(selectedGroup!)"
              />
            </div>
            <div class="switch-row">
              <span>允许群内互加好友</span>
              <el-switch
                :model-value="!!selectedGroup.allowMemberAddFriend"
                disabled
              />
            </div>
            <el-button
              v-if="selectedGroup.status !== 'dissolved'"
              type="danger"
              plain
              class="dissolve-btn"
              @click="openDissolveDialog(selectedGroup)"
            >
              解散该群
            </el-button>
          </div>

          <div class="detail-section">
            <div class="detail-section-header">
              <h4>群管理撤回记录</h4>
              <el-tag v-if="recallTotal > 0" type="warning" size="small">{{ recallTotal }} 条</el-tag>
            </div>
            <template v-if="recallLogs.length || recallLoading">
              <el-table
                v-loading="recallLoading"
                :data="recallLogs"
                size="small"
                style="width: 100%"
              >
                <el-table-column label="操作人" min-width="100" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.operatorName || "-" }}</template>
                </el-table-column>
                <el-table-column label="角色" min-width="80">
                  <template #default="{ row }">{{ formatOperatorType(row.operatorType) }}</template>
                </el-table-column>
                <el-table-column label="消息 ID" min-width="160" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.messageId || "-" }}</template>
                </el-table-column>
                <el-table-column label="撤回原因" min-width="120" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.reason || "-" }}</template>
                </el-table-column>
                <el-table-column label="时间" min-width="160">
                  <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
                </el-table-column>
              </el-table>
              <div v-if="recallTotal > 0" class="recall-footer">
                <el-pagination
                  background
                  small
                  v-model:current-page="recallPage"
                  v-model:page-size="recallSize"
                  :page-sizes="[10, 20, 50]"
                  layout="total, sizes, prev, pager, next"
                  :total="recallTotal"
                />
              </div>
            </template>
            <el-empty v-else description="暂无撤回记录" :image-size="60" />
          </div>

          <div class="detail-section">
            <div class="detail-section-header">
              <h4>群被举报记录</h4>
              <el-tag v-if="groupReportsTotal > 0" type="danger" size="small">{{ groupReportsTotal }} 条</el-tag>
            </div>
            <template v-if="groupReports.length || groupReportsLoading">
              <el-table
                v-loading="groupReportsLoading"
                :data="groupReports"
                size="small"
                style="width: 100%"
              >
                <el-table-column label="举报单号" min-width="140" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.reportNo || "-" }}</template>
                </el-table-column>
                <el-table-column label="举报人 ID" min-width="160" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.reporterId || "-" }}</template>
                </el-table-column>
                <el-table-column label="原因" min-width="100" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.reasonText || "-" }}</template>
                </el-table-column>
                <el-table-column label="状态" min-width="90">
                  <template #default="{ row }">
                    <el-tag :type="reportStatusTagTypes[row.status] ?? 'info'" effect="plain" size="small">
                      {{ formatReportStatus(row.status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="处理结论" min-width="120" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.conclusion || "-" }}</template>
                </el-table-column>
                <el-table-column label="处置动作" min-width="90">
                  <template #default="{ row }">{{ formatActionTaken(row.actionTaken) }}</template>
                </el-table-column>
                <el-table-column label="创建时间" min-width="160">
                  <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
                </el-table-column>
              </el-table>
              <div v-if="groupReportsTotal > 0" class="recall-footer">
                <el-pagination
                  background
                  small
                  v-model:current-page="groupReportsPage"
                  v-model:page-size="groupReportsSize"
                  :page-sizes="[10, 20, 50]"
                  layout="total, sizes, prev, pager, next"
                  :total="groupReportsTotal"
                />
              </div>
            </template>
            <el-empty v-else description="暂无举报记录" :image-size="60" />
          </div>
        </template>
        <el-empty v-else-if="!detailLoading" description="暂无详情" :image-size="64" />
      </div>
    </el-drawer>

    <el-dialog
      v-model="dissolveVisible"
      title="解散违规群"
      width="480px"
      destroy-on-close
      @closed="closeDissolveDialog"
    >
      <el-alert
        type="error"
        :closable="false"
        show-icon
        title="解散后所有成员将被移出，不可恢复。"
        style="margin-bottom: 16px"
      />
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="目标群">
          <span>{{ dissolveTarget?.name || "-" }}</span>
        </el-form-item>
        <el-form-item label="解散原因" required>
          <el-input
            v-model="dissolveForm.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="请填写解散原因"
          />
        </el-form-item>
        <el-form-item label="关联工单">
          <el-input v-model="dissolveForm.ticketNo" clearable placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeDissolveDialog">取消</el-button>
        <el-button type="danger" :loading="dissolveSubmitting" @click="submitDissolve">确认解散</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="muteVisible"
      :title="muteNext ? '全员禁言' : '解除禁言'"
      width="480px"
      destroy-on-close
      @closed="closeMuteDialog"
    >
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="目标群">
          <span>{{ muteTarget?.name || "-" }}</span>
        </el-form-item>
        <el-form-item label="操作原因" required>
          <el-input
            v-model="muteForm.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            :placeholder="muteNext ? '请填写禁言原因' : '请填写解除禁言原因'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeMuteDialog">取消</el-button>
        <el-button type="primary" :loading="muteSubmitting" @click="submitMute">确定</el-button>
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

.card {
  background: var(--el-bg-color);
  border-radius: 4px;
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
  min-width: 0;

  .group-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  strong {
    overflow: hidden;
    color: var(--el-text-color-primary);
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group-meta span {
    overflow: hidden;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    font-size: 20px;
  }
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
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
  margin-bottom: 24px;
}

.detail-section {
  margin-bottom: 28px;

  h4 {
    margin: 0 0 12px;
    font-size: 15px;
    font-weight: 600;
  }
}

.detail-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;

  h4 {
    margin: 0;
  }
}

.recall-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.dissolve-btn {
  margin-top: 16px;
  width: 100%;
}
</style>
