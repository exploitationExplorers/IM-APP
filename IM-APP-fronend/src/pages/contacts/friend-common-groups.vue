<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { APP_CONFIG } from '@/config'
import { fetchContact } from '@/api/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useContactStore } from '@/stores/contact'
import { useDesktopLayout } from '@/composables/useDesktopLayout'
import ImNavBar from '@/components/ImNavBar.vue'
import { safeBack } from '@/utils/nav'
import type { Contact, GroupPreview } from '@/types'

useAuthGuard()

const contactStore = useContactStore()
const { isDesktop } = useDesktopLayout()

const contactId = ref('')
const contact = ref<Contact | null>(null)
const loading = ref(false)

const groups = computed(() => contact.value?.commonGroups || [])

onLoad((query) => {
  contactId.value = String(query?.id || '')
  if (contactId.value) void loadDetail()
})

async function loadDetail() {
  loading.value = true
  try {
    contact.value = await fetchContact(contactId.value)
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goBack() {
  safeBack('/pages/contacts/index')
}

function openGroup(g: GroupPreview) {
  if (isDesktop.value) {
    void contactStore.openChatWithGroupDesktop(
      g.id,
      g.name,
      g.avatar || APP_CONFIG.defaultGroupAvatarUrl,
    )
    return
  }
  uni.navigateTo({
    url: `/pages/chat/room?type=group&targetId=${encodeURIComponent(g.id)}&title=${encodeURIComponent(g.name)}&avatar=${encodeURIComponent(g.avatar || APP_CONFIG.defaultGroupAvatarUrl)}`,
  })
}
</script>

<template>
  <view class="page">
    <ImNavBar title="共同群组" @back="goBack" />

    <scroll-view scroll-y class="list">
      <view v-if="loading && !groups.length" class="hint">加载中…</view>
      <view v-else-if="!groups.length" class="hint">暂无共同群组</view>
      <view
        v-for="g in groups"
        :key="g.id"
        class="row"
        @click="openGroup(g)"
      >
        <image
          class="avatar"
          :src="g.avatar || APP_CONFIG.defaultGroupAvatarUrl"
          mode="aspectFill"
        />
        <text class="name">{{ g.name }}</text>
        <image class="chevron" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  height: 100dvh;
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

.list {
  flex: 1;
  min-height: 0;
}

.hint {
  padding: 80rpx 40rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}

.row {
  display: flex;
  align-items: center;
  gap: 32rpx;
  min-height: 112rpx;
  padding: 16rpx 40rpx;
  box-sizing: border-box;
  border-bottom: 1rpx solid #f3f4f7;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.name {
  flex: 1;
  min-width: 0;
  font-size: 32rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
  opacity: 0.45;
}
</style>
