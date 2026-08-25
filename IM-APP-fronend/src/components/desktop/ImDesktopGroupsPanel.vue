<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchGroups } from '@/api/contact'
import { APP_CONFIG } from '@/config'
import type { GroupPreview } from '@/types'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [group: GroupPreview]
}>()

const tab = ref<'created' | 'joined'>('created')
const panelGroups = ref<GroupPreview[]>([])
const loading = ref(false)

const visibleGroups = computed(() => panelGroups.value.filter((g) => g.status !== 'dismissed'))

function close() {
  emit('update:modelValue', false)
}

async function loadPanelGroups() {
  loading.value = true
  try {
    panelGroups.value = await fetchGroups(tab.value === 'created' ? 'owner' : 'member')
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '群列表加载失败', icon: 'none' })
    panelGroups.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    tab.value = 'created'
    void loadPanelGroups()
  },
)

watch(tab, () => {
  if (props.modelValue) void loadPanelGroups()
})

function onSelect(g: GroupPreview) {
  emit('select', g)
  close()
}

function roleTagOf(g: GroupPreview) {
  const role = (g.role || '').toLowerCase()
  if (role === 'owner') return '群主'
  if (role === 'admin') return '管理员'
  return ''
}

function roleTagClass(g: GroupPreview) {
  const role = (g.role || '').toLowerCase()
  return role === 'owner' ? 'role-owner' : 'role-admin'
}

function goCreate() {
  close()
  uni.navigateTo({ url: '/pages/group/create' })
}
</script>

<template>
  <view v-if="modelValue" class="groups-panel-layer">
    <view class="groups-panel-backdrop" @click="close" />

    <view class="groups-panel" @click.stop>
      <view class="groups-panel-header">
        <text class="groups-panel-title">群聊天</text>
        <view class="groups-panel-add" @click="goCreate">
          <image class="groups-panel-add-icon" src="/static/icons/icon-plus.svg" mode="aspectFit" />
        </view>
      </view>

      <view class="groups-panel-tabs">
        <view
          class="groups-panel-tab"
          :class="{ active: tab === 'created' }"
          @click="tab = 'created'"
        >
          我建立的
        </view>
        <view
          class="groups-panel-tab"
          :class="{ active: tab === 'joined' }"
          @click="tab = 'joined'"
        >
          我加入的
        </view>
      </view>

      <scroll-view scroll-y class="groups-panel-body">
        <view v-if="loading" class="groups-panel-status">加载中…</view>
        <template v-else>
          <view
            v-for="g in visibleGroups"
            :key="g.id"
            class="groups-panel-row"
            @click="onSelect(g)"
          >
            <image
              class="groups-panel-avatar"
              :src="g.avatar || APP_CONFIG.defaultGroupAvatarUrl"
              mode="aspectFill"
            />
            <text class="groups-panel-name">{{ g.name }}</text>
            <text
              v-if="roleTagOf(g)"
              class="groups-panel-role"
              :class="roleTagClass(g)"
            >{{ roleTagOf(g) }}</text>
            <image class="groups-panel-arrow" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
          </view>
          <view v-if="!visibleGroups.length" class="groups-panel-status">无群组</view>
        </template>
      </scroll-view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.groups-panel-layer {
  position: absolute;
  inset: 0;
  z-index: 60;
}

.groups-panel-backdrop {
  position: fixed;
  inset: 0;
}

.groups-panel {
  position: absolute;
  top: 24px;
  left: 16px;
  width: 320px;
  max-height: calc(100% - 48px);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16), 0 4px 12px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.groups-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 16px;
  flex-shrink: 0;
}

.groups-panel-title {
  font-size: 16px;
  font-weight: 700;
  color: #212121;
  line-height: 24px;
}

.groups-panel-add {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.groups-panel-add-icon {
  width: 20px;
  height: 20px;
}

.groups-panel-tabs {
  display: flex;
  border-bottom: 1px solid #ececec;
  flex-shrink: 0;
}

.groups-panel-tab {
  flex: 1;
  text-align: center;
  padding: 12px 0;
  font-size: 14px;
  color: #636e86;
  cursor: pointer;
  position: relative;
}

.groups-panel-tab.active {
  color: #212121;
  font-weight: 600;
}

.groups-panel-tab.active::after {
  content: '';
  position: absolute;
  left: 20%;
  right: 20%;
  bottom: 0;
  height: 2px;
  background: #0a2fc2;
  border-radius: 2px;
}

.groups-panel-body {
  flex: 1;
  min-height: 0;
  max-height: 420px;
}

.groups-panel-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 16px;
  box-sizing: border-box;
  cursor: pointer;
}

.groups-panel-row:active {
  background: #f5f6f8;
}

.groups-panel-avatar {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #f3f4f7;
  flex-shrink: 0;
}

.groups-panel-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 20px;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.groups-panel-role {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.4;
  border-radius: 4px;
  padding: 1px 6px;
}

.groups-panel-role.role-owner {
  color: #636e86;
  border: 1px solid #c5cad6;
}

.groups-panel-role.role-admin {
  color: #0a2fc2;
  border: 1px solid #0a2fc2;
}

.groups-panel-arrow {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.45;
}

.groups-panel-status {
  padding: 48px 16px;
  text-align: center;
  font-size: 14px;
  color: #8a8f9c;
}
</style>
