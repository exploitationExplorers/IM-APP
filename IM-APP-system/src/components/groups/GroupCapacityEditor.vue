<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { postGroupMemberLimitApi } from "@/api/modules/adminGroups";
import { getSystemLimitsApi } from "@/api/modules/appConfig";

const props = defineProps<{ groupId: string; memberCount: number; maxMembers: number }>();
const emit = defineEmits<{ updated: [maxMembers: number] }>();
const value = ref(props.maxMembers);
const reason = ref("");
const saving = ref(false);
const technicalLimit = ref<number>();
watch(() => props.maxMembers, (next) => { value.value = next; });
onMounted(async () => {
  try { technicalLimit.value = (await getSystemLimitsApi()).data?.groupMemberHardLimit; } catch { /* 后端保存仍会校验 */ }
});

async function save(): Promise<void> {
  if (!reason.value.trim()) { ElMessage.warning("请填写调整原因"); return; }
  saving.value = true;
  try {
    await postGroupMemberLimitApi({ groupId: props.groupId, maxMembers: value.value, reason: reason.value.trim() });
    emit("updated", value.value);
    reason.value = "";
    ElMessage.success("群人数上限已更新");
  } finally { saving.value = false; }
}
</script>

<template>
  <div class="capacity-editor">
    <div class="capacity-row">
      <span>当前 {{ memberCount }} 人</span>
      <el-input-number v-model="value" :min="3" :max="technicalLimit" />
      <el-button type="primary" :loading="saving" @click="save">保存上限</el-button>
    </div>
    <el-input v-model="reason" maxlength="200" placeholder="调整原因（必填）" />
    <el-text v-if="technicalLimit" type="info">技术安全上限：{{ technicalLimit }}（环境配置）</el-text>
    <el-alert v-if="value < memberCount" type="warning" :closable="false" show-icon title="低于现有人数不会踢人；恢复到上限内之前禁止新增成员。" />
  </div>
</template>

<style scoped>.capacity-editor{display:grid;gap:10px}.capacity-row{display:flex;align-items:center;gap:12px}</style>
