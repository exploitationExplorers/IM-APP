<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CircleClose, RefreshLeft, RefreshRight, Search, View } from "@element-plus/icons-vue";
import ForwardDeliverySettingsCard from "./ForwardDeliverySettingsCard.vue";
import ForwardQueueOverview from "./ForwardQueueOverview.vue";

import {
  AdminForwardRisk,
  getAdminForwardTaskDetailApi,
  getAdminForwardTaskFailuresApi,
  getAdminForwardTaskTargetsApi,
  getAdminForwardSettingsApi,
  getAdminForwardQueueMetricsApi,
  getAdminForwardTasksApi,
  postAdminCancelForwardTaskApi,
  postAdminRetryFailedForwardTargetsApi,
  putAdminForwardSettingsApi,
} from "@/api/modules/forwardRisk";

type TaskStatus = AdminForwardRisk.ForwardTaskStatus;
type TargetStatus = AdminForwardRisk.ForwardTargetStatus;
type ForwardSettings = AdminForwardRisk.ForwardSettings;

const STATUS_LABEL_MAP: Record<TaskStatus, string> = {
  pending: "待处理",
  processing: "处理中",
  draft: "草稿",
  expanding: "展开目标中",
  retrying: "重试中",
  partially_completed: "部分完成",
  paused: "已暂停",
  success: "已完成",
  completed: "已完成",
  failed: "失败",
  cancelled: "已终止",
};

interface Filters {
  status: "" | TaskStatus;
}

const filters = reactive<Filters>({ status: "" });
const currentPage = shallowRef(1);
const pageSize = shallowRef(20);
const total = shallowRef(0);
const tableLoading = shallowRef(false);
const tasks = shallowRef<AdminForwardRisk.ForwardTask[]>([]);

const detailVisible = shallowRef(false);
const detailLoading = shallowRef(false);
const selectedTask = shallowRef<AdminForwardRisk.ForwardTask | null>(null);
const activeDetailTab = shallowRef<"base" | "targets" | "failures">("base");

const targetsLoading = shallowRef(false);
const targetStatus = shallowRef<"" | TargetStatus>("");
const targetsPage = shallowRef(1);
const targetsPageSize = shallowRef(20);
const targetsTotal = shallowRef(0);
const targets = shallowRef<AdminForwardRisk.ForwardTarget[]>([]);

const failuresLoading = shallowRef(false);
const failures = shallowRef<AdminForwardRisk.ForwardTaskFailureStat[]>([]);

const settingsLoading = shallowRef(false);
const settingsSaving = shallowRef(false);
const forwardSettings = shallowRef<ForwardSettings>({
  globalQps: 20, workerConcurrency: 4, claimBatchSize: 50, perUserConcurrency: 2,
  retryBaseSeconds: 2, retryMaxSeconds: 300, processingLockSeconds: 300,
  queuePaused: false, retentionDays: 30, queueAlertDepth: 100000,
});
const forwardSettingsInitial = shallowRef<ForwardSettings | null>(null);
const queueMetrics = shallowRef<AdminForwardRisk.ForwardQueueMetrics | null>(null);
const queueMetricsLoading = shallowRef(false);

async function fetchQueueMetrics(): Promise<void> {
  queueMetricsLoading.value = true;
  try { queueMetrics.value = (await getAdminForwardQueueMetricsApi()).data ?? null; }
  finally { queueMetricsLoading.value = false; }
}

const forwardSettingsChanged = computed(() => {
  if (!forwardSettingsInitial.value) return false;
  return JSON.stringify(forwardSettings.value) !== JSON.stringify(forwardSettingsInitial.value);
});

function snapshotForwardSettings(): ForwardSettings {
  return {
    ...forwardSettings.value,
  };
}

function applyForwardSettings(value: ForwardSettings): void {
  forwardSettings.value = { ...value };
}

