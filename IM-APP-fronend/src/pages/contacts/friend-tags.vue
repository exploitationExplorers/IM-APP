<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  createContactTag,
  fetchContact,
  fetchContactTags,
  updateContact,
} from '@/api/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import type { ContactTagItem } from '@/types'

useAuthGuard()

const contactId = ref('')
const allTags = ref<ContactTagItem[]>([])
const selected = ref<Set<string>>(new Set())
const saving = ref(false)
const creating = ref(false)

const selectedCount = computed(() => selected.value.size)

onLoad(async (query) => {
  contactId.value = String(query?.id || '')
  await load()
})

async function load() {
  try {
    const [tags, detail] = await Promise.all([
      fetchContactTags(),
      fetchContact(contactId.value),
    ])
    allTags.value = tags
    selected.value = new Set((detail.tags || []).map((t) => t.id))
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

async function onCreate() {
  if (creating.value) return
  uni.showModal({
    title: '新建标签',
    editable: true,
    placeholderText: '请输入标签名',
    success: async (res) => {
      if (!res.confirm) return
      const name = (res.content || '').trim()
      if (!name) {
        uni.showToast({ title: '标签名不能为空', icon: 'none' })
        return
      }
      creating.value = true
      try {
        const tag = await createContactTag(name)
        allTags.value = [...allTags.value, tag]
        const next = new Set(selected.value)
        next.add(tag.id)
        selected.value = next
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      } finally {
        creating.value = false
      }
    },
  })
}

async function onSubmit() {
  if (!contactId.value || saving.value) return
  saving.value = true
  try {
    await updateContact(contactId.value, { tagIds: Array.from(selected.value) })
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
      <text class="nav-title">设置标签</text>
      <view class="nav-action" @click="onCreate">新建</view>
    </view>

    <view v-if="allTags.length" class="list">
      <view
        v-for="tag in allTags"
        :key="tag.id"
        class="item"
        @click="toggle(tag.id)"
      >
        <view class="check" :class="{ on: selected.has(tag.id) }" />
        <text class="name">{{ tag.name }}</text>
        <text class="count">{{ tag.memberCount }}人</text>
      </view>
    </view>
    <view v-else class="empty">暂无标签，点击右上角新建</view>

    <view class="footer">
      <button class="btn" :disabled="saving" @click="onSubmit">
        确认{{ selectedCount ? `(${selectedCount})` : '' }}
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
}

.nav {
  display: flex;
  align-items: center;
  height: calc(88rpx + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 24rpx 0;
  background: #fff;
  border-bottom: 1rpx solid #e1e3ea;
  box-sizing: border-box;
}

.nav-back {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-icon {
  width: 40rpx;
  height: 40rpx;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 34rpx;
  font-weight: 700;
  color: #212121;
}

.nav-action {
  min-width: 72rpx;
  padding: 0 8rpx;
  text-align: right;
  font-size: 28rpx;
  color: #0a2fc2;
}

.list {
  margin-top: 16rpx;
  background: #fff;
}

.item {
  display: flex;
  align-items: center;
  min-height: 104rpx;
  padding: 0 32rpx;
  border-bottom: 1rpx solid #e1e3ea;
}

.check {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid #c5c9d4;
  margin-right: 20rpx;
  box-sizing: border-box;
}

.check.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
  box-shadow: inset 0 0 0 8rpx #fff;
}

.name {
  flex: 1;
  font-size: 30rpx;
  color: #212121;
}

.count {
  font-size: 26rpx;
  color: #636e86;
}

.empty {
  margin-top: 120rpx;
  text-align: center;
  color: #999;
  font-size: 28rpx;
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
