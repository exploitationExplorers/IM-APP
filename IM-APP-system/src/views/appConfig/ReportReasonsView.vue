<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";

import {
  AppConfig,
  getReportReasonsApi,
  postReportReasonApi,
  putReportReasonApi,
  putReportReasonStatusApi,
} from "@/api/modules/appConfig";

type DialogMode = "create" | "edit";

const loading = shallowRef(false);
const items = shallowRef<AppConfig.ReportReason[]>([]);

const dialogVisible = shallowRef(false);
const dialogLoading = shallowRef(false);
const dialogMode = shallowRef<DialogMode>("create");
const editingId = shallowRef("");
const formRef = shallowRef<FormInstance>();

const formModel = reactive<AppConfig.ReqCreateReportReasonBody>({
  language: "zh",
  reason: "",
  sortOrder: 0,
  status: "active",
  targetType: "user",
});

const formRules: FormRules = {
  reason: [{ required: true, message: "请输入原因文案", trigger: "blur" }],
  targetType: [{ required: true, message: "请选择目标类型", trigger: "change" }],
};

const targetTypeLabels: Record<AppConfig.ReportReasonTargetType, string> = {
  user: "用户",
  group: "群组",
  message: "消息",
};

const statusLabels: Record<AppConfig.ReportReasonStatus, string> = {
  active: "启用",
  disabled: "停用",
};

const statusTagTypes: Record<AppConfig.ReportReasonStatus, string> = {
  active: "success",
  disabled: "info",
};

const dialogTitle = computed(() => (dialogMode.value === "create" ? "新建举报原因" : "修改举报原因"));

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    const res = await getReportReasonsApi();
    items.value = res.data ?? [];
  } finally {
    loading.value = false;
  }
}

function resetForm(): void {
  formModel.language = "zh";
  formModel.reason = "";
  formModel.sortOrder = 0;
  formModel.status = "active";
  formModel.targetType = "user";
}

function openCreate(): void {
  dialogMode.value = "create";
  editingId.value = "";
  resetForm();
  dialogVisible.value = true;
}

function openEdit(row: AppConfig.ReportReason): void {
  dialogMode.value = "edit";
  editingId.value = row.id;
  formModel.language = row.language ?? "zh";
  formModel.reason = row.reason ?? "";
  formModel.sortOrder = row.sortOrder ?? 0;
  formModel.status = row.status;
  formModel.targetType = row.targetType;
  dialogVisible.value = true;
}

async function submitForm(): Promise<void> {
  const form = formRef.value;
  if (!form) return;
  await form.validate();
  dialogLoading.value = true;
  try {
    if (dialogMode.value === "create") {
      await postReportReasonApi({
        language: formModel.language?.trim() || undefined,
        reason: String(formModel.reason).trim(),
        sortOrder: formModel.sortOrder ?? undefined,
        status: formModel.status,
        targetType: formModel.targetType,
      });
      ElMessage.success("创建成功");
    } else {
      await putReportReasonApi(editingId.value, {
        language: formModel.language?.trim() || undefined,
        reason: String(formModel.reason).trim() || undefined,
        sortOrder: formModel.sortOrder ?? undefined,
        targetType: formModel.targetType,
      });
      ElMessage.success("修改成功");
    }
    dialogVisible.value = false;
    await fetchList();
  } finally {
    dialogLoading.value = false;
  }
}

async function toggleStatus(row: AppConfig.ReportReason): Promise<void> {
  const nextStatus: AppConfig.ReportReasonStatus = row.status === "active" ? "disabled" : "active";
  const actionText = nextStatus === "active" ? "启用" : "停用";
  try {
    await ElMessageBox.confirm(`确认${actionText}该举报原因？`, `${actionText}举报原因`, {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await putReportReasonStatusApi(row.id, { status: nextStatus });
  ElMessage.success(`${actionText}成功`);
  await fetchList();
}

onMounted(() => {
  void fetchList();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新建举报原因</el-button>
      <el-button :disabled="loading" @click="fetchList">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="items" border style="width: 100%">
      <el-table-column prop="reason" label="原因文案" min-width="260" show-overflow-tooltip />
      <el-table-column prop="targetType" label="目标类型" min-width="140">
        <template #default="{ row }: { row: AppConfig.ReportReason }">
          <el-tag type="info">{{ targetTypeLabels[row.targetType] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="language" label="语言" min-width="120" />
      <el-table-column prop="sortOrder" label="排序" min-width="120" />
      <el-table-column prop="status" label="状态" min-width="120">
        <template #default="{ row }: { row: AppConfig.ReportReason }">
          <el-tag :type="statusTagTypes[row.status]">{{ statusLabels[row.status] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }: { row: AppConfig.ReportReason }">
          <el-button size="small" type="primary" link @click="openEdit(row)">修改</el-button>
          <el-button size="small" type="warning" link style="margin-left: 14px" @click="toggleStatus(row)">
            {{ row.status === "active" ? "停用" : "启用" }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px" destroy-on-close>
      <el-form ref="formRef" :model="formModel" :rules="formRules" label-width="90px">
        <el-form-item label="原因文案" prop="reason">
          <el-input v-model="formModel.reason" maxlength="80" show-word-limit />
        </el-form-item>
        <el-form-item label="目标类型" prop="targetType">
          <el-select v-model="formModel.targetType" style="width: 100%">
            <el-option label="用户" value="user" />
            <el-option label="群组" value="group" />
            <el-option label="消息" value="message" />
          </el-select>
        </el-form-item>
        <el-form-item label="语言">
          <el-input v-model="formModel.language" maxlength="16" show-word-limit placeholder="默认 zh" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="formModel.sortOrder" :min="0" :max="999999" />
        </el-form-item>
        <el-form-item v-if="dialogMode === 'create'" label="初始状态">
          <el-select v-model="formModel.status" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="disabled" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button :disabled="dialogLoading" @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="dialogLoading" @click="submitForm">确定</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar {
  display: flex;
  gap: 10px;
}
</style>
