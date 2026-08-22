<script setup lang="ts">
import { onMounted, reactive, shallowRef, watch } from "vue";
import { RefreshLeft, Search } from "@element-plus/icons-vue";

import {
  AdminMessageAudit,
  getAdminMessagesApi,
  getAdminMessageFailuresApi,
} from "@/api/modules/messageAudit";

type PeerType = AdminMessageAudit.PeerType;

// OpenIM 数字消息类型 → 中文（复用转发风控口径）
const CONTENT_TYPE_MAP: Record<number, string> = {
  101: "文本",
  102: "图片",
  103: "语音",
  104: "视频",
  105: "文件",
  106: "@消息",
  107: "合并转发",
  108: "名片",
  114: "引用",
};

function formatContentType(value?: number | null): string {
  if (!value) return "—";
  return CONTENT_TYPE_MAP[value] ?? `其他(${value})`;
}

// 失败码 → 中文：服务端拦截码 + 客户端上报码（扩展）
const FAIL_CODE_LABEL_MAP: Record<string, string> = {
  // 服务端 beforeSend 拦截
  blocked: "已被拉黑",
  not_friend: "非好友关系",
  self: "不能发给自己",
  sender_inactive: "发送方账号停用",
  account_inactive: "对方账号停用",
  group_inactive: "群不可用",
  group_dissolved: "群已解散",
  member_muted: "已被禁言",
  group_muted: "全员禁言",
  "message restricted by admin": "被管理员限制发言",
  // 客户端上报
  upload_timeout: "上传超时",
  upload_failed: "上传失败",
  create_failed: "消息创建失败",
  send_timeout: "发送超时",
  send_failed: "发送失败",
  network_error: "网络错误",
};

function formatFailCode(code?: string | null): string {
  const key = String(code ?? "").trim();
  if (!key) return "—";
  return FAIL_CODE_LABEL_MAP[key] ?? key;
}

const STAGE_LABEL_MAP: Record<string, string> = {
  create: "创建",
  upload: "上传",
  send: "发送",
  timeout: "超时",
  blocked: "拦截",
};

function formatStage(stage?: string | null): string {
  const key = String(stage ?? "").trim();
  if (!key) return "—";
  return STAGE_LABEL_MAP[key] ?? key;
}

function formatSource(source?: string | null): string {
  if (source === "before_hook") return "服务端拦截";
  if (source === "client") return "客户端";
  return source ? String(source) : "—";
}

function peerTypeLabel(peer?: PeerType | null): string {
  if (peer === "group") return "群聊";
  if (peer === "c2c") return "单聊";
  return "—";
}

// 发送方/接收方展示：昵称（im_id）
function nameWithId(name?: string, id?: string): string {
  const n = String(name ?? "").trim();
  const i = String(id ?? "").trim();
  if (n && i) return `${n}（${i}）`;
  return n || i || "—";
}

// 成功记录接收方：群聊显示群名，单聊显示接收人
function recordTarget(row: AdminMessageAudit.MessageRecord): string {
  if (row.peerType === "group") return `群 ${nameWithId(row.groupName, row.groupImId)}`;
  return nameWithId(row.receiverNickname, row.receiverImId);
}

// 失败记录接收方
function failureTarget(row: AdminMessageAudit.MessageFailure): string {
  const prefix = row.peerType === "group" ? "群 " : "";
  return prefix + nameWithId(row.targetName, row.targetImId);
}

// 日期范围 → from/to 查询参数（to 补到当天 23:59:59，含当日）
function rangeToParams(range: [string, string] | null): { from?: string; to?: string } {
  if (!range || range.length !== 2) return {};
  const [from, to] = range;
  return {
    from: from || undefined,
    to: to ? `${to}T23:59:59` : undefined,
  };
}

const activeTab = shallowRef<"records" | "failures">("records");

const CONTENT_TYPE_OPTIONS = Object.entries(CONTENT_TYPE_MAP).map(([value, label]) => ({
  value: Number(value),
  label,
}));

/* ==================== Tab 1: 发送记录（成功） ==================== */
interface RecordFilters {
  senderKeyword: string;
  contentType: number | "";
  peerType: "" | PeerType;
  dateRange: [string, string] | null;
}

const recordFilters = reactive<RecordFilters>({ senderKeyword: "", contentType: "", peerType: "", dateRange: null });
const recordPage = shallowRef(1);
const recordSize = shallowRef(20);
const recordTotal = shallowRef(0);
const recordLoading = shallowRef(false);
const records = shallowRef<AdminMessageAudit.MessageRecord[]>([]);