function validateForwardSettings(): string | null {
  const s = forwardSettings.value;
  if ([s.globalQps, s.workerConcurrency, s.claimBatchSize, s.perUserConcurrency, s.retryBaseSeconds,
    s.retryMaxSeconds, s.processingLockSeconds, s.retentionDays, s.queueAlertDepth].some((value) => value < 1)) return "调度参数必须大于 0";
  if (s.retryMaxSeconds < s.retryBaseSeconds) return "最大重试间隔不能小于初始重试间隔";
  return null;
}

async function fetchForwardSettings(): Promise<void> {
  settingsLoading.value = true;
  try {
    const res = await getAdminForwardSettingsApi();
    if (res.data) {
      applyForwardSettings(res.data);
      forwardSettingsInitial.value = { ...res.data };
    } else {
      forwardSettingsInitial.value = snapshotForwardSettings();
    }
  } catch {
    forwardSettingsInitial.value = null;
  } finally {
    settingsLoading.value = false;
  }
}

function resetForwardSettings(): void {
  if (!forwardSettingsInitial.value) return;
  applyForwardSettings(forwardSettingsInitial.value);
}

async function saveForwardSettings(): Promise<void> {
  const error = validateForwardSettings();
  if (error) {
    ElMessage.error(error);
    return;
  }
  if (!forwardSettingsInitial.value || !forwardSettingsChanged.value) return;

  const reason = await promptReason("修改转发调度与可靠性配置");
  if (!reason) return;

  settingsSaving.value = true;
  const rollback = forwardSettingsInitial.value ? { ...forwardSettingsInitial.value } : snapshotForwardSettings();
  try {
    await putAdminForwardSettingsApi({ reason, settings: snapshotForwardSettings() });
    forwardSettingsInitial.value = snapshotForwardSettings();
    ElMessage.success("已保存");
  } catch {
    applyForwardSettings(rollback);
  } finally {
    settingsSaving.value = false;
  }
}

const canCancelSelected = computed(() => {
  const status = selectedTask.value?.status;
  return status === "pending" || status === "processing";
});

const canRetrySelected = computed(() => {
  const count = selectedTask.value?.failedCount ?? 0;
  return count > 0;
});

function pickStatusTagType(status: TaskStatus): "success" | "danger" | "warning" | "primary" | "info" {
  const map: Record<TaskStatus, "success" | "danger" | "warning" | "primary" | "info"> = {
    pending: "warning",
    processing: "primary",
    draft: "info",
    expanding: "primary",
    retrying: "warning",
    partially_completed: "warning",
    paused: "info",
    success: "success",
    completed: "success",
    failed: "danger",
    cancelled: "info",
  };
  return map[status] ?? "info";
}

function formatTime(value?: string | null): string {
  if (!value) return "—";
  return value.replace("T", " ").replace(/\.\d+/, "").replace(/\+08:00$/, "");
}

function formatTaskStatus(status: unknown): string {
  const key = status as TaskStatus;
  return (STATUS_LABEL_MAP[key] ?? String(status ?? "")) || "—";
}

function resetFilters(): void {
  filters.status = "";
  currentPage.value = 1;
  fetchTasks();
}

function applyFilters(): void {
  currentPage.value = 1;
  fetchTasks();
}

async function fetchTasks(): Promise<void> {
  tableLoading.value = true;
  try {
    const res = await getAdminForwardTasksApi({
      page: currentPage.value,
      size: pageSize.value,
      status: filters.status || undefined,
    });

    tasks.value = res.data?.items ?? [];
    total.value = res.data?.total ?? 0;
  } catch {
    tasks.value = [];
    total.value = 0;
  } finally {
    tableLoading.value = false;
  }
}

async function fetchDetail(id: string): Promise<void> {
  selectedTask.value = null;
  detailLoading.value = true;
  try {
    const res = await getAdminForwardTaskDetailApi(id);
    selectedTask.value = res.data ?? null;
  } catch {
    selectedTask.value = null;
  } finally {
    detailLoading.value = false;
  }
}

async function fetchTargets(): Promise<void> {
  const id = selectedTask.value?.id;
  if (!id) return;
  targetsLoading.value = true;
  try {
    const res = await getAdminForwardTaskTargetsApi(id, {
      page: targetsPage.value,
      size: targetsPageSize.value,
      status: targetStatus.value || undefined,
    });
    targets.value = res.data?.items ?? [];
    targetsTotal.value = res.data?.total ?? 0;
  } catch {
    targets.value = [];
    targetsTotal.value = 0;
  } finally {
    targetsLoading.value = false;
  }
}

