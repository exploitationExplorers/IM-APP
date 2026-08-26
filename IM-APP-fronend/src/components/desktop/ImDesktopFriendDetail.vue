<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { APP_CONFIG, THEME } from '@/config'
import {
  blockContact,
  deleteContact,
  fetchContact,
  unblockContact,
} from '@/api/contact'
import { useContactStore } from '@/stores/contact'
import type { Contact, GroupPreview } from '@/types'

const props = defineProps<{
  modelValue: boolean
  contactId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const contactStore = useContactStore()
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
const previewGroups = computed(() => groups.value.slice(0, 3))

function close() {
  showMore.value = false
  emit('update:modelValue', false)
}

async function loadDetail() {
  if (!props.contactId) return
  loading.value = true
  try {
    contact.value = await fetchContact(props.contactId)
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
    close()
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.modelValue, props.contactId] as const,
  ([open]) => {
    if (open) {
      showMore.value = false
      contact.value = null
      void loadDetail()
    }
  },
  { immediate: true },
)

function goRemark() {
  if (!contact.value) return
  close()
  uni.navigateTo({
    url: `/pages/contacts/friend-remark?id=${contact.value.id}&remark=${encodeURIComponent(contact.value.remark || '')}&nickname=${encodeURIComponent(contact.value.nickname)}`,
  })
}

function goTags() {
  if (!contact.value) return
  close()
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
  const id = contact.value.id
  const name = listName.value
  const avatar = contact.value.avatar || APP_CONFIG.defaultAvatarUrl
  close()
  await contactStore.openChatWithContactDesktop(id, name, avatar)
}

function openGroup(g: GroupPreview) {
  close()
  void contactStore.openChatWithGroupDesktop(
    g.id,
    g.name,
    g.avatar || APP_CONFIG.defaultGroupAvatarUrl,
  )
}

function goAllGroups() {
  if (!contact.value || !groups.value.length) return
  uni.showToast({ title: `共 ${groups.value.length} 个共同群组`, icon: 'none' })
}

function onBlock() {
  showMore.value = false
  if (!contact.value) return
  const blocked = !!contact.value.isBlocked
  uni.showModal({
    title: blocked ? '移出黑名单' : '加入黑名单',
    content: blocked
      ? '解除后对方可正常向你发送消息。'
      : '拉黑后对方将无法再向你发送消息，解除后可恢复。',
    confirmText: blocked ? '解除' : '拉黑',
    confirmColor: THEME.danger,
    success: async (res) => {
      if (!res.confirm || !contact.value) return
      try {
        if (blocked) {
          await unblockContact(contact.value.id)
          contact.value.isBlocked = false
          uni.showToast({ title: '已解除', icon: 'success' })
        } else {
          await blockContact(contact.value.id)
          contact.value.isBlocked = true
          uni.showToast({ title: '已拉黑', icon: 'success' })
        }
        await contactStore.loadDirectory()
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      }
    },
  })
}

function onDelete() {
  showMore.value = false
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
        await contactStore.loadDirectory()
        uni.showToast({ title: '已删除', icon: 'success' })
        close()
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      }
    },
  })
}
</script>

