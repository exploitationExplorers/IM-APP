<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CircleClose, RefreshLeft, RefreshRight, Search, View } from "@element-plus/icons-vue";

import {
  AdminForwardRisk,
  getAdminForwardTaskDetailApi,
  getAdminForwardTaskFailuresApi,
  getAdminForwardTaskTargetsApi,
  getAdminForwardSettingsApi,
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
  success: "已完成",
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
const forwardSettings = reactive<ForwardSettings>({
  defaultDailyLimit: 0,
  defaultHourlyLimit: 0,
  defaultSingleTargets: 0,
  maxSingleTargets: 0,
});
const forwardSettingsInitial = shallowRef<ForwardSettings | null>(null);

const forwardSettingsChanged = computed(() => {
  if (!forwardSettingsInitial.value) return false;
  return (
    forwardSettings.defaultDailyLimit !== forwardSettingsInitial.value.defaultDailyLimit ||
    forwardSettings.defaultHourlyLimit !== forwardSettingsInitial.value.defaultHourlyLimit ||
    forwardSettings.defaultSingleTargets !== forwardSettingsInitial.value.defaultSingleTargets ||
    forwardSettings.maxSingleTargets !== forwardSettingsInitial.value.maxSingleTargets
  );
});

function snapshotForwardSettings(): ForwardSettings {
  return {
    defaultDailyLimit: Number(forwardSettings.defaultDailyLimit ?? 0),
    defaultHourlyLimit: Number(forwardSettings.defaultHourlyLimit ?? 0),
    defaultSingleTargets: Number(forwardSettings.defaultSingleTargets ?? 0),
    maxSingleTargets: Number(forwardSettings.maxSingleTargets ?? 0),
  };
}

function applyForwardSettings(value: ForwardSettings): void {
  forwardSettings.defaultDailyLimit = Number(value.defaultDailyLimit ?? 0);
  forwardSettings.defaultHourlyLimit = Number(value.defaultHourlyLimit ?? 0);
  forwardSettings.defaultSingleTargets = Number(value.defaultSingleTargets ?? 0);
  forwardSettings.maxSingleTargets = Number(value.maxSingleTargets ?? 0);
}

function validateForwardSettings(): string | null {
  if (forwardSettings.defaultDailyLimit < 0) return "默认每日上限不能小于 0";
  if (forwardSettings.defaultHourlyLimit < 0) return "默认每小时上限不能小于 0";
  if (forwardSettings.defaultSingleTargets < 0) return "默认单次目标数不能小于 0";
  if (forwardSettings.maxSingleTargets < 0) return "单次目标数上限不能小于 0";
  if (forwardSettings.defaultSingleTargets > forwardSettings.maxSingleTargets) return "默认单次目标数不能大于单次目标数上限";
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

  const reason = await promptReason("修改全局转发规则");
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
    success: "success",
    failed: "danger",
    cancelled: "info",
  };
  return map[status] ?? "info";
}

function formatTaskStatus(status: unknown): string {
  const key = status as TaskStatus;
  return (STATUS_LABEL_MAP[key] ?? String(status ?? "")) || "—";
}

