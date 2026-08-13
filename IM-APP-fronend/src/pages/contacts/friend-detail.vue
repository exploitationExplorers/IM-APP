<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { APP_CONFIG, THEME } from '@/config'
import {
  blockContact,
  deleteContact,
  fetchContact,
} from '@/api/contact'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import type { Contact, GroupPreview } from '@/types'

useAuthGuard()

const contactStore = useContactStore()
const contactId = ref('')
const contact = ref<Contact | null>(null)
const loading = ref(false)
const showMore = ref(false)

const nickname = computed(() => contact.value?.nickname || '')
const listName = computed(
  () => contact.value?.remark?.trim() || contact.value?.nickname || '',
)
const tagText = computed(() =>
  (contact.value?.tags || []).map((t) => t.name).join('、'),
)
const groups = computed(() => contact.value?.commonGroups || [])

onLoad((query) => {
  contactId.value = String(query?.id || '')
})

onShow(() => {
  if (contactId.value) loadDetail()
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
  uni.navigateBack()
}

function goRemark() {
  if (!contact.value) return
  uni.navigateTo({
    url: `/pages/contacts/friend-remark?id=${contact.value.id}&remark=${encodeURIComponent(contact.value.remark || '')}&nickname=${encodeURIComponent(contact.value.nickname)}`,
  })
}

function goTags() {
  if (!contact.value) return
  uni.navigateTo({ url: `/pages/contacts/friend-tags?id=${contact.value.id}` })
}

function onCopyPublicId() {
  const id = contact.value?.publicId
  if (!id) {
    uni.showToast({ title: '暂无聊天号', icon: 'none' })
    return
  }
  uni.setClipboardData({
    data: id,
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
  })
}

async function onMessage() {
  if (!contact.value) return
  await contactStore.openChatWithContact(
    contact.value.id,
    listName.value,
    contact.value.avatar || APP_CONFIG.defaultAvatarUrl,
  )
}

function openGroup(g: GroupPreview) {
  uni.navigateTo({
    url: `/pages/chat/room?type=group&targetId=${encodeURIComponent(g.id)}&title=${encodeURIComponent(g.name)}&avatar=${encodeURIComponent(g.avatar || APP_CONFIG.defaultGroupAvatarUrl)}`,
  })
}

function onMore() {
  showMore.value = !showMore.value
}

function closeMore() {
  showMore.value = false
}

function onBlock() {
  closeMore()
  if (!contact.value) return
  uni.showModal({
    title: '加入黑名单',
    content: '拉黑后将删除好友关系，对方无法再向你发起会话。',
    confirmText: '拉黑',
    confirmColor: THEME.danger,
    success: async (res) => {
      if (!res.confirm || !contact.value) return
      try {
        await blockContact(contact.value.id)
        await contactStore.loadAll()
        uni.showToast({ title: '已拉黑', icon: 'success' })
        setTimeout(() => uni.navigateBack(), 400)
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      }
    },
  })
}

function onDelete() {
  closeMore()
  if (!contact.value) return
  uni.showModal({
    title: '删除联络人',
    content: `确定删除「${listName.value}」吗？`,
    confirmText: '删除',
    confirmColor: THEME.danger,
    success: async (res) => {
      if (!res.confirm || !contact.value) return
      try {
        await deleteContact(contact.value.id)
        await contactStore.loadAll()
        uni.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => uni.navigateBack(), 400)
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      }
    },
  })
}
</script>

<template>
  <view class="page" @click="closeMore">
    <!-- 参考站：主色底 + friend-info.webp luminosity 混合 -->
    <view class="hero">
      <view class="hero-img" />
    </view>

    <view class="nav">
      <view class="nav-btn" @click="goBack">
        <image class="nav-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">好友详情</text>
      <view class="nav-btn" @click.stop="onMore">
        <image class="nav-more-icon" src="/static/icons/icon-more.svg" mode="aspectFit" />
        <view v-if="showMore" class="more-menu">
          <view class="more-item" @click.stop="onBlock">
            <image class="more-icon" src="/static/icons/icon-block.svg" mode="aspectFit" />
            <text>加入黑名单</text>
          </view>
          <view class="more-item danger" @click.stop="onDelete">
            <image class="more-icon" src="/static/icons/icon-profile-remove.svg" mode="aspectFit" />
            <text>删除联络人</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="contact" class="body">
      <view class="sheet">
        <view class="top-card">
          <view class="profile">
            <image
              class="avatar"
              :src="contact.avatar || APP_CONFIG.defaultAvatarUrl"
              mode="aspectFill"
            />
            <view class="profile-meta">
              <text class="name">{{ nickname }}</text>
            </view>
          </view>

          <view class="divider" />

          <view class="row" @click="goRemark">
            <text class="label">备注</text>
            <view class="row-right">
              <text v-if="contact.remark" class="value">{{ contact.remark }}</text>
              <image class="chevron" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
            </view>
          </view>
          <view class="row">
            <text class="label">聊天号</text>
            <view class="row-right">
              <text class="pid">{{ contact.publicId || '—' }}</text>
              <view v-if="contact.publicId" class="copy" @click.stop="onCopyPublicId">复制</view>
            </view>
          </view>
          <view class="row" @click="goTags">
            <text class="label">标签</text>
            <view class="row-right">
              <text v-if="tagText" class="value">{{ tagText }}</text>
              <image class="chevron" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
            </view>
          </view>
        </view>

        <view v-if="groups.length" class="groups">
          <view class="groups-bar">
            <text class="groups-title">共同群组 ({{ groups.length }})</text>
          </view>
          <view
            v-for="g in groups"
            :key="g.id"
            class="group-row"
            @click="openGroup(g)"
          >
            <image
              class="group-avatar"
              :src="g.avatar || APP_CONFIG.defaultGroupAvatarUrl"
              mode="aspectFill"
            />
            <text class="group-name">{{ g.name }}</text>
            <image class="chevron" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
          </view>
        </view>

        <view class="footer">
          <view class="msg-btn" @click="onMessage">
            <image class="msg-icon" src="/static/icons/icon-chat-white.svg" mode="aspectFit" />
            <text class="msg-text">消息</text>
          </view>
        </view>
      </view>
    </view>

    <view v-else-if="loading" class="hint">加载中...</view>
  </view>
