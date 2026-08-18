<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import { RefreshLeft } from "@element-plus/icons-vue";

import { getAdminSmsStatisticsApi } from "@/api/modules/countrySms";

const filters = reactive<{ days: number }>({ days: 7 });
const loading = shallowRef(false);
const data = shallowRef<{
  total: number;
  success: number;
  failed: number;
  deliveredRate: number;
  byDate: Array<{ date: string; total: number; success: number; failed: number }>;
} | null>(null);

const deliveredRateText = computed(() => {
  const rate = data.value?.deliveredRate;
  if (rate == null) return "—";
  if (rate > 1) return `${rate.toFixed(2)}%`;
  return `${(rate * 100).toFixed(2)}%`;
});

async function fetchStatistics(): Promise<void> {
  loading.value = true;
  try {
    const res = await getAdminSmsStatisticsApi({ days: filters.days || undefined });
    const d = res.data;
    data.value = d
      ? {
          total: d.total ?? 0,
          success: d.success ?? 0,
          failed: d.failed ?? 0,
          deliveredRate: d.deliveredRate ?? 0,
          byDate: d.byDate ?? [],
        }
      : null;
  } catch {
    data.value = null;
  } finally {
    loading.value = false;
  }
}

function daysChanged(): void {
  fetchStatistics();
}

onMounted(() => {
  fetchStatistics();
});
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent>
        <div class="search-grid">
          <div class="search-item">
            <el-form-item label="统计天数" label-width="80px">
              <el-input-number
                v-model="filters.days"
                :min="1"
                :max="365"
                controls-position="right"
                @change="daysChanged"
              />
            </el-form-item>
          </div>
          <div class="search-operation">
            <el-button :icon="RefreshLeft" @click="fetchStatistics">刷新</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card stat-summary" v-loading="loading">
      <el-row :gutter="12">
        <el-col :xs="24" :sm="12" :md="6">
          <div class="stat-card">
            <div class="stat-title">总量</div>
            <div class="stat-value">{{ data?.total ?? 0 }}</div>
          </div>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <div class="stat-card">
            <div class="stat-title">已送达</div>
            <div class="stat-value">{{ data?.success ?? 0 }}</div>
          </div>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <div class="stat-card">
            <div class="stat-title">失败</div>
            <div class="stat-value">{{ data?.failed ?? 0 }}</div>
          </div>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <div class="stat-card">
            <div class="stat-title">送达率</div>
            <div class="stat-value">{{ deliveredRateText }}</div>
          </div>
        </el-col>
      </el-row>
    </section>

    <section class="card table-main">
      <el-table v-loading="loading" :data="data?.byDate ?? []" style="width: 100%">
        <el-table-column prop="date" label="日期" min-width="140" />
        <el-table-column prop="total" label="总量" min-width="120" />
        <el-table-column prop="success" label="已送达" min-width="120" />
        <el-table-column prop="failed" label="失败" min-width="120" />
        <el-table-column label="送达率" min-width="140">
          <template #default="{ row }">
            <span>{{ row.total ? ((row.success / row.total) * 100).toFixed(2) : "0.00" }}%</span>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped lang="scss">
.stat-summary {
  margin-bottom: 12px;
}

.stat-card {
  padding: 14px 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.stat-title {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.stat-value {
  margin-top: 6px;
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>

