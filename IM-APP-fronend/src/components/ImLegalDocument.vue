<script setup lang="ts">
import { computed } from 'vue'
import { APP_CONFIG } from '@/config'

const props = defineProps<{ kind: 'privacy' | 'agreement' }>()
const url = computed(() => props.kind === 'privacy' ? APP_CONFIG.privacyPolicyUrl : APP_CONFIG.userAgreementUrl)
const available = computed(() => /^https:\/\/[^/]+\//i.test(url.value))
</script>

<template>
  <web-view
    v-if="available"
    :src="url"
  />
  <view
    v-else
    class="legal-unavailable"
  >
    <text>暂时无法加载，请稍后重试。</text>
  </view>
</template>

<style scoped>
.legal-unavailable { padding: 48rpx; font-size: 28rpx; color: #636e86; }
</style>
