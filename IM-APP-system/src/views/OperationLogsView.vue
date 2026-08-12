<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import { ElMessage } from "element-plus";
import { Download, RefreshLeft, Search } from "@element-plus/icons-vue";
import type { OperationLog } from "../types/system";

interface LogFilters {
  keyword: string;
  result: "" | OperationLog["result"];
  action: string;
}

const filters = reactive<LogFilters>({ keyword: "", result: "", action: "" });
const currentPage = shallowRef(1);
const pageSize = shallowRef(10);
const detailVisible = shallowRef(false);
const selectedLog = shallowRef<OperationLog | null>(null);

const logs = shallowRef<OperationLog[]>([
  {
    id: 1,
    operator: "陈安",
    action: "修改用户",
    target: "zhou.miya",
    ip: "10.24.18.32",
    result: "成功",
    createdAt: "2026-08-12 10:41:28",
  },
  {
    id: 2,
    operator: "林诺",
    action: "新增用户",
    target: "huang.yi",
    ip: "10.24.11.85",
    result: "成功",
    createdAt: "2026-08-12 10:06:12",
  },
  {
    id: 3,
    operator: "陈安",
    action: "停用用户",
    target: "wang.lei",
    ip: "10.24.18.32",
    result: "成功",
    createdAt: "2026-08-12 09:52:03",
  },
  {
    id: 4,
    operator: "未知用户",
    action: "登录系统",
    target: "admin",
    ip: "185.22.91.105",
    result: "失败",
    createdAt: "2026-08-12 09:16:48",
  },
  {
    id: 5,
    operator: "系统",
    action: "版本发布",
    target: "IM-APP v1.4.2",
    ip: "127.0.0.1",
    result: "成功",
    createdAt: "2026-08-11 23:40:00",
  },
  {
    id: 6,
    operator: "周米娅",
    action: "登录系统",
    target: "zhou.miya",
    ip: "10.24.8.17",
    result: "成功",
    createdAt: "2026-08-11 20:17:36",
  },
]);

const filteredLogs = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  return logs.value.filter((log) => {
    const matchesKeyword =
      !keyword ||
      [log.operator, log.action, log.target, log.ip].some((value) =>
        value.toLowerCase().includes(keyword),
      );
    const matchesResult = !filters.result || log.result === filters.result;
    const matchesAction = !filters.action || log.action === filters.action;
    return matchesKeyword && matchesResult && matchesAction;
  });
});

const pageLogs = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredLogs.value.slice(start, start + pageSize.value);
});

function resetFilters(): void {
  filters.keyword = "";
  filters.result = "";
  filters.action = "";
  currentPage.value = 1;
}

function openLogDetail(log: OperationLog): void {
  selectedLog.value = log;
  detailVisible.value = true;
}

function exportLogs(): void {
  ElMessage.success("日志导出任务已提交");
}
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
                @clear="currentPage = 1"
              />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.action" clearable placeholder="操作类型">
                <el-option label="登录系统" value="登录系统" />
                <el-option label="新增用户" value="新增用户" />
                <el-option label="修改用户" value="修改用户" />
                <el-option label="停用用户" value="停用用户" />
                <el-option label="版本发布" value="版本发布" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.result" clearable placeholder="结果">
                <el-option label="成功" value="成功" />
                <el-option label="失败" value="失败" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-operation">
            <el-button type="primary" :icon="Search" @click="currentPage = 1">搜索</el-button>
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

      <el-table :data="pageLogs" style="width: 100%">
        <el-table-column prop="createdAt" label="操作时间" min-width="175" />
        <el-table-column prop="operator" label="操作人" min-width="145" />
        <el-table-column prop="action" label="操作类型" min-width="170">
          <template #default="{ row }">
            <el-tag effect="plain">{{ row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="target" label="操作目标" min-width="170" />
        <el-table-column prop="ip" label="IP 地址" min-width="145" />
        <el-table-column label="结果" min-width="110">
          <template #default="{ row }">
            <el-tag :type="row.result === '成功' ? 'success' : 'danger'" effect="light">{{
              row.result
            }}</el-tag>
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
          :total="filteredLogs.length"
        />
      </div>
    </section>

    <el-dialog v-model="detailVisible" title="操作详情" width="min(520px, calc(100% - 32px))">
      <el-descriptions v-if="selectedLog" :column="1" border>
        <el-descriptions-item label="操作时间">{{ selectedLog.createdAt }}</el-descriptions-item>
        <el-descriptions-item label="操作人">{{ selectedLog.operator }}</el-descriptions-item>
        <el-descriptions-item label="操作类型">{{ selectedLog.action }}</el-descriptions-item>
        <el-descriptions-item label="操作目标">{{ selectedLog.target }}</el-descriptions-item>
        <el-descriptions-item label="IP 地址">{{ selectedLog.ip }}</el-descriptions-item>
        <el-descriptions-item label="结果">{{ selectedLog.result }}</el-descriptions-item>
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