<template>
  <!-- 对齐参考站 PC modal：400×90dvh 居中白卡片，透明遮罩，深色标题 -->
  <view v-if="modelValue" class="friend-layer" @click="close">
    <view class="friend-modal" @click.stop>
      <view class="friend-hero" />

      <view class="friend-nav">
        <text class="friend-nav-title">好友详情</text>
        <view class="friend-nav-more" @click.stop="showMore = !showMore">
          <image class="friend-nav-more-icon" src="/static/icons/icon-more.svg" mode="aspectFit" />
          <view v-if="showMore" class="friend-more-menu">
            <view class="friend-more-item" @click.stop="onBlock">
              <image class="friend-more-icon" src="/static/icons/icon-block.svg" mode="aspectFit" />
              <text>{{ contact?.isBlocked ? '移出黑名单' : '加入黑名单' }}</text>
            </view>
            <view class="friend-more-item danger" @click.stop="onDelete">
              <image
                class="friend-more-icon"
                src="/static/icons/icon-profile-remove.svg"
                mode="aspectFit"
              />
              <text>删除联络人</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="loading && !contact" class="friend-loading">加载中…</view>

      <!-- 对齐参考站：mt-6dvh 白底 sheet；头像 -mt 压边且不在 overflow 容器内 -->
      <view v-else-if="contact" class="friend-body">
        <view class="friend-sheet">
          <!-- 参考站双层 -mt-2，合计约上移 16px，头像才完整压在白底上沿 -->
          <view class="friend-profile-wrap">
            <view class="friend-profile">
              <view
                class="friend-avatar"
                :style="{
                  backgroundImage: `url(${contact.avatar || APP_CONFIG.defaultAvatarUrl})`,
                }"
              />
              <view class="friend-profile-meta">
                <text class="friend-name">{{ nickname }}</text>
                <view v-if="contact.isBlocked" class="friend-blocked-tag">
                  <text>已拉黑</text>
                </view>
              </view>
            </view>
          </view>

          <view class="friend-main">
            <view class="friend-divider" />

            <view class="friend-row" @click="goRemark">
              <text class="friend-label">备注</text>
              <view class="friend-row-right">
                <text v-if="contact.remark" class="friend-value">{{ contact.remark }}</text>
                <image class="friend-chevron" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
              </view>
            </view>
            <view class="friend-row">
              <text class="friend-label">聊天号</text>
              <view class="friend-row-right">
                <text class="friend-pid">{{ contact.publicId || '—' }}</text>
                <view v-if="contact.publicId" class="friend-copy" @click.stop="onCopyPublicId">
                  <text>复制</text>
                </view>
              </view>
            </view>
            <view class="friend-row" @click="goTags">
              <text class="friend-label">标签</text>
              <view class="friend-row-right">
                <text v-if="tagText" class="friend-value">{{ tagText }}</text>
                <image class="friend-chevron" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
              </view>
            </view>

            <template v-if="groups.length">
              <view class="friend-hr" />

              <view class="friend-groups-bar">
                <text class="friend-groups-title">共同群组 ({{ groups.length }})</text>
                <text class="friend-groups-all" @click="goAllGroups">查看全部</text>
              </view>
              <view class="friend-groups-list">
                <view
                  v-for="g in previewGroups"
                  :key="g.id"
                  class="friend-group-row"
                  @click="openGroup(g)"
                >
                  <image
                    class="friend-group-avatar"
                    :src="g.avatar || APP_CONFIG.defaultGroupAvatarUrl"
                    mode="aspectFill"
                  />
                  <text class="friend-group-name">{{ g.name }}</text>
                  <image class="friend-chevron" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
                </view>
              </view>
            </template>

            <view class="friend-footer">
              <view class="friend-msg-btn" @click="onMessage">
                <image
                  class="friend-msg-icon"
                  src="/static/icons/icon-chat-white.svg"
                  mode="aspectFit"
                />
                <text class="friend-msg-text">消息</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 参考站：fixed 居中 + 透明遮罩 + 400×90dvh 白卡片 shadow-modal */
.friend-layer {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  pointer-events: auto;
}

.friend-modal {
  position: relative;
  width: 400px;
  max-width: calc(100vw - 48px);
  height: 90dvh;
  max-height: 90dvh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 8px 36px rgba(0, 0, 0, 0.16);
}

.friend-hero {
  pointer-events: none;
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 35dvh;
  z-index: 0;
  overflow: hidden;
  background-color: #0a2fc2;
  background-image: url('/static/contacts/friend-info-bg.webp');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-blend-mode: luminosity;
}

.friend-nav {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  height: 48px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  box-sizing: border-box;
}

.friend-nav-title {
  font-size: 24px;
  font-weight: 700;
  line-height: 32px;
  color: #212121;
}