async function fetchFailures(): Promise<void> {
  const id = selectedTask.value?.id;
  if (!id) return;
  failuresLoading.value = true;
  try {
    const res = await getAdminForwardTaskFailuresApi(id);
    failures.value = Array.isArray(res.data) ? res.data : [];
  } catch {
    failures.value = [];
  } finally {
    failuresLoading.value = false;
  }
}

async function openDetail(row: AdminForwardRisk.ForwardTask): Promise<void> {
  detailVisible.value = true;
  activeDetailTab.value = "base";
  targetsPage.value = 1;
  targetsPageSize.value = 20;
  targetsTotal.value = 0;
  targetStatus.value = "";
  targets.value = [];
  failures.value = [];
  await fetchDetail(row.id);
}

async function promptReason(title: string): Promise<string | null> {
  try {
    const res = await ElMessageBox.prompt("请输入操作原因", title, {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputType: "textarea",
      inputPlaceholder: "原因（必填）",
      inputValidator: (value) => {
        if (String(value ?? "").trim()) return true;
        return "请输入原因";
      },
      inputErrorMessage: "请输入原因",
    });
    return String(res.value ?? "").trim() || null;
  } catch {
    return null;
  }
}

async function cancelTask(task: AdminForwardRisk.ForwardTask): Promise<void> {
  const reason = await promptReason("终止任务");
  if (!reason) return;
  try {
    const res = await postAdminCancelForwardTaskApi(task.id, { reason });
    if (res.data?.ok) ElMessage.success("已终止");
    await fetchTasks();
    if (detailVisible.value && selectedTask.value?.id === task.id) {
      await fetchDetail(task.id);
      if (activeDetailTab.value === "targets") await fetchTargets();
      if (activeDetailTab.value === "failures") await fetchFailures();
    }
  } catch {
  }
}

async function retryFailedTargets(task: AdminForwardRisk.ForwardTask): Promise<void> {
  const reason = await promptReason("重试失败目标");
  if (!reason) return;
  try {
    const res = await postAdminRetryFailedForwardTargetsApi(task.id, { reason });
    ElMessage.success(`已触发重试 ${res.data?.retried ?? 0} 条`);
    await fetchTasks();
    if (detailVisible.value && selectedTask.value?.id === task.id) {
      await fetchDetail(task.id);
      if (activeDetailTab.value === "targets") await fetchTargets();
      if (activeDetailTab.value === "failures") await fetchFailures();
    }
  } catch {
  }
}

onMounted(() => {
  fetchForwardSettings();
  fetchQueueMetrics();
  fetchTasks();
});

watch([currentPage, pageSize], () => {
  fetchTasks();
});

watch(detailVisible, (visible) => {
  if (!visible) {
    selectedTask.value = null;
    activeDetailTab.value = "base";
    targetsPage.value = 1;
    targetsTotal.value = 0;
    targetStatus.value = "";
    targets.value = [];
    failures.value = [];
  }
});

watch([targetStatus, targetsPage, targetsPageSize], () => {
  if (!detailVisible.value) return;
  if (activeDetailTab.value !== "targets") return;
  fetchTargets();
});

watch(activeDetailTab, () => {
  if (!detailVisible.value) return;
  if (!selectedTask.value?.id) return;
  if (activeDetailTab.value === "targets") fetchTargets();
  if (activeDetailTab.value === "failures") fetchFailures();
});
</script>

