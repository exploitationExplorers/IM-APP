<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useContactStore } from '@/stores/contact'
import { useGroupStore } from '@/stores/group'

const contactStore = useContactStore()
const groupStore = useGroupStore()
const { contacts } = storeToRefs(contactStore)

const groupName = ref('')
const selectedIds = ref<string[]>([])
const loading = ref(false)

onMounted(() => {
  contactStore.loadAll()
})

const canSubmit = computed(() => groupName.value.trim().length > 0)

function toggleMember(id: string) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(id)
}

async function onCreate() {
  if (!canSubmit.value) {
    uni.showToast({ title: '请输入群名称', icon: 'none' })
    return
  }
  loading.value = true
  uni.showLoading({ title: '创建中...', mask: true })
  try {
    const g = await groupStore.create(groupName.value.trim(), [...selectedIds.value])
    uni.showToast({ title: '创建成功', icon: 'success' })
    if (g.conversationId) {
      uni.redirectTo({
        url: `/pages/chat/room?id=${g.conversationId}&title=${encodeURIComponent(g.name)}`,
      })
    } else {
      uni.navigateBack()
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
    uni.hideLoading()
  }
}
</script>

<template>
  <view class="page">
    <view class="field">
      <text class="label">群名称</text>
      <input class="input" v-model="groupName" placeholder="请输入群名称" maxlength="32" />
    </view>

    <view class="section-title">选择好友（{{ selectedIds.length }}）</view>
    <scroll-view scroll-y class="list">
      <view
        v-for="c in contacts"
        :key="c.id"
        class="row"
        @click="toggleMember(c.id)"
      >
        <image class="avatar" :src="c.avatar || '/static/avatar-me.png'" mode="aspectFill" />
        <text class="name">{{ c.nickname }}</text>
        <text class="check">{{ selectedIds.includes(c.id) ? '✓' : '' }}</text>
      </view>
    </scroll-view>

    <button class="btn" :disabled="!canSubmit || loading" @click="onCreate">创建群聊</button>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
  display: flex;
  flex-direction: column;
}

.field {
  background: #fff;
  padding: 28rpx;
  margin-bottom: 16rpx;
}

.label {
  font-size: 26rpx;
  color: #666;
}

.input {
  margin-top: 12rpx;
  font-size: 30rpx;
}

.section-title {
  padding: 16rpx 28rpx;
  color: #666;
  font-size: 24rpx;
}

.list {
  flex: 1;
  height: 0;
  background: #fff;
}

.row {
  display: flex;
  align-items: center;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid #f3f3f3;
}

.avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  margin-right: 20rpx;
  background: #eee;
}

.name {
  flex: 1;
  font-size: 28rpx;
}

.check {
  color: #2b5cff;
  font-size: 32rpx;
}

.btn {
  margin: 24rpx 28rpx 48rpx;
  background: #2b5cff;
  color: #fff;
  border-radius: 12rpx;
}

.btn::after {
  border: none;
}
</style>
