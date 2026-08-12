<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { RefreshLeft, Search, View } from "@element-plus/icons-vue";

type TaskStatus = "pending" | "sending" | "completed" | "failed";
type ContentType = "text" | "image" | "video" | "link" | "miniProgram";

interface ForwardTask {
  id: number;
  taskNo: string;
  senderName: string;
  receiverCount: number;
  successCount: number;
  failCount: number;
  contentType: ContentType;
  status: TaskStatus;
  duplicateCount: number;
  isLimited: boolean;
  reportCount: number;
  isBanned: boolean;
  createdAt: string;
}

const STATUS_MAP: Record<TaskStatus, string> = {
  pending: "待发送",
  sending: "发送中",
  completed: "已完成",
  failed: "发送失败",
};

const CONTENT_TYPE_MAP: Record<ContentType, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  link: "链接",
  miniProgram: "小程序",
};

interface TaskFilters {
  keyword: string;
  status: "" | TaskStatus;
  contentType: "" | ContentType;
  dateRange: [string, string] | null;
}

const filters = reactive<TaskFilters>({ keyword: "", status: "", contentType: "", dateRange: null });
const currentPage = shallowRef(1);
const pageSize = shallowRef(10);
const detailVisible = shallowRef(false);
const selectedTask = shallowRef<ForwardTask | null>(null);

const tasks = shallowRef<ForwardTask[]>([
  {
    id: 1,
    taskNo: "FW20260812001",
    senderName: "陈安",
    receiverCount: 328,
    successCount: 310,
    failCount: 18,
    contentType: "text",
    status: "completed",
    duplicateCount: 3,
    isLimited: false,
    reportCount: 0,
    isBanned: false,
    createdAt: "2026-08-12 09:30",
  },
  {
    id: 2,
    taskNo: "FW20260812002",
    senderName: "林诺",
    receiverCount: 156,
    successCount: 0,
    failCount: 0,
    contentType: "image",
    status: "sending",
    duplicateCount: 0,
    isLimited: false,
    reportCount: 0,
    isBanned: false,
    createdAt: "2026-08-12 10:15",
  },
  {
    id: 3,
    taskNo: "FW20260811003",
    senderName: "周米娅",
    receiverCount: 500,
    successCount: 480,
    failCount: 20,
    contentType: "video",
    status: "completed",
    duplicateCount: 12,
    isLimited: true,
    reportCount: 2,
    isBanned: false,
    createdAt: "2026-08-11 14:20",
  },
  {
    id: 4,
    taskNo: "FW20260811004",
    senderName: "王磊",
    receiverCount: 89,
    successCount: 0,
    failCount: 89,
    contentType: "link",
    status: "failed",
    duplicateCount: 0,
    isLimited: false,
    reportCount: 5,
    isBanned: true,
    createdAt: "2026-08-11 11:05",
  },
  {
    id: 5,
    taskNo: "FW20260812005",
    senderName: "黄怡",
    receiverCount: 200,
    successCount: 0,
    failCount: 0,
    contentType: "miniProgram",
    status: "pending",
    duplicateCount: 1,
    isLimited: false,
    reportCount: 0,
    isBanned: false,
    createdAt: "2026-08-12 11:00",
  },
]);

const filteredTasks = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  return tasks.value.filter((task) => {
    const matchesKeyword =
      !keyword ||
      [task.taskNo, task.senderName].some((v) => v.toLowerCase().includes(keyword));
    const matchesStatus = !filters.status || task.status === filters.status;
    const matchesContentType = !filters.contentType || task.contentType === filters.contentType;
    return matchesKeyword && matchesStatus && matchesContentType;
  });
});

const pageTasks = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredTasks.value.slice(start, start + pageSize.value);
});

function statusTagType(status: TaskStatus) {
  const map: Record<TaskStatus, string> = {
    pending: "warning",
    sending: "primary",
    completed: "success",
    failed: "danger",
  };
  return map[status] ?? "info";
}

function resetFilters(): void {
  filters.keyword = "";
  filters.status = "";
  filters.contentType = "";
  filters.dateRange = null;
  currentPage.value = 1;
}

function openDetail(task: ForwardTask): void {
  selectedTask.value = task;
  detailVisible.value = true;
}

