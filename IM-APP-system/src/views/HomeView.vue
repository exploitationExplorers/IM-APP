<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import {
  AdminDashboard,
  getAdminDashboardOverviewApi,
  getAdminDashboardTodosApi,
  getAdminDashboardTrendsApi,
} from "@/api/modules/dashboard";

const router = useRouter();

const overviewLoading = shallowRef(false);
const todosLoading = shallowRef(false);
const trendsLoading = shallowRef(false);

const overview = shallowRef<AdminDashboard.DashboardOverview | null>(null);
const todos = shallowRef<AdminDashboard.DashboardTodo[]>([]);
const trends = shallowRef<AdminDashboard.DashboardTrend[]>([]);

const days = shallowRef(7);

function formatNumber(value: unknown): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString();
}

function pickTodoLabel(type: AdminDashboard.DashboardTodoType): string {
  const map: Record<AdminDashboard.DashboardTodoType, string> = {
    report: "举报",
    forward_risk: "转发风控",
    sms_failed: "短信失败",
    system_alert: "系统告警",
  };
  return map[type] ?? String(type);
}

function pickTodoTag(type: AdminDashboard.DashboardTodoType): "danger" | "warning" | "primary" | "info" | "success" {
  const map: Record<AdminDashboard.DashboardTodoType, "danger" | "warning" | "primary" | "info" | "success"> = {
    report: "danger",
    forward_risk: "warning",
    sms_failed: "warning",
    system_alert: "danger",
  };
  return map[type] ?? "info";
}

function resolveTodoRoute(type: AdminDashboard.DashboardTodoType): string | null {
  const map: Partial<Record<AdminDashboard.DashboardTodoType, string>> = {
    forward_risk: "/forward-risk",
    sms_failed: "/sms-operation-config",
    system_alert: "/runtime-observe/errors",
  };
  return map[type] ?? null;
}

const metrics = computed(() => {
  const data = overview.value;
  return [
    { key: "users", label: "用户总数", value: formatNumber(data?.users), icon: "UserFilled", to: "/app/users" },
    { key: "groups", label: "群组总数", value: formatNumber(data?.groups), icon: "ChatSquare", to: "/app/groups" },
    { key: "activeToday", label: "今日活跃", value: formatNumber(data?.activeToday), icon: "TrendCharts" },
    { key: "messagesToday", label: "今日消息", value: formatNumber(data?.messagesToday), icon: "ChatDotRound" },
    { key: "pendingReports", label: "待处理举报", value: formatNumber(data?.pendingReports), icon: "WarningFilled" },
    { key: "forwardTasks", label: "转发任务", value: formatNumber(data?.forwardTasks), icon: "Switch", to: "/forward-risk" },
    { key: "smsSentToday", label: "今日短信", value: formatNumber(data?.smsSentToday), icon: "Message" },
  ];
});

async function fetchOverview(): Promise<void> {
  overviewLoading.value = true;
  try {
    const res = await getAdminDashboardOverviewApi();
    overview.value = res.data ?? null;
  } catch {
    overview.value = null;
  } finally {
    overviewLoading.value = false;
  }
}

async function fetchTodos(): Promise<void> {
  todosLoading.value = true;
  try {
    const res = await getAdminDashboardTodosApi();
    todos.value = res.data ?? [];
  } catch {
    todos.value = [];
  } finally {
    todosLoading.value = false;
  }
}

async function fetchTrends(): Promise<void> {
  trendsLoading.value = true;
  try {
    const res = await getAdminDashboardTrendsApi({ days: days.value });
    trends.value = res.data ?? [];
  } catch {
    trends.value = [];
  } finally {
    trendsLoading.value = false;
  }
}

async function fetchAll(): Promise<void> {
  await Promise.all([fetchOverview(), fetchTodos(), fetchTrends()]);
}

function openRoute(path: string | null): void {
  if (!path) return;
  void router.push(path);
}

function summarizeTrends(payload: { columns: { property?: string }[]; data: AdminDashboard.DashboardTrend[] }): string[] {
  const { columns, data } = payload;
  const totals = data.reduce(
    (acc, cur) => {
      acc.registrations += Number(cur.registrations ?? 0);
      acc.active += Number(cur.active ?? 0);
      acc.messages += Number(cur.messages ?? 0);
      acc.reports += Number(cur.reports ?? 0);
      acc.forwards += Number(cur.forwards ?? 0);
      return acc;
    },
    { registrations: 0, active: 0, messages: 0, reports: 0, forwards: 0 },
  );

  return columns.map((col, index) => {
    if (index === 0) return "合计";
    switch (col.property) {
      case "registrations":
        return formatNumber(totals.registrations);
      case "active":
        return formatNumber(totals.active);
      case "messages":
        return formatNumber(totals.messages);
      case "reports":
        return formatNumber(totals.reports);
      case "forwards":
        return formatNumber(totals.forwards);
      default:
        return "";
    }
  });
}

