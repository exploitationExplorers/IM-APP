<script setup lang="ts">
import { onMounted, reactive, shallowRef, watch } from "vue";
import { ElMessage } from "element-plus";
import { Download, Plus, RefreshLeft } from "@element-plus/icons-vue";

import { AdminExports, getAdminExportTasksApi, postAdminCreateExportTaskApi } from "@/api/modules/exports";

type ExportResource = "users" | "groups" | "reports";

const resourceLabelMap: Record<ExportResource, string> = {
  users: "用户",
  groups: "群组",
  reports: "举报",
};

interface ExportFilters {
  resource: "" | ExportResource;
  status: string;
}

const filters = reactive<ExportFilters>({ resource: "", status: "" });
const currentPage = shallowRef(1);
const pageSize = shallowRef(20);
const total = shallowRef(0);
const tableLoading = shallowRef(false);
const tasks = shallowRef<AdminExports.ExportTaskItem[]>([]);

const createVisible = shallowRef(false);
const createLoading = shallowRef(false);
const createForm = reactive<{ resource: ExportResource; filters: string }>({
  resource: "users",
  filters: "",
});

function normalizeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === 0) return "0";
  if (value) return String(value);
  return "";
}

function pickStatusTagType(status: string): "success" | "danger" | "warning" | "primary" | "info" {
  const text = status.toLowerCase();
  if (text.includes("finish") || text.includes("success") || text.includes("done") || text.includes("complete")) return "success";
  if (text.includes("fail") || text.includes("error")) return "danger";
  if (text.includes("pending") || text.includes("wait") || text.includes("queue")) return "warning";
  if (text.includes("run") || text.includes("process") || text.includes("doing")) return "primary";
  return "info";
}

function formatResource(value: string): string {
  const v = value.toLowerCase() as ExportResource;
  return resourceLabelMap[v] ?? value;
}

function canDownload(task: AdminExports.ExportTaskItem): boolean {
  return Boolean(task.fileUrl && task.fileUrl.trim());
}

function downloadFile(task: AdminExports.ExportTaskItem): void {
  if (!task.fileUrl) return;
  window.open(task.fileUrl, "_blank", "noopener,noreferrer");
}

function openCreateDialog(): void {
  createForm.resource = "users";
  createForm.filters = "";
  createVisible.value = true;
}

function resetFilters(): void {
  filters.resource = "";
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
    const res = await getAdminExportTasksApi({
      page: currentPage.value,
      size: pageSize.value,
    });

    let items = res.data?.items ?? [];

    if (filters.resource) {
      items = items.filter((item) => normalizeString(item.resource).toLowerCase() === filters.resource);
    }
    if (filters.status.trim()) {
      const keyword = filters.status.trim().toLowerCase();
      items = items.filter((item) => normalizeString(item.status).toLowerCase().includes(keyword));
    }

    tasks.value = items;
    total.value = res.data?.total ?? items.length;
  } catch {
    tasks.value = [];
    total.value = 0;
  } finally {
    tableLoading.value = false;
  }
}

async function submitCreate(): Promise<void> {
  const filtersText = createForm.filters.trim();
  if (filtersText) {
    try {
      JSON.parse(filtersText);
    } catch {
      ElMessage.warning("filters 必须是合法 JSON 字符串");
      return;
    }
  }

  createLoading.value = true;
  try {
    await postAdminCreateExportTaskApi({
      resource: createForm.resource,
      filters: filtersText || undefined,
    });
    ElMessage.success("导出任务已提交");
    createVisible.value = false;
    currentPage.value = 1;
    fetchTasks();
  } catch {
    // ignored
  } finally {
    createLoading.value = false;
  }
}

onMounted(() => {
  fetchTasks();
});

watch([currentPage, pageSize], () => {
  fetchTasks();
});
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent="applyFilters">
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.resource" clearable placeholder="资源类型" @change="applyFilters">
                <el-option label="用户" value="users" />
                <el-option label="群组" value="groups" />
                <el-option label="举报" value="reports" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-input v-model="filters.status" clearable placeholder="状态关键字" @keyup.enter="applyFilters" />
            </el-form-item>
          </div>
          <div class="search-operation">
            <el-button type="primary" @click="applyFilters">搜索</el-button>
            <el-button :icon="RefreshLeft" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <div class="table-header">
        <div class="header-button-lf">
          <el-button type="primary" :icon="Plus" @click="openCreateDialog">创建导出任务</el-button>
        </div>
      </div>

      <el-table v-loading="tableLoading" :data="tasks" style="width: 100%">
        <el-table-column label="任务ID" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono-text">{{ row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="资源" min-width="120">
          <template #default="{ row }">
            <el-tag effect="plain" round>{{ formatResource(row.resource) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="120">
          <template #default="{ row }">
            <el-tag :type="pickStatusTagType(normalizeString(row.status))" effect="light">
              {{ row.status || "—" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" min-width="180" />
        <el-table-column prop="finishedAt" label="完成时间" min-width="180" />
        <el-table-column prop="expireAt" label="过期时间" min-width="180" />
        <el-table-column label="筛选条件" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono-text">{{ row.filters || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="文件" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="Download" :disabled="!canDownload(row)" @click="downloadFile(row)">
              下载
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

    <el-dialog v-model="createVisible" title="创建导出任务" width="min(620px, calc(100% - 32px))" destroy-on-close>
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="导出资源">
          <el-select v-model="createForm.resource" placeholder="请选择导出资源">
            <el-option label="用户(users)" value="users" />
            <el-option label="群组(groups)" value="groups" />
            <el-option label="举报(reports)" value="reports" />
          </el-select>
        </el-form-item>
        <el-form-item label="filters">
          <el-input
            v-model="createForm.filters"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 10 }"
            placeholder='可选，JSON 字符串，如：{"status":"active"}'
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button :disabled="createLoading" @click="createVisible = false">取消</el-button>
          <el-button type="primary" :loading="createLoading" @click="submitCreate">确定</el-button>
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

.mono-text {
  font-family: "Courier New", monospace;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
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
}
</style>
