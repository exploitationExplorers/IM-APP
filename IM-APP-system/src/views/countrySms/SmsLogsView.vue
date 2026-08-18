<script setup lang="ts">
import { onMounted, reactive, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { RefreshLeft, Search } from "@element-plus/icons-vue";

import { CountrySms, getAdminSmsLogsApi } from "@/api/modules/countrySms";

const router = useRouter();

const filters = reactive<{ keyword: string; status: "" | CountrySms.SmsLogStatus }>({ keyword: "", status: "" });
const currentPage = shallowRef(1);
const pageSize = shallowRef(20);
const total = shallowRef(0);
const tableLoading = shallowRef(false);
const logs = shallowRef<CountrySms.SmsLogItem[]>([]);

const statusLabelMap: Record<CountrySms.SmsLogStatus, string> = {
  sent: "已发送",
  success: "已送达",
  failed: "失败",
  pending: "发送中",
};

function normalizeStatus(status: unknown): CountrySms.SmsLogStatus | "" {
  if (status === "sent" || status === "success" || status === "failed" || status === "pending") return status;
  return "";
}

function statusTagType(status: unknown) {
  const map: Record<CountrySms.SmsLogStatus, "success" | "danger" | "warning" | "info"> = {
    sent: "info",
    success: "success",
    failed: "danger",
    pending: "warning",
  };
  const s = normalizeStatus(status);
  if (!s) return "info";
  return map[s] ?? "info";
}

function statusLabel(status: unknown): string {
  const s = normalizeStatus(status);
  if (!s) return status ? String(status) : "—";
  return statusLabelMap[s] ?? s;
}

function resetFilters(): void {
  filters.keyword = "";
  filters.status = "";
  currentPage.value = 1;
  fetchLogs();
}

function applyFilters(): void {
  currentPage.value = 1;
  fetchLogs();
}

function goDetail(row: CountrySms.SmsLogItem): void {
  router.push(`/country-sms/sms-logs/${row.id}`);
}

async function fetchLogs(): Promise<void> {
  tableLoading.value = true;
  try {
    const res = await getAdminSmsLogsApi({
      page: currentPage.value,
      size: pageSize.value,
      keyword: filters.keyword.trim() || undefined,
      status: filters.status || undefined,
    });

    logs.value = res.data?.items ?? [];
    total.value = res.data?.total ?? 0;
  } catch {
    logs.value = [];
    total.value = 0;
  } finally {
    tableLoading.value = false;
  }
}

onMounted(() => {
  fetchLogs();
});

watch([currentPage, pageSize], () => {
  fetchLogs();
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
                placeholder="关键词（按手机号匹配）"
                :prefix-icon="Search"
                @keyup.enter="applyFilters"
              />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.status" clearable placeholder="状态" @change="applyFilters">
                <el-option label="已发送" value="sent" />
                <el-option label="已送达" value="success" />
                <el-option label="失败" value="failed" />
                <el-option label="发送中" value="pending" />
              </el-select>
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
        <div class="header-button-ri">
          <el-button :icon="RefreshLeft" @click="fetchLogs">刷新</el-button>
        </div>
      </div>

      <el-table v-loading="tableLoading" :data="logs" style="width: 100%">
        <el-table-column prop="id" label="日志ID" min-width="110">
          <template #default="{ row }">
            <span class="mono-text">{{ row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="phoneMasked" label="手机号（脱敏）" min-width="160">
          <template #default="{ row }">
            <span class="mono-text">{{ row.phoneMasked || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="countryCode" label="国家码" min-width="110">
          <template #default="{ row }">
            <span class="mono-text">{{ row.countryCode || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="provider" label="供应商" min-width="140" show-overflow-tooltip />
        <el-table-column prop="scene" label="场景" min-width="140" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" min-width="120">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" effect="light">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="errorCode" label="错误码" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono-text">{{ row.errorCode || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" min-width="180" />
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-footer">
        <el-pagination
          background
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
        />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.mono-text {
  font-family: ui-monospace, sfmono-regular, menlo, monaco, consolas, "Liberation Mono", "Courier New", monospace;
}
</style>