onMounted(() => {
  fetchAll();
});

watch(days, () => {
  fetchTrends();
});
</script>

<template>
  <div class="dashboard">
    <section class="card dashboard-heading">
      <div class="heading-left">
        <div class="heading-title">工作台</div>
        <div class="heading-sub">按日趋势统计（注册/活跃/消息/举报/转发）</div>
      </div>
      <div class="heading-actions">
        <el-button @click="fetchAll">刷新</el-button>
      </div>
    </section>

    <section class="card dashboard-overview" v-loading="overviewLoading">
      <div class="section-title">关键指标</div>
      <div class="metric-grid dashboard-metrics">
        <button
          v-for="item in metrics"
          :key="item.key"
          class="metric-card"
          type="button"
          :class="{ clickable: !!item.to }"
          @click="openRoute(item.to ?? null)"
        >
          <div class="metric-icon">
            <el-icon><component :is="item.icon" /></el-icon>
          </div>
          <div class="metric-body">
            <div class="metric-label">{{ item.label }}</div>
            <div class="metric-value">{{ item.value }}</div>
          </div>
        </button>
      </div>
      <el-empty v-if="!overviewLoading && !overview" description="暂无概览数据" />
    </section>

    <section class="card dashboard-todos" v-loading="todosLoading">
      <div class="section-head">
        <div class="section-title">工作台待办</div>
      </div>
      <el-table v-if="todos.length" :data="todos" size="small" style="width: 100%">
        <el-table-column prop="createdAt" label="时间" min-width="170" />
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            <el-tag :type="pickTodoTag(row.type)" effect="light">{{ pickTodoLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="260" show-overflow-tooltip />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!resolveTodoRoute(row.type)" @click="openRoute(resolveTodoRoute(row.type))">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!todosLoading" description="暂无待办" />
    </section>

    <section class="card dashboard-trends" v-loading="trendsLoading">
      <div class="section-head">
        <div class="section-title">按日趋势统计</div>
        <div class="section-actions">
          <span class="action-label">统计天数</span>
          <el-select v-model="days" class="days-select">
            <el-option label="近 7 天" :value="7" />
            <el-option label="近 14 天" :value="14" />
            <el-option label="近 30 天" :value="30" />
          </el-select>
          <el-button @click="fetchTrends">刷新</el-button>
        </div>
      </div>
      <el-table
        v-if="trends.length"
        :data="trends"
        size="small"
        style="width: 100%"
        show-summary
        :summary-method="summarizeTrends"
      >
        <el-table-column prop="date" label="日期" min-width="140" />
        <el-table-column prop="registrations" label="注册" min-width="110" align="right" />
        <el-table-column prop="active" label="活跃" min-width="110" align="right" />
        <el-table-column prop="messages" label="消息" min-width="110" align="right" />
        <el-table-column prop="reports" label="举报" min-width="110" align="right" />
        <el-table-column prop="forwards" label="转发" min-width="110" align="right" />
      </el-table>
      <el-empty v-else-if="!trendsLoading" description="暂无趋势数据" />
    </section>
  </div>
</template>

<style scoped lang="scss">
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-height: 100%;
}

.dashboard-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.heading-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.heading-sub {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.heading-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.dashboard-overview {
  width: 100%;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.action-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.days-select {
  width: 140px;
}

.dashboard-metrics {
  margin-top: 14px;
}

.metric-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  text-align: left;
  cursor: default;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}

.metric-card.clickable {
  cursor: pointer;
}

.metric-card.clickable:hover {
  border-color: var(--el-color-primary);
  box-shadow: 0 6px 18px rgb(0 0 0 / 8%);
  transform: translateY(-1px);
}

.metric-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 12px;
  flex: 0 0 auto;
}

.metric-icon :deep(svg) {
  width: 22px;
  height: 22px;
}

.metric-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.metric-value {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  line-height: 1.1;
}

.dashboard-todos,
.dashboard-trends {
  width: 100%;
}

.dashboard-todos :deep(.el-table),
.dashboard-trends :deep(.el-table) {
  margin-top: 8px;
}

@media (max-width: 560px) {
  .dashboard-heading {
    flex-direction: column;
    align-items: stretch;
  }

  .heading-actions {
    justify-content: flex-start;
  }

  .days-select {
    width: 100%;
  }
}
</style>
