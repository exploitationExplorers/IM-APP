<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage } from "element-plus";

import {
  AppConfig,
  getLegalDocumentsApi,
  postLegalDocumentApi,
  postLegalDocumentPublishApi,
} from "@/api/modules/appConfig";

const loading = shallowRef(false);
const items = shallowRef<AppConfig.LegalDocument[]>([]);

const createVisible = shallowRef(false);
const createLoading = shallowRef(false);
const createFormRef = shallowRef<FormInstance>();

const createForm = reactive<AppConfig.ReqCreateLegalDocumentBody>({
  title: "",
  type: "user_agreement",
  version: "",
  language: "zh",
  contentUrl: "",
  reason: "",
});

const createRules: FormRules = {
  title: [{ required: true, message: "请输入标题", trigger: "blur" }],
  type: [{ required: true, message: "请选择类型", trigger: "change" }],
  version: [{ required: true, message: "请输入版本号", trigger: "blur" }],
  contentUrl: [{ required: true, message: "请输入内容 URL", trigger: "blur" }],
  reason: [{ required: true, message: "请输入操作原因", trigger: "blur" }],
};

const publishVisible = shallowRef(false);
const publishLoading = shallowRef(false);
const publishId = shallowRef("");
const publishForm = reactive<AppConfig.ReqPublishLegalDocumentBody>({
  reason: "",
  idempotencyKey: "",
  ticketNo: "",
});

const typeLabels: Record<AppConfig.LegalDocumentType, string> = {
  user_agreement: "用户服务协议",
  privacy_policy: "隐私政策",
};

const statusLabels: Record<AppConfig.LegalDocumentStatus, string> = {
  draft: "草稿",
  published: "已发布",
};

const statusTagTypes: Record<AppConfig.LegalDocumentStatus, string> = {
  draft: "info",
  published: "success",
};

const publishTitle = computed(() => "发布协议版本");

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    const res = await getLegalDocumentsApi();
    items.value = res.data ?? [];
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  createForm.title = "";
  createForm.type = "user_agreement";
  createForm.version = "";
  createForm.language = "zh";
  createForm.contentUrl = "";
  createForm.reason = "";
  createVisible.value = true;
}

async function submitCreate(): Promise<void> {
  const form = createFormRef.value;
  if (!form) return;
  await form.validate();
  createLoading.value = true;
  try {
    await postLegalDocumentApi({
      title: createForm.title.trim(),
      type: createForm.type,
      version: createForm.version.trim(),
      language: createForm.language?.trim() || undefined,
      contentUrl: createForm.contentUrl.trim(),
      reason: createForm.reason.trim(),
    });
    ElMessage.success("创建成功");
    createVisible.value = false;
    await fetchList();
  } finally {
    createLoading.value = false;
  }
}

function openPublish(row: AppConfig.LegalDocument): void {
  publishId.value = row.id;
  publishForm.reason = "";
  publishForm.idempotencyKey = "";
  publishForm.ticketNo = "";
  publishVisible.value = true;
}

async function submitPublish(): Promise<void> {
  if (!publishForm.reason.trim()) {
    ElMessage.warning("请填写操作原因");
    return;
  }
  publishLoading.value = true;
  try {
    await postLegalDocumentPublishApi(publishId.value, {
      reason: publishForm.reason.trim(),
      idempotencyKey: publishForm.idempotencyKey?.trim() || undefined,
      ticketNo: publishForm.ticketNo?.trim() || undefined,
    });
    ElMessage.success("发布成功");
    publishVisible.value = false;
    await fetchList();
  } finally {
    publishLoading.value = false;
  }
}

onMounted(() => {
  void fetchList();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">创建协议版本</el-button>
      <el-button :disabled="loading" @click="fetchList">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="items" border style="width: 100%">
      <el-table-column prop="type" label="类型" min-width="160">
        <template #default="{ row }: { row: AppConfig.LegalDocument }">
          <span>{{ typeLabels[row.type] }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
      <el-table-column prop="version" label="版本号" min-width="140" />
      <el-table-column prop="language" label="语言" min-width="120" />
      <el-table-column prop="status" label="状态" min-width="120">
        <template #default="{ row }: { row: AppConfig.LegalDocument }">
          <el-tag :type="statusTagTypes[row.status]">{{ statusLabels[row.status] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="publishedAt" label="发布时间" min-width="180" show-overflow-tooltip />
      <el-table-column prop="contentUrl" label="内容 URL" min-width="320" show-overflow-tooltip />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }: { row: AppConfig.LegalDocument }">
          <el-button v-if="row.status === 'draft'" size="small" type="primary" link @click="openPublish(row)"
            >发布</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="createVisible" title="创建协议版本" width="620px" destroy-on-close>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="类型" prop="type">
          <el-select v-model="createForm.type" style="width: 100%">
            <el-option label="用户服务协议" value="user_agreement" />
            <el-option label="隐私政策" value="privacy_policy" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题" prop="title">
          <el-input v-model="createForm.title" maxlength="80" show-word-limit />
        </el-form-item>
        <el-form-item label="版本号" prop="version">
          <el-input v-model="createForm.version" maxlength="32" show-word-limit />
        </el-form-item>
        <el-form-item label="语言">
          <el-input v-model="createForm.language" maxlength="16" show-word-limit placeholder="默认 zh" />
        </el-form-item>
        <el-form-item label="内容 URL" prop="contentUrl">
          <el-input v-model="createForm.contentUrl" maxlength="300" show-word-limit placeholder="https://..." />
        </el-form-item>
        <el-form-item label="操作原因" prop="reason">
          <el-input
            v-model="createForm.reason"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button :disabled="createLoading" @click="createVisible = false">取消</el-button>
          <el-button type="primary" :loading="createLoading" @click="submitCreate">确定</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="publishVisible" :title="publishTitle" width="560px" destroy-on-close>
      <el-form :model="publishForm" label-width="90px">
        <el-form-item label="幂等键">
          <el-input v-model="publishForm.idempotencyKey" maxlength="64" show-word-limit />
        </el-form-item>
        <el-form-item label="工单号">
          <el-input v-model="publishForm.ticketNo" maxlength="64" show-word-limit />
        </el-form-item>
        <el-form-item label="操作原因" required>
          <el-input
            v-model="publishForm.reason"
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
          <el-button :disabled="publishLoading" @click="publishVisible = false">取消</el-button>
          <el-button type="primary" :loading="publishLoading" @click="submitPublish">确定</el-button>
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