</template>

<style scoped lang="scss">
.page {
  position: relative;
  min-height: 100vh;
  height: 100vh;
  background: #f3f4f7;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 参考站 h-35dvh */
.hero {
  pointer-events: none;
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 460rpx;
  z-index: 0;
  overflow: hidden;
  background-color: #0a2fc2;
}

.hero-img {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-image: url('/static/contacts/friend-info-bg.webp');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  mix-blend-mode: luminosity;
  opacity: 0.95;
}

.nav {
  position: relative;
  z-index: 20;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: calc(96rpx + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 32rpx 0;
  background: transparent;
  box-sizing: border-box;
}

.nav-btn {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
}

.nav-icon {
  width: 40rpx;
  height: 40rpx;
}

.nav-more-icon {
  width: 36rpx;
  height: 36rpx;
  transform: rotate(90deg);
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 48rpx;
  font-weight: 700;
  line-height: 64rpx;
  color: #212121;
}

.more-menu {
  position: absolute;
  top: 72rpx;
  right: 0;
  min-width: 320rpx;
  background: #fff;
  border-radius: 32rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
  overflow: hidden;
  z-index: 30;
}

.more-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 32rpx;
  font-size: 28rpx;
  color: #212121;
  white-space: nowrap;
  text-align: left;
}

.more-icon {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.more-item.danger {
  color: #ef4343;
}

.body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 参考站 nav→sheet 约 49px ≈ 98rpx */
  margin-top: 100rpx;
}

.sheet {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f3f4f7;
  border-radius: 32rpx 32rpx 0 0;
  overflow: visible;
}

.top-card {
  flex-shrink: 0;
  background: #fff;
  border-radius: 32rpx 32rpx 0 0;
  overflow: visible;
}

.profile {
  display: flex;
  align-items: center;
  gap: 32rpx;
  padding: 0 48rpx 16rpx;
  flex-shrink: 0;
  margin-top: -40rpx;
}

.avatar {
  width: 144rpx;
  height: 144rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
  border: 4rpx solid #fff;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.12);
}

.profile-meta {
  flex: 1;
  min-width: 0;
  padding-bottom: 8rpx;
}

.name {
  font-size: 34rpx;
  font-weight: 700;
  line-height: 48rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 参考站 my-1 mx-5 border #e1e3ea，仅资料区下方一条 */
.divider {
  flex-shrink: 0;
  margin: 8rpx 40rpx 0;
  height: 0;
  border-top: 1rpx solid #e1e3ea;
}

.row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  padding: 20rpx 40rpx;
  box-sizing: border-box;
}

.label {
  font-size: 34rpx;
  line-height: 48rpx;
  color: #212121;
  flex-shrink: 0;
}

.row-right {
  display: flex;
  align-items: center;
  gap: 16rpx;
  max-width: 68%;
  margin-left: 24rpx;
}

.value {
  font-size: 32rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 参考站 text-content-secondary + font-mono */
.pid {
  font-size: 32rpx;
  color: #626e8d;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy {
  flex-shrink: 0;
  height: 64rpx;
  padding: 0 16rpx;
  border-radius: 8rpx;
  background: #3c83f6;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 64rpx;
  text-align: center;
}

.chevron {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
  opacity: 0.45;
}

.groups {
  flex-shrink: 0;
  margin-top: 0;
  background: #f3f4f7;
}

.groups-bar {
  display: flex;
  align-items: center;
  min-height: 64rpx;
  padding: 16rpx 40rpx;
  background: #f3f4f7;
}

.groups-title {
  font-size: 28rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #212121;
}

.group-row {
  display: flex;
  align-items: center;
  gap: 32rpx;
  padding: 16rpx 40rpx;
  background: #fff;
}

.group-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.group-name {
  flex: 1;
  font-size: 32rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer {
  margin-top: auto;
  flex-shrink: 0;
  padding: 16rpx 40rpx calc(16rpx + env(safe-area-inset-bottom));
  background: #f3f4f7;
}

.msg-btn {
  height: 80rpx;
  border-radius: 8rpx;
  background: #0a2fc2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
}

.msg-icon {
  width: 40rpx;
  height: 40rpx;
}

.msg-text {
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1;
}

.hint {
  position: relative;
  z-index: 1;
  text-align: center;
  color: #999;
  margin-top: 240rpx;
}
</style>
