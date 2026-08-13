<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import type { SystemUser, UserDraft, UserStatus } from "../../types/system";

const props = defineProps<{
  modelValue: boolean;
  user: SystemUser | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [draft: UserDraft];
}>();

const formRef = ref<FormInstance>();
const isEditing = computed(() => props.user !== null);
const title = computed(() => (isEditing.value ? "编辑用户" : "新增用户"));

const draft = reactive<UserDraft>({
  name: "",
  account: "",
  email: "",
  role: "普通成员",
  status: "active",
});

const rules: FormRules<UserDraft> = {
  name: [{ required: true, message: "请输入用户姓名", trigger: "blur" }],
  account: [{ required: true, message: "请输入登录账号", trigger: "blur" }],
  email: [
    {
      required: true,
      type: "email",
      message: "请输入有效的邮箱地址",
      trigger: "blur",
    },
  ],
  role: [{ required: true, message: "请选择用户角色", trigger: "change" }],
};

function resetDraft(user: SystemUser | null): void {
  draft.name = user?.name ?? "";
  draft.account = user?.account ?? "";
  draft.email = user?.email ?? "";
  draft.role = user?.role ?? "普通成员";
  draft.status = user?.status ?? "active";
}

watch(
  () => [props.modelValue, props.user] as const,
  ([isVisible, user]) => {
    if (isVisible) resetDraft(user);
  },
  { immediate: true },
);

function close(): void {
  emit("update:modelValue", false);
}

async function submit(): Promise<void> {
  const isValid = await formRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!isValid) return;

  emit("save", { ...draft, status: draft.status as UserStatus });
  close();
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="title"
    size="440px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form ref="formRef" :model="draft" :rules="rules" label-position="top">
      <el-form-item label="用户姓名" prop="name">
        <el-input v-model="draft.name" placeholder="例如：陈安" />
      </el-form-item>
      <el-form-item label="登录账号" prop="account">
        <el-input v-model="draft.account" placeholder="例如：chen.an" />
      </el-form-item>
      <el-form-item label="邮箱" prop="email">
        <el-input v-model="draft.email" placeholder="name@example.com" />
      </el-form-item>
      <el-form-item label="角色" prop="role">
        <el-select v-model="draft.role" class="full-width">
          <el-option label="超级管理员" value="超级管理员" />
          <el-option label="运营管理员" value="运营管理员" />
          <el-option label="普通成员" value="普通成员" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="draft.status">
          <el-radio value="active">启用</el-radio>
          <el-radio value="disabled">停用</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="drawer-footer">
        <el-button @click="close">取消</el-button>
        <el-button type="primary" @click="submit">
          {{ isEditing ? "保存修改" : "新增用户" }}
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.full-width {
  width: 100%;
}
.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
