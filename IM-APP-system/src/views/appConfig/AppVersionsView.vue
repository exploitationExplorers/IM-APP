<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage } from "element-plus";

import {
  AppConfig,
  getAppVersionsApi,
  postAppVersionApi,
  putAppVersionApi,
  putAppVersionStatusApi,
} from "@/api/modules/appConfig";

type DialogMode = "create" | "edit";

const loading = shallowRef(false);
const items = shallowRef<AppConfig.AppVersion[]>([]);

const dialogVisible = shallowRef(false);
const dialogLoading = shallowRef(false);
const dialogMode = shallowRef<DialogMode>("create");
const editingId = shallowRef<string>("");
const formRef = shallowRef<FormInstance>();

const formModel = reactive<AppConfig.ReqCreateAppVersionBody>({
  version: "",
  platform: "android",
  description: "",
  downloadUrl: "",
  forceUpgrade: false,
});

const formRules: FormRules = {
  version: [{ required: true, message: "请输入版本号", trigger: "blur" }],
  platform: [{ required: true, message: "请选择平台", trigger: "change" }],
};

const statusVisible = shallowRef(false);
const statusLoading = shallowRef(false);
const statusId = shallowRef<string>("");
const statusTarget = shallowRef<AppConfig.AppVersionStatus>("published");
const statusReason = shallowRef("");

const statusTitle = computed(() => (statusTarget.value === "published" ? "发布版本" : "下线版本"));

const statusLabels: Record<AppConfig.AppVersionStatus, string> = {
  draft: "草稿",
  published: "已发布",
};

const statusTagTypes: Record<AppConfig.AppVersionStatus, string> = {
  draft: "info",
  published: "success",
};

function resetForm(): void {
  formModel.version = "";
  formModel.platform = "android";
  formModel.description = "";
  formModel.downloadUrl = "";
  formModel.forceUpgrade = false;
}

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    const res = await getAppVersionsApi();
    items.value = res.data ?? [];
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  dialogMode.value = "create";
  editingId.value = "";
  resetForm();
  dialogVisible.value = true;
}

function openEdit(row: AppConfig.AppVersion): void {
  dialogMode.value = "edit";
  editingId.value = row.id;
  formModel.version = row.version;
  formModel.platform = row.platform;
  formModel.description = row.description ?? "";
  formModel.downloadUrl = row.downloadUrl ?? "";
  formModel.forceUpgrade = Boolean(row.forceUpgrade);
  dialogVisible.value = true;
}

function openStatus(row: AppConfig.AppVersion): void {
  statusId.value = row.id;
  statusTarget.value = row.status === "draft" ? "published" : "draft";
  statusReason.value = "";
  statusVisible.value = true;
}

async function submitForm(): Promise<void> {
  const form = formRef.value;
  if (!form) return;
  await form.validate();
  dialogLoading.value = true;
  try {
    if (dialogMode.value === "create") {
      await postAppVersionApi({
        version: formModel.version,
        platform: formModel.platform,
        description: formModel.description?.trim() || undefined,
        downloadUrl: formModel.downloadUrl?.trim() || undefined,
        forceUpgrade: Boolean(formModel.forceUpgrade),
      });
      ElMessage.success("创建成功");
    } else {
      await putAppVersionApi(editingId.value, {
        description: formModel.description?.trim() || undefined,
        downloadUrl: formModel.downloadUrl?.trim() || undefined,
        forceUpgrade: Boolean(formModel.forceUpgrade),
      });
      ElMessage.success("修改成功");
    }
    dialogVisible.value = false;
    await fetchList();
  } finally {
    dialogLoading.value = false;
  }
}

async function submitStatus(): Promise<void> {
  if (!statusReason.value.trim()) {
    ElMessage.warning("请填写操作原因");
    return;
  }
  statusLoading.value = true;
  try {
    await putAppVersionStatusApi(statusId.value, { status: statusTarget.value, reason: statusReason.value.trim() });
    ElMessage.success(statusTarget.value === "published" ? "发布成功" : "下线成功");
    statusVisible.value = false;
    await fetchList();
  } finally {
    statusLoading.value = false;
  }
}

onMounted(() => {
  void fetchList();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">创建 APP 版本</el-button>
      <el-button :disabled="loading" @click="fetchList">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="items" border style="width: 100%">
      <el-table-column prop="version" label="版本号" min-width="160" />
      <el-table-column prop="platform" label="平台" min-width="120">
        <template #default="{ row }: { row: AppConfig.AppVersion }">
          <el-tag type="info">{{ row.platform }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="forceUpgrade" label="强制升级" min-width="120">
        <template #default="{ row }: { row: AppConfig.AppVersion }">
          <el-tag :type="row.forceUpgrade ? 'danger' : 'info'">{{ row.forceUpgrade ? "是" : "否" }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="downloadUrl" label="下载地址" min-width="280" show-overflow-tooltip />
      <el-table-column prop="description" label="更新说明" min-width="260" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" min-width="120">
        <template #default="{ row }: { row: AppConfig.AppVersion }">
          <el-tag :type="statusTagTypes[row.status]">{{ statusLabels[row.status] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" min-width="180" show-overflow-tooltip />
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }: { row: AppConfig.AppVersion }">
          <el-button size="small" type="primary" link @click="openEdit(row)">修改</el-button>
          <el-button size="small" type="warning" link style="margin-left: 14px" @click="openStatus(row)">
            {{ row.status === "draft" ? "发布" : "下线" }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '创建 APP 版本' : '修改 APP 版本'" width="560px">
      <el-form ref="formRef" :model="formModel" :rules="formRules" label-width="90px">
        <el-form-item label="版本号" prop="version">
          <el-input v-model="formModel.version" :disabled="dialogMode === 'edit'" maxlength="32" show-word-limit />
        </el-form-item>
        <el-form-item label="平台" prop="platform">
          <el-select v-model="formModel.platform" :disabled="dialogMode === 'edit'" style="width: 100%">
            <el-option label="Android" value="android" />
            <el-option label="iOS" value="ios" />
          </el-select>
        </el-form-item>
        <el-form-item label="下载地址">
          <el-input v-model="formModel.downloadUrl" placeholder="https://..." maxlength="300" show-word-limit />
        </el-form-item>
        <el-form-item label="强制升级">
          <el-switch v-model="formModel.forceUpgrade" />
        </el-form-item>
        <el-form-item label="更新说明">
          <el-input
            v-model="formModel.description"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            maxlength="400"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button :disabled="dialogLoading" @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="dialogLoading" @click="submitForm">确定</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="statusVisible" :title="statusTitle" width="520px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="目标状态">
          <el-tag :type="statusTagTypes[statusTarget]">{{ statusLabels[statusTarget] }}</el-tag>
        </el-form-item>
        <el-form-item label="操作原因" required>
          <el-input
            v-model="statusReason"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            maxlength="200"
            show-word-limit
            placeholder="请填写本次操作原因（必填）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button :disabled="statusLoading" @click="statusVisible = false">取消</el-button>
          <el-button type="primary" :loading="statusLoading" @click="submitStatus">确定</el-button>
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
