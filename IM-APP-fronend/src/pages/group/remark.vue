<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchGroupDetail, updateGroupRemark } from '@/api/group'
import { useGroupStore } from '@/stores/group'
import { useChatStore } from '@/stores/chat'
import { resolveGroupConversationID, setConversationGroupRemark } from '@/utils/openim'
import ImNavBar from '@/components/ImNavBar.vue'

const REMARK_MAX = 64
const groupId = ref('')
const name = ref('')
const remark = ref('')
const saving = ref(false)

const count = computed(() => remark.value.length)
const canSubmit = computed(() => !saving.value)

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }
  try {
    const g = await fetchGroupDetail(groupId.value)
    name.value = g.name || ''
    remark.value = g.remark?.trim() || ''
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}

async function onSubmit() {
  if (!groupId.value || saving.value) return
  const value = remark.value.trim()
  if (value.length > REMARK_MAX) {
    uni.showToast({ title: `群备注最多 ${REMARK_MAX} 个字`, icon: 'none' })
    return
  }
  saving.value = true
  try {
    await updateGroupRemark(groupId.value, value)
    try {
      const conversationId = await resolveGroupConversationID(groupId.value)
      await setConversationGroupRemark(conversationId, value)
      useChatStore().patchConversation(conversationId, { title: value || name.value })
    } catch {
      // 备注已写入业务库；OpenIM 会话标题下次拉列表再对齐
    }
    const store = useGroupStore()
    await store.loadDetail(groupId.value)
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 300)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar title="群备注" @back="goBack" />

    <view class="form">
      <textarea
        class="input"
        v-model="remark"
        :maxlength="REMARK_MAX"
        :placeholder="name || '请输入群备注'"
        auto-height
      />
      <view class="meta">
        <text class="hint">群备注仅自己可见，最多 {{ REMARK_MAX }} 个字</text>
        <text class="count">{{ count }}/{{ REMARK_MAX }}</text>
      </view>
    </view>

    <view class="footer">
      <button class="btn" :disabled="!canSubmit" @click="onSubmit">确认</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f4f7;
  display: flex;
  flex-direction: column;
}
.form {
  margin-top: 24rpx;
  background: #fff;
  padding: 32rpx;
}
.input {
  width: 100%;
  min-height: 120rpx;
  font-size: 30rpx;
  color: #212121;
  line-height: 1.5;
}
.meta {
  margin-top: 16rpx;
  display: flex;
  justify-content: space-between;
}
.hint,
.count {
  font-size: 24rpx;
  color: #636e86;
}
.footer {
  margin-top: auto;
  padding: 32rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}
.btn {
  height: 96rpx;
  line-height: 96rpx;
  border-radius: 16rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
}
.btn[disabled] {
  opacity: 0.5;
}
.btn::after {
  border: none;
}
</style>
