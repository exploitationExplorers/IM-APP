<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { RefreshLeft, Search, View, Plus, Delete, Edit } from "@element-plus/icons-vue";

const activeTab = shallowRef("region");

/* ============================================================
 *  Tab 1: 国家/地区启停
 * ============================================================ */
interface Region {
  id: number;
  name: string;
  code: string;
  enabled: boolean;
}

const regions = shallowRef<Region[]>([
  { id: 1, name: "中国大陆", code: "+86", enabled: true },
  { id: 2, name: "中国香港", code: "+852", enabled: true },
  { id: 3, name: "美国", code: "+1", enabled: true },
  { id: 4, name: "日本", code: "+81", enabled: false },
  { id: 5, name: "韩国", code: "+82", enabled: false },
  { id: 6, name: "新加坡", code: "+65", enabled: true },
  { id: 7, name: "马来西亚", code: "+60", enabled: false },
  { id: 8, name: "泰国", code: "+66", enabled: true },
]);

function toggleRegion(row: Region): void {
  row.enabled = !row.enabled;
  ElMessage.success(`${row.name} 已${row.enabled ? "启用" : "停用"}`);
}

/* ============================================================
 *  Tab 2: 短信发送记录
 * ============================================================ */
interface SmsRecord {
  id: number;
  phone: string;
  content: string;
  type: "验证码" | "通知" | "营销";
  sendTime: string;
}

const smsRecordFilters = reactive({ keyword: "", type: "" });
const smsRecordPage = shallowRef(1);
const smsRecordSize = shallowRef(10);

const smsRecords = shallowRef<SmsRecord[]>([
  { id: 1, phone: "138****1234", content: "您的验证码为 385921，请在5分钟内使用。", type: "验证码", sendTime: "2026-08-12 09:15" },
  { id: 2, phone: "159****5678", content: "您的账户已成功激活，欢迎使用。", type: "通知", sendTime: "2026-08-12 09:30" },
  { id: 3, phone: "186****9012", content: "限时优惠！全场商品8折起，点击查看详情。", type: "营销", sendTime: "2026-08-12 10:00" },
  { id: 4, phone: "133****3456", content: "您的验证码为 724018，请在5分钟内使用。", type: "验证码", sendTime: "2026-08-11 14:20" },
  { id: 5, phone: "150****7890", content: "系统升级通知：8月15日凌晨2点进行维护。", type: "通知", sendTime: "2026-08-11 16:45" },
  { id: 6, phone: "176****2345", content: "您的验证码为 519374，请在5分钟内使用。", type: "验证码", sendTime: "2026-08-11 18:00" },
  { id: 7, phone: "188****6789", content: "新功能上线！快来体验群组管理功能。", type: "营销", sendTime: "2026-08-10 10:30" },
]);

const filteredSmsRecords = computed(() => {
  const kw = smsRecordFilters.keyword.trim().toLowerCase();
  return smsRecords.value.filter((r) => {
    const matchKw = !kw || r.phone.includes(kw) || r.content.toLowerCase().includes(kw);
    const matchType = !smsRecordFilters.type || r.type === smsRecordFilters.type;
    return matchKw && matchType;
  });
});

const pageSmsRecords = computed(() => {
  const s = (smsRecordPage.value - 1) * smsRecordSize.value;
  return filteredSmsRecords.value.slice(s, s + smsRecordSize.value);
});

function resetSmsRecordFilters(): void {
  smsRecordFilters.keyword = "";
  smsRecordFilters.type = "";
  smsRecordPage.value = 1;
}

/* ============================================================
 *  Tab 3: 短信发送结果
 * ============================================================ */
interface SmsResult {
  id: number;
  phone: string;
  content: string;
  status: "success" | "failed" | "pending";
  errorCode: string;
  sendTime: string;
}

const smsResultFilters = reactive({ keyword: "", status: "" as "" | "success" | "failed" | "pending" });
const smsResultPage = shallowRef(1);
const smsResultSize = shallowRef(10);

