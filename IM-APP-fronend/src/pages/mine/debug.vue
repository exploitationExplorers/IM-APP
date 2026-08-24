<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import { fetchIMToken } from '@/api/im'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { readLocalAppVersion } from '@/composables/useAppUpdate'
import { APP_CONFIG } from '@/config'
import { useUserStore } from '@/stores/user'
import { imUserId } from '@/utils/openim'
import { safeBack } from '@/utils/nav'
import {
  appProbeUrl,
  buildProbeItem,
  capabilityFlags,
  fileProbeUrl,
  healthUrlFromApiBase,
  hostOf,
  isPrivateBrowsingGuess,
  mediaSupportList,
  permissionFlags,
  platformTag,
  probeUrl,
  probeWebSocket,
  readNetworkStatus,
  readStorageUsage,
  browserSummary,
  type LatencySample,
  type ProbeResult,
} from '@/utils/debug-probe'

useAuthGuard()

const userStore = useUserStore()

const versionText = ref(APP_CONFIG.version)
const screenSize = ref('—')
const startedAt = ref('')
const nowText = ref('')
const browserText = ref('—')
const privateBrowse = ref('—')
const networkText = ref('—')
const storageText = ref('—')
const mediaList = shallowRef<string[]>([])
const caps = shallowRef<Record<string, boolean | string>>({})
const perms = shallowRef<Record<string, string>>({})
const probes = shallowRef<ProbeResult[]>([])
const history = shallowRef<LatencySample[]>([])
const probing = ref(false)
const openimApi = ref('')
const openimWs = ref('')

let historyTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

const chatIdText = computed(() => {
  const pub = userStore.profile?.publicId || '—'
  const im = imUserId.value || userStore.profile?.id || ''
  return im ? `${pub} (${im})` : pub
})

const historyMaxMs = computed(() => {
  const vals = history.value.map((h) => h.ms)
  return Math.max(1, ...vals, 1)
})

function formatClock(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatIsoLocal(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(off) / 60))
  const om = pad(Math.abs(off) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
}

function goBack() {
  safeBack('/pages/mine/general')
}

async function refreshMeta() {
  try {
    const local = await readLocalAppVersion()
    const name = local.versionName || APP_CONFIG.version
    const ver = String(name).startsWith('v') ? String(name) : `v${name}`
    versionText.value = `${ver} ${platformTag()}`
  } catch {
    versionText.value = `${APP_CONFIG.version} ${platformTag()}`
  }
  try {
    const info = uni.getSystemInfoSync()
    screenSize.value = `${Math.round(info.windowWidth || 0)} × ${Math.round(info.windowHeight || 0)}`
  } catch {
    screenSize.value = '—'
  }
  browserText.value = browserSummary()
  privateBrowse.value = isPrivateBrowsingGuess()
  networkText.value = await readNetworkStatus()
  storageText.value = await readStorageUsage()
  mediaList.value = mediaSupportList()
  caps.value = await capabilityFlags()
  perms.value = await permissionFlags()
  if (!startedAt.value) startedAt.value = formatIsoLocal()
  nowText.value = formatIsoLocal()
}

async function resolveOpenIMEndpoints() {
  try {
    const token = await fetchIMToken()
    openimApi.value = token.apiAddr || ''
    openimWs.value = token.wsAddr || ''
    if (token.userId && !imUserId.value) {
      imUserId.value = token.userId
    }
  } catch {
    openimApi.value = ''
    openimWs.value = ''
  }
}

