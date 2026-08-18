<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import { ElMessage } from "element-plus";

import { AppConfig, getSystemLimitsApi, postSystemLimitsPublishApi, putSystemLimitsDraftApi } from "@/api/modules/appConfig";

type ActionMode = "draft" | "publish";

const loading = shallowRef(false);
const saving = shallowRef(false);

const publishedLimits = shallowRef<AppConfig.SystemLimits | null>(null);

const formModel = reactive<AppConfig.SystemLimits>({
  maxFileSizeMb: 0,
  maxForwardTargets: 0,
  maxGroupMembers: 0,
  maxNicknameLen: 0,
  recallWindowSec: 0,
});

const actionVisible = shallowRef(false);
const actionLoading = shallowRef(false);
const actionMode = shallowRef<ActionMode>("draft");
const actionReason = shallowRef("");

const actionTitle = computed(() => (actionMode.value === "draft" ? "保存系统限制草稿" : "发布系统限制配置"));

async function fetchPublished(): Promise<void> {
  loading.value = true;
  try {
    const res = await getSystemLimitsApi();
    publishedLimits.value = res.data ?? null;
    applyPublished();
  } finally {
    loading.value = false;
  }
}

function applyPublished(): void {
  const limits = publishedLimits.value ?? {};
  formModel.maxFileSizeMb = limits.maxFileSizeMb ?? 0;
  formModel.maxForwardTargets = limits.maxForwardTargets ?? 0;
  formModel.maxGroupMembers = limits.maxGroupMembers ?? 0;
  formModel.maxNicknameLen = limits.maxNicknameLen ?? 0;
  formModel.recallWindowSec = limits.recallWindowSec ?? 0;
}

function openAction(mode: ActionMode): void {
  actionMode.value = mode;
  actionReason.value = "";
  actionVisible.value = true;
}

async function submitAction(): Promise<void> {
  if (!actionReason.value.trim()) {
    ElMessage.warning("请填写操作原因");
    return;
  }
  actionLoading.value = true;
  try {
    if (actionMode.value === "draft") {
      await putSystemLimitsDraftApi({
        limits: {
          maxFileSizeMb: formModel.maxFileSizeMb,
          maxForwardTargets: formModel.maxForwardTargets,
          maxGroupMembers: formModel.maxGroupMembers,
          maxNicknameLen: formModel.maxNicknameLen,
          recallWindowSec: formModel.recallWindowSec,
        },
        reason: actionReason.value.trim(),
      });
      ElMessage.success("保存草稿成功");
    } else {
      await postSystemLimitsPublishApi({ reason: actionReason.value.trim() });
      ElMessage.success("发布成功");
      await fetchPublished();
    }
    actionVisible.value = false;
  } finally {
    actionLoading.value = false;
  }
}

async function refresh(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    await fetchPublished();
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void fetchPublished();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-button :disabled="loading || saving" @click="refresh">刷新已发布配置</el-button>
      <el-button :disabled="loading" @click="applyPublished">重置为已发布</el-button>
      <el-button type="primary" :disabled="loading" @click="openAction('draft')">保存草稿</el-button>
      <el-button type="danger" :disabled="loading" @click="openAction('publish')">发布配置</el-button>
    </div>

    <el-card shadow="never">
      <el-form :model="formModel" label-width="170px">
        <el-form-item label="单文件大小上限 (MB)">
          <el-input-number v-model="formModel.maxFileSizeMb" :min="0" :max="999999" />
        </el-form-item>
        <el-form-item label="单次转发目标数上限">
          <el-input-number v-model="formModel.maxForwardTargets" :min="0" :max="999999" />
        </el-form-item>
        <el-form-item label="单群成员数上限">
          <el-input-number v-model="formModel.maxGroupMembers" :min="0" :max="9999999" />
        </el-form-item>
        <el-form-item label="昵称最大长度">
          <el-input-number v-model="formModel.maxNicknameLen" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="消息撤回时间窗 (秒)">
          <el-input-number v-model="formModel.recallWindowSec" :min="0" :max="9999999" />
        </el-form-item>
      </el-form>
    </el-card>

    <el-dialog v-model="actionVisible" :title="actionTitle" width="560px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="操作原因" required>
          <el-input
            v-model="actionReason"
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
          <el-button :disabled="actionLoading" @click="actionVisible = false">取消</el-button>
          <el-button type="primary" :loading="actionLoading" @click="submitAction">确定</el-button>
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
  flex-wrap: wrap;
  gap: 10px;
}
</style>