.friend-nav-more {
  position: relative;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.friend-nav-more-icon {
  width: 20px;
  height: 20px;
}

.friend-more-menu {
  position: absolute;
  top: 40px;
  right: 0;
  min-width: 148px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  z-index: 30;
}

.friend-more-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  font-size: 14px;
  color: #212121;
  white-space: nowrap;
}

.friend-more-item:active {
  background: #f5f6f8;
}

.friend-more-item.danger {
  color: #ef4343;
}

.friend-more-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.friend-loading {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a8f9c;
  font-size: 14px;
}

/* 参考站：父级可滚；sheet overflow-visible + mt-6dvh；头像不进滚动区 */
.friend-body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.friend-sheet {
  position: relative;
  z-index: 50;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 6dvh;
  background: #fff;
  border-radius: 16px 16px 0 0;
  overflow: visible;
}

/* 参考站：外层 relative rounded w-full -mt-2 pb-1 */
.friend-profile-wrap {
  position: relative;
  width: 100%;
  margin-top: -8px;
  padding-bottom: 4px;
  border-radius: 4px;
  overflow: visible;
  flex-shrink: 0;
  z-index: 2;
}

/* 参考站：内层 flex items-center gap-4 px-6 -mt-2 pb-1 */
.friend-profile {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px 4px;
  margin-top: -8px;
  border-radius: 4px;
  position: relative;
  overflow: visible;
}

/* 参考站用 bg-cover 圆头像，避免 uni-image 裁切异常 */
.friend-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background-color: #f3f4f7;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  flex-shrink: 0;
  box-shadow:
    0 0 0 1px #fff,
    0 1px 3px rgba(0, 0, 0, 0.1),
    0 1px 2px -1px rgba(0, 0, 0, 0.1);
}

.friend-profile-meta {
  flex: 1;
  min-width: 0;
}

.friend-name {
  font-size: 16px;
  font-weight: 400;
  line-height: 24px;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.friend-blocked-tag {
  display: inline-flex;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #ffe5e5;
}

.friend-blocked-tag text {
  font-size: 11px;
  color: #e54d42;
}

/* 资料行以下可滚动，避免 overflow 裁到头像 */
.friend-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  padding-bottom: 8px;
}

.friend-divider {
  margin: 4px 20px;
  height: 0;
  border-top: 1px solid #e1e3ea;
}

.friend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  padding: 10px 16px;
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 4px;
}

.friend-row:hover {
  background: #f3f4f7;
}

.friend-label {
  font-size: 15px;
  line-height: 22px;
  color: #212121;
  flex-shrink: 0;
}

.friend-row-right {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 68%;
  margin-left: 12px;
}

.friend-value {
  font-size: 14px;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.friend-pid {
  font-size: 14px;
  color: #626e8d;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.friend-copy {
  flex-shrink: 0;
  height: 32px;
  padding: 0 8px;
  border-radius: 4px;
  background: #3c83f6;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  line-height: 32px;
  text-align: center;
}

.friend-chevron {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  opacity: 0.45;
}

.friend-hr {
  width: 100%;
  height: 8px;
  margin: 4px 0 0;
  background: #f3f4f7;
  border: none;
}

.friend-groups-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px 8px;
}

.friend-groups-title {
  font-size: 14px;
  font-weight: 700;
  line-height: 20px;
  color: #212121;
}

.friend-groups-all {
  font-size: 12px;
  color: #212121;
  cursor: pointer;
}

.friend-groups-list {
  padding: 0 20px;
}

.friend-group-row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 64px;
  padding: 8px 0;
  cursor: pointer;
  border-radius: 8px;
}

.friend-group-row:hover {
  background: #f3f4f7;
}

.friend-group-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.friend-group-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.friend-footer {
  margin-top: auto;
  padding: 0 20px 8px;
}

.friend-msg-btn {
  height: 40px;
  border-radius: 4px;
  background: #0a2fc2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
}

.friend-msg-btn:active {
  opacity: 0.92;
}

.friend-msg-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.friend-msg-text {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}
</style>
