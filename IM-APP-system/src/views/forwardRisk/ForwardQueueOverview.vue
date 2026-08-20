<script setup lang="ts">
import type { AdminForwardRisk } from "@/api/modules/forwardRisk";

defineProps<{ metrics: AdminForwardRisk.ForwardQueueMetrics | null; loading: boolean }>();
defineEmits<{ refresh: [] }>();

function duration(seconds = 0): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  return `${Math.floor(seconds / 3600)} 小时`;
}
</script>

<template>
  <section class="card overview" v-loading="loading">
    <div class="overview-header"><strong>可靠队列概览</strong><el-button link type="primary" @click="$emit('refresh')">刷新</el-button></div>
    <div class="metrics">
      <el-statistic title="排队" :value="metrics?.queued ?? 0" />
      <el-statistic title="重试中" :value="metrics?.retrying ?? 0" />
      <el-statistic title="处理中" :value="metrics?.processing ?? 0" />
      <el-statistic title="永久失败" :value="metrics?.permanentFailed ?? 0" />
      <el-statistic title="当前发送/秒" :value="metrics?.sendRatePerSecond ?? 0" :precision="2" />
      <el-statistic title="最老等待" :value="duration(metrics?.oldestPendingSeconds)" />
    </div>
  </section>
</template>

<style scoped>
.overview { padding: 18px; margin-bottom: 10px; }
.overview-header { display: flex; justify-content: space-between; margin-bottom: 16px; }
.metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 18px; }
@media (max-width: 1100px) { .metrics { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 700px) { .metrics { grid-template-columns: repeat(2, 1fr); } }
</style>
