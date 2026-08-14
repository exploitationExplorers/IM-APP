<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'

const groupStore = useGroupStore()
const userStore = useUserStore()
const groupId = ref('')
const nickname = ref('')
const originalNickname = ref('')
const saving = ref(false)

const NICKNAME_MAX = 15
const nicknameCount = computed(() => nickname.value.length)
const canSubmit = computed(() => {
  const name = nickname.value.trim()
  return name.length > 0 && name !== originalNickname.value.trim()
})

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }

  try {
    await groupStore.loadDetail(groupId.value)
    const meId = userStore.profile?.id
    const meNickname =
      groupStore.members.find((member) => member.id === meId)?.nickname ||
      userStore.profile?.nickname ||
      '我'

    nickname.value = meNickname
    originalNickname.value = meNickname
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群昵称失败', icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}

function onNicknameInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  nickname.value = (detail?.value || '').slice(0, NICKNAME_MAX)
}

function clearNickname() {
  nickname.value = ''
}

async function onConfirm() {
  const name = nickname.value.trim()
  if (!name) {
    uni.showToast({ title: '请输入群昵称', icon: 'none' })
    return
  }
  if (name.length > NICKNAME_MAX) {
    uni.showToast({ title: `群昵称最多 ${NICKNAME_MAX} 个字`, icon: 'none' })
    return
  }
  if (!canSubmit.value) return

  saving.value = true
  try {
    await groupStore.updateMyNickname(groupId.value, name)
    uni.showToast({ title: '修改成功', icon: 'success' })
    uni.navigateBack()
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '修改群昵称失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">我在本群的昵称</text>
      <view class="nav-space" />
    </view>

    <view class="form">
      <view class="input-row">
        <input
          class="input"
          type="text"
          :value="nickname"
          :maxlength="NICKNAME_MAX"
          placeholder="输入群昵称"
          placeholder-style="color:#636E86"
          :focus="true"
          @input="onNicknameInput"
        />
        <view v-if="nickname" class="clear-btn" @click="clearNickname">
          <text class="clear-icon">×</text>
        </view>
      </view>
      <view class="meta">
        <text class="hint">群昵称最多 {{ NICKNAME_MAX }} 个字</text>
        <text class="count">{{ nicknameCount }}/{{ NICKNAME_MAX }}</text>
      </view>
    </view>

    <view class="footer">
      <button
        class="confirm-btn"
        :class="{ 'is-enabled': canSubmit }"
        :loading="saving"
        :disabled="!canSubmit || saving"
        @click="onConfirm"
      >
        确认
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f4f7;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 26rpx;
  background: #fff;
}

.nav-back {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  color: #1b1b1b;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 34rpx;
  font-weight: 700;
  color: #1f1f1f;
}

.nav-space {
  width: 52rpx;
  height: 52rpx;
}

.form {
  padding: 24rpx 40rpx 0;
  background: #fff;
}

.input-row {
  display: flex;
  align-items: center;
  min-height: 96rpx;
  border-bottom: 1rpx solid #e1e3ea;
}

.input {
  flex: 1;
  min-width: 0;
  height: 96rpx;
  font-size: 34rpx;
  color: #212121;
}

.clear-btn {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #c8ccd6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: 16rpx;
}

.clear-icon {
  font-size: 32rpx;
  line-height: 1;
  color: #fff;
  margin-top: -2rpx;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0 24rpx;
}

.hint,
.count {
  font-size: 24rpx;
  color: #636e86;
  line-height: 32rpx;
}

.footer {
  padding: 32rpx 30rpx 40rpx;
  margin-top: auto;
}

.confirm-btn {
  width: 100%;
  height: 96rpx;
  border: none;
  border-radius: 18rpx;
  background: #dfe3f1;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
}

.confirm-btn.is-enabled {
  background: #0a2fc2;
}
</style>
