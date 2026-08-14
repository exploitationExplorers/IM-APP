<script setup lang="ts">
import { onMounted, reactive, shallowRef, watch } from "vue";
import { ElMessage } from "element-plus";
import { Download, RefreshLeft, Search } from "@element-plus/icons-vue";
import type { Audit } from "../../api/interface";
import { getAuditLogDetail, getAuditLogs } from "../../api/modules/admin";

interface LogFilters {
  keyword: string;
  result: "" | Audit.AuditLogsResult;
  resource: string;
}

const filters = reactive<LogFilters>({ keyword: "", result: "", resource: "" });
const currentPage = shallowRef(1);
const pageSize = shallowRef(10);
const total = shallowRef(0);
const loading = shallowRef(false);
const logs = shallowRef<Audit.AuditLogsAuditLog[]>([]);

const detailVisible = shallowRef(false);
const detailLoading = shallowRef(false);
const selectedLog = shallowRef<Audit.AuditLogsAuditLog | null>(null);

function formatTime(value?: string): string {
  if (!value) return "-";
  return value.replace("T", " ").replace(/\.\d+/, "").replace(/\+08:00$/, "");
}

function formatTarget(log: Audit.AuditLogsAuditLog): string {
  return [log.resource, log.resourceId].filter(Boolean).join(" / ") || "-";
}

function formatResult(result?: Audit.AuditLogsResult): string {
  if (result === "success") return "成功";
  if (result === "denied") return "权限拒绝";
  if (result === "failed") return "失败";
  return "-";
}

function resultTagType(result?: Audit.AuditLogsResult): "success" | "warning" | "danger" {
  if (result === "success") return "success";
  if (result === "denied") return "warning";
  return "danger";
}

async function loadLogs(): Promise<void> {
  loading.value = true;
  try {
    const params = {
      keyword: filters.keyword.trim() || undefined,
      result: filters.result || undefined,
      resource: filters.resource.trim() || undefined,
      page: currentPage.value,
      size: pageSize.value,
    } as unknown as Audit.AuditLogsRequest;
    const response = await getAuditLogs(params);
    const data = response.data as unknown as Audit.AuditLogsData;
    logs.value = data.items ?? [];
    total.value = data.total ?? 0;
  } catch {
    logs.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function queryLogs(): void {
  currentPage.value = 1;
  void loadLogs();
}

function resetFilters(): void {
  filters.keyword = "";
  filters.result = "";
  filters.resource = "";
  currentPage.value = 1;
  void loadLogs();
}

async function openLogDetail(log: Audit.AuditLogsAuditLog): Promise<void> {
  if (log.id == null) return;
  selectedLog.value = log;
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    const response = await getAuditLogDetail(String(log.id));
    const detail = response.data as unknown as Audit.AuditLogsAuditLog;
    selectedLog.value = { ...log, ...detail };
  } catch {
  } finally {
    detailLoading.value = false;
  }
}

function exportLogs(): void {
  ElMessage.success("日志导出任务已提交");
}

watch([currentPage, pageSize], () => {
  void loadLogs();
});

onMounted(() => {
  void loadLogs();
});
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent>
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-input
                v-model="filters.keyword"
                clearable
                placeholder="操作人/操作类型/目标/IP"
                :prefix-icon="Search"
                @clear="queryLogs"
                @keyup.enter="queryLogs"
              />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-input v-model="filters.resource" clearable placeholder="资源类型" />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.result" clearable placeholder="结果">
                <el-option label="成功" value="success" />
                <el-option label="权限拒绝" value="denied" />
                <el-option label="失败" value="failed" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-operation">
            <el-button type="primary" :icon="Search" @click="queryLogs">搜索</el-button>
            <el-button :icon="RefreshLeft" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <div class="table-header">
        <div class="header-button-lf">
          <el-button type="primary" plain :icon="Download" @click="exportLogs">导出日志</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="logs" style="width: 100%">
        <el-table-column label="操作时间" min-width="175">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作人" min-width="145">
          <template #default="{ row }">{{ row.adminName || "未知管理员" }}</template>
        </el-table-column>
        <el-table-column prop="action" label="操作类型" min-width="170">
          <template #default="{ row }">
            <el-tag effect="plain">{{ row.action || "-" }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作目标" min-width="170">
          <template #default="{ row }">{{ formatTarget(row) }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="操作原因" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.reason || "-" }}</template>
        </el-table-column>
        <el-table-column prop="ip" label="IP 地址" min-width="145" />
        <el-table-column label="结果" min-width="110">
          <template #default="{ row }">
            <el-tag :type="resultTagType(row.result)" effect="light">
              {{ formatResult(row.result) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="详情" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openLogDetail(row)">查看</el-button>
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

    <el-dialog
      v-model="detailVisible"
      v-loading="detailLoading"
      title="操作详情"
      width="min(520px, calc(100% - 32px))"
    >
      <el-descriptions v-if="selectedLog" :column="1" border>
        <el-descriptions-item label="审计 ID">
          {{ selectedLog.id ?? "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="管理员 ID">
          <span class="detail-value">{{ selectedLog.adminId || "-" }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="操作人">
          {{ selectedLog.adminName || "未知管理员" }}
        </el-descriptions-item>
        <el-descriptions-item label="操作类型">
          <span class="detail-value">{{ selectedLog.action || "-" }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="资源类型">
          {{ selectedLog.resource || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="资源 ID">
          <span class="detail-value">{{ selectedLog.resourceId || "-" }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="操作原因">
          <span class="detail-value">{{ selectedLog.reason || "-" }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="IP 地址">{{ selectedLog.ip || "-" }}</el-descriptions-item>
        <el-descriptions-item label="结果">
          <el-tag :type="resultTagType(selectedLog.result)" effect="light">
            {{ formatResult(selectedLog.result) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="请求 ID">
          <span class="detail-value">{{ selectedLog.requestId || "-" }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="User-Agent">
          <span class="detail-value">{{ selectedLog.userAgent || "-" }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="操作时间">
          {{ formatTime(selectedLog.createdAt) }}
        </el-descriptions-item>
      </el-descriptions>
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

.table-header {
  min-height: 40px;

  .header-button-lf {
    display: flex;
    flex-wrap: wrap;
    gap: 15px 12px;
    margin-bottom: 15px;

    .el-button:not(.el-input .el-button) {
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

.detail-value {
  overflow-wrap: anywhere;
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
