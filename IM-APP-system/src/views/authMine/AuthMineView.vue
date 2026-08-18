<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { useRouter } from "vue-router";
import { logoutAllApi, logoutApi } from "@/api/modules/auth";
import { changeMyPasswordApi, disableMyMfaApi, getMeApi, getMyMfaApi, setupMyMfaApi } from "@/api/modules/me";
import type { Me } from "@/api/interface";
import { useAuthStore } from "@/stores/auth";

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
}

interface LogoutAllForm {
  reason: string;
  ticketNo: string;
}

interface MfaCodeForm {
  code: string;
}

const auth = useAuthStore();
const router = useRouter();

const meLoading = shallowRef(false);
const meResult = shallowRef<Me.ResMeResult | null>(null);

const mfaLoading = shallowRef(false);
const mfaStatus = shallowRef<Me.ResMfaStatus | null>(null);

const passwordFormRef = shallowRef<FormInstance>();
const passwordLoading = shallowRef(false);
const passwordForm = reactive<PasswordForm>({
  oldPassword: "",
  newPassword: "",
});

const logoutAllFormRef = shallowRef<FormInstance>();
const logoutAllLoading = shallowRef(false);
const logoutAllForm = reactive<LogoutAllForm>({
  reason: "",
  ticketNo: "",
});

const setupFormRef = shallowRef<FormInstance>();
const setupLoading = shallowRef(false);
const setupForm = reactive<MfaCodeForm>({ code: "" });

const disableFormRef = shallowRef<FormInstance>();
const disableLoading = shallowRef(false);
const disableForm = reactive<MfaCodeForm>({ code: "" });

const permissions = computed(() => {
  if (meResult.value?.permissions?.length) return meResult.value.permissions;
  return auth.permissions;
});

const passwordRules: FormRules<PasswordForm> = {
  oldPassword: [{ required: true, message: "请输入原密码", trigger: "blur" }],
  newPassword: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    { min: 6, message: "新密码至少 6 位", trigger: "blur" },
  ],
};

const logoutAllRules: FormRules<LogoutAllForm> = {
  reason: [{ required: true, message: "请填写操作原因", trigger: "blur" }],
};

const mfaRules: FormRules<MfaCodeForm> = {
  code: [
    { required: true, message: "请输入 6 位验证码", trigger: "blur" },
    { pattern: /^\d{6}$/, message: "验证码格式不正确", trigger: "blur" },
  ],
};

async function fetchMe(): Promise<void> {
  meLoading.value = true;
  try {
    const res = await getMeApi();
    meResult.value = res.data;
    auth.setMe(res.data);
  } catch {
  } finally {
    meLoading.value = false;
  }
}

async function fetchMfa(): Promise<void> {
  mfaLoading.value = true;
  try {
    const res = await getMyMfaApi();
    mfaStatus.value = res.data;
  } catch {
    mfaStatus.value = null;
  } finally {
    mfaLoading.value = false;
  }
}

async function handleLogout(): Promise<void> {
  const refreshToken = auth.refreshToken;
  if (refreshToken) {
    try {
      await logoutApi({ refreshToken });
    } catch {
    }
  }
  auth.logout();
  await router.push("/login");
}

async function handleLogoutAll(): Promise<void> {
  const ok = await logoutAllFormRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!ok || logoutAllLoading.value) return;

  const idempotencyKey =
    typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
      ? (crypto as any).randomUUID()
      : undefined;

  logoutAllLoading.value = true;
  try {
    await logoutAllApi({
      idempotencyKey,
      reason: logoutAllForm.reason.trim(),
      ticketNo: logoutAllForm.ticketNo.trim() || undefined,
    });
    ElMessage.success("已退出全部会话");
    auth.logout();
    await router.push("/login");
  } catch {
  } finally {
    logoutAllLoading.value = false;
  }
}

async function submitPasswordChange(): Promise<void> {
  const ok = await passwordFormRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!ok || passwordLoading.value) return;

  passwordLoading.value = true;
  try {
    await changeMyPasswordApi({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    });
    ElMessage.success("密码修改成功");
    passwordForm.oldPassword = "";
    passwordForm.newPassword = "";
    passwordFormRef.value?.clearValidate();
  } catch {
  } finally {
    passwordLoading.value = false;
  }
}

async function submitSetupMfa(): Promise<void> {
  const ok = await setupFormRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!ok || setupLoading.value) return;

  setupLoading.value = true;
  try {
    await setupMyMfaApi({ code: setupForm.code });
    ElMessage.success("MFA 已启用");
    setupForm.code = "";
    setupFormRef.value?.clearValidate();
    await fetchMfa();
  } catch {
  } finally {
    setupLoading.value = false;
  }
}

async function submitDisableMfa(): Promise<void> {
  const ok = await disableFormRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!ok || disableLoading.value) return;

  disableLoading.value = true;
  try {
    await disableMyMfaApi({ code: disableForm.code });
    ElMessage.success("MFA 已关闭");
    disableForm.code = "";
    disableFormRef.value?.clearValidate();
    await fetchMfa();
  } catch {
  } finally {
    disableLoading.value = false;
  }
}

async function copySecret(): Promise<void> {
  const secret = mfaStatus.value?.secret;
  if (!secret) return;
  try {
    await navigator.clipboard.writeText(secret);
    ElMessage.success("已复制");
  } catch {
    ElMessage.warning("复制失败，请手动复制");
  }
}

