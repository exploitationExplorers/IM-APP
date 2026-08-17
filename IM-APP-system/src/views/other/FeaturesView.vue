<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { RefreshRight } from "@element-plus/icons-vue";

import { AdminFeatures, getAdminFeaturesApi, putAdminFeaturesApi } from "@/api/modules/features";

type FeaturesForm = AdminFeatures.FeaturesConfig;

const loading = shallowRef(false);
const saving = shallowRef(false);
const form = reactive<FeaturesForm>({ mfa: false, report: false });
const initial = shallowRef<FeaturesForm | null>(null);

const changed = computed(() => {
  if (!initial.value) return false;
  return form.mfa !== initial.value.mfa || form.report !== initial.value.report;
});

function snapshotCurrent(): FeaturesForm {
  return { mfa: Boolean(form.mfa), report: Boolean(form.report) };
}

function applySnapshot(value: FeaturesForm): void {
  form.mfa = Boolean(value.mfa);
  form.report = Boolean(value.report);
}

async function fetchFeatures(): Promise<void> {
  loading.value = true;
  try {
    const res = await getAdminFeaturesApi();
    const data = res.data;
    if (data) {
      applySnapshot(data);
      initial.value = { ...data };
    } else {
      initial.value = snapshotCurrent();
    }
  } catch {
    initial.value = null;
  } finally {
    loading.value = false;
  }
}

async function promptReason(title: string): Promise<string | null> {
  try {
    const res = await ElMessageBox.prompt("请输入操作原因", title, {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputType: "textarea",
      inputPlaceholder: "原因（必填）",
      inputValidator: (value) => {
        if (String(value ?? "").trim()) return true;
        return "请输入原因";
      },
      inputErrorMessage: "请输入原因",
    });
    return String(res.value ?? "").trim() || null;
  } catch {
    return null;
  }
}

function resetForm(): void {
  if (!initial.value) return;
  applySnapshot(initial.value);
}

async function saveFeatures(): Promise<void> {
  if (!initial.value || !changed.value) return;
  const reason = await promptReason("设置功能开关");
  if (!reason) return;

  const body: AdminFeatures.ReqUpdateFeaturesBody = { reason };
  if (form.mfa !== initial.value.mfa) body.mfa = form.mfa;
  if (form.report !== initial.value.report) body.report = form.report;

  if (body.mfa === undefined && body.report === undefined) return;

  saving.value = true;
  const rollback = initial.value ? { ...initial.value } : snapshotCurrent();
  try {
    await putAdminFeaturesApi(body);
    initial.value = snapshotCurrent();
    ElMessage.success("已保存");
  } catch {
    applySnapshot(rollback);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  fetchFeatures();
});
</script>

<template>
  <div class="table-box">
    <section class="card feature-card" v-loading="loading">
      <div class="card-header">
        <div class="card-title">功能开关</div>
        <div class="card-ops">
          <el-button :icon="RefreshRight" :disabled="saving" @click="fetchFeatures">刷新</el-button>
          <el-button :disabled="!changed || saving" @click="resetForm">还原</el-button>
          <el-button type="primary" :loading="saving" :disabled="!changed" @click="saveFeatures">保存</el-button>
        </div>
      </div>

      <el-form :model="form" label-width="140px" class="feature-form">
        <div class="feature-grid">
          <el-form-item label="MFA 多因子认证">
            <el-switch v-model="form.mfa" :disabled="saving" />
          </el-form-item>
          <el-form-item label="举报功能">
            <el-switch v-model="form.report" :disabled="saving" />
          </el-form-item>
        </div>
      </el-form>
    </section>
  </div>
</template>

<style scoped lang="scss">
.table-box {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.feature-card {
  padding: 18px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.card-ops {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.card-ops .el-button {
  margin-left: 0;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
}

.feature-form :deep(.el-form-item) {
  margin-bottom: 18px;
}
</style>
