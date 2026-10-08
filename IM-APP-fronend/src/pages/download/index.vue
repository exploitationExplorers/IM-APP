<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { checkAppRelease } from '@/api/app-release'
import { APP_CONFIG } from '@/config'
import type { AppReleaseCheckResult } from '@/types'
import { getToken } from '@/utils/request'
import headerBg from './assets/header-bg.png'
import androidIcon from './assets/android.png'
import liteIcon from './assets/lite.svg'
import warnIcon from './assets/warn.svg'
import section1 from './assets/section-01.png'
import section2 from './assets/section-02.png'
import section3 from './assets/section-03.png'
import {
  DOWNLOAD_COPY,
  DOWNLOAD_LANGS,
  detectDownloadLang,
  saveDownloadLang,
  type DownloadLang,
} from './copy'

const lang = ref<DownloadLang>(detectDownloadLang())
const langOpen = ref(false)
const downloading = ref(false)
const versionText = ref('')

/** 壳版本低于 wgt 的 minNative 时，nativeVersion=0 读不到热更新版本名。 */
const WGT_VERSION_PROBE = 1_000_000_000

const copy = computed(() => DOWNLOAD_COPY[lang.value])
const langName = computed(
  () => DOWNLOAD_LANGS.find((item) => item.code === lang.value)?.name || '简体中文',
)

const features = computed(() => [
  { title: copy.value.commentator, desc: copy.value.story, image: section1, gradient: false },
  { title: copy.value.fans, desc: copy.value.topics, image: section2, gradient: true },
  { title: copy.value.ai, desc: copy.value.neverMiss, image: section3, gradient: false },
])

function formatVersion(raw: string) {
  const name = String(raw || '').trim().replace(/^v/i, '')
  return name ? `V ${name}` : ''
}

function applyTitle() {
  const title = copy.value.title
  uni.setNavigationBarTitle({ title })
  if (typeof document === 'undefined') return
  document.title = title
  document.documentElement.classList.remove('im-desktop')
}

function chooseLang(next: DownloadLang) {
  lang.value = next
  langOpen.value = false
  saveDownloadLang(next)
  applyTitle()
}

function closeLang() {
  langOpen.value = false
}

function openLite() {
  if (getToken()) {
    uni.switchTab({ url: '/pages/chat/index' })
    return
  }
  uni.reLaunch({ url: '/pages/auth/sign-in' })
}

async function readPublishedAndroid(): Promise<AppReleaseCheckResult | null> {
  const channel = APP_CONFIG.updateChannel
  const [installPackage, hotUpdate] = await Promise.all([
    checkAppRelease({ platform: 'android', channel, nativeVersion: 0, wgtVersion: 0 }),
    checkAppRelease({
      platform: 'android',
      channel,
      nativeVersion: WGT_VERSION_PROBE,
      wgtVersion: 0,
    }),
  ])
  const latest = [installPackage, hotUpdate]
    .filter((item) => item.versionCode > 0 && item.versionName)
    .sort((a, b) => b.versionCode - a.versionCode)[0]
  if (latest) versionText.value = formatVersion(latest.versionName)
  if (installPackage.updateType === 'native' && installPackage.downloadUrl) return installPackage
  return null
}

async function loadPackageVersion() {
  try {
    await readPublishedAndroid()
  } catch {
    /* 版本号保持空白，避免用过期的 1.0.0 */
  }
}

