<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Download, RefreshLeft, Search } from "@element-plus/icons-vue";

import { getSystemErrorDetailApi, getSystemErrorListApi, SystemErrors } from "@/api/modules/systemErrors";
import { postAdminCreateExportTaskApi } from "@/api/modules/exports";

interface ErrorFilters {
  keyword: string;
  level: string;
  service: string;
}

const router = useRouter();
const filters = reactive<ErrorFilters>({ keyword: "", level: "", service: "" });

const currentPage = shallowRef(1);
const pageSize = shallowRef(20);
const total = shallowRef(0);
const tableLoading = shallowRef(false);
const items = shallowRef<SystemErrors.ErrorEvent[]>([]);

const detailVisible = shallowRef(false);
const detailLoading = shallowRef(false);
const selectedId = shallowRef<number | null>(null);
const detail = shallowRef<SystemErrors.ErrorEvent | null>(null);

const exportVisible = shallowRef(false);
const exportLoading = shallowRef(false);
const exportForm = reactive<{ resource: string }>({ resource: "system_errors" });

const visibleItems = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  const level = filters.level.trim().toLowerCase();
  const service = filters.service.trim().toLowerCase();

  return items.value.filter((row) => {
    const matchesKeyword =
      !keyword ||
      [row.message, row.fingerprint, row.service].some((value) => String(value ?? "").toLowerCase().includes(keyword));
    const matchesLevel = !level || String(row.level ?? "").toLowerCase().includes(level);
    const matchesService = !service || String(row.service ?? "").toLowerCase().includes(service);
    return matchesKeyword && matchesLevel && matchesService;
  });
});

function pickLevelType(level: string): "success" | "danger" | "warning" | "primary" | "info" {
  const text = String(level || "").toLowerCase();
  if (text.includes("fatal") || text.includes("panic")) return "danger";
  if (text.includes("error")) return "danger";
  if (text.includes("warn")) return "warning";
  if (text.includes("info")) return "info";
  if (text.includes("debug") || text.includes("trace")) return "primary";
  return "info";
}

async function fetchList(): Promise<void> {
  tableLoading.value = true;
  try {
    const res = await getSystemErrorListApi({ page: currentPage.value, size: pageSize.value });
    items.value = res.data?.items ?? [];
    total.value = res.data?.total ?? 0;
  } catch {
    items.value = [];
    total.value = 0;
  } finally {
    tableLoading.value = false;
  }
}

function resetFilters(): void {
  filters.keyword = "";
  filters.level = "";
  filters.service = "";
  currentPage.value = 1;
  fetchList();
}

function applyFilters(): void {
  currentPage.value = 1;
  fetchList();
}

async function openDetail(row: SystemErrors.ErrorEvent): Promise<void> {
  selectedId.value = row.id;
  detail.value = null;
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    const res = await getSystemErrorDetailApi(row.id);
    detail.value = res.data ?? null;
  } catch {
    detail.value = null;
  } finally {
    detailLoading.value = false;
  }
}

async function copyText(value: string): Promise<void> {
  const text = value ?? "";
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success("已复制");
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      ElMessage.success("已复制");
    } catch {
      ElMessage.error("复制失败");
    }
  }
}

function openExportDialog(): void {
  exportForm.resource = "system_errors";
  exportVisible.value = true;
}

async function submitExport(): Promise<void> {
  const payload: Record<string, string> = {};
  if (filters.keyword.trim()) payload.keyword = filters.keyword.trim();
  if (filters.level.trim()) payload.level = filters.level.trim();
  if (filters.service.trim()) payload.service = filters.service.trim();

  exportLoading.value = true;
  try {
    await postAdminCreateExportTaskApi({
      resource: exportForm.resource.trim() || "system_errors",
      filters: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
    });

    exportVisible.value = false;
    const go = await ElMessageBox.confirm("导出任务已提交，是否前往「导出任务」查看下载？", "提示", {
      confirmButtonText: "去查看",
      cancelButtonText: "稍后",
      type: "success",
    }).catch(() => false);

    if (go) router.push("/runtime-observe/exports");
  } catch {
    // ignored
  } finally {
    exportLoading.value = false;
  }
}