const smsResults = shallowRef<SmsResult[]>([
  { id: 1, phone: "138****1234", content: "验证码 385921", status: "success", errorCode: "", sendTime: "2026-08-12 09:15" },
  { id: 2, phone: "159****5678", content: "账户激活通知", status: "success", errorCode: "", sendTime: "2026-08-12 09:30" },
  { id: 3, phone: "186****9012", content: "营销短信", status: "failed", errorCode: "ERR_QUOTA", sendTime: "2026-08-12 10:00" },
  { id: 4, phone: "133****3456", content: "验证码 724018", status: "success", errorCode: "", sendTime: "2026-08-11 14:20" },
  { id: 5, phone: "150****7890", content: "系统升级通知", status: "pending", errorCode: "", sendTime: "2026-08-11 16:45" },
  { id: 6, phone: "176****2345", content: "验证码 519374", status: "failed", errorCode: "ERR_INVALID", sendTime: "2026-08-11 18:00" },
]);

const SMS_RESULT_MAP: Record<string, string> = { success: "发送成功", failed: "发送失败", pending: "待发送" };

function smsResultTagType(status: string) {
  const map: Record<string, string> = { success: "success", failed: "danger", pending: "warning" };
  return map[status] ?? "info";
}

const filteredSmsResults = computed(() => {
  const kw = smsResultFilters.keyword.trim().toLowerCase();
  return smsResults.value.filter((r) => {
    const matchKw = !kw || r.phone.includes(kw);
    const matchStatus = !smsResultFilters.status || r.status === smsResultFilters.status;
    return matchKw && matchStatus;
  });
});

const pageSmsResults = computed(() => {
  const s = (smsResultPage.value - 1) * smsResultSize.value;
  return filteredSmsResults.value.slice(s, s + smsResultSize.value);
});

function resetSmsResultFilters(): void {
  smsResultFilters.keyword = "";
  smsResultFilters.status = "";
  smsResultPage.value = 1;
}

/* ============================================================
 *  Tab 4: APP 版本管理
 * ============================================================ */
interface AppVersion {
  id: number;
  version: string;
  platform: "Android" | "iOS";
  description: string;
  forceUpdate: boolean;
  status: "published" | "draft";
  createdAt: string;
}

const appVersions = shallowRef<AppVersion[]>([
  { id: 1, version: "2.5.0", platform: "Android", description: "新增群组管理功能，优化消息推送性能", forceUpdate: false, status: "published", createdAt: "2026-08-10" },
  { id: 2, version: "2.5.0", platform: "iOS", description: "新增群组管理功能，优化消息推送性能", forceUpdate: false, status: "published", createdAt: "2026-08-10" },
  { id: 3, version: "2.4.1", platform: "Android", description: "修复登录闪退问题", forceUpdate: true, status: "published", createdAt: "2026-07-20" },
  { id: 4, version: "2.4.1", platform: "iOS", description: "修复登录闪退问题", forceUpdate: true, status: "published", createdAt: "2026-07-20" },
  { id: 5, version: "2.6.0", platform: "Android", description: "新增转发群发功能，敏感词过滤", forceUpdate: false, status: "draft", createdAt: "2026-08-12" },
]);

const APP_STATUS_MAP: Record<string, string> = { published: "已发布", draft: "草稿" };

function appStatusTagType(status: string) {
  return status === "published" ? "success" : "info";
}

