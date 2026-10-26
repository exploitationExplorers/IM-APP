<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useAccountDeletion } from '@/composables/useAccountDeletion'

useAuthGuard()
const { password, acknowledged, loading, deleting, ownedGroupCount, requirementsLoaded,
  error, canSubmit, load, submit } = useAccountDeletion()
onShow(load)
function goBack() { uni.navigateBack() }
</script>

<template>
  <view class="page">
    <ImNavBar title="注销账号" @back="goBack" />
    <view class="content">
      <text class="title">注销后将无法恢复</text>
      <text class="paragraph">你的手机号、密码、个人资料、好友关系及账号内的收藏等私人数据将被清除，所有设备将退出登录。</text>
      <text class="paragraph">已发送给他人的内容、他人保存的副本及处理违规所需的记录可能匿名保留。注销不会删除群内其他成员的消息。</text>
      <text class="paragraph">如果你是群主，请先在群设置中转让或解散群聊。未设置或忘记登录密码时，请先设置或重置密码。</text>
      <text v-if="loading" class="paragraph">正在检查账号…</text>
      <text v-else-if="ownedGroupCount" class="error">你仍是 {{ ownedGroupCount }} 个群的群主，请处理后返回此页。</text>
      <input v-model="password" class="password" password :maxlength="72" placeholder="输入登录密码确认身份" :disabled="deleting" />
      <view class="consent" @click="!deleting && (acknowledged = !acknowledged)">
        <checkbox :checked="acknowledged" :disabled="deleting" color="#e5484d" />
        <text>我已了解注销后果，确认注销此账号</text>
      </view>
      <text v-if="error" class="error">{{ error }}</text>
      <button v-if="!loading && !requirementsLoaded" @click="load">重新检查</button>
      <button class="delete" :disabled="!canSubmit" :loading="deleting" @click="submit">永久注销账号</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page { min-height: 100vh; background: #f5f5f5; }
.content { padding: 40rpx 32rpx; display: flex; flex-direction: column; gap: 28rpx; }
.title { font-size: 36rpx; font-weight: 600; }
.paragraph { font-size: 28rpx; line-height: 1.8; color: #555; }
.password { padding: 28rpx; background: #fff; border-radius: 12rpx; }
.consent { display: flex; align-items: center; gap: 12rpx; font-size: 26rpx; }
.error { color: #c6333a; font-size: 26rpx; }
.delete { width: 100%; background: #e5484d; color: #fff; }
.delete[disabled] { background: #e4b5b7; color: #fff; }
</style>