async function runProbes() {
  if (probing.value) return
  probing.value = true
  try {
    await resolveOpenIMEndpoints()
    const appUrl = appProbeUrl()
    const apiUrl = healthUrlFromApiBase(APP_CONFIG.apiBaseUrl)
    const fileUrl = fileProbeUrl(APP_CONFIG.defaultAvatarUrl)
    const imApiUrl = openimApi.value
      ? openimApi.value.replace(/\/$/, '') + '/'
      : ''
    const wsUrl = openimWs.value

    const tasks: Array<Promise<ProbeResult>> = [
      probeUrl(appUrl).then((r) => buildProbeItem('App', appUrl, r)),
      probeUrl(apiUrl).then((r) => buildProbeItem('API', apiUrl, r)),
      probeUrl(fileUrl).then((r) => buildProbeItem('File', fileUrl, r)),
    ]
    if (imApiUrl) {
      tasks.push(probeUrl(imApiUrl).then((r) => buildProbeItem('OpenIM', imApiUrl, r)))
    }
    if (wsUrl) {
      tasks.push(probeWebSocket(wsUrl).then((r) => buildProbeItem('WS', wsUrl, r)))
    }
    tasks.push(
      probeUrl('https://www.baidu.com/').then((r) => buildProbeItem('百度', 'https://www.baidu.com/', r)),
      probeUrl('https://www.qq.com/').then((r) => buildProbeItem('腾讯', 'https://www.qq.com/', r)),
      probeUrl('https://www.wechat.com/').then((r) => buildProbeItem('微信', 'https://www.wechat.com/', r)),
    )

    probes.value = await Promise.all(tasks)

    const apiItem = probes.value.find((p) => p.label === 'API')
    if (apiItem && apiItem.ms != null) {
      pushHistory(apiItem.ms, apiItem.ok)
    }
  } finally {
    probing.value = false
  }
}

function pushHistory(ms: number, ok: boolean) {
  const next = [
    ...history.value,
    { at: Date.now(), label: formatClock(), ms, ok },
  ].slice(-10)
  history.value = next
}

async function sampleHistory() {
  const apiUrl = healthUrlFromApiBase(APP_CONFIG.apiBaseUrl)
  const r = await probeUrl(apiUrl)
  pushHistory(r.ms, r.ok)
  nowText.value = formatIsoLocal()
}

function startTimers() {
  stopTimers()
  clockTimer = setInterval(() => {
    nowText.value = formatIsoLocal()
  }, 1000)
  historyTimer = setInterval(() => {
    void sampleHistory()
  }, 10000)
}

function stopTimers() {
  if (historyTimer) {
    clearInterval(historyTimer)
    historyTimer = null
  }
  if (clockTimer) {
    clearInterval(clockTimer)
    clockTimer = null
  }
}

function onSaveImage() {
  // 无额外依赖：复制摘要到剪贴板，并提示用户系统截图
  const lines = [
    `调试资讯 ${nowText.value}`,
    `聊天号 ${chatIdText.value}`,
    `版本号 ${versionText.value}`,
    `画面尺寸 ${screenSize.value}`,
    ...probes.value.map((p) => `${p.label} ${p.host} ${p.ms ?? '—'}ms ${p.ok ? 'OK' : 'FAIL'}`),
    `浏览器 ${browserText.value}`,
    `网络 ${networkText.value}`,
    `储存 ${storageText.value}`,
  ]
  const text = lines.join('\n')
  uni.setClipboardData({
    data: text,
    success: () => {
      uni.showToast({ title: '已复制，可再截图保存', icon: 'none' })
    },
    fail: () => {
      uni.showToast({ title: '请使用系统截图保存', icon: 'none' })
    },
  })
}

onShow(() => {
  if (!userStore.profile) {
    void userStore.loadProfile().catch(() => undefined)
  }
  void refreshMeta()
  void runProbes()
  startTimers()
})

onHide(() => {
  stopTimers()
})

onUnmounted(() => {
  stopTimers()
})
</script>