async function fetchRecords(): Promise<void> {
  recordLoading.value = true;
  try {
    const res = await getAdminMessagesApi({
      page: recordPage.value,
      size: recordSize.value,
      senderKeyword: recordFilters.senderKeyword.trim() || undefined,
      contentType: recordFilters.contentType || undefined,
      peerType: recordFilters.peerType || undefined,
      ...rangeToParams(recordFilters.dateRange),
    });
    records.value = res.data?.items ?? [];
    recordTotal.value = res.data?.total ?? 0;
  } catch {
    records.value = [];
    recordTotal.value = 0;
  } finally {
    recordLoading.value = false;
  }
}

function applyRecordFilters(): void {
  recordPage.value = 1;
  fetchRecords();
}

function resetRecordFilters(): void {
  recordFilters.senderKeyword = "";
  recordFilters.contentType = "";
  recordFilters.peerType = "";
  recordFilters.dateRange = null;
  recordPage.value = 1;
  fetchRecords();
}

/* ==================== Tab 2: 发送失败 ==================== */
interface FailureFilters {
  senderKeyword: string;
  contentType: number | "";
  failCode: string;
  source: "" | AdminMessageAudit.FailureSource;
  dateRange: [string, string] | null;
}

const failureFilters = reactive<FailureFilters>({ senderKeyword: "", contentType: "", failCode: "", source: "", dateRange: null });
const failurePage = shallowRef(1);
const failureSize = shallowRef(20);
const failureTotal = shallowRef(0);
const failureLoading = shallowRef(false);
const failures = shallowRef<AdminMessageAudit.MessageFailure[]>([]);

async function fetchFailures(): Promise<void> {
  failureLoading.value = true;
  try {
    const res = await getAdminMessageFailuresApi({
      page: failurePage.value,
      size: failureSize.value,
      senderKeyword: failureFilters.senderKeyword.trim() || undefined,
      contentType: failureFilters.contentType || undefined,
      failCode: failureFilters.failCode.trim() || undefined,
      source: failureFilters.source || undefined,
      ...rangeToParams(failureFilters.dateRange),
    });
    failures.value = res.data?.items ?? [];
    failureTotal.value = res.data?.total ?? 0;
  } catch {
    failures.value = [];
    failureTotal.value = 0;
  } finally {
    failureLoading.value = false;
  }
}

function applyFailureFilters(): void {
  failurePage.value = 1;
  fetchFailures();
}

function resetFailureFilters(): void {
  failureFilters.senderKeyword = "";
  failureFilters.contentType = "";
  failureFilters.failCode = "";
  failureFilters.source = "";
  failureFilters.dateRange = null;
  failurePage.value = 1;
  fetchFailures();
}

watch([recordPage, recordSize], () => fetchRecords());
watch([failurePage, failureSize], () => fetchFailures());
watch(activeTab, (tab) => {
  if (tab === "records" && records.value.length === 0) fetchRecords();
  if (tab === "failures" && failures.value.length === 0) fetchFailures();
});

onMounted(() => {
  fetchRecords();
});
</script>