onMounted(() => {
  fetchList();
});

watch([currentPage, pageSize], () => {
  fetchList();
});
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent="applyFilters">
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-input
                v-model="filters.keyword"
                clearable
                placeholder="消息/指纹/服务 关键字（本页过滤）"
                :prefix-icon="Search"
                @keyup.enter="applyFilters"
                @clear="applyFilters"
              />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-input v-model="filters.service" clearable placeholder="服务（本页过滤）" @keyup.enter="applyFilters" @clear="applyFilters" />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-input v-model="filters.level" clearable placeholder="等级（本页过滤）" @keyup.enter="applyFilters" @clear="applyFilters" />
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
      <div class="table-header">
        <div class="header-button-lf">
          <el-button type="primary" plain :icon="Download" @click="openExportDialog">导出</el-button>
          <el-button :icon="RefreshLeft" @click="fetchList">刷新</el-button>
        </div>
      </div>

      <el-table v-loading="tableLoading" :data="visibleItems" style="width: 100%" @row-dblclick="openDetail">
        <el-table-column prop="id" label="事件ID" min-width="110" />
        <el-table-column label="等级" min-width="120">
          <template #default="{ row }">
            <el-tag :type="pickLevelType(row.level)" effect="light">{{ row.level || "—" }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="service" label="服务" min-width="160" show-overflow-tooltip />
        <el-table-column prop="message" label="消息" min-width="260" show-overflow-tooltip />
        <el-table-column label="指纹" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono-text">{{ row.fingerprint || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="count" label="出现次数" min-width="110" />
        <el-table-column prop="firstAt" label="首次时间" min-width="180" />
        <el-table-column prop="lastAt" label="最后时间" min-width="180" />
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button link @click="copyText(row.fingerprint)">复制指纹</el-button>
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

    <el-drawer v-model="detailVisible" title="运行错误详情" size="min(680px, calc(100% - 24px))">
      <div class="detail-body" v-loading="detailLoading">
        <el-descriptions v-if="detail" :column="1" border>
          <el-descriptions-item label="事件ID">{{ detail.id }}</el-descriptions-item>
          <el-descriptions-item label="等级">
            <el-tag :type="pickLevelType(detail.level)" effect="light">{{ detail.level || "—" }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="服务">{{ detail.service || "—" }}</el-descriptions-item>
          <el-descriptions-item label="指纹">
            <div class="mono-row">
              <span class="mono-text">{{ detail.fingerprint || "—" }}</span>
              <el-button link type="primary" @click="copyText(detail.fingerprint)">复制</el-button>
            </div>
          </el-descriptions-item>
          <el-descriptions-item label="出现次数">{{ detail.count }}</el-descriptions-item>
          <el-descriptions-item label="首次时间">{{ detail.firstAt }}</el-descriptions-item>
          <el-descriptions-item label="最后时间">{{ detail.lastAt }}</el-descriptions-item>
          <el-descriptions-item label="消息">
            <pre class="message-pre">{{ detail.message }}</pre>
          </el-descriptions-item>
        </el-descriptions>
        <el-empty v-else description="暂无详情数据" />
      </div>
    </el-drawer>

    <el-dialog v-model="exportVisible" title="创建导出任务" width="min(560px, calc(100% - 32px))" destroy-on-close>
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="resource">
          <el-input v-model="exportForm.resource" placeholder="例如：system_errors" />
        </el-form-item>
        <el-form-item label="filters">
          <el-input
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 10 }"
            :model-value="
              JSON.stringify(
                {
                  keyword: filters.keyword.trim() || undefined,
                  service: filters.service.trim() || undefined,
                  level: filters.level.trim() || undefined,
                },
                null,
                2,
              )
            "
            readonly
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button :disabled="exportLoading" @click="exportVisible = false">取消</el-button>
          <el-button type="primary" :loading="exportLoading" @click="submitExport">提交导出</el-button>
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

.mono-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.message-pre {
  margin: 0;
  font-family: "Courier New", monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.detail-body {
  min-height: 220px;
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
