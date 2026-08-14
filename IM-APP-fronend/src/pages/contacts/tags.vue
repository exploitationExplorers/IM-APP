<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppSearchBar from '@/components/AppSearchBar.vue'
import {
  createContactTag,
  deleteContactTag,
  fetchContactTags,
  fetchTagMembers,
} from '@/api/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import type { ContactTagItem } from '@/types'

useAuthGuard()

const TAG_MAX = 12
const tags = ref<ContactTagItem[]>([])
const keyword = ref('')
const editing = ref(false)
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const deleting = ref(false)
const creating = ref(false)
const showCreate = ref(false)
const draftName = ref('')

const filtered = computed(() => {
  const k = keyword.value.trim()
  if (!k) return tags.value
  return tags.value.filter((t) => {
    if (t.name.includes(k)) return true
    return (t.memberNames || []).some((n) => n.includes(k))
  })
})

const selectedCount = computed(() => selected.value.size)
const draftCount = computed(() => draftName.value.length)
const canCreate = computed(() => !!draftName.value.trim() && !creating.value)

onShow(() => {
  load()
})

function contactDisplayName(c: { remark?: string; nickname: string }) {
  return c.remark?.trim() || c.nickname
}

async function fillMemberPreviews(list: ContactTagItem[]) {
  const need = list.filter((t) => t.memberCount > 0 && !(t.memberNames && t.memberNames.length))
  if (!need.length) return
  await Promise.all(
    need.map(async (tag) => {
      try {
        const members = await fetchTagMembers(tag.id)
        tag.memberNames = members
          .slice(0, 5)
          .map(contactDisplayName)
          .filter((n) => !!n)
      } catch {
        /* 预览失败不影响列表 */
      }
    }),
  )
}

