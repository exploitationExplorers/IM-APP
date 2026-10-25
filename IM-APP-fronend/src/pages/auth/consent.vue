<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { APP_CONFIG } from '@/config'
import ImLegalConsent from '@/components/ImLegalConsent.vue'
import { acceptPrivacyConsent, hasPrivacyConsent } from '@/utils/privacy-consent'

const agreed = ref(false)

onShow(() => {
  if (hasPrivacyConsent()) uni.switchTab({ url: '/pages/chat/index' })
})

function onAccept() {
  if (!agreed.value) {
    uni.showToast({ title: '请先阅读并勾选协议与隐私政策', icon: 'none' })
    return
  }
  acceptPrivacyConsent()
  uni.$emit('privacy-consent-accepted')
  uni.reLaunch({ url: '/pages/chat/index' })
}

function onDecline() {
  uni.showModal({ title: '您可以先了解隐私政策', content: '未同意前不会启动登录、聊天服务或登记推送。您可以继续阅读，或关闭应用。', showCancel: false, confirmText: '知道了' })
}
</script>

<template>
  <view class="consent-page">
    <image
      class="consent-logo"
      src="/static/logo/logo.png"
      mode="aspectFit"
    />
    <text class="consent-title">
      欢迎使用{{ APP_CONFIG.displayName }}
    </text>
    <text class="consent-copy">
      为提供账号登录和即时通讯服务，我们需要处理您的手机号、账号资料、消息内容和会话设备标识。相机、麦克风和相册权限仅在您使用对应功能时申请。请阅读完整协议与隐私政策后自主选择。
    </text>
    <ImLegalConsent v-model="agreed" />
    <button
      class="consent-button"
      @click="onAccept"
    >
      同意并继续
    </button>
    <button
      class="consent-decline"
      @click="onDecline"
    >
      暂不同意
    </button>
  </view>
</template>

<style scoped>
.consent-page { min-height: 100vh; padding: 120rpx 48rpx 64rpx; box-sizing: border-box; background: #fff; }
.consent-logo { display: block; width: 160rpx; height: 160rpx; margin: 0 auto 48rpx; }
.consent-title { display: block; text-align: center; font-size: 38rpx; font-weight: 600; margin-bottom: 40rpx; }
.consent-copy { display: block; font-size: 28rpx; line-height: 1.9; color: #3a4558; }
.consent-button { background: #0a2fc2; color: #fff; margin-top: 32rpx; }
.consent-decline { background: #fff; color: #636e86; margin-top: 24rpx; }
</style>
