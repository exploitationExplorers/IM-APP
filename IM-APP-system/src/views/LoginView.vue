<script setup lang="ts">
import { reactive, shallowRef } from "vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { CircleClose, Lock, User, UserFilled } from "@element-plus/icons-vue";
import { useRouter } from "vue-router";
import { loginApi, verifyMfaApi } from "@/api/modules/auth";
import { getMeApi } from "@/api/modules/me";
import loginBackground from "../assets/images/login_bg.svg";
import loginIllustration from "../assets/images/login_left.png";
import logo from "../assets/images/logo.svg";
import { useAuthStore } from "../stores/auth";

interface LoginForm {
  username: string;
  password: string;
}

interface MfaForm {
  code: string;
}

const router = useRouter();
const auth = useAuthStore();
const formRef = shallowRef<FormInstance>();
const mfaFormRef = shallowRef<FormInstance>();
const loading = shallowRef(false);
const mfaVisible = shallowRef(false);
const mfaLoading = shallowRef(false);
const mfaChallengeToken = shallowRef("");

const form = reactive<LoginForm>({
  username: "admin",
  password: "admin123",
});

const mfaForm = reactive<MfaForm>({ code: "" });

const rules: FormRules<LoginForm> = {
  username: [{ required: true, message: "请输入管理员账号", trigger: "blur" }],
  password: [{ required: true, message: "请输入登录密码", trigger: "blur" }],
};

const mfaRules: FormRules<MfaForm> = {
  code: [
    { required: true, message: "请输入 6 位验证码", trigger: "blur" },
    { pattern: /^\d{6}$/, message: "验证码格式不正确", trigger: "blur" },
  ],
};

function resetForm(): void {
  formRef.value?.resetFields();
}

function resetMfa(): void {
  mfaForm.code = "";
  mfaChallengeToken.value = "";
  mfaVisible.value = false;
}

async function submit(): Promise<void> {
  const isValid = await formRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!isValid || loading.value) return;

  loading.value = true;
  try {
    const res = await loginApi({
      username: form.username.trim(),
      password: form.password,
    });
    if (res.data?.mfaChallenge && !res.data?.token) {
      mfaChallengeToken.value = res.data.mfaChallenge;
      mfaForm.code = "";
      mfaVisible.value = true;
      ElMessage.warning("需要进行二次验证");
      return;
    }
    auth.setSession(res.data);
    try {
      const me = await getMeApi();
      auth.setMe(me.data);
    } catch {
    }
    ElMessage.success("欢迎回来");
    await router.push("/home");
  } catch {
  } finally {
    loading.value = false;
  }
}

async function submitMfa(): Promise<void> {
  const isValid = await mfaFormRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!isValid || mfaLoading.value) return;

  if (!mfaChallengeToken.value) {
    ElMessage.error("挑战凭证已失效，请重新登录");
    resetMfa();
    return;
  }

  mfaLoading.value = true;
  try {
    const res = await verifyMfaApi({
      challengeToken: mfaChallengeToken.value,
      code: mfaForm.code,
    });
    auth.setSession(res.data);
    try {
      const me = await getMeApi();
      auth.setMe(me.data);
    } catch {
    }
    ElMessage.success("验证通过");
    resetMfa();
    await router.push("/home");
  } catch {
  } finally {
    mfaLoading.value = false;
  }
}
</script>

<template>
  <main class="login-container" :style="{ backgroundImage: `url(${loginBackground})` }">
    <section class="login-box">
      <div class="login-left">
        <img class="login-left-img" :src="loginIllustration" alt="IM-APP 管理系统" />
      </div>
      <section class="login-form">
        <div class="login-logo">
          <img class="login-icon" :src="logo" alt="IM-APP" />
          <h1 class="logo-text">IM-APP</h1>
        </div>
        <el-form ref="formRef" :model="form" :rules="rules" size="large" @submit.prevent="submit">
          <el-form-item prop="username"
            ><el-input
              v-model="form.username"
              placeholder="管理员账号：admin"
              :prefix-icon="User"
              autocomplete="username"
          /></el-form-item>
          <el-form-item prop="password"
            ><el-input
              v-model="form.password"
              type="password"
              show-password
              placeholder="登录密码：admin123"
              :prefix-icon="Lock"
              autocomplete="current-password"
          /></el-form-item>
        </el-form>
        <div class="login-actions">
          <el-button :icon="CircleClose" round size="large" @click="resetForm">重置</el-button
          ><el-button
            :icon="UserFilled"
            round
            size="large"
            type="primary"
            :loading="loading"
            @click="submit"
            >登录</el-button
          >
        </div>
        <p class="login-hint">演示账号：admin · 密码：admin123</p>
      </section>
    </section>

    <el-dialog v-model="mfaVisible" title="二次验证" width="420px" :close-on-click-modal="false" @closed="resetMfa">
      <el-form ref="mfaFormRef" :model="mfaForm" :rules="mfaRules" size="large" @submit.prevent="submitMfa">
        <el-form-item prop="code">
          <el-input v-model="mfaForm.code" placeholder="请输入 6 位 TOTP 验证码" maxlength="6" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetMfa">取消</el-button>
        <el-button type="primary" :loading="mfaLoading" @click="submitMfa">验证</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<style scoped lang="scss">
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 550px;
  height: 100%;
  background-color: #eee;
  background-size: 100% 100%;
  background-size: cover;
}
.login-box {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-around;
  width: 96.5%;
  height: 94%;
  padding: 0 50px;
  background-color: rgb(255 255 255 / 80%);
  border-radius: 10px;
}
.login-left {
  width: 800px;
  margin-right: 10px;
}
.login-left-img {
  width: 100%;
  height: 100%;
}
.login-form {
  width: 420px;
  padding: 50px 40px 45px;
  background-color: #fff;
  border-radius: 10px;
  box-shadow: rgb(0 0 0 / 10%) 0 2px 10px 2px;
}
.login-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 45px;
}
.login-icon {
  width: 60px;
  height: 52px;
}
.logo-text {
  padding-left: 25px;
  margin: 0;
  color: #34495e;
  font-size: 42px;
  font-weight: 700;
  white-space: nowrap;
}
.login-form :deep(.el-form-item) {
  margin-bottom: 40px;
}
.login-actions {
  display: flex;
  justify-content: space-between;
  width: 100%;
  margin-top: 40px;
  white-space: nowrap;
}
.login-actions .el-button {
  width: 160px;
}
.login-hint {
  margin: 18px 0 0;
  color: #909399;
  font-size: 12px;
  text-align: center;
}
@media screen and (max-width: 1250px) {
  .login-left {
    display: none;
  }
}
@media screen and (max-width: 600px) {
  .login-box {
    padding: 0 12px;
  }
  .login-form {
    width: 97%;
    padding: 42px 22px;
  }
  .logo-text {
    padding-left: 14px;
    font-size: 29px;
  }
  .login-actions .el-button {
    width: calc(50% - 8px);
  }
}
</style>
