<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import type { Rbac } from "../../api/modules/rbac";

export interface AdminDraft {
  username: string;
  nickname: string;
  password: string;
  roleIds: string[];
  status: Rbac.Status;
}

const props = defineProps<{
  modelValue: boolean;
  admin: Rbac.AdminAccount | null;
  roleOptions: Rbac.Role[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [draft: AdminDraft];
}>();

const formRef = ref<FormInstance>();
const isEditing = computed(() => props.admin !== null);
const title = computed(() => (isEditing.value ? "编辑管理员" : "新增管理员"));

const draft = reactive<AdminDraft>({
  username: "",
  nickname: "",
  password: "",
  roleIds: [],
  status: "active",
});

const rules = computed<FormRules<AdminDraft>>(() => ({
  username: [{ required: true, message: "请输入登录账号", trigger: "blur" }],
  password: isEditing.value
    ? [
        {
          validator: (_rule, value: string, callback) => {
            if (value && value.length < 6) callback(new Error("密码至少 6 位"));
            else callback();
          },
          trigger: "blur",
        },
      ]
    : [
        { required: true, message: "请输入初始密码", trigger: "blur" },
        { min: 6, message: "密码至少 6 位", trigger: "blur" },
      ],
}));

function resetDraft(admin: Rbac.AdminAccount | null): void {
  draft.username = admin?.username ?? "";
  draft.nickname = admin?.nickname ?? "";
  draft.password = "";
  draft.roleIds = [...(admin?.roleIds ?? [])];
  draft.status = admin?.status === "disabled" ? "disabled" : "active";
}

watch(
  () => [props.modelValue, props.admin] as const,
  ([isVisible, admin]) => {
    if (isVisible) resetDraft(admin);
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

  emit("save", {
    username: draft.username.trim(),
    nickname: draft.nickname.trim(),
    password: draft.password,
    roleIds: [...draft.roleIds],
    status: draft.status,
  });
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
      <el-form-item label="登录账号" prop="username">
        <el-input
          v-model="draft.username"
          placeholder="登录账号"
          :disabled="isEditing"
          autocomplete="off"
        />
      </el-form-item>
      <el-form-item label="昵称">
        <el-input v-model="draft.nickname" placeholder="昵称（可选）" />
      </el-form-item>
      <el-form-item :label="isEditing ? '新密码' : '初始密码'" prop="password">
        <el-input
          v-model="draft.password"
          type="password"
          show-password
          :placeholder="isEditing ? '不填则不修改' : '至少 6 位'"
          autocomplete="new-password"
        />
      </el-form-item>
      <el-form-item label="角色">
        <el-select
          v-model="draft.roleIds"
          multiple
          clearable
          filterable
          class="full-width"
          placeholder="选择角色"
        >
          <el-option
            v-for="role in roleOptions"
            :key="role.id"
            :label="role.name"
            :value="role.id"
          />
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
          {{ isEditing ? "保存修改" : "新增管理员" }}
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