<template>
  <view class="page">
    <ImNavBar title="调试资讯" @back="goBack" />

    <scroll-view scroll-y class="scroll">
      <view id="debug-capture" class="capture">
        <view class="info-table">
          <view class="info-row">
            <text class="info-label">聊天号</text>
            <text class="info-value">{{ chatIdText }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">版本号</text>
            <text class="info-value">{{ versionText }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">画面尺寸</text>
            <text class="info-value">{{ screenSize }}</text>
          </view>
        </view>

        <view class="section">
          <view v-for="item in probes" :key="item.label + item.host" class="probe-row">
            <view class="probe-main">
              <text class="probe-label">{{ item.label }}</text>
              <text class="probe-host">{{ item.host }}</text>
            </view>
            <view class="probe-right">
              <text class="probe-ms" :class="{ fail: !item.ok }">
                {{ item.ms == null ? '—' : item.ms }}<text class="probe-unit">ms</text>
              </text>
              <view class="probe-dot" :class="{ ok: item.ok, bad: !item.ok }">
                <text class="probe-dot-mark">{{ item.ok ? '✓' : '!' }}</text>
              </view>
            </view>
          </view>
          <view v-if="!probes.length" class="empty">
            <text class="empty-text">{{ probing ? '探测中…' : '暂无探测结果' }}</text>
          </view>
        </view>

        <view v-if="history.length" class="section chart-section">
          <view class="chart">
            <view
              v-for="(h, idx) in history"
              :key="h.at + '-' + idx"
              class="bar-col"
            >
              <view
                class="bar"
                :class="{ bad: !h.ok }"
                :style="{ height: Math.max(8, Math.round((h.ms / historyMaxMs) * 120)) + 'rpx' }"
              />
              <text class="bar-ms">{{ h.ms }}ms</text>
              <text class="bar-time">{{ h.label }}</text>
            </view>
          </view>
        </view>

        <view class="section meta-section">
          <view class="meta-row">
            <text class="meta-label">浏览器</text>
            <text class="meta-value">{{ browserText }}</text>
          </view>
          <view class="meta-row">
            <text class="meta-label">私密浏览</text>
            <text class="meta-value">{{ privateBrowse }}</text>
          </view>
          <view class="meta-row">
            <text class="meta-label">网络状态</text>
            <text class="meta-value">{{ networkText }}</text>
          </view>
          <view class="meta-row">
            <text class="meta-label">储存空间</text>
            <text class="meta-value">{{ storageText }}</text>
          </view>
        </view>

        <view class="section">
          <text class="block-title">媒体支援</text>
          <view class="tag-wrap">
            <text v-for="m in mediaList" :key="m" class="tag">{{ m }}</text>
          </view>
        </view>

        <view class="section">
          <view class="cap-grid">
            <view v-for="(val, key) in perms" :key="'p-' + key" class="cap-item">
              <text class="cap-k">{{ key }}</text>
              <text class="cap-v">{{ val }}</text>
            </view>
            <view v-for="(val, key) in caps" :key="'c-' + key" class="cap-item">
              <text class="cap-k">{{ key }}</text>
              <text class="cap-v">{{ val === true ? '是' : val === false ? '否' : val }}</text>
            </view>
          </view>
        </view>

        <view class="section">
          <view class="meta-row">
            <text class="meta-label">现在时间</text>
            <text class="meta-value">{{ nowText || startedAt }}</text>
          </view>
          <view v-if="openimApi" class="meta-row">
            <text class="meta-label">OpenIM API</text>
            <text class="meta-value small">{{ hostOf(openimApi) }}</text>
          </view>
          <view v-if="openimWs" class="meta-row">
            <text class="meta-label">OpenIM WS</text>
            <text class="meta-value small">{{ hostOf(openimWs) }}</text>
          </view>
        </view>

        <view class="actions">
          <view class="save-btn" @click="onSaveImage">
            <text class="save-btn-text">以图片保存</text>
          </view>
          <view class="refresh-btn" @click="runProbes">
            <text class="refresh-btn-text">{{ probing ? '探测中…' : '重新探测' }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
$text: #212121;
$muted: #636e86;
$line: #eceff3;
$ok: #22c55e;
$bad: #ef4444;

.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.scroll {
  flex: 1;
  height: 0;
}

.capture {
  padding: 8rpx 28rpx 48rpx;
  box-sizing: border-box;
}

.info-table {
  border: 1rpx solid $line;
  border-radius: 12rpx;
  overflow: hidden;
  margin-bottom: 24rpx;
}

.info-row {
  display: flex;
  align-items: flex-start;
  padding: 20rpx 24rpx;
  border-bottom: 1rpx solid $line;
  gap: 24rpx;
}
.info-row:last-child {
  border-bottom: none;
}

.info-label {
  width: 140rpx;
  flex-shrink: 0;
  font-size: 26rpx;
  color: $muted;
  line-height: 40rpx;
}

.info-value {
  flex: 1;
  font-size: 26rpx;
  color: $text;
  line-height: 40rpx;
  word-break: break-all;
}

.section {
  margin-bottom: 28rpx;
}

.probe-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 4rpx;
  border-bottom: 1rpx solid #f3f4f7;
  gap: 16rpx;
}

.probe-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.probe-label {
  font-size: 28rpx;
  color: $text;
  font-weight: 600;
  line-height: 40rpx;
}

.probe-host {
  font-size: 22rpx;
  color: $muted;
  line-height: 32rpx;
  word-break: break-all;
}

.probe-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}

.probe-ms {
  font-size: 28rpx;
  color: $text;
  font-variant-numeric: tabular-nums;
}
.probe-ms.fail {
  color: $bad;
}
.probe-unit {
  font-size: 22rpx;
  color: $muted;
  margin-left: 2rpx;
}

.probe-dot {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.probe-dot.ok {
  background: $ok;
}
.probe-dot.bad {
  background: $bad;
}
.probe-dot-mark {
  color: #fff;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1;
}

.empty {
  padding: 24rpx 0;
}
.empty-text {
  font-size: 26rpx;
  color: $muted;
}

.chart-section {
  padding: 12rpx 0 8rpx;
  overflow-x: auto;
}

.chart {
  display: flex;
  align-items: flex-end;
  gap: 12rpx;
  min-height: 200rpx;
  padding-bottom: 8rpx;
}

.bar-col {
  width: 72rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}

.bar {
  width: 28rpx;
  border-radius: 8rpx 8rpx 4rpx 4rpx;
  background: #93c5fd;
}
.bar.bad {
  background: #fca5a5;
}

.bar-ms {
  font-size: 18rpx;
  color: $muted;
}
.bar-time {
  font-size: 16rpx;
  color: #9aa3b5;
  transform: scale(0.92);
}

.meta-section {
  border-top: 1rpx solid $line;
  padding-top: 16rpx;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 24rpx;
  padding: 14rpx 0;
}

.meta-label {
  font-size: 26rpx;
  color: $muted;
  flex-shrink: 0;
}

.meta-value {
  font-size: 26rpx;
  color: $text;
  text-align: right;
  word-break: break-all;
}
.meta-value.small {
  font-size: 22rpx;
  color: $muted;
}

.block-title {
  display: block;
  font-size: 26rpx;
  color: $muted;
  margin-bottom: 12rpx;
}

.tag-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.tag {
  font-size: 20rpx;
  color: #445;
  background: #f3f4f7;
  padding: 6rpx 12rpx;
  border-radius: 8rpx;
}

.cap-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12rpx 24rpx;
}

.cap-item {
  display: flex;
  justify-content: space-between;
  gap: 12rpx;
  padding: 8rpx 0;
  border-bottom: 1rpx solid #f5f6f8;
}

.cap-k {
  font-size: 24rpx;
  color: $muted;
}
.cap-v {
  font-size: 24rpx;
  color: $text;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 12rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
}

.save-btn,
.refresh-btn {
  height: 88rpx;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.save-btn {
  background: #0a2fc2;
}
.save-btn-text {
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
}

.refresh-btn {
  background: #f3f4f7;
}
.refresh-btn-text {
  color: $text;
  font-size: 28rpx;
}
</style>
