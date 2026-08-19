<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef, watch } from "vue";
import { ElMessage } from "element-plus";
import { RefreshLeft, Search, View } from "@element-plus/icons-vue";
import {
  getReports,
  getReportDetail,
  getReportActions,
  assignReport,
  addReportNote,
  rejectReport,
  resolveReport,
  startReport,
  reopenReport,
} from "@/api/modules/admin";
import type { Reports } from "@/api/interface";
import { useAuthStore } from "@/stores/auth";

const authStore = useAuthStore();

const filters = reactive({
  keyword: "",
  status: "",
});
const page = shallowRef(1);
const size = shallowRef(20);
const total = shallowRef(0);
const loading = shallowRef(false);
const items = shallowRef<Reports.ReportItem[]>([]);

const detailVisible = shallowRef(false);
const detailLoading = shallowRef(false);
const detail = shallowRef<Reports.ReportDetail | null>(null);
const actions = shallowRef<Reports.ReportAction[]>([]);

const assignVisible = shallowRef(false);
const assignSubmitting = shallowRef(false);
const assignForm = reactive({
  assigneeId: "",
  reason: "",
});

const noteSubmitting = shallowRef(false);
const noteForm = reactive({
  content: "",
});

const rejectVisible = shallowRef(false);
const rejectSubmitting = shallowRef(false);
const rejectForm = reactive({
  reason: "",
  conclusion: "",
  disposeActions: [] as string[],
  ticketNo: "",
});

const resolveVisible = shallowRef(false);
const resolveSubmitting = shallowRef(false);
const resolveForm = reactive({
  reason: "",
  conclusion: "",
  disposeActions: [] as string[],
  ticketNo: "",
});

const reopenVisible = shallowRef(false);
const reopenSubmitting = shallowRef(false);
const reopenForm = reactive({
  reason: "",
  conclusion: "",
  disposeActions: [] as string[],
  ticketNo: "",
});

const startVisible = shallowRef(false);
const startSubmitting = shallowRef(false);
const startForm = reactive({
  reason: "",
  ticketNo: "",
});

const disposeActionOptions = [
  { label: "警告", value: "warn" },
  { label: "限制登录", value: "restrict_login" },
  { label: "限制发消息", value: "restrict_message" },
  { label: "封禁", value: "ban" },
  { label: "全员禁言", value: "mute_all" },
  { label: "撤回", value: "recall" },
  { label: "解散", value: "dissolve" },
];

const canHandle = computed(() => {
  const status = detail.value?.status;
  return status === "pending" || status === "processing" || status === "reopened";
});

const canStart = computed(() => {
  const status = detail.value?.status;
  return status === "pending" || status === "reopened";
});

const canReopen = computed(() => {
  const status = detail.value?.status;
  return status === "resolved" || status === "rejected";
});

const statusLabels: Record<string, string> = {
  pending: "待处理",
  processing: "处理中",
  resolved: "已处理",
  rejected: "已驳回",
  reopened: "已重开",
};