async function publishVersion(row: AppVersion): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定发布版本 ${row.version} (${row.platform}) 吗？`, "发布确认", {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    row.status = "published";
    ElMessage.success("版本已发布");
  } catch {
    // cancelled
  }
}

/* ============================================================
 *  Tab 5: 用户协议与隐私政策
 * ============================================================ */
const agreementContent = shallowRef(
  "欢迎使用 IM-APP 服务。本服务协议（以下简称'协议'）是您与 IM-APP 之间关于使用 IM-APP 服务所订立的协议。\n\n一、服务内容\nIM-APP 为用户提供即时通讯、群组管理、文件传输等服务。\n\n二、用户责任\n用户应遵守相关法律法规，不得利用本服务从事违法活动。\n\n三、隐私保护\n我们重视用户隐私保护，详细隐私政策请参阅《隐私政策》。",
);
const privacyContent = shallowRef(
  "IM-APP 隐私政策\n\n一、信息收集\n我们收集您在使用服务过程中主动提供的信息，包括但不限于注册信息、个人资料等。\n\n二、信息使用\n我们使用收集的信息来提供、维护和改进我们的服务。\n\n三、信息共享\n未经您的同意，我们不会与第三方共享您的个人信息，法律法规要求除外。\n\n四、信息安全\n我们采取合理的技术和管理措施保护您的个人信息安全。",
);

async function saveAgreement(): Promise<void> {
  ElMessage.success("用户协议已保存");
}

async function savePrivacy(): Promise<void> {
  ElMessage.success("隐私政策已保存");
}

/* ============================================================
 *  Tab 6: 敏感词配置
 * ============================================================ */
interface SensitiveWord {
  id: number;
  word: string;
  category: "政治" | "色情" | "暴力" | "广告" | "其他";
  createdAt: string;
}

const sensitiveWordFilters = reactive({ keyword: "" });
const sensitiveWordPage = shallowRef(1);
const sensitiveWordSize = shallowRef(10);
const newWordInput = shallowRef("");
const newWordCategory = shallowRef<SensitiveWord["category"]>("其他");

const sensitiveWords = shallowRef<SensitiveWord[]>([
  { id: 1, word: "赌博", category: "其他", createdAt: "2026-07-01" },
  { id: 2, word: "传销", category: "广告", createdAt: "2026-07-01" },
  { id: 3, word: "枪支", category: "暴力", createdAt: "2026-07-15" },
  { id: 4, word: "假证", category: "广告", createdAt: "2026-07-20" },
  { id: 5, word: "代孕", category: "其他", createdAt: "2026-08-01" },
  { id: 6, word: "发票代开", category: "广告", createdAt: "2026-08-05" },
]);

const filteredSensitiveWords = computed(() => {
  const kw = sensitiveWordFilters.keyword.trim().toLowerCase();
  return sensitiveWords.value.filter((w) => !kw || w.word.toLowerCase().includes(kw));
});

const pageSensitiveWords = computed(() => {
  const s = (sensitiveWordPage.value - 1) * sensitiveWordSize.value;
  return filteredSensitiveWords.value.slice(s, s + sensitiveWordSize.value);
});

function resetSensitiveWordFilters(): void {
  sensitiveWordFilters.keyword = "";
  sensitiveWordPage.value = 1;
}

function addSensitiveWord(): void {
  const word = newWordInput.value.trim();
  if (!word) {
    ElMessage.warning("请输入敏感词");
    return;
  }
  const exists = sensitiveWords.value.some((w) => w.word === word);
  if (exists) {
    ElMessage.warning("该敏感词已存在");
    return;
  }
  const id = Math.max(...sensitiveWords.value.map((w) => w.id), 0) + 1;
  sensitiveWords.value = [
    ...sensitiveWords.value,
    { id, word, category: newWordCategory.value, createdAt: new Date().toISOString().slice(0, 10) },
  ];
  newWordInput.value = "";
  ElMessage.success("敏感词已添加");
}

async function deleteSensitiveWord(row: SensitiveWord): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除敏感词「${row.word}」吗？`, "删除确认", {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    sensitiveWords.value = sensitiveWords.value.filter((w) => w.id !== row.id);
    ElMessage.success("已删除");
  } catch {
    // cancelled
  }
}

/* ============================================================
 *  Tab 7: 运行错误记录
 * ============================================================ */
interface ErrorLog {
  id: number;
  level: "error" | "warning" | "critical";
  module: string;
  message: string;
  stack: string;
  createdAt: string;
}

const errorLogFilters = reactive({ keyword: "", level: "" as "" | "error" | "warning" | "critical" });
const errorLogPage = shallowRef(1);
const errorLogSize = shallowRef(10);
const errorDetailVisible = shallowRef(false);
const selectedErrorLog = shallowRef<ErrorLog | null>(null);

