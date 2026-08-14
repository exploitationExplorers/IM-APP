<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { storeToRefs } from 'pinia'
import AppSearchBar from '@/components/AppSearchBar.vue'
import { fetchTagMembers, setTagMembers } from '@/api/contact'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG } from '@/config'
import type { Contact } from '@/types'

useAuthGuard()

const contactStore = useContactStore()
const { contacts } = storeToRefs(contactStore)

const tagId = ref('')
const keyword = ref('')
const existingIds = ref<Set<string>>(new Set())
const selected = ref<Set<string>>(new Set())
const saving = ref(false)

const candidates = computed(() =>
  contacts.value.filter((c) => !existingIds.value.has(c.id)),
)

const filtered = computed(() => {
  const k = keyword.value.trim()
  let list = candidates.value
  if (k) {
    list = list.filter((c) => displayName(c).includes(k) || (c.publicId || '').includes(k))
  }
  return list
})

const selectedList = computed(() =>
  candidates.value.filter((c) => selected.value.has(c.id)),
)

const selectedCount = computed(() => selected.value.size)
const allFilteredSelected = computed(
  () => filtered.value.length > 0 && filtered.value.every((c) => selected.value.has(c.id)),
)

function displayName(c: Contact) {
  return c.remark?.trim() || c.nickname
}

onLoad(async (query) => {
  tagId.value = String(query?.id || '')
  try {
    const [members] = await Promise.all([
      fetchTagMembers(tagId.value),
      contacts.value.length ? Promise.resolve() : contactStore.loadDirectory(),
    ])
    existingIds.value = new Set(members.map((m) => m.id))
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function unselect(id: string) {
  const next = new Set(selected.value)
  next.delete(id)
  selected.value = next
}

function toggleAll() {
  const next = new Set(selected.value)
  if (allFilteredSelected.value) {
    filtered.value.forEach((c) => next.delete(c.id))
  } else {
    filtered.value.forEach((c) => next.add(c.id))
  }
  selected.value = next
}

async function onSubmit() {
  if (!tagId.value || saving.value || !selectedCount.value) return
  saving.value = true
  try {
    const userIds = [...existingIds.value, ...selected.value]
    await setTagMembers(tagId.value, userIds)
    uni.navigateBack()
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
      <text class="nav-title">选择联络人</text>
      <text
        class="nav-action"
        :class="{ disabled: !selectedCount || saving }"
        @click="onSubmit"
      >{{ selectedCount ? `新增(${selectedCount})` : '新增' }}</text>
    </view>

    <scroll-view v-if="selectedList.length" scroll-x class="picked">
      <view
        v-for="c in selectedList"
        :key="`picked-${c.id}`"
        class="picked-item"
        @click="unselect(c.id)"
      >
        <image
          class="picked-avatar"
          :src="c.avatar || APP_CONFIG.defaultAvatarUrl"
          mode="aspectFill"
        />
        <text class="picked-name">{{ displayName(c) }}</text>
        <text class="picked-x">×</text>
      </view>
    </scroll-view>

    <AppSearchBar v-model="keyword" placeholder="搜索" />

    <view class="section-head">
      <text class="section-count">联络人 ({{ candidates.length }})</text>
    </view>
    <view class="select-all" @click="toggleAll">
      <text class="select-all-text">全选 ({{ selectedCount }}/{{ filtered.length }})</text>
      <view class="check" :class="{ on: allFilteredSelected }" />
    </view>

    <scroll-view scroll-y class="body">
      <view
        v-for="c in filtered"
        :key="c.id"
        class="row"
        @click="toggle(c.id)"
      >
        <image
          class="avatar"
          :src="c.avatar || APP_CONFIG.defaultAvatarUrl"
          mode="aspectFill"
        />
        <text class="name">{{ displayName(c) }}</text>
        <view class="check" :class="{ on: selected.has(c.id) }" />
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #ffffff;
  display: flex;
  flex-direction: column;
}

.nav {
  display: flex;
  align-items: center;
  height: calc(96rpx + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 32rpx 0;
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
  color: #0a2fc2;
  flex-shrink: 0;
}

.nav-action.disabled {
  color: #c5c9d4;
}

.picked {
  white-space: nowrap;
  padding: 8rpx 40rpx 0;
  width: 100%;
  box-sizing: border-box;
}

.picked-item {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  margin-right: 16rpx;
  padding: 8rpx 16rpx 8rpx 8rpx;
  background: #f3f4f7;
  border-radius: 32rpx;
}

.picked-avatar {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #ddd;
}

.picked-name {
  max-width: 160rpx;
  font-size: 24rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picked-x {
  font-size: 28rpx;
  color: #626e8d;
}

.section-head {
  display: flex;
  align-items: center;
  height: 48rpx;
  margin: 8rpx 40rpx;
}

.section-count {
  font-size: 28rpx;
  font-weight: 700;
  color: #212121;
}

.select-all {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
  padding: 8rpx 40rpx 16rpx;
}

.select-all-text {
  font-size: 28rpx;
  color: #212121;
}

.body {
  flex: 1;
  height: 0;
}

.row {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 40rpx;
  gap: 32rpx;
  box-sizing: border-box;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.name {
  flex: 1;
  font-size: 34rpx;
  color: #212121;
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
</style>
