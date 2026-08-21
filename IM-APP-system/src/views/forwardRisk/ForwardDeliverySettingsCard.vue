<script setup lang="ts">
import type { AdminForwardRisk } from "@/api/modules/forwardRisk";

const settings = defineModel<AdminForwardRisk.ForwardSettings>({ required: true });

defineProps<{
  loading: boolean;
  saving: boolean;
  changed: boolean;
}>();

defineEmits<{
  refresh: [];
  reset: [];
  save: [];
}>();
</script>

<template>
  <section class="card settings-card" v-loading="loading">
    <div class="settings-header">
      <div>
        <div class="settings-title">转发调度与可靠性</div>
        <div class="settings-hint">不限总量；以下配置只影响发送速度、重试和队列消费。</div>
      </div>
      <div class="settings-ops">
        <el-button :disabled="saving" @click="$emit('refresh')">刷新</el-button>
        <el-button :disabled="!changed || saving" @click="$emit('reset')">还原</el-button>
        <el-button type="primary" :loading="saving" :disabled="!changed" @click="$emit('save')">保存</el-button>
      </div>
    </div>

    <el-form :model="settings" label-width="150px">
      <div class="settings-grid">
        <el-form-item label="全局 QPS"><el-input-number v-model="settings.globalQps" :min="1" controls-position="right" /></el-form-item>
        <el-form-item label="Worker 并发"><el-input-number v-model="settings.workerConcurrency" :min="1" controls-position="right" /></el-form-item>
        <el-form-item label="单次领取数量"><el-input-number v-model="settings.claimBatchSize" :min="1" controls-position="right" /></el-form-item>
        <el-form-item label="单用户并发"><el-input-number v-model="settings.perUserConcurrency" :min="1" controls-position="right" /></el-form-item>
        <el-form-item label="重试初始秒数"><el-input-number v-model="settings.retryBaseSeconds" :min="1" controls-position="right" /></el-form-item>
        <el-form-item label="重试最大秒数"><el-input-number v-model="settings.retryMaxSeconds" :min="1" controls-position="right" /></el-form-item>
        <el-form-item label="处理锁秒数"><el-input-number v-model="settings.processingLockSeconds" :min="1" controls-position="right" /></el-form-item>
        <el-form-item label="明细保留天数"><el-input-number v-model="settings.retentionDays" :min="1" controls-position="right" /></el-form-item>
        <el-form-item label="积压告警阈值"><el-input-number v-model="settings.queueAlertDepth" :min="1" controls-position="right" /></el-form-item>
        <el-form-item label="暂停队列消费"><el-switch v-model="settings.queuePaused" /></el-form-item>
      </div>
    </el-form>
  </section>
</template>

<style scoped lang="scss">
.settings-card { padding: 18px 18px 0; margin-bottom: 10px; }
.settings-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.settings-title { font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); }
.settings-hint { margin-top: 6px; font-size: 13px; color: var(--el-text-color-secondary); }
.settings-ops { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
.settings-ops .el-button { margin-left: 0; }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.settings-grid :deep(.el-form-item) { margin-bottom: 18px; }
.settings-grid :deep(.el-form-item__content > *) { width: 100%; }
@media (max-width: 700px) { .settings-grid { grid-template-columns: 1fr; } }
</style>