const errorLogs = shallowRef<ErrorLog[]>([
  {
    id: 1,
    level: "error",
    module: "MessageService",
    message: "消息推送超时",
    stack: "TimeoutError: Push notification timed out after 30000ms\n  at MessageService.push (message.ts:142)\n  at async NotificationHandler.send (notification.ts:58)",
    createdAt: "2026-08-12 08:30",
  },
  {
    id: 2,
    level: "critical",
    module: "DatabaseService",
    message: "数据库连接池耗尽",
    stack: "PoolExhaustedError: All connections in use (max: 100)\n  at DatabaseService.getConnection (db.ts:89)\n  at QueryRunner.execute (query.ts:34)",
    createdAt: "2026-08-12 07:15",
  },
  {
    id: 3,
    level: "warning",
    module: "FileService",
    message: "文件上传大小超出建议值",
    stack: "Warning: File size 48MB exceeds recommended limit of 20MB\n  at FileService.validate (file.ts:67)",
    createdAt: "2026-08-11 22:10",
  },
  {
    id: 4,
    level: "error",
    module: "AuthService",
    message: "Token 刷新失败",
    stack: "AuthError: Refresh token expired\n  at AuthService.refreshToken (auth.ts:201)\n  at TokenMiddleware.handle (middleware.ts:45)",
    createdAt: "2026-08-11 19:45",
  },
  {
    id: 5,
    level: "critical",
    module: "SmsService",
    message: "短信网关连接失败",
    stack: "GatewayError: Connection refused by SMS gateway\n  at SmsService.connect (sms.ts:78)\n  at SmsQueue.process (queue.ts:112)",
    createdAt: "2026-08-11 15:30",
  },
]);

const ERROR_LEVEL_MAP: Record<string, string> = { error: "错误", warning: "警告", critical: "严重" };

function errorLevelTagType(level: string) {
  const map: Record<string, string> = { error: "danger", warning: "warning", critical: "danger" };
  return map[level] ?? "info";
}

const filteredErrorLogs = computed(() => {
  const kw = errorLogFilters.keyword.trim().toLowerCase();
  return errorLogs.value.filter((log) => {
    const matchKw = !kw || log.module.toLowerCase().includes(kw) || log.message.toLowerCase().includes(kw);
    const matchLevel = !errorLogFilters.level || log.level === errorLogFilters.level;
    return matchKw && matchLevel;
  });
});

const pageErrorLogs = computed(() => {
  const s = (errorLogPage.value - 1) * errorLogSize.value;
  return filteredErrorLogs.value.slice(s, s + errorLogSize.value);
});

function resetErrorLogFilters(): void {
  errorLogFilters.keyword = "";
  errorLogFilters.level = "";
  errorLogPage.value = 1;
}

function openErrorDetail(log: ErrorLog): void {
  selectedErrorLog.value = log;
  errorDetailVisible.value = true;
}
</script>