<template>
  <div class="table-box">
    <section class="card table-main">
      <el-tabs v-model="activeTab" type="border-card">
        <!-- ==================== Tab 1: 发送记录 ==================== -->
        <el-tab-pane label="发送记录" name="records">
          <div class="tab-search">
            <el-form :model="recordFilters" @submit.prevent="applyRecordFilters">
              <div class="search-grid">
                <div class="search-item">
                  <el-form-item>
                    <el-input
                      v-model="recordFilters.senderKeyword"
                      clearable
                      placeholder="发送人（昵称 / im_id）"
                      :prefix-icon="Search"
                      @keyup.enter="applyRecordFilters"
                    />
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-select v-model="recordFilters.contentType" clearable placeholder="消息类型" @change="applyRecordFilters">
                      <el-option v-for="opt in CONTENT_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-select v-model="recordFilters.peerType" clearable placeholder="会话类型" @change="applyRecordFilters">
                      <el-option label="单聊" value="c2c" />
                      <el-option label="群聊" value="group" />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-date-picker
                      v-model="recordFilters.dateRange"
                      type="daterange"
                      range-separator="至"
                      start-placeholder="开始日期"
                      end-placeholder="结束日期"
                      value-format="YYYY-MM-DD"
                      @change="applyRecordFilters"
                    />
                  </el-form-item>
                </div>
                <div class="search-operation">
                  <el-button type="primary" @click="applyRecordFilters">搜索</el-button>
                  <el-button :icon="RefreshLeft" @click="resetRecordFilters">重置</el-button>
                </div>
              </div>
            </el-form>
          </div>

          <el-table v-loading="recordLoading" :data="records" style="width: 100%">
            <el-table-column prop="createdAt" label="时间" min-width="180" />
            <el-table-column label="发送方" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ nameWithId(row.senderNickname, row.senderImId) }}</template>
            </el-table-column>
            <el-table-column label="接收方 / 群" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ recordTarget(row) }}</template>
            </el-table-column>
            <el-table-column label="会话类型" min-width="110">
              <template #default="{ row }">
                <el-tag effect="plain" round>{{ peerTypeLabel(row.peerType) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="消息类型" min-width="120">
              <template #default="{ row }">
                <el-tag effect="light" type="info">{{ formatContentType(row.contentType) }}</el-tag>
              </template>
            </el-table-column>
          </el-table>

          <div class="table-footer">
            <el-pagination
              background
              v-model:current-page="recordPage"
              v-model:page-size="recordSize"
              :total="recordTotal"
              :page-sizes="[10, 20, 50, 100]"
              layout="total, sizes, prev, pager, next, jumper"
            />
          </div>
        </el-tab-pane>

        <!-- ==================== Tab 2: 发送失败 ==================== -->
        <el-tab-pane label="发送失败" name="failures">
          <div class="tab-search">
            <el-form :model="failureFilters" @submit.prevent="applyFailureFilters">
              <div class="search-grid">
                <div class="search-item">
                  <el-form-item>
                    <el-input
                      v-model="failureFilters.senderKeyword"
                      clearable
                      placeholder="发送人（昵称 / im_id）"
                      :prefix-icon="Search"
                      @keyup.enter="applyFailureFilters"
                    />
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-select v-model="failureFilters.contentType" clearable placeholder="消息类型" @change="applyFailureFilters">
                      <el-option v-for="opt in CONTENT_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-select v-model="failureFilters.source" clearable placeholder="来源" @change="applyFailureFilters">
                      <el-option label="客户端" value="client" />
                      <el-option label="服务端拦截" value="before_hook" />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-input
                      v-model="failureFilters.failCode"
                      clearable
                      placeholder="失败码（如 upload_timeout）"
                      @keyup.enter="applyFailureFilters"
                    />
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-date-picker
                      v-model="failureFilters.dateRange"
                      type="daterange"
                      range-separator="至"
                      start-placeholder="开始日期"
                      end-placeholder="结束日期"
                      value-format="YYYY-MM-DD"
                      @change="applyFailureFilters"
                    />
                  </el-form-item>
                </div>
                <div class="search-operation">
                  <el-button type="primary" @click="applyFailureFilters">搜索</el-button>
                  <el-button :icon="RefreshLeft" @click="resetFailureFilters">重置</el-button>
                </div>
              </div>
            </el-form>
          </div>

          <el-table v-loading="failureLoading" :data="failures" style="width: 100%">
            <el-table-column prop="createdAt" label="时间" min-width="180" />
            <el-table-column label="发送方" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">{{ nameWithId(row.senderNickname, row.senderImId) }}</template>
            </el-table-column>
            <el-table-column label="接收方 / 群" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">{{ failureTarget(row) }}</template>
            </el-table-column>
            <el-table-column label="会话类型" min-width="100">
              <template #default="{ row }">
                <el-tag effect="plain" round>{{ peerTypeLabel(row.peerType) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="消息类型" min-width="110">
              <template #default="{ row }">
                <el-tag effect="light" type="info">{{ formatContentType(row.contentType) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="来源" min-width="110">
              <template #default="{ row }">{{ formatSource(row.source) }}</template>
            </el-table-column>
            <el-table-column label="阶段" min-width="90">
              <template #default="{ row }">{{ formatStage(row.stage) }}</template>
            </el-table-column>
            <el-table-column label="失败原因" min-width="240" show-overflow-tooltip>
              <template #default="{ row }">
                <div>
                  <el-tag type="danger" effect="light">{{ formatFailCode(row.failCode) }}</el-tag>
                </div>
                <div v-if="row.failMessage" class="fail-message">{{ row.failMessage }}</div>
              </template>
            </el-table-column>
          </el-table>

          <div class="table-footer">
            <el-pagination
              background
              v-model:current-page="failurePage"
              v-model:page-size="failureSize"
              :total="failureTotal"
              :page-sizes="[10, 20, 50, 100]"
              layout="total, sizes, prev, pager, next, jumper"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>
  </div>
</template>

<style scoped lang="scss">
.fail-message {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