function pickRiskTagType(riskLevel: string): "success" | "danger" | "warning" | "primary" | "info" {
  const v = String(riskLevel ?? "").toLowerCase();
  if (!v) return "info";
  if (v.includes("high") || v.includes("danger") || v.includes("严重") || v === "3") return "danger";
  if (v.includes("mid") || v.includes("medium") || v.includes("warn") || v.includes("中") || v === "2") return "warning";
  if (v.includes("low") || v.includes("safe") || v.includes("低") || v === "1") return "success";
  return "info";
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
    failures.value = res.data ?? [];
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
    <section class="card settings-card" v-loading="settingsLoading">
      <div class="settings-header">
        <div class="settings-title">全局转发规则</div>
        <div class="settings-ops">
          <el-button :disabled="settingsSaving" @click="fetchForwardSettings">刷新</el-button>
          <el-button :disabled="!forwardSettingsChanged || settingsSaving" @click="resetForwardSettings">还原</el-button>
          <el-button type="primary" :loading="settingsSaving" :disabled="!forwardSettingsChanged" @click="saveForwardSettings">
            保存
          </el-button>
        </div>
      </div>

      <el-form :model="forwardSettings" label-width="140px">
        <div class="settings-grid">
          <el-form-item label="默认每日上限">
            <el-input-number v-model="forwardSettings.defaultDailyLimit" :min="0" controls-position="right" />
          </el-form-item>
          <el-form-item label="默认每小时上限">
            <el-input-number v-model="forwardSettings.defaultHourlyLimit" :min="0" controls-position="right" />
          </el-form-item>
          <el-form-item label="默认单次目标数">
            <el-input-number v-model="forwardSettings.defaultSingleTargets" :min="0" controls-position="right" />
          </el-form-item>
          <el-form-item label="单次目标数上限">
            <el-input-number v-model="forwardSettings.maxSingleTargets" :min="0" controls-position="right" />
          </el-form-item>
        </div>
      </el-form>
    </section>

    <section class="card table-search">
      <el-form :model="filters" @submit.prevent="applyFilters">
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.status" clearable placeholder="任务状态" @change="applyFilters">
                <el-option label="待处理" value="pending" />
                <el-option label="处理中" value="processing" />
                <el-option label="已完成" value="success" />
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
        <el-table-column prop="contentSummary" label="内容摘要" min-width="220" show-overflow-tooltip />
        <el-table-column label="内容类型" min-width="120">
          <template #default="{ row }">
            <el-tag effect="plain" round>{{ row.contentType || "—" }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="风险等级" min-width="120">
          <template #default="{ row }">
            <el-tag :type="pickRiskTagType(row.riskLevel)" effect="light">{{ row.riskLevel || "—" }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="120">
          <template #default="{ row }">
            <el-tag :type="pickStatusTagType(row.status as TaskStatus)" effect="light">
              {{ formatTaskStatus(row.status) }}
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
        <el-table-column prop="createdAt" label="创建时间" min-width="180" />
        <el-table-column prop="finishedAt" label="完成时间" min-width="180" />
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
                <el-descriptions-item label="内容类型">{{ selectedTask.contentType || "—" }}</el-descriptions-item>
                <el-descriptions-item label="风险等级">
                  <el-tag :type="pickRiskTagType(selectedTask.riskLevel)" effect="light">
                    {{ selectedTask.riskLevel || "—" }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="状态" :span="2">
                  <el-tag :type="pickStatusTagType(selectedTask.status)" effect="light">
                    {{ formatTaskStatus(selectedTask.status) }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="内容摘要" :span="2">{{ selectedTask.contentSummary || "—" }}</el-descriptions-item>
                <el-descriptions-item label="目标数">{{ selectedTask.targetCount ?? 0 }}</el-descriptions-item>
                <el-descriptions-item label="成功数">{{ selectedTask.successCount ?? 0 }}</el-descriptions-item>
                <el-descriptions-item label="失败数">{{ selectedTask.failedCount ?? 0 }}</el-descriptions-item>
                <el-descriptions-item label="跳过数">{{ selectedTask.skippedCount ?? 0 }}</el-descriptions-item>
                <el-descriptions-item label="创建时间" :span="2">{{ selectedTask.createdAt || "—" }}</el-descriptions-item>
                <el-descriptions-item label="完成时间" :span="2">{{ selectedTask.finishedAt || "—" }}</el-descriptions-item>
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
                <el-table-column prop="userId" label="用户ID" min-width="220" show-overflow-tooltip />
                <el-table-column prop="nickname" label="昵称" min-width="120" show-overflow-tooltip />
                <el-table-column label="状态" min-width="120">
                  <template #default="{ row }">
                    <el-tag effect="light">
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
                <el-table-column prop="attempts" label="重试次数" width="100" align="center" />
                <el-table-column label="失败码" min-width="120" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.failCode || "—" }}</template>
                </el-table-column>
                <el-table-column prop="finishedAt" label="完成时间" min-width="170" />
                <el-table-column prop="messageId" label="消息ID" min-width="220" show-overflow-tooltip />
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