const targetTypeLabels: Record<string, string> = {
  user: "用户",
  group: "群组",
  message: "消息",
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

const reportActionLabels: Record<string, string> = {
  resolve: "结案",
  reject: "驳回",
  reopen: "重开",
  assign: "指派",
  start: "开始处理",
  note: "备注",
  process: "受理",
};

const statusTagTypes: Record<string, "info" | "warning" | "success" | "danger" | "primary"> = {
  pending: "warning",
  processing: "primary",
  resolved: "success",
  rejected: "danger",
  reopened: "info",
};

function formatStatus(status?: string): string {
  const value = (status || "").trim();
  if (!value) return "-";
  return statusLabels[value] ?? value;
}

function formatTargetType(type: string): string {
  return targetTypeLabels[type] ?? type;
}

function formatActionTaken(action?: string): string {
  if (!action) return "-";
  return actionTakenLabels[action] ?? action;
}

function formatReportAction(action?: string): string {
  if (!action) return "-";
  return reportActionLabels[action] ?? action;
}

function formatTime(value?: string): string {
  if (!value) return "-";
  return value.replace("T", " ").replace(/\.\d+/, "").replace(/\+08:00$/, "");
}

function isImageFile(file: Reports.ReportFile): boolean {
  return (file.contentType || "").startsWith("image/");
}

async function loadReports(): Promise<void> {
  loading.value = true;
  try {
    const res = await getReports({
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

function searchReports(): void {
  page.value = 1;
  void loadReports();
}

function resetFilters(): void {
  filters.keyword = "";
  filters.status = "";
  page.value = 1;
  void loadReports();
}

async function loadDetailBundle(id: string): Promise<void> {
  const [detailRes, actionsRes] = await Promise.all([
    getReportDetail(id),
    getReportActions(id),
  ]);
  detail.value = detailRes.data ?? null;
  const list = Array.isArray(actionsRes.data) ? actionsRes.data : [];
  actions.value = [...list].sort((a, b) => {
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

async function openReportDetail(row: Reports.ReportItem): Promise<void> {
  detailVisible.value = true;
  detail.value = null;
  actions.value = [];
  detailLoading.value = true;
  try {
    await loadDetailBundle(row.id);
  } catch {
    detail.value = null;
    actions.value = [];
  } finally {
    detailLoading.value = false;
  }
}

function closeReportDetail(): void {
  detailVisible.value = false;
  detail.value = null;
  actions.value = [];
  noteForm.content = "";
  closeAssignDialog();
  closeRejectDialog();
  closeResolveDialog();
  closeStartDialog();
  closeReopenDialog();
}

function openAssignDialog(): void {
  if (!detail.value) return;
  assignForm.assigneeId = "";
  assignForm.reason = "";
  assignVisible.value = true;
}

function closeAssignDialog(): void {
  assignVisible.value = false;
  assignForm.assigneeId = "";
  assignForm.reason = "";
}

async function submitAssign(): Promise<void> {
  const reportId = detail.value?.id;
  const assigneeId = assignForm.assigneeId.trim();
  const reason = assignForm.reason.trim();
  if (!reportId) return;
  if (!assigneeId) {
    ElMessage.warning("请填写处理人 ID");
    return;
  }
  if (!reason) {
    ElMessage.warning("请填写指派原因");
    return;
  }
  if (assignSubmitting.value) return;

  assignSubmitting.value = true;
  try {
    await assignReport(reportId, { assigneeId, reason });
    ElMessage.success("指派成功");
    closeAssignDialog();
    await loadDetailBundle(reportId);
    await loadReports();
  } catch {
  } finally {
    assignSubmitting.value = false;
  }
}

async function claimReport(): Promise<void> {
  const reportId = detail.value?.id;
  const assigneeId = authStore.adminId?.trim() || "";
  if (!reportId) return;
  if (!assigneeId) {
    ElMessage.warning("缺少当前管理员 ID，请重新登录后再领取");
    return;
  }
  if (assignSubmitting.value) return;

  assignSubmitting.value = true;
  try {
    await assignReport(reportId, { assigneeId, reason: "领取工单" });
    ElMessage.success("领取成功");
    await loadDetailBundle(reportId);
    await loadReports();
  } catch {
  } finally {
    assignSubmitting.value = false;
  }
}

async function submitNote(): Promise<void> {
  const reportId = detail.value?.id;
  const content = noteForm.content.trim();
  if (!reportId) return;
  if (!content) {
    ElMessage.warning("请填写备注内容");
    return;
  }
  if (noteSubmitting.value) return;

  noteSubmitting.value = true;
  try {
    await addReportNote(reportId, { content });
    ElMessage.success("备注已添加");
    noteForm.content = "";
    await loadDetailBundle(reportId);
  } catch {
  } finally {
    noteSubmitting.value = false;
  }
}

function openRejectDialog(): void {
  if (!detail.value) return;
  rejectForm.reason = "";
  rejectForm.conclusion = "";
  rejectForm.disposeActions = [];
  rejectForm.ticketNo = "";
  rejectVisible.value = true;
}

function closeRejectDialog(): void {
  rejectVisible.value = false;
  rejectForm.reason = "";
  rejectForm.conclusion = "";
  rejectForm.disposeActions = [];
  rejectForm.ticketNo = "";
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `reject-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function submitReject(): Promise<void> {
  const reportId = detail.value?.id;
  const reason = rejectForm.reason.trim();
  const conclusion = rejectForm.conclusion.trim();
  const ticketNo = rejectForm.ticketNo.trim();
  if (!reportId) return;
  if (!reason) {
    ElMessage.warning("请填写驳回原因");
    return;
  }
  if (rejectSubmitting.value) return;

  rejectSubmitting.value = true;
  try {
    await rejectReport(reportId, {
      reason,
      conclusion: conclusion || undefined,
      disposeActions: rejectForm.disposeActions.length ? [...rejectForm.disposeActions] : undefined,
      ticketNo: ticketNo || undefined,
      idempotencyKey: createIdempotencyKey(),
    });
    ElMessage.success("已驳回并结案");
    closeRejectDialog();
    await loadDetailBundle(reportId);
    await loadReports();
  } catch {
  } finally {
    rejectSubmitting.value = false;
  }
}

function openResolveDialog(): void {
  if (!detail.value) return;
  resolveForm.reason = "";
  resolveForm.conclusion = "";
  resolveForm.disposeActions = [];
  resolveForm.ticketNo = "";
  resolveVisible.value = true;
}

function closeResolveDialog(): void {
  resolveVisible.value = false;
  resolveForm.reason = "";
  resolveForm.conclusion = "";
  resolveForm.disposeActions = [];
  resolveForm.ticketNo = "";
}

async function submitResolve(): Promise<void> {
  const reportId = detail.value?.id;
  const reason = resolveForm.reason.trim();
  const conclusion = resolveForm.conclusion.trim();
  const ticketNo = resolveForm.ticketNo.trim();
  if (!reportId) return;
  if (!reason) {
    ElMessage.warning("请填写结案原因");
    return;
  }
  if (resolveSubmitting.value) return;

  resolveSubmitting.value = true;
  try {
    await resolveReport(reportId, {
      reason,
      conclusion: conclusion || undefined,
      disposeActions: resolveForm.disposeActions.length ? [...resolveForm.disposeActions] : undefined,
      ticketNo: ticketNo || undefined,
      idempotencyKey: createIdempotencyKey(),
    });
    ElMessage.success("已成立并结案");
    closeResolveDialog();
    await loadDetailBundle(reportId);
    await loadReports();
  } catch {
  } finally {
    resolveSubmitting.value = false;
  }
}

function openStartDialog(): void {
  if (!detail.value) return;
  startForm.reason = "";
  startForm.ticketNo = "";
  startVisible.value = true;
}

function closeStartDialog(): void {
  startVisible.value = false;
  startForm.reason = "";
  startForm.ticketNo = "";
}

async function submitStart(): Promise<void> {
  const reportId = detail.value?.id;
  const reason = startForm.reason.trim();
  const ticketNo = startForm.ticketNo.trim();
  if (!reportId) return;
  if (!reason) {
    ElMessage.warning("请填写开始处理原因");
    return;
  }
  if (startSubmitting.value) return;

  startSubmitting.value = true;
  try {
    await startReport(reportId, {
      reason,
      ticketNo: ticketNo || undefined,
      idempotencyKey: createIdempotencyKey(),
    });
    ElMessage.success("已标记为处理中");
    closeStartDialog();
    await loadDetailBundle(reportId);
    await loadReports();
  } catch {
  } finally {
    startSubmitting.value = false;
  }
}

function openReopenDialog(): void {
  if (!detail.value) return;
  reopenForm.reason = "";
  reopenForm.conclusion = "";
  reopenForm.disposeActions = [];
  reopenForm.ticketNo = "";
  reopenVisible.value = true;
}

function closeReopenDialog(): void {
  reopenVisible.value = false;
  reopenForm.reason = "";
  reopenForm.conclusion = "";
  reopenForm.disposeActions = [];
  reopenForm.ticketNo = "";
}

async function submitReopen(): Promise<void> {
  const reportId = detail.value?.id;
  const reason = reopenForm.reason.trim();
  const conclusion = reopenForm.conclusion.trim();
  const ticketNo = reopenForm.ticketNo.trim();
  if (!reportId) return;
  if (!reason) {
    ElMessage.warning("请填写重开原因");
    return;
  }
  if (reopenSubmitting.value) return;

  reopenSubmitting.value = true;
  try {
    await reopenReport(reportId, {
      reason,
      conclusion: conclusion || undefined,
      disposeActions: reopenForm.disposeActions.length ? [...reopenForm.disposeActions] : undefined,
      ticketNo: ticketNo || undefined,
      idempotencyKey: createIdempotencyKey(),
    });
    ElMessage.success("工单已重开");
    closeReopenDialog();
    await loadDetailBundle(reportId);
    await loadReports();
  } catch {
  } finally {
    reopenSubmitting.value = false;
  }
}

watch([page, size], () => {
  void loadReports();
});

onMounted(() => {
  void loadReports();
});
</script>

<template>
  <div class="table-box">
    <div class="card table-main">
      <div class="tab-search">
        <el-form :model="filters" @submit.prevent>
          <div class="search-grid">
            <div class="search-item">
              <el-form-item>
                <el-input
                  v-model="filters.keyword"
                  clearable
                  placeholder="关键字"
                  :prefix-icon="Search"
                  @clear="searchReports"
                  @keyup.enter="searchReports"
                />
              </el-form-item>
            </div>
            <div class="search-item">
              <el-form-item>
                <el-select v-model="filters.status" clearable placeholder="状态筛选">
                  <el-option label="待处理" value="pending" />
                  <el-option label="处理中" value="processing" />
                  <el-option label="已处理" value="resolved" />
                  <el-option label="已驳回" value="rejected" />
                  <el-option label="已重开" value="reopened" />
                </el-select>
              </el-form-item>
            </div>
            <div class="search-operation">
              <el-button type="primary" :icon="Search" @click="searchReports">搜索</el-button>
              <el-button :icon="RefreshLeft" @click="resetFilters">重置</el-button>
              <el-button :icon="RefreshLeft" :loading="loading" @click="loadReports">刷新</el-button>
            </div>
          </div>
        </el-form>
      </div>

      <el-table v-loading="loading" :data="items" style="width: 100%">
        <el-table-column prop="reportNo" label="举报单号" min-width="150" />
        <el-table-column label="目标类型" min-width="100">
          <template #default="{ row }">{{ formatTargetType(row.targetType) }}</template>
        </el-table-column>
        <el-table-column prop="targetId" label="目标 ID" min-width="220" show-overflow-tooltip />
        <el-table-column prop="reporterId" label="举报人 ID" min-width="220" show-overflow-tooltip />
        <el-table-column prop="reasonText" label="举报原因" min-width="120" show-overflow-tooltip />
        <el-table-column prop="description" label="补充说明" min-width="160" show-overflow-tooltip />
        <el-table-column label="状态" min-width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagTypes[row.status] ?? 'info'" effect="plain" round>
              {{ formatStatus(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="assigneeId" label="处理人 ID" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.assigneeId || "-" }}</template>
        </el-table-column>
        <el-table-column prop="conclusion" label="处理结论" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.conclusion || "-" }}</template>
        </el-table-column>
        <el-table-column label="处理动作" min-width="100">
          <template #default="{ row }">{{ formatActionTaken(row.actionTaken) }}</template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="更新时间" min-width="170">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="View" @click="openReportDetail(row)">详情</el-button>
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
    </div>

    <el-dialog
      v-model="detailVisible"
      title="举报详情"
      width="1100px"
      top="5vh"
      destroy-on-close
      @closed="closeReportDetail"
    >
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="举报单号">{{ detail.reportNo }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusTagTypes[detail.status] ?? 'info'" effect="plain" round>
                {{ formatStatus(detail.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="目标类型">{{ formatTargetType(detail.targetType) }}</el-descriptions-item>
            <el-descriptions-item label="目标 ID">{{ detail.targetId }}</el-descriptions-item>
            <el-descriptions-item label="举报人 ID">{{ detail.reporterId }}</el-descriptions-item>
            <el-descriptions-item label="处理人 ID">{{ detail.assigneeId || "-" }}</el-descriptions-item>
            <el-descriptions-item label="举报原因">{{ detail.reasonText }}</el-descriptions-item>
            <el-descriptions-item label="处理动作">{{ formatActionTaken(detail.actionTaken) }}</el-descriptions-item>
            <el-descriptions-item label="补充说明" :span="2">{{ detail.description || "-" }}</el-descriptions-item>
            <el-descriptions-item label="处理结论" :span="2">{{ detail.conclusion || "-" }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ formatTime(detail.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="更新时间">{{ formatTime(detail.updatedAt) }}</el-descriptions-item>
          </el-descriptions>

          <el-divider content-position="left">证据材料</el-divider>
          <div v-if="detail.files?.length" class="evidence-list">
            <div v-for="file in detail.files" :key="file.id" class="evidence-item">
              <el-image
                v-if="isImageFile(file)"
                :src="file.fileUrl"
                :preview-src-list="[file.fileUrl]"
                fit="cover"
                class="evidence-image"
              />
              <a v-else :href="file.fileUrl" target="_blank" rel="noopener noreferrer">{{ file.fileUrl }}</a>
              <div class="evidence-meta">{{ file.contentType }}</div>
            </div>
          </div>
          <el-empty v-else description="暂无证据材料" :image-size="64" />

          <el-divider content-position="left">处理备注</el-divider>
          <div class="note-editor">
            <el-input
              v-model="noteForm.content"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              placeholder="填写内部备注"
            />
            <div class="note-editor-actions">
              <el-button type="primary" :loading="noteSubmitting" @click="submitNote">添加备注</el-button>
            </div>
          </div>
          <el-timeline v-if="detail.notes?.length">
            <el-timeline-item
              v-for="note in detail.notes"
              :key="note.id"
              :timestamp="formatTime(note.createdAt)"
              placement="top"
            >
              <div class="note-content">{{ note.content }}</div>
              <div class="note-meta">管理员：{{ note.adminId }}</div>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="暂无处理备注" :image-size="64" />

          <el-divider content-position="left">处置历史</el-divider>
          <el-table v-if="actions.length" :data="actions" size="small" style="width: 100%" table-layout="auto">
            <el-table-column label="操作" width="100">
              <template #default="{ row }">{{ formatReportAction(row.action) }}</template>
            </el-table-column>
            <el-table-column label="变更前" width="100">
              <template #default="{ row }">{{ formatStatus(row.beforeStatus) }}</template>
            </el-table-column>
            <el-table-column label="变更后" width="100">
              <template #default="{ row }">{{ formatStatus(row.afterStatus) }}</template>
            </el-table-column>
            <el-table-column prop="detail" label="详情" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.detail || "-" }}</template>
            </el-table-column>
            <el-table-column prop="adminId" label="管理员 ID" min-width="320">
              <template #default="{ row }">{{ row.adminId || "-" }}</template>
            </el-table-column>
            <el-table-column label="时间" width="180">
              <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无处置历史" :image-size="64" />
        </template>
        <el-empty v-else-if="!detailLoading" description="暂无详情" :image-size="64" />
      </div>

      <template v-if="detail && (canHandle || canReopen)" #footer>
        <template v-if="canHandle">
          <el-button :loading="assignSubmitting" @click="claimReport">领取</el-button>
          <el-button @click="openAssignDialog">指派</el-button>
          <el-button v-if="canStart" type="primary" @click="openStartDialog">开始处理</el-button>
          <el-button type="success" @click="openResolveDialog">成立结案</el-button>
          <el-button type="danger" @click="openRejectDialog">驳回结案</el-button>
        </template>
        <el-button v-if="canReopen" type="warning" @click="openReopenDialog">重新打开</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="assignVisible"
      title="指派工单"
      width="480px"
      destroy-on-close
      @closed="closeAssignDialog"
    >
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="处理人 ID" required>
          <el-input v-model="assignForm.assigneeId" clearable placeholder="请输入管理员 ID" />
        </el-form-item>
        <el-form-item label="指派原因" required>
          <el-input
            v-model="assignForm.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="请填写指派原因"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeAssignDialog">取消</el-button>
        <el-button type="primary" :loading="assignSubmitting" @click="submitAssign">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="rejectVisible"
      title="驳回并结案"
      width="520px"
      destroy-on-close
      @closed="closeRejectDialog"
    >
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="驳回原因" required>
          <el-input
            v-model="rejectForm.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="请填写驳回原因"
          />
        </el-form-item>
        <el-form-item label="结案结论">
          <el-input
            v-model="rejectForm.conclusion"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="可选"
          />
        </el-form-item>
        <el-form-item label="处置动作">
          <el-select
            v-model="rejectForm.disposeActions"
            multiple
            clearable
            collapse-tags
            collapse-tags-tooltip
            placeholder="可选"
            style="width: 100%"
          >
            <el-option
              v-for="item in disposeActionOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关联工单">
          <el-input v-model="rejectForm.ticketNo" clearable placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeRejectDialog">取消</el-button>
        <el-button type="danger" :loading="rejectSubmitting" @click="submitReject">确定驳回</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="resolveVisible"
      title="成立并结案"
      width="520px"
      destroy-on-close
      @closed="closeResolveDialog"
    >
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="结案原因" required>
          <el-input
            v-model="resolveForm.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="请填写结案原因"
          />
        </el-form-item>
        <el-form-item label="结案结论">
          <el-input
            v-model="resolveForm.conclusion"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="可选"
          />
        </el-form-item>
        <el-form-item label="处置动作">
          <el-select
            v-model="resolveForm.disposeActions"
            multiple
            clearable
            collapse-tags
            collapse-tags-tooltip
            placeholder="可选"
            style="width: 100%"
          >
            <el-option
              v-for="item in disposeActionOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关联工单">
          <el-input v-model="resolveForm.ticketNo" clearable placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeResolveDialog">取消</el-button>
        <el-button type="success" :loading="resolveSubmitting" @click="submitResolve">确定结案</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="startVisible"
      title="开始处理"
      width="480px"
      destroy-on-close
      @closed="closeStartDialog"
    >
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="处理原因" required>
          <el-input
            v-model="startForm.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="请填写开始处理原因"
          />
        </el-form-item>
        <el-form-item label="关联工单">
          <el-input v-model="startForm.ticketNo" clearable placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeStartDialog">取消</el-button>
        <el-button type="primary" :loading="startSubmitting" @click="submitStart">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="reopenVisible"
      title="重新打开工单"
      width="520px"
      destroy-on-close
      @closed="closeReopenDialog"
    >
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="重开原因" required>
          <el-input
            v-model="reopenForm.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="请填写重开原因"
          />
        </el-form-item>
        <el-form-item label="结案结论">
          <el-input
            v-model="reopenForm.conclusion"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="可选"
          />
        </el-form-item>
        <el-form-item label="处置动作">
          <el-select
            v-model="reopenForm.disposeActions"
            multiple
            clearable
            collapse-tags
            collapse-tags-tooltip
            placeholder="可选"
            style="width: 100%"
          >
            <el-option
              v-for="item in disposeActionOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关联工单">
          <el-input v-model="reopenForm.ticketNo" clearable placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeReopenDialog">取消</el-button>
        <el-button type="warning" :loading="reopenSubmitting" @click="submitReopen">确定重开</el-button>
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
  padding: 16px;
  background: var(--el-bg-color);
  border-radius: 4px;
}

.tab-search {
  margin-bottom: 12px;

  .search-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px 16px;
    align-items: start;
  }

  .search-operation {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  :deep(.el-form-item) {
    margin-bottom: 0;
  }
}

:deep(.el-table) {
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
  justify-content: flex-end;
  margin-top: 16px;
}

.evidence-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.evidence-item {
  width: 140px;
}

.evidence-image {
  width: 140px;
  height: 140px;
  border-radius: 4px;
}

.evidence-meta,
.note-meta {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.note-editor {
  margin-bottom: 16px;
}

.note-editor-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.note-content {
  margin-bottom: 4px;
  line-height: 1.5;
}
</style>