<template>
  <div class="table-box">
    <section class="card table-main">
      <el-tabs v-model="activeTab" type="border-card">
        <!-- ==================== Tab 1: 国家/地区启停 ==================== -->
        <el-tab-pane label="国家/地区启停" name="region">
          <el-table :data="regions" style="width: 100%">
            <el-table-column prop="name" label="国家/地区" min-width="150" />
            <el-table-column prop="code" label="区号" min-width="100" />
            <el-table-column label="状态" min-width="100">
              <template #default="{ row }">
                <el-tag :type="row.enabled ? 'success' : 'info'" effect="light">
                  {{ row.enabled ? '已启用' : '已停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-switch
                  :model-value="row.enabled"
                  active-text="启用"
                  inactive-text="停用"
                  inline-prompt
                  @change="toggleRegion(row)"
                />
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- ==================== Tab 2: 短信发送记录 ==================== -->
        <el-tab-pane label="短信发送记录" name="smsRecord">
          <div class="tab-search">
            <el-form :model="smsRecordFilters" @submit.prevent>
              <div class="search-grid">
                <div class="search-item">
                  <el-form-item>
                    <el-input
                      v-model="smsRecordFilters.keyword"
                      clearable
                      placeholder="手机号 / 内容"
                      :prefix-icon="Search"
                      @clear="smsRecordPage = 1"
                    />
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-select v-model="smsRecordFilters.type" clearable placeholder="短信类型">
                      <el-option label="验证码" value="验证码" />
                      <el-option label="通知" value="通知" />
                      <el-option label="营销" value="营销" />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="search-operation">
                  <el-button type="primary" :icon="Search" @click="smsRecordPage = 1">搜索</el-button>
                  <el-button :icon="RefreshLeft" @click="resetSmsRecordFilters">重置</el-button>
                </div>
              </div>
            </el-form>
          </div>

          <el-table :data="pageSmsRecords" style="width: 100%">
            <el-table-column prop="phone" label="手机号" min-width="130" />
            <el-table-column prop="content" label="短信内容" min-width="280" show-overflow-tooltip />
            <el-table-column label="类型" min-width="90">
              <template #default="{ row }">
                <el-tag effect="plain" round>{{ row.type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="sendTime" label="发送时间" min-width="160" />
          </el-table>

          <div class="table-footer">
            <el-pagination
              background
              v-model:current-page="smsRecordPage"
              v-model:page-size="smsRecordSize"
              :page-sizes="[10, 25, 50, 100]"
              layout="total, sizes, prev, pager, next, jumper"
              :total="filteredSmsRecords.length"
            />
          </div>
        </el-tab-pane>

        <!-- ==================== Tab 3: 短信发送结果 ==================== -->
        <el-tab-pane label="短信发送结果" name="smsResult">
          <div class="tab-search">
            <el-form :model="smsResultFilters" @submit.prevent>
              <div class="search-grid">
                <div class="search-item">
                  <el-form-item>
                    <el-input
                      v-model="smsResultFilters.keyword"
                      clearable
                      placeholder="手机号"
                      :prefix-icon="Search"
                      @clear="smsResultPage = 1"
                    />
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-select v-model="smsResultFilters.status" clearable placeholder="发送状态">
                      <el-option label="发送成功" value="success" />
                      <el-option label="发送失败" value="failed" />
                      <el-option label="待发送" value="pending" />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="search-operation">
                  <el-button type="primary" :icon="Search" @click="smsResultPage = 1">搜索</el-button>
                  <el-button :icon="RefreshLeft" @click="resetSmsResultFilters">重置</el-button>
                </div>
              </div>
            </el-form>
          </div>

          <el-table :data="pageSmsResults" style="width: 100%">
            <el-table-column prop="phone" label="手机号" min-width="130" />
            <el-table-column prop="content" label="短信内容" min-width="200" show-overflow-tooltip />
            <el-table-column label="发送状态" min-width="110">
              <template #default="{ row }">
                <el-tag :type="smsResultTagType(row.status)" effect="light">
                  {{ SMS_RESULT_MAP[row.status] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="错误码" min-width="120">
              <template #default="{ row }">
                <span v-if="row.errorCode" class="count-fail">{{ row.errorCode }}</span>
                <span v-else class="text-muted">--</span>
              </template>
            </el-table-column>
            <el-table-column prop="sendTime" label="发送时间" min-width="160" />
          </el-table>

          <div class="table-footer">
            <el-pagination
              background
              v-model:current-page="smsResultPage"
              v-model:page-size="smsResultSize"
              :page-sizes="[10, 25, 50, 100]"
              layout="total, sizes, prev, pager, next, jumper"
              :total="filteredSmsResults.length"
            />
          </div>
        </el-tab-pane>

        <!-- ==================== Tab 4: APP 版本管理 ==================== -->
        <el-tab-pane label="APP版本管理" name="appVersion">
          <el-table :data="appVersions" style="width: 100%">
            <el-table-column prop="version" label="版本号" min-width="100" />
            <el-table-column prop="platform" label="平台" min-width="100">
              <template #default="{ row }">
                <el-tag effect="plain" round>{{ row.platform }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="更新说明" min-width="280" show-overflow-tooltip />
            <el-table-column label="强制更新" min-width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="row.forceUpdate ? 'danger' : 'success'" effect="light" round>
                  {{ row.forceUpdate ? '是' : '否' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="发布状态" min-width="100">
              <template #default="{ row }">
                <el-tag :type="appStatusTagType(row.status)" effect="light">
                  {{ APP_STATUS_MAP[row.status] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间" min-width="120" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-if="row.status === 'draft'"
                  link
                  type="primary"
                  @click="publishVersion(row)"
                >
                  发布
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- ==================== Tab 5: 用户协议与隐私政策 ==================== -->
        <el-tab-pane label="用户协议与隐私政策" name="agreement">
          <div class="agreement-section">
            <div class="agreement-block">
              <div class="agreement-header">
                <h4>用户协议</h4>
                <el-button type="primary" size="small" :icon="Edit" @click="saveAgreement">保存</el-button>
              </div>
              <el-input
                v-model="agreementContent"
                type="textarea"
                :rows="10"
                placeholder="请输入用户协议内容"
              />
            </div>
            <el-divider />
            <div class="agreement-block">
              <div class="agreement-header">
                <h4>隐私政策</h4>
                <el-button type="primary" size="small" :icon="Edit" @click="savePrivacy">保存</el-button>
              </div>
              <el-input
                v-model="privacyContent"
                type="textarea"
                :rows="10"
                placeholder="请输入隐私政策内容"
              />
            </div>
          </div>
        </el-tab-pane>

        <!-- ==================== Tab 6: 敏感词配置 ==================== -->
        <el-tab-pane label="敏感词配置" name="sensitiveWord">
          <div class="tab-search">
            <el-form :model="sensitiveWordFilters" @submit.prevent>
              <div class="search-grid">
                <div class="search-item">
                  <el-form-item>
                    <el-input
                      v-model="sensitiveWordFilters.keyword"
                      clearable
                      placeholder="搜索敏感词"
                      :prefix-icon="Search"
                      @clear="sensitiveWordPage = 1"
                    />
                  </el-form-item>
                </div>
                <div class="search-operation">
                  <el-button type="primary" :icon="Search" @click="sensitiveWordPage = 1">搜索</el-button>
                  <el-button :icon="RefreshLeft" @click="resetSensitiveWordFilters">重置</el-button>
                </div>
              </div>
            </el-form>
          </div>

          <div class="add-word-bar">
            <el-input
              v-model="newWordInput"
              placeholder="输入新敏感词"
              style="width: 200px"
              clearable
            />
            <el-select v-model="newWordCategory" style="width: 120px">
              <el-option label="政治" value="政治" />
              <el-option label="色情" value="色情" />
              <el-option label="暴力" value="暴力" />
              <el-option label="广告" value="广告" />
              <el-option label="其他" value="其他" />
            </el-select>
            <el-button type="primary" :icon="Plus" @click="addSensitiveWord">添加</el-button>
          </div>

          <el-table :data="pageSensitiveWords" style="width: 100%">
            <el-table-column prop="word" label="敏感词" min-width="150" />
            <el-table-column label="分类" min-width="100">
              <template #default="{ row }">
                <el-tag effect="plain" round>{{ row.category }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="添加时间" min-width="130" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="danger" :icon="Delete" @click="deleteSensitiveWord(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="table-footer">
            <el-pagination
              background
              v-model:current-page="sensitiveWordPage"
              v-model:page-size="sensitiveWordSize"
              :page-sizes="[10, 25, 50, 100]"
              layout="total, sizes, prev, pager, next, jumper"
              :total="filteredSensitiveWords.length"
            />
          </div>
        </el-tab-pane>

        <!-- ==================== Tab 7: 运行错误记录 ==================== -->
        <el-tab-pane label="运行错误记录" name="errorLog">
          <div class="tab-search">
            <el-form :model="errorLogFilters" @submit.prevent>
              <div class="search-grid">
                <div class="search-item">
                  <el-form-item>
                    <el-input
                      v-model="errorLogFilters.keyword"
                      clearable
                      placeholder="模块 / 错误信息"
                      :prefix-icon="Search"
                      @clear="errorLogPage = 1"
                    />
                  </el-form-item>
                </div>
                <div class="search-item">
                  <el-form-item>
                    <el-select v-model="errorLogFilters.level" clearable placeholder="错误级别">
                      <el-option label="错误" value="error" />
                      <el-option label="警告" value="warning" />
                      <el-option label="严重" value="critical" />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="search-operation">
                  <el-button type="primary" :icon="Search" @click="errorLogPage = 1">搜索</el-button>
                  <el-button :icon="RefreshLeft" @click="resetErrorLogFilters">重置</el-button>
                </div>
              </div>
            </el-form>
          </div>

          <el-table :data="pageErrorLogs" style="width: 100%">
            <el-table-column label="级别" min-width="90">
              <template #default="{ row }">
                <el-tag :type="errorLevelTagType(row.level)" effect="light">
                  {{ ERROR_LEVEL_MAP[row.level] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="module" label="模块" min-width="140" />
            <el-table-column prop="message" label="错误信息" min-width="220" show-overflow-tooltip />
            <el-table-column prop="createdAt" label="发生时间" min-width="160" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :icon="View" @click="openErrorDetail(row)">详情</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="table-footer">
            <el-pagination
              background
              v-model:current-page="errorLogPage"
              v-model:page-size="errorLogSize"
              :page-sizes="[10, 25, 50, 100]"
              layout="total, sizes, prev, pager, next, jumper"
              :total="filteredErrorLogs.length"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <!-- 错误日志详情弹窗 -->
    <el-dialog v-model="errorDetailVisible" title="错误详情" width="min(640px, calc(100% - 32px))">
      <template v-if="selectedErrorLog">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="错误级别">
            <el-tag :type="errorLevelTagType(selectedErrorLog.level)" effect="light">
              {{ ERROR_LEVEL_MAP[selectedErrorLog.level] }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="模块">{{ selectedErrorLog.module }}</el-descriptions-item>
          <el-descriptions-item label="错误信息" :span="2">{{ selectedErrorLog.message }}</el-descriptions-item>
          <el-descriptions-item label="发生时间" :span="2">{{ selectedErrorLog.createdAt }}</el-descriptions-item>
        </el-descriptions>
        <el-divider content-position="left">堆栈信息</el-divider>
        <pre class="stack-trace">{{ selectedErrorLog.stack }}</pre>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.table-box,
.table-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

:deep(.el-tabs__content) {
  padding: 16px;
}

:deep(.el-table) {
  .el-table__header th {
    height: 45px;
    font-size: 15px;
    font-weight: bold;
    color: var(--el-text-color-primary);
    background: var(--el-fill-color-light);
  }

  .el-table__row {
    height: 45px;
    font-size: 14px;
  }
}

.tab-search {
  margin-bottom: 12px;

  .search-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0 18px;
  }

  .search-item :deep(.el-form-item) {
    margin-bottom: 12px;
  }

  .search-item :deep(.el-form-item__content > *) {
    width: 100%;
  }

  .search-operation {
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    gap: 12px;
    margin-bottom: 12px;

    .el-button {
      margin-left: 0;
    }
  }
}

.table-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 54px;
}

.count-fail {
  color: var(--el-color-danger);
  font-weight: 600;
}

.text-muted {
  color: var(--el-text-color-secondary);
}

/* 用户协议与隐私政策 */
.agreement-section {
  padding: 8px 0;
}

.agreement-block {
  .agreement-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;

    h4 {
      margin: 0;
      font-size: 15px;
      color: var(--el-text-color-primary);
    }
  }
}

/* 敏感词添加栏 */
.add-word-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

/* 堆栈信息 */
.stack-trace {
  padding: 16px;
  margin: 0;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-color-danger);
  font-family: "Consolas", "Monaco", monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: auto;
}

@media (max-width: 1100px) {
  .tab-search .search-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tab-search .search-operation {
    justify-content: flex-start;
  }
}

@media (max-width: 700px) {
  .tab-search .search-grid {
    grid-template-columns: 1fr;
  }

  .tab-search .search-operation {
    justify-content: flex-start;
  }

  .table-footer {
    justify-content: center;
  }

  .add-word-bar {
    flex-wrap: wrap;
  }
}
</style>
