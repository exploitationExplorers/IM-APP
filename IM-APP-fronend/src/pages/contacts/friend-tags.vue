<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  createContactTag,
  fetchContact,
  fetchContactTags,
  updateContact,
} from '@/api/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import type { ContactTagItem } from '@/types'

useAuthGuard()

const TAG_MAX = 12
const contactId = ref('')
const allTags = ref<ContactTagItem[]>([])
const selected = ref<Set<string>>(new Set())
const initialIds = ref<Set<string>>(new Set())
const saving = ref(false)
const creating = ref(false)
const showCreate = ref(false)
const draftName = ref('')

const assignedTags = computed(() =>
  allTags.value.filter((t) => selected.value.has(t.id)),
)

const isDirty = computed(() => {
  if (selected.value.size !== initialIds.value.size) return true
  for (const id of selected.value) {
    if (!initialIds.value.has(id)) return true
  }
  return false
})

const draftCount = computed(() => draftName.value.length)
const canCreate = computed(
  () => !!draftName.value.trim() && !creating.value,
)

onLoad((query) => {
  contactId.value = String(query?.id || '')
})

onShow(() => {
  if (contactId.value) load()
})

async function load() {
  try {
    const [tags, detail] = await Promise.all([
      fetchContactTags(),
      fetchContact(contactId.value),
    ])
    allTags.value = tags
    const ids = new Set((detail.tags || []).map((t) => t.id))
    selected.value = new Set(ids)
    initialIds.value = ids
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function goBack() {
  uni.navigateBack()
}

function goEditTags() {
  uni.navigateTo({ url: '/pages/contacts/tags' })
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

async function onSubmit() {
  if (!contactId.value || saving.value || !isDirty.value) return
  saving.value = true
  try {
    await updateContact(contactId.value, { tagIds: Array.from(selected.value) })
    initialIds.value = new Set(selected.value)
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
    <view class="nav">
      <view class="nav-back" @click="goBack">
        <image class="nav-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">新增标签</text>
    </view>

    <view class="section">
      <view class="section-head">
        <text class="section-title">已有标签</text>
        <text
          class="section-action"
          :class="isDirty && !saving ? 'primary' : 'muted'"
          @click="onSubmit"
        >{{ saving ? '保存中' : '确认' }}</text>
      </view>
      <view class="chip-row">
        <view
          v-for="tag in assignedTags"
          :key="`assigned-${tag.id}`"
          class="chip chip-on"
          @click="toggle(tag.id)"
        >
          <text class="mark">×</text>
          <text class="chip-text">{{ tag.name }}</text>
        </view>
        <text v-if="!assignedTags.length" class="empty">暂无标签</text>
      </view>
    </view>

    <view class="section">
      <view class="section-head">
        <text class="section-title">全部标签</text>
        <view class="edit" @click="goEditTags">
          <text class="section-action">编辑</text>
          <image class="edit-arrow" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
        </view>
      </view>
      <view class="chip-row">
        <view
          v-for="tag in allTags"
          :key="tag.id"
          class="chip"
          :class="selected.has(tag.id) ? 'chip-on' : 'chip-off'"
          @click="toggle(tag.id)"
        >
          <text v-if="selected.has(tag.id)" class="mark">×</text>
          <text v-else class="mark">+</text>
          <text class="chip-text">{{ tag.name }}</text>
        </view>
        <view class="chip chip-add" @click="openCreate">
          <text class="mark">+</text>
          <text class="chip-text">新增</text>
        </view>
      </view>
    </view>

    <view v-if="showCreate" class="mask" @click="closeCreate">
      <view class="dialog" @click.stop>
        <text class="dialog-title">新增标签</text>
        <input
          class="dialog-input"
          v-model="draftName"
          :maxlength="TAG_MAX"
          placeholder=""
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
}

.nav {
  display: flex;
  align-items: center;
  height: calc(96rpx + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 32rpx 0;
  background: #ffffff;
  box-sizing: border-box;
  gap: 32rpx;
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

.section {
  padding: 0 40rpx;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 80rpx;
  padding: 16rpx 0;
}

.section-title {
  font-size: 28rpx;
  font-weight: 700;
  line-height: 48rpx;
  color: #212121;
}

.section-action {
  font-size: 28rpx;
  font-weight: 600;
  color: #626e8d;
}

.section-action.primary {
  color: #0a2fc2;
}

.section-action.muted {
  color: #848ea9;
}

.edit {
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.edit-arrow {
  width: 32rpx;
  height: 32rpx;
  opacity: 0.45;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  padding: 16rpx 0;
}

.chip {
  height: 64rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  box-sizing: border-box;
}

.chip-off {
  background: transparent;
  border: 2rpx solid #626e8d;
}

.chip-add {
  background: transparent;
  border: 2rpx solid #0a2fc2;
}

.chip-on {
  background: #e1e3ea;
  border: 2rpx solid #e1e3ea;
}

.chip-text {
  font-size: 28rpx;
  font-weight: 400;
  line-height: 48rpx;
}

.chip-off .chip-text,
.chip-off .mark,
.chip-on .chip-text,
.chip-on .mark {
  color: #626e8d;
}

.chip-add .chip-text,
.chip-add .mark {
  color: #0a2fc2;
}

.mark {
  font-size: 28rpx;
  line-height: 1;
}

.empty {
  font-size: 32rpx;
  line-height: 48rpx;
  color: #626e8d;
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
  font-weight: 400;
}

.dialog-btn.ghost {
  color: #212121;
  background: transparent;
}

.dialog-btn.solid {
  color: #ffffff;
  background: #0a2fc2;
}

.dialog-btn.disabled {
  opacity: 0.4;
}
</style>
