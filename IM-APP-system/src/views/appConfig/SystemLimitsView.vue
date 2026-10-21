<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import { ElMessage } from "element-plus";

import { AppConfig, getGroupLimitImpactApi, getSystemLimitsApi, postSystemLimitsPublishApi, putSystemLimitsDraftApi } from "@/api/modules/appConfig";

type ActionMode = "draft" | "publish";

const loading = shallowRef(false);
const saving = shallowRef(false);

const publishedLimits = shallowRef<AppConfig.SystemLimits | null>(null);

const formModel = reactive<AppConfig.SystemLimits>({
  maxFileSizeMb: 0,
  maxForwardTargets: 0,
  maxGroupMembers: 0,
  defaultGroupMaxMembers: 0,
  groupMemberHardLimit: 4000,
  maxNicknameLen: 0,
  recallWindowSec: 0,
  groupRetentionMaxMessages: 3000,
  groupRetentionHours: 72,
});

const actionVisible = shallowRef(false);
const actionLoading = shallowRef(false);
const actionMode = shallowRef<ActionMode>("draft");
const actionReason = shallowRef("");
const groupImpact = shallowRef<AppConfig.GroupLimitImpact | null>(null);

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
  formModel.defaultGroupMaxMembers = limits.defaultGroupMaxMembers ?? 0;
  formModel.groupMemberHardLimit = limits.groupMemberHardLimit ?? 4000;
  formModel.maxNicknameLen = limits.maxNicknameLen ?? 0;
  formModel.recallWindowSec = limits.recallWindowSec ?? 0;
  formModel.groupRetentionMaxMessages = limits.groupRetentionMaxMessages ?? 3000;
  formModel.groupRetentionHours = limits.groupRetentionHours ?? 72;
}

async function openAction(mode: ActionMode): Promise<void> {
  actionMode.value = mode;
  actionReason.value = "";
  actionVisible.value = true;
  groupImpact.value = null;
  if (mode === "publish" && formModel.maxGroupMembers) {
    try { groupImpact.value = (await getGroupLimitImpactApi(formModel.maxGroupMembers)).data ?? null; } catch { /* 发布接口仍会做最终校验 */ }
  }
}

async function submitAction(): Promise<void> {
  if (!actionReason.value.trim()) {
    ElMessage.warning("请填写操作原因");
    return;
  }
  if ((formModel.defaultGroupMaxMembers ?? 0) > (formModel.maxGroupMembers ?? 0)) {
    ElMessage.warning("新群默认上限不能超过平台群人数上限");
    return;
  }
  if ((formModel.groupRetentionMaxMessages ?? 0) < 1 || (formModel.groupRetentionMaxMessages ?? 0) > 20000) {
    ElMessage.warning("群消息保留条数须在 1～20000");
    return;
  }
  if ((formModel.groupRetentionHours ?? 0) < 1 || (formModel.groupRetentionHours ?? 0) > 2160) {
    ElMessage.warning("群消息保留小时须在 1～2160");
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
          defaultGroupMaxMembers: formModel.defaultGroupMaxMembers,
          maxNicknameLen: formModel.maxNicknameLen,
          recallWindowSec: formModel.recallWindowSec,
          groupRetentionMaxMessages: formModel.groupRetentionMaxMessages,
          groupRetentionHours: formModel.groupRetentionHours,
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
          <el-input-number v-model="formModel.maxGroupMembers" :min="3" :max="formModel.groupMemberHardLimit || 4000" />
          <el-text type="info" class="limit-tip">技术安全上限 {{ formModel.groupMemberHardLimit || 4000 }}（环境变量控制）</el-text>
        </el-form-item>
        <el-form-item label="新建群默认人数上限">
          <el-input-number v-model="formModel.defaultGroupMaxMembers" :min="3" :max="formModel.maxGroupMembers || 3" />
        </el-form-item>
        <el-form-item label="昵称最大长度">
          <el-input-number v-model="formModel.maxNicknameLen" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="消息撤回时间窗 (秒)">
          <el-input-number v-model="formModel.recallWindowSec" :min="0" :max="9999999" />
        </el-form-item>
        <el-form-item label="群消息保留条数">
          <el-input-number v-model="formModel.groupRetentionMaxMessages" :min="1" :max="20000" />
          <el-text type="info" class="limit-tip">与时间窗口取并集：最近 N 条始终保留（默认 3000）；仅「超条数且超窗口」才清理</el-text>
        </el-form-item>
        <el-form-item label="群消息保留小时">
          <el-input-number v-model="formModel.groupRetentionHours" :min="1" :max="2160" />
          <el-text type="info" class="limit-tip">滚动窗口，默认 72（3 天）必须保留；不足条数时超窗消息也保留。提高上限不会恢复已被隐藏的旧消息</el-text>
        </el-form-item>
      </el-form>
    </el-card>

    <el-dialog v-model="actionVisible" :title="actionTitle" width="560px" destroy-on-close>
	  <el-alert
		v-if="actionMode === 'publish' && groupImpact"
		type="warning"
		:closable="false"
		show-icon
		:title="`发布后 ${groupImpact.configuredAboveLimit} 个群的单群配置会被平台上限截断；${groupImpact.currentlyOverLimit} 个群将进入只出不进状态。`"
	  />
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
.limit-tip { margin-left: 12px; }
</style>

