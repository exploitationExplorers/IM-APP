<script setup lang="ts">
/**
 * 群聊输入 @ 后弹出的提及面板（对齐参考站）：
 * - 顶部「所有人」仅群主/管理员可见
 * - 下方为可搜索的成员列表（头像 + 名称）
 */
import { computed } from 'vue'
import { APP_CONFIG } from '@/config'

export interface AtMentionMember {
  id: string
  /** OpenIM userID，发 AtText 用 */
  imUserId: string
  name: string
  avatar: string
}

const props = defineProps<{
  visible: boolean
  /** 仅 owner/admin 显示「所有人」 */
  canAtAll: boolean
  keyword: string
  members: AtMentionMember[]
}>()

const emit = defineEmits<{
  close: []
  selectAll: []
  select: [member: AtMentionMember]
}>()

const filtered = computed(() => {
  const text = props.keyword.trim().toLowerCase()
  if (!text) return props.members
  return props.members.filter((m) => m.name.toLowerCase().includes(text))
})
</script>

<template>
  <view v-if="visible" class="at-panel">
    <!-- 顶栏：群主/管理员显示「所有人」+ 关闭；普通成员仅关闭 -->
    <view class="at-header" :class="{ 'at-header--all': canAtAll }">
      <view
        v-if="canAtAll"
        class="at-all-left"
        @click="emit('selectAll')"
      >
        <view class="at-all-icon-wrap">
          <image class="at-all-icon" src="/static/icons/menu-group.svg" mode="aspectFit" />
        </view>
        <text class="at-all-label">所有人</text>
      </view>
      <view v-else class="at-header-spacer" />
      <text class="at-close" @click.stop="emit('close')">×</text>
    </view>

    <scroll-view scroll-y class="at-list" :show-scrollbar="true">
      <view
        v-for="m in filtered"
        :key="m.id"
        class="at-row"
        @click="emit('select', m)"
      >
        <image
          class="at-avatar"
          :src="m.avatar || APP_CONFIG.defaultAvatarUrl"
          mode="aspectFill"
        />
        <text class="at-name">{{ m.name }}</text>
      </view>
      <view v-if="!filtered.length" class="at-empty">
        <text class="at-empty-text">无匹配成员</text>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.at-panel {
  background: #fff;
  overflow: hidden;
  border-top: 1rpx solid #e8e8e8;
}

.at-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  padding: 0 28rpx;
  background: #f3f4f7;
  box-sizing: border-box;
}

.at-header--all {
  /* 可点「所有人」时整行更贴近参考站 */
}

.at-header-spacer {
  flex: 1;
}

.at-all-left {
  display: flex;
  align-items: center;
  gap: 20rpx;
  min-width: 0;
  flex: 1;
}

.at-all-icon-wrap {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: #e8eaf0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.at-all-icon {
  width: 32rpx;
  height: 32rpx;
}

.at-all-label {
  font-size: 30rpx;
  color: #212121;
  font-weight: 500;
}

.at-close {
  width: 48rpx;
  height: 48rpx;
  line-height: 48rpx;
  text-align: center;
  font-size: 40rpx;
  color: #8a8f9c;
  flex-shrink: 0;
}

.at-list {
  max-height: 480rpx;
  background: #fff;
}

.at-row {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 20rpx 28rpx;
  box-sizing: border-box;
}

.at-row:active {
  background: #f5f6f8;
}

.at-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #eee;
  flex-shrink: 0;
}

.at-name {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.at-empty {
  padding: 48rpx 28rpx;
  text-align: center;
}

.at-empty-text {
  font-size: 26rpx;
  color: #8a8f9c;
}
</style>