async function retryTask(task: ForwardTask): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定重新发送任务 ${task.taskNo} 吗？`, "重新发送", {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    ElMessage.success("任务重新发送已提交");
  } catch {
    // cancelled
  }
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
                placeholder="任务编号 / 发送人"
                :prefix-icon="Search"
                @clear="currentPage = 1"
              />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.status" clearable placeholder="任务状态">
                <el-option label="待发送" value="pending" />
                <el-option label="发送中" value="sending" />
                <el-option label="已完成" value="completed" />
                <el-option label="发送失败" value="failed" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.contentType" clearable placeholder="内容类型">
                <el-option label="文本" value="text" />
                <el-option label="图片" value="image" />
                <el-option label="视频" value="video" />
                <el-option label="链接" value="link" />
                <el-option label="小程序" value="miniProgram" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-date-picker
                v-model="filters.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                style="width: 100%"
              />
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
      <el-table :data="pageTasks" style="width: 100%">
        <el-table-column prop="taskNo" label="任务编号" min-width="150" />
        <el-table-column prop="senderName" label="发送人" min-width="100" />
        <el-table-column prop="receiverCount" label="接收人数" min-width="100" align="center" />
        <el-table-column label="成功 / 失败" min-width="110" align="center">
          <template #default="{ row }">
            <span class="count-success">{{ row.successCount }}</span>
            <span class="count-sep">/</span>
            <span class="count-fail">{{ row.failCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="内容类型" min-width="100">
          <template #default="{ row }: { row: ForwardTask }">
            <el-tag effect="plain" round>{{ CONTENT_TYPE_MAP[row.contentType] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="任务状态" min-width="110">
          <template #default="{ row }: { row: ForwardTask }">
            <el-tag :type="statusTagType(row.status)" effect="light">{{ STATUS_MAP[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" min-width="160" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="View" @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status === 'failed'" link type="warning" @click="retryTask(row)">重试</el-button>
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
          :total="filteredTasks.length"
        />
      </div>
    </section>

    <!-- 详情弹窗 -->
    <el-dialog v-model="detailVisible" title="任务详情" width="min(620px, calc(100% - 32px))">
      <template v-if="selectedTask">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="任务编号">{{ selectedTask.taskNo }}</el-descriptions-item>
          <el-descriptions-item label="发送人">{{ selectedTask.senderName }}</el-descriptions-item>
          <el-descriptions-item label="内容类型">{{ CONTENT_TYPE_MAP[selectedTask.contentType] }}</el-descriptions-item>
          <el-descriptions-item label="任务状态">
            <el-tag :type="statusTagType(selectedTask.status)" effect="light">{{ STATUS_MAP[selectedTask.status] }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="接收人数">{{ selectedTask.receiverCount }}</el-descriptions-item>
          <el-descriptions-item label="成功 / 失败">
            <span class="count-success">{{ selectedTask.successCount }}</span>
            <span class="count-sep">/</span>
            <span class="count-fail">{{ selectedTask.failCount }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">{{ selectedTask.createdAt }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">异常与限制</el-divider>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="异常重复任务">{{ selectedTask.duplicateCount }} 条</el-descriptions-item>
          <el-descriptions-item label="用户发送限制">
            <el-tag :type="selectedTask.isLimited ? 'danger' : 'success'" effect="light">
              {{ selectedTask.isLimited ? '已限制' : '未限制' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="举报次数">{{ selectedTask.reportCount }} 次</el-descriptions-item>
          <el-descriptions-item label="封禁状态">
            <el-tag :type="selectedTask.isBanned ? 'danger' : 'success'" effect="light">
              {{ selectedTask.isBanned ? '已封禁' : '正常' }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>
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
    grid-template-columns: repeat(5, minmax(0, 1fr));
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

.count-success {
  color: var(--el-color-success);
  font-weight: 600;
}

.count-fail {
  color: var(--el-color-danger);
  font-weight: 600;
}

.count-sep {
  margin: 0 4px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 1100px) {
  .table-search .search-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .table-search .search-operation {
    justify-content: flex-start;
  }
}

@media (max-width: 700px) {
  .table-search .search-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .table-search .search-operation {
    justify-content: flex-start;
  }

  .table-footer {
    justify-content: center;
  }
}
</style>