<template>
  <div class="table-box">
    <ForwardQueueOverview :metrics="queueMetrics" :loading="queueMetricsLoading" @refresh="fetchQueueMetrics" />
    <ForwardDeliverySettingsCard v-model="forwardSettings" :loading="settingsLoading" :saving="settingsSaving"
      :changed="forwardSettingsChanged" @refresh="fetchForwardSettings" @reset="resetForwardSettings" @save="saveForwardSettings" />

    <section class="card table-search">
      <el-form :model="filters" @submit.prevent="applyFilters">
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.status" clearable placeholder="任务状态" @change="applyFilters">
                <el-option label="待处理" value="pending" />
                <el-option label="处理中" value="processing" />
                <el-option label="已完成" value="completed" />
                <el-option label="失败" value="failed" />
                <el-option label="已终止" value="cancelled" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-operation">
            <el-button type="primary" :icon="Search" @click="applyFilters">搜索</el-button>
            <el-button :icon="RefreshLeft" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <el-table v-loading="tableLoading" :data="tasks" style="width: 100%">
        <el-table-column label="任务ID" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono-text">{{ row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="用户ID" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono-text">{{ row.userId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="110">
          <template #default="{ row }">
            <el-tag :type="pickStatusTagType(row.status as TaskStatus)" effect="light">
              {{ formatTaskStatus(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="是否重复" min-width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.isDuplicate ? 'warning' : 'info'" size="small" effect="plain">
              {{ row.isDuplicate ? "是" : "否" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="目标/成功/失败/跳过" min-width="170" align="center">
          <template #default="{ row }">
            <span class="count-target">{{ row.targetCount ?? 0 }}</span>
            <span class="count-sep">/</span>
            <span class="count-success">{{ row.successCount ?? 0 }}</span>
            <span class="count-sep">/</span>
            <span class="count-fail">{{ row.failedCount ?? 0 }}</span>
            <span class="count-sep">/</span>
            <span class="count-skip">{{ row.skippedCount ?? 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="完成时间" min-width="180">
          <template #default="{ row }">{{ formatTime(row.finishedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="View" @click="openDetail(row)">详情</el-button>
            <el-button
              v-if="row.status === 'pending' || row.status === 'processing'"
              link
              type="danger"
              :icon="CircleClose"
              @click="cancelTask(row)"
            >
              终止
            </el-button>
            <el-button v-if="(row.failedCount ?? 0) > 0" link type="primary" :icon="RefreshRight" @click="retryFailedTargets(row)">
              重试失败
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-footer">
        <el-pagination
          background
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
        />
      </div>
    </section>

    <el-dialog v-model="detailVisible" title="转发任务详情" width="min(980px, calc(100% - 32px))" destroy-on-close>
      <div v-loading="detailLoading">
        <template v-if="selectedTask">
          <div class="detail-ops">
            <el-button
              v-if="canCancelSelected"
              type="danger"
              plain
              :icon="CircleClose"
              @click="cancelTask(selectedTask)"
            >
              终止任务
            </el-button>
            <el-button
              v-if="canRetrySelected"
              type="primary"
              plain
              :icon="RefreshRight"
              @click="retryFailedTargets(selectedTask)"
            >
              重试失败目标
            </el-button>
          </div>

          <el-tabs v-model="activeDetailTab" class="detail-tabs">
            <el-tab-pane label="基本信息" name="base">
              <el-descriptions :column="2" border>
                <el-descriptions-item label="任务ID">
                  <span class="mono-text">{{ selectedTask.id }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="用户ID">
                  <span class="mono-text">{{ selectedTask.userId }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="状态">
                  <el-tag :type="pickStatusTagType(selectedTask.status)" effect="light">
                    {{ formatTaskStatus(selectedTask.status) }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="是否重复">
                  <el-tag :type="selectedTask.isDuplicate ? 'warning' : 'info'" size="small" effect="plain">
                    {{ selectedTask.isDuplicate ? "是" : "否" }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="目标数">{{ selectedTask.targetCount ?? 0 }}</el-descriptions-item>
                <el-descriptions-item label="成功数">{{ selectedTask.successCount ?? 0 }}</el-descriptions-item>
                <el-descriptions-item label="失败数">{{ selectedTask.failedCount ?? 0 }}</el-descriptions-item>
                <el-descriptions-item label="跳过数">{{ selectedTask.skippedCount ?? 0 }}</el-descriptions-item>
                <el-descriptions-item label="创建时间" :span="2">{{ formatTime(selectedTask.createdAt) }}</el-descriptions-item>
                <el-descriptions-item label="完成时间" :span="2">{{ formatTime(selectedTask.finishedAt) }}</el-descriptions-item>
              </el-descriptions>
            </el-tab-pane>
            <el-tab-pane label="目标明细" name="targets">
              <div class="detail-filter">
                <el-select v-model="targetStatus" clearable placeholder="目标状态" @change="targetsPage = 1">
                  <el-option label="待发送" value="pending" />
                  <el-option label="已送达" value="success" />
                  <el-option label="失败" value="failed" />
                  <el-option label="已跳过" value="skipped" />
                  <el-option label="已取消" value="cancelled" />
                </el-select>
              </div>
              <el-table v-loading="targetsLoading" :data="targets" style="width: 100%">
                <el-table-column label="目标ID" min-width="220" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span class="mono-text">{{ row.id }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="目标" min-width="220" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.peerType === "group" ? "群 " : "用户 " }}{{ row.userId }}</template>
                </el-table-column>
                <el-table-column prop="nickname" label="昵称" min-width="120" show-overflow-tooltip />
                <el-table-column label="状态" min-width="110">
                  <template #default="{ row }">
                    <el-tag :type="row.status === 'success' ? 'success' : row.status === 'failed' ? 'danger' : 'info'" effect="light">
                      {{
                        row.status === "pending"
                          ? "待发送"
                          : row.status === "success"
                            ? "已送达"
                            : row.status === "failed"
                              ? "失败"
                              : row.status === "skipped"
                                ? "已跳过"
                                : row.status === "cancelled"
                                  ? "已取消"
                                  : row.status || "—"
                      }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="尝试次数" width="100" align="center">
                  <template #default="{ row }">{{ row.attempts ?? 0 }}</template>
                </el-table-column>
                <el-table-column label="完成时间" min-width="180">
                  <template #default="{ row }">{{ formatTime(row.finishedAt) }}</template>
                </el-table-column>
              </el-table>
              <div class="table-footer">
                <el-pagination
                  background
                  v-model:current-page="targetsPage"
                  v-model:page-size="targetsPageSize"
                  :page-sizes="[10, 20, 50, 100]"
                  layout="total, sizes, prev, pager, next, jumper"
                  :total="targetsTotal"
                />
              </div>
            </el-tab-pane>
            <el-tab-pane label="失败原因统计" name="failures">
              <el-table v-loading="failuresLoading" :data="failures" style="width: 100%">
                <el-table-column label="失败码" min-width="200" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.failCode || "—" }}</template>
                </el-table-column>
                <el-table-column label="数量" width="120" align="center">
                  <template #default="{ row }">{{ row.count ?? 0 }}</template>
                </el-table-column>
                <el-table-column label="原因/说明" min-width="260" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.reason || row.message || "—" }}</template>
                </el-table-column>
              </el-table>
              <el-empty v-if="!failuresLoading && !failures.length" description="暂无失败原因数据" />
            </el-tab-pane>
          </el-tabs>
        </template>
        <template v-else>
          <el-empty description="暂无详情数据" />
        </template>
      </div>
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
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

.settings-card {
  padding: 18px 18px 0;
  margin-bottom: 10px;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.settings-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.settings-ops {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.settings-ops .el-button {
  margin-left: 0;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
}

.settings-grid :deep(.el-form-item) {
  margin-bottom: 18px;
}

.settings-grid :deep(.el-form-item__content > *) {
  width: 100%;
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

.mono-text {
  font-family: "Courier New", monospace;
}

.detail-ops {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.detail-filter {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-bottom: 12px;
}

.detail-filter :deep(.el-select) {
  width: min(260px, 100%);
}

.count-target {
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.count-success {
  color: var(--el-color-success);
  font-weight: 600;
}

.count-fail {
  color: var(--el-color-danger);
  font-weight: 600;
}

.count-skip {
  color: var(--el-color-warning);
  font-weight: 600;
}

.count-sep {
  margin: 0 4px;
  color: var(--el-text-color-secondary);
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
