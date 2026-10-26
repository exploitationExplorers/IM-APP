<script setup lang="ts">
import { computed } from 'vue'
import { APP_CONFIG } from '@/config'
import legalContent from '@/content/legal.json'

const props = defineProps<{ kind: 'privacy' | 'agreement' }>()
const url = computed(() => props.kind === 'privacy' ? APP_CONFIG.privacyPolicyUrl : APP_CONFIG.userAgreementUrl)
const available = computed(() => /^https:\/\/[^/]+\//i.test(url.value))
const document = computed(() => legalContent.documents[props.kind])
</script>

<template>
  <web-view
    v-if="available"
    :src="url"
  />
  <view
    v-else
    class="legal-document"
  >
    <text class="legal-title">
      {{ document.title }}
    </text>
    <text class="legal-date">
      更新日期：{{ legalContent.updatedAt }}　生效日期：{{ legalContent.effectiveAt }}
    </text>
    <text
      v-for="paragraph in document.introduction"
      :key="paragraph"
      class="legal-paragraph"
    >
      {{ paragraph }}
    </text>
    <view
      v-for="section in document.sections"
      :key="section.title"
      class="legal-section"
    >
      <text class="legal-heading">
        {{ section.title }}
      </text>
      <text
        v-for="paragraph in section.paragraphs"
        :key="paragraph"
        class="legal-paragraph"
        :class="{ 'legal-important': 'important' in section && section.important }"
      >
        {{ paragraph }}
      </text>
    </view>
  </view>
</template>

<style scoped>
.legal-document { box-sizing: border-box; min-height: 100vh; max-width: 900px; margin: 0 auto; padding: 40rpx 32rpx 80rpx; background: #fff; color: #333; }
.legal-title { display: block; margin-bottom: 20rpx; font-size: 40rpx; font-weight: 700; line-height: 1.5; }
.legal-date { display: block; margin-bottom: 24rpx; font-size: 24rpx; line-height: 1.8; color: #636e86; }
.legal-section { margin-top: 40rpx; }
.legal-heading { display: block; margin-bottom: 20rpx; font-size: 32rpx; font-weight: 700; line-height: 1.6; }
.legal-paragraph { display: block; margin-bottom: 24rpx; font-size: 28rpx; line-height: 1.9; overflow-wrap: anywhere; }
.legal-important { font-weight: 600; }
</style>
