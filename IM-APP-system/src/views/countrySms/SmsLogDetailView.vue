<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft, RefreshLeft } from "@element-plus/icons-vue";

import { getAdminSmsLogDetailApi } from "@/api/modules/countrySms";

const route = useRoute();
const router = useRouter();

const detailLoading = shallowRef(false);
const detail = shallowRef<Record<string, unknown> | null>(null);

const logId = computed(() => String(route.params.id ?? ""));

const displayEntries = computed(() => {
  const raw = detail.value;
  if (!raw) return [];

  const priorityKeys = [
    "id",
    "phoneMasked",
    "countryCode",
    "provider",
    "scene",
    "status",
    "errorCode",
    "createdAt",
  ];

  const known = priorityKeys
    .filter((key) => key in raw)
    .map((key) => ({ key, value: raw[key] }));

  const rest = Object.keys(raw)
    .filter((k) => !priorityKeys.includes(k))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ key, value: raw[key] }));

  return [...known, ...rest];
});

function formatValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatLabel(key: string): string {
  const map: Record<string, string> = {
    id: "日志ID",
    phoneMasked: "手机号（脱敏）",
    countryCode: "国家码",
    provider: "供应商",
    scene: "场景",
    status: "状态",
    errorCode: "错误码",
    createdAt: "创建时间",
  };
  return map[key] ?? key;
}

function goBack(): void {
  router.push("/country-sms/sms-logs");
}

async function fetchDetail(): Promise<void> {
  if (!logId.value) return;
  detailLoading.value = true;
  try {
    const res = await getAdminSmsLogDetailApi(logId.value);
    detail.value = (res.data as unknown as Record<string, unknown>) ?? null;
  } catch {
    detail.value = null;
    ElMessage.error("获取详情失败");
  } finally {
    detailLoading.value = false;
  }
}

onMounted(() => {
  fetchDetail();
});
</script>

<template>
  <div class="detail-box">
    <section class="card detail-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" @click="goBack">返回列表</el-button>
      </div>
      <div class="header-right">
        <el-button :icon="RefreshLeft" @click="fetchDetail">刷新</el-button>
      </div>
    </section>

    <section class="card detail-main">
      <el-skeleton :loading="detailLoading" animated>
        <template #template>
          <el-skeleton :rows="8" />
        </template>
        <template #default>
          <el-empty v-if="!detail" description="暂无数据" />
          <el-descriptions v-else :column="2" border>
            <el-descriptions-item v-for="item in displayEntries" :key="item.key" :label="formatLabel(item.key)">
              <span class="mono-text">{{ formatValue(item.value) }}</span>
            </el-descriptions-item>
          </el-descriptions>
        </template>
      </el-skeleton>
    </section>
  </div>
</template>

<style scoped lang="scss">
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mono-text {
  font-family: ui-monospace, sfmono-regular, menlo, monaco, consolas, "Liberation Mono", "Courier New", monospace;
  word-break: break-all;
}
</style>