onMounted(() => {
  fetchMe();
  fetchMfa();
});
</script>

<template>
  <div class="auth-mine">
    <el-row :gutter="12">
      <el-col :span="24" :lg="12">
        <section class="card block" v-loading="meLoading">
          <h3 class="block-title">我的资料</h3>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="管理员账号">{{ meResult?.admin?.username || auth.profile.username || "—" }}</el-descriptions-item>
            <el-descriptions-item label="昵称">{{ meResult?.admin?.nickname || auth.profile.name || "—" }}</el-descriptions-item>
            <el-descriptions-item label="角色">{{ auth.profile.role || "—" }}</el-descriptions-item>
            <el-descriptions-item label="MFA">{{ mfaStatus?.enabled ? "已启用" : "未启用" }}</el-descriptions-item>
          </el-descriptions>

          <div class="permissions">
            <div class="permissions-label">权限列表</div>
            <div class="permissions-tags">
              <el-tag v-for="p in permissions" :key="p" size="small" effect="plain">{{ p }}</el-tag>
              <span v-if="!permissions.length" class="muted">—</span>
            </div>
          </div>
        </section>
      </el-col>

      <el-col :span="24" :lg="12">
        <section class="card block" v-loading="mfaLoading">
          <h3 class="block-title">MFA 管理</h3>

          <div v-if="mfaStatus?.enabled === false">
            <el-alert title="当前未启用 MFA" type="warning" show-icon :closable="false" />
            <div class="mfa-secret" v-if="mfaStatus?.secret">
              <div class="mfa-secret-label">绑定密钥</div>
              <div class="mfa-secret-row">
                <el-input :model-value="mfaStatus.secret" readonly />
                <el-button type="primary" plain @click="copySecret">复制</el-button>
              </div>
            </div>

            <el-form ref="setupFormRef" :model="setupForm" :rules="mfaRules" label-width="110px" class="mfa-form">
              <el-form-item label="TOTP 验证码" prop="code">
                <el-input v-model="setupForm.code" placeholder="输入 6 位验证码" maxlength="6" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="setupLoading" @click="submitSetupMfa">启用 MFA</el-button>
              </el-form-item>
            </el-form>
          </div>

          <div v-else-if="mfaStatus?.enabled === true">
            <el-alert title="当前已启用 MFA" type="success" show-icon :closable="false" />
            <el-form ref="disableFormRef" :model="disableForm" :rules="mfaRules" label-width="110px" class="mfa-form">
              <el-form-item label="TOTP 验证码" prop="code">
                <el-input v-model="disableForm.code" placeholder="输入 6 位验证码" maxlength="6" />
              </el-form-item>
              <el-form-item>
                <el-button type="danger" :loading="disableLoading" @click="submitDisableMfa">关闭 MFA</el-button>
              </el-form-item>
            </el-form>
          </div>

          <el-empty v-else description="暂无法获取 MFA 状态" :image-size="70" />
        </section>
      </el-col>

      <el-col :span="24" :lg="12">
        <section class="card block">
          <h3 class="block-title">修改密码</h3>
          <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-width="100px" @submit.prevent="submitPasswordChange">
            <el-form-item label="原密码" prop="oldPassword">
              <el-input v-model="passwordForm.oldPassword" type="password" show-password autocomplete="current-password" />
            </el-form-item>
            <el-form-item label="新密码" prop="newPassword">
              <el-input v-model="passwordForm.newPassword" type="password" show-password autocomplete="new-password" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="passwordLoading" @click="submitPasswordChange">保存</el-button>
            </el-form-item>
          </el-form>
        </section>
      </el-col>

      <el-col :span="24" :lg="12">
        <section class="card block">
          <h3 class="block-title">会话管理</h3>
          <div class="session-actions">
            <el-button type="danger" plain @click="handleLogout">退出当前会话</el-button>
          </div>

          <el-divider />

          <el-form ref="logoutAllFormRef" :model="logoutAllForm" :rules="logoutAllRules" label-width="110px" class="logout-all-form">
            <el-form-item label="操作原因" prop="reason">
              <el-input v-model="logoutAllForm.reason" type="textarea" :rows="2" placeholder="必填：例如账号疑似泄露、交接等" />
            </el-form-item>
            <el-form-item label="关联工单号" prop="ticketNo">
              <el-input v-model="logoutAllForm.ticketNo" placeholder="可选" />
            </el-form-item>
            <el-form-item>
              <el-button type="danger" :loading="logoutAllLoading" @click="handleLogoutAll">退出全部会话</el-button>
            </el-form-item>
          </el-form>
        </section>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped lang="scss">
.auth-mine {
  width: 100%;
}

.block {
  padding: 18px;
  margin-bottom: 12px;
}

.block-title {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.permissions {
  margin-top: 14px;
}

.permissions-label {
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.permissions-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.muted {
  color: var(--el-text-color-secondary);
}

.mfa-form {
  margin-top: 14px;
}

.mfa-secret {
  margin-top: 12px;
}

.mfa-secret-label {
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.mfa-secret-row {
  display: flex;
  gap: 10px;
}

.session-actions {
  display: flex;
  gap: 12px;
}

.logout-all-form {
  margin-top: 10px;
}
</style>

