<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { putGroupRetentionApi } from "@/api/modules/adminGroups";
import { getSystemLimitsApi } from "@/api/modules/appConfig";

const props = defineProps<{
  groupId: string;
  retentionMaxMessages?: number | null;
  retentionKeepHours?: number | null;
}>();
const emit = defineEmits<{
  updated: [payload: { retentionMaxMessages?: number | null; retentionKeepHours?: number | null }];
}>();

const usePlatformDefault = ref(props.retentionMaxMessages == null && props.retentionKeepHours == null);
const maxMessages = ref(props.retentionMaxMessages ?? 1500);
const keepHours = ref(props.retentionKeepHours ?? 168);
const platformMax = ref(1500);
const platformHours = ref(168);
const reason = ref("");
const saving = ref(false);

watch(
  () => [props.retentionMaxMessages, props.retentionKeepHours] as const,
  ([messages, hours]) => {
    usePlatformDefault.value = messages == null && hours == null;
    maxMessages.value = messages ?? platformMax.value;
    keepHours.value = hours ?? platformHours.value;
  },
);

onMounted(async () => {
  try {
    const limits = (await getSystemLimitsApi()).data;
    platformMax.value = limits?.groupRetentionMaxMessages ?? 1500;
    platformHours.value = limits?.groupRetentionHours ?? 168;
    if (usePlatformDefault.value) {
      maxMessages.value = platformMax.value;
      keepHours.value = platformHours.value;
    }
  } catch {
    /* 保存时后端仍会校验 */
  }
});

async function save(): Promise<void> {
  if (!reason.value.trim()) {
    ElMessage.warning("请填写调整原因");
    return;
  }
  saving.value = true;
  try {
    if (usePlatformDefault.value) {
      await putGroupRetentionApi(props.groupId, {
        usePlatformDefault: true,
        reason: reason.value.trim(),
      });
      emit("updated", { retentionMaxMessages: null, retentionKeepHours: null });
    } else {
      await putGroupRetentionApi(props.groupId, {
        usePlatformDefault: false,
        retentionMaxMessages: maxMessages.value,
        retentionKeepHours: keepHours.value,
        reason: reason.value.trim(),
      });
      emit("updated", {
        retentionMaxMessages: maxMessages.value,
        retentionKeepHours: keepHours.value,
      });
    }
    reason.value = "";
    ElMessage.success("群消息保留策略已更新");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="retention-editor">
    <div class="retention-row">
      <el-checkbox v-model="usePlatformDefault">
        使用平台默认（{{ platformMax }} 条 / {{ platformHours }} 小时）
      </el-checkbox>
    </div>
    <div v-if="!usePlatformDefault" class="retention-row">
      <span>保留条数</span>
      <el-input-number v-model="maxMessages" :min="1" :max="20000" />
      <span>保留小时</span>
      <el-input-number v-model="keepHours" :min="1" :max="2160" />
    </div>
    <el-input v-model="reason" maxlength="200" placeholder="调整原因（必填）" />
    <el-button type="primary" :loading="saving" @click="save">保存保留策略</el-button>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="提高上限不会恢复已被策略隐藏的旧消息；缩小上限在下次保留任务后生效。"
    />
  </div>
</template>

<style scoped>
.retention-editor {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}
.retention-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
</style>