async function onDownload() {
  if (downloading.value) return
  downloading.value = true
  try {
    const release = await readPublishedAndroid()
    if (!release) {
      uni.showToast({ title: copy.value.noPackage, icon: 'none' })
      return
    }
    if (typeof window !== 'undefined') {
      window.location.href = release.downloadUrl
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : copy.value.downloadFail
    uni.showToast({ title: message || copy.value.downloadFail, icon: 'none' })
  } finally {
    downloading.value = false
  }
}

onLoad(() => {
  applyTitle()
  void loadPackageVersion()
})

onShow(() => {
  applyTitle()
})
</script>

<template>
  <view class="page" @click="closeLang">
    <view class="hero">
      <view class="hero-bg" :style="{ backgroundImage: `url(${headerBg})` }" />

      <view class="lang" @click.stop>
        <view class="lang-btn" @click="langOpen = !langOpen">
          <text class="lang-name">{{ langName }}</text>
          <view class="lang-caret" :class="{ open: langOpen }" />
        </view>
        <view v-if="langOpen" class="lang-menu">
          <view
            v-for="item in DOWNLOAD_LANGS"
            :key="item.code"
            class="lang-item"
            :class="{ active: item.code === lang }"
            @click="chooseLang(item.code)"
          >
            <text>{{ item.name }}</text>
          </view>
        </view>
      </view>

      <view class="hero-inner">
        <image class="logo" src="/static/logo/logo.png" mode="aspectFill" />
        <view class="subline">
          <text>{{ copy.enthusiastic }}</text>
          <text>{{ copy.analysis }}</text>
        </view>
        <view class="headline">
          <text>{{ copy.share1 }}</text>
          <text v-if="copy.share2">{{ copy.share2 }}</text>
        </view>

        <view class="pill" :class="{ disabled: downloading }" @click.stop="onDownload">
          <image class="pill-icon" :src="androidIcon" mode="aspectFit" />
          <text class="pill-label">{{ copy.download }}</text>
          <text v-if="versionText" class="pill-version">{{ versionText }}</text>
        </view>

        <view class="pill pill-lite" @click.stop="openLite">
          <image class="pill-icon" :src="liteIcon" mode="aspectFit" />
          <text class="pill-label">{{ copy.openLite }}</text>
        </view>

        <text class="passion">{{ copy.passion }}</text>
      </view>

      <view class="flight">
        <image class="flight-icon" :src="warnIcon" mode="aspectFit" />
        <text class="flight-text">{{ copy.flight }}</text>
      </view>
    </view>

    <view class="features">
      <view
        v-for="item in features"
        :key="item.title"
        class="feature"
        :class="{ gradient: item.gradient }"
      >
        <view class="feature-copy" :class="{ end: item.gradient }">
          <text class="feature-line">{{ item.title }}</text>
          <text class="feature-line">{{ item.desc }}</text>
        </view>
        <image class="feature-shot" :src="item.image" mode="widthFix" />
      </view>
    </view>

    <view class="footer">
      <text>Copyright © 2026 66 Chat</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #1c41c7;
  color: #fff;
  font-family: Arial, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.hero {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 72px 22px 78px;
  background-image: linear-gradient(326deg, #2f9de2 0%, #1c41c7 33%, #0c1b54 100%);
}

.hero-bg {
  position: absolute;
  inset: 0;
  background-position: center bottom;
  background-repeat: no-repeat;
  background-size: cover;
  pointer-events: none;
}

.lang {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 3;
}

.lang-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 8px;
  background: #3b82f6;
  color: #fff;
}

.lang-name {
  font-size: 16px;
  line-height: 24px;
}

.lang-caret {
  width: 7px;
  height: 7px;
  border-right: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: translateY(-2px) rotate(45deg);
  transition: transform 0.15s;
}

.lang-caret.open {
  transform: translateY(2px) rotate(225deg);
}

.lang-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 132px;
  padding: 4px 0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.lang-item {
  padding: 8px 16px;
  color: #374151;
  font-size: 16px;
  line-height: 24px;
  white-space: nowrap;
}

.lang-item.active {
  background: #dbeafe;
  color: #1d4ed8;
}

.hero-inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.logo {
  width: 150px;
  height: 150px;
  border-radius: 36px;
  box-shadow:
    0 0 18px rgba(255, 255, 255, 0.72),
    0 0 42px rgba(147, 197, 253, 0.55);
}

.subline {
  margin-top: 8px;
  display: flex;
  justify-content: center;
  gap: 8px;
  font-size: 16px;
  line-height: 24px;
  text-align: center;
}

.headline {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  line-height: 28px;
  text-align: center;
}

.pill {
  width: 100%;
  min-height: 46px;
  margin-top: 22px;
  padding: 10px 18px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #fff;
  color: #1c41c7;
}

.pill-lite {
  margin-top: 16px;
  margin-bottom: 8px;
}

.pill.disabled {
  opacity: 0.65;
}

.pill-icon {
  width: 24px;
  height: 24px;
  margin-right: 8px;
  flex-shrink: 0;
}

.pill-label {
  font-size: 16px;
  font-weight: 700;
  line-height: 24px;
}

.pill-version {
  margin-left: 10px;
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
}

.passion {
  margin-top: 16px;
  font-size: 20px;
  line-height: 28px;
  text-align: center;
}

.flight {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 12px;
  background: #fff;
  color: #374151;
}

.flight-icon {
  width: 36px;
  height: 36px;
  margin-right: 4px;
  flex-shrink: 0;
}

.flight-text {
  font-size: 16px;
  font-weight: 700;
  line-height: 22px;
}

.features {
  background: #dedede;
}

.feature {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 16px 8px;
  color: #1c1c1c;
}

.feature.gradient {
  color: #fff;
  background-image: linear-gradient(326deg, #2f9de2 0%, #1c41c7 33%, #0c1b54 100%);
}

.feature-copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.feature-line {
  font-size: 16px;
  line-height: 24px;
}

.feature-shot {
  width: min(448px, 100%);
  margin-top: 12px;
}

.footer {
  padding: 64px 16px;
  background: #1c41c7;
  color: #fff;
  text-align: center;
  font-size: 16px;
  line-height: 24px;
}

@media (min-width: 640px) {
  .logo {
    width: 176px;
    height: 176px;
    border-radius: 40px;
  }
}

@media (min-width: 768px) {
  .feature {
    flex-direction: row;
    justify-content: center;
    gap: 28px;
    padding: 56px 32px;
  }

  .feature-copy {
    align-items: flex-start;
    text-align: left;
    max-width: 280px;
  }

  .feature-copy.end {
    align-items: flex-end;
    text-align: right;
  }

  .feature-shot {
    width: 448px;
    margin-top: 0;
  }
}

@media (hover: hover) {
  .pill:hover {
    box-shadow: 0 0 1.5em rgba(0, 0, 0, 0.7);
  }

  .lang-btn:hover {
    background: #2563eb;
  }

  .lang-item:hover {
    background: #f3f4f6;
  }

  .lang-item.active:hover {
    background: #dbeafe;
  }
}
</style>