async function load() {
  loading.value = true
  try {
    const list = await fetchContactTags()
    await fillMemberPreviews(list)
    tags.value = list
    const valid = new Set(tags.value.map((t) => t.id))
    const next = new Set<string>()
    selected.value.forEach((id) => {
      if (valid.has(id)) next.add(id)
    })
    selected.value = next
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function memberPreview(tag: ContactTagItem) {
  return (tag.memberNames || []).join(', ')
}

function goBack() {
  if (editing.value) {
    editing.value = false
    selected.value = new Set()
    return
  }
  uni.navigateBack()
}

function toggleEdit() {
  if (editing.value) {
    editing.value = false
    selected.value = new Set()
    return
  }
  editing.value = true
}

function openTag(tag: ContactTagItem) {
  if (editing.value) {
    toggleSelect(tag.id)
    return
  }
  uni.navigateTo({
    url: `/pages/contacts/tag-detail?id=${encodeURIComponent(tag.id)}&name=${encodeURIComponent(tag.name)}`,
  })
}

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function openCreate() {
  draftName.value = ''
  showCreate.value = true
}

function closeCreate() {
  if (creating.value) return
  showCreate.value = false
  draftName.value = ''
}

async function confirmCreate() {
  const name = draftName.value.trim()
  if (!name || creating.value) return
  if (name.length > TAG_MAX) {
    uni.showToast({ title: `标签名称最多 ${TAG_MAX} 个字`, icon: 'none' })
    return
  }
  creating.value = true
  try {
    const tag = await createContactTag(name)
    showCreate.value = false
    draftName.value = ''
    uni.navigateTo({
      url: `/pages/contacts/tag-detail?id=${encodeURIComponent(tag.id)}&name=${encodeURIComponent(tag.name)}`,
    })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    creating.value = false
  }
}

async function onDelete() {
  if (!selectedCount.value || deleting.value) return
  uni.showModal({
    title: '删除标签',
    content: `确定删除选中的 ${selectedCount.value} 个标签吗？`,
    success: async (res) => {
      if (!res.confirm) return
      deleting.value = true
      try {
        const ids = Array.from(selected.value)
        for (const id of ids) {
          await deleteContactTag(id)
        }
        selected.value = new Set()
        editing.value = false
        await load()
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      } finally {
        deleting.value = false
      }
    },
  })
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">
        <image class="nav-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">通讯录标签</text>
      <text class="nav-action" @click="toggleEdit">{{ editing ? '取消' : '编辑' }}</text>
    </view>

    <AppSearchBar v-model="keyword" placeholder="搜索" />

    <scroll-view scroll-y class="body">
      <view
        v-for="tag in filtered"
        :key="tag.id"
        class="row"
        :class="{ compact: !memberPreview(tag) }"
        @click="openTag(tag)"
      >
        <view class="row-main">
          <text class="row-title">{{ tag.name }} ({{ tag.memberCount }})</text>
          <text v-if="memberPreview(tag)" class="row-sub">{{ memberPreview(tag) }}</text>
        </view>
        <view v-if="editing" class="check" :class="{ on: selected.has(tag.id) }" />
      </view>
      <view v-if="!filtered.length && !loading" class="empty">暂无标签</view>
    </scroll-view>

    <view class="footer">
      <view
        v-if="editing"
        class="footer-btn danger"
        :class="{ disabled: !selectedCount || deleting }"
        @click="onDelete"
      >删除{{ selectedCount ? ` (${selectedCount})` : ' (0)' }}</view>
      <view v-else class="footer-btn" @click="openCreate">新增</view>
    </view>

    <view v-if="showCreate" class="mask" @click="closeCreate">
      <view class="dialog" @click.stop>
        <text class="dialog-title">新增标签</text>
        <input
          class="dialog-input"
          v-model="draftName"
          :maxlength="TAG_MAX"
          confirm-type="done"
          @confirm="confirmCreate"
        />
        <view class="dialog-meta">
          <text class="dialog-hint">标签名称最多 {{ TAG_MAX }} 个字</text>
          <text class="dialog-count">{{ draftCount }}/{{ TAG_MAX }}</text>
        </view>
        <view class="dialog-actions">
          <view class="dialog-btn ghost" @click="closeCreate">取消</view>
          <view
            class="dialog-btn solid"
            :class="{ disabled: !canCreate }"
            @click="confirmCreate"
          >确认</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(128rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.nav {
  display: flex;
  align-items: center;
  height: calc(96rpx + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 32rpx 0 32rpx;
  background: #ffffff;
  box-sizing: border-box;
  gap: 16rpx;
}

.nav-back {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-icon {
  width: 48rpx;
  height: 48rpx;
}

.nav-title {
  flex: 1;
  font-size: 48rpx;
  font-weight: 700;
  line-height: 64rpx;
  color: #212121;
}

.nav-action {
  font-size: 28rpx;
  font-weight: 600;
  color: #212121;
  padding: 0 8rpx;
}

.body {
  flex: 1;
  height: 0;
}

.row {
  display: flex;
  align-items: center;
  min-height: 136rpx;
  padding: 16rpx 40rpx;
  box-sizing: border-box;
  gap: 16rpx;
}

.row.compact {
  min-height: 96rpx;
}

.row-main {
  flex: 1;
  min-width: 0;
}

.row-title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 48rpx;
  color: #212121;
}

.row-sub {
  display: block;
  font-size: 28rpx;
  line-height: 48rpx;
  color: #626e8d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid #c5c9d4;
  box-sizing: border-box;
  flex-shrink: 0;
}

.check.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
  box-shadow: inset 0 0 0 8rpx #fff;
}

.empty {
  margin-top: 80rpx;
  text-align: center;
  font-size: 32rpx;
  color: #626e8d;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16rpx 40rpx calc(16rpx + env(safe-area-inset-bottom));
  background: #ffffff;
}

.footer-btn {
  height: 80rpx;
  border-radius: 8rpx;
  background: #0a2fc2;
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.footer-btn.danger {
  background: #ef4343;
}

.footer-btn.disabled {
  opacity: 0.4;
}

.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
}

.dialog {
  width: 640rpx;
  max-width: 100%;
  background: #ffffff;
  border-radius: 32rpx;
  padding: 16rpx 48rpx 32rpx;
  box-sizing: border-box;
}

.dialog-title {
  display: block;
  margin: 32rpx 0;
  font-size: 32rpx;
  font-weight: 700;
  color: #212121;
}

.dialog-input {
  width: 100%;
  height: 96rpx;
  padding: 0 32rpx;
  background: #f3f4f7;
  border-radius: 8rpx;
  border: 2rpx solid #0a2fc2;
  font-size: 32rpx;
  color: #212121;
  box-sizing: border-box;
}

.dialog-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 8rpx 0;
}

.dialog-hint {
  font-size: 24rpx;
  color: #212121;
}

.dialog-count {
  font-size: 28rpx;
  color: #212121;
}

.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
  margin-top: 48rpx;
}

.dialog-btn {
  height: 80rpx;
  min-width: 120rpx;
  padding: 0 32rpx;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
}

.dialog-btn.ghost {
  color: #212121;
}

.dialog-btn.solid {
  color: #ffffff;
  background: #0a2fc2;
}

.dialog-btn.disabled {
  opacity: 0.4;
}
</style>
