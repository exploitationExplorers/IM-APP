<script setup lang="ts">
import { computed, getCurrentInstance, ref, shallowRef } from "vue";
import { onShow } from "@dcloudio/uni-app";
import {
  FavoriteListType,
  fetchFavorites,
  deleteFavorite,
} from "@/api/favorites";
import type { FavoriteItem } from "@/api/favorites";
import EmptyState from "@/components/EmptyState.vue";
import ImSuccessToast from "@/components/ImSuccessToast.vue";
import { useChatStore } from "@/stores/chat";
import { useForwardStore } from "@/stores/forward";
import { conversationTitleOf } from "@/utils/favoriteMeta";
import { formatFavoriteDay } from "@/utils/format";
import { safeBack } from "@/utils/nav";

const VOICE_WAVE_HEIGHTS = [3.4, 11, 3.7, 7.4, 12.4, 4.1, 13.9, 19.3];
const PAGE_SIZE = 20;
const MENU_WIDTH_RPX = 176;
const MENU_OFFSET_RPX = 8;
const VIEWPORT_PADDING_RPX = 16;

interface FavoriteGroup {
  key: string;
  title: string;
  dateLabel: string;
  items: FavoriteItem[];
}

const chatStore = useChatStore();
const forwardStore = useForwardStore();
const instance = getCurrentInstance();
const successVisible = ref(false);

const tab = shallowRef<FavoriteListType>(FavoriteListType.All);
const tabs = [
  { type: FavoriteListType.All, label: "全部" },
  { type: FavoriteListType.Text, label: "文字" },
  { type: FavoriteListType.Media, label: "图片与视频" },
  { type: FavoriteListType.File, label: "文件" },
  { type: FavoriteListType.Voice, label: "语音" },
];

const favorites = shallowRef<FavoriteItem[]>([]);
const loading = shallowRef(false);
const noMore = shallowRef(false);
let page = 1;

const activeMenuId = shallowRef<string | null>(null);
const activeMenuItem = shallowRef<FavoriteItem | null>(null);
const menuStyle = shallowRef<Record<string, string>>({});

const groups = computed<FavoriteGroup[]>(() => {
  const map = new Map<string, FavoriteGroup>();
  for (const item of favorites.value) {
    const title =
      chatStore.conversations.find((c) => c.id === item.conversationId)
        ?.title || conversationTitleOf(item.conversationId);
    const dateLabel = formatFavoriteDay(item.createdAt);
    const key = `${item.conversationId}|${dateLabel}`;
    const group = map.get(key);
    if (group) {
      group.items.push(item);
    } else {
      map.set(key, { key, title, dateLabel, items: [item] });
    }
  }
  return [...map.values()];
});

async function loadFavorites(type: FavoriteListType, reset = false) {
  if (loading.value && !reset) return;
  if (reset) {
    page = 1;
    favorites.value = [];
    noMore.value = false;
  }
  const currentPage = page;
  loading.value = true;
  try {
    const items = await fetchFavorites({
      type,
      page: currentPage,
      size: PAGE_SIZE,
    });
    if (tab.value !== type) return;
    favorites.value = reset ? items : [...favorites.value, ...items];
    noMore.value = items.length < PAGE_SIZE;
    page = currentPage + 1;
  } catch (error) {
    if (tab.value !== type) return;
    uni.showToast({
      title: error instanceof Error ? error.message : "收藏加载失败",
      icon: "none",
    });
  } finally {
    if (tab.value === type) loading.value = false;
  }
}

function selectTab(type: FavoriteListType) {
  if (tab.value === type) return;
  tab.value = type;
  closeMenu();
  void loadFavorites(type, true);
}

function loadMore() {
  if (loading.value || noMore.value) return;
  void loadFavorites(tab.value);
}

onShow(() => {
  if (forwardStore.consumeSucceeded()) {
    successVisible.value = true;
  }
  if (!chatStore.conversations.length) {
    void chatStore.loadConversations().catch(() => undefined);
  }
  void loadFavorites(tab.value, true);
});

function goBack() {
  safeBack("/pages/mine/index");
}

function closeMenu() {
  activeMenuId.value = null;
  activeMenuItem.value = null;
  menuStyle.value = {};
}

function toDesignUnit(value: number) {
  const { windowWidth } = uni.getSystemInfoSync();
  return (value * 750) / windowWidth;
}

function eventPoint(event: unknown) {
  const raw = event as {
    changedTouches?: Array<{ clientX: number; clientY: number }>;
    touches?: Array<{ clientX: number; clientY: number }>;
    detail?: { x?: number; y?: number } | number;
    clientX?: number;
    clientY?: number;
  };
  const touch = raw.changedTouches?.[0] || raw.touches?.[0];
  const detail =
    typeof raw.detail === "object" && raw.detail ? raw.detail : undefined;
  return {
    x: touch?.clientX ?? detail?.x ?? raw.clientX ?? 0,
    y: touch?.clientY ?? detail?.y ?? raw.clientY ?? 0,
  };
}

function updateMenuPosition(item: FavoriteItem, event: unknown) {
  const { windowWidth, windowHeight } = uni.getSystemInfoSync();
  const viewportWidthRpx = toDesignUnit(windowWidth);
  const viewportHeightRpx = toDesignUnit(windowHeight);
  const point = eventPoint(event);
  const clickXRpx = toDesignUnit(point.x);
  const rightSpaceRpx = viewportWidthRpx - clickXRpx - VIEWPORT_PADDING_RPX;
  const leftRpx =
    rightSpaceRpx >= MENU_WIDTH_RPX
      ? clickXRpx + MENU_OFFSET_RPX
      : Math.max(
          clickXRpx - MENU_WIDTH_RPX - MENU_OFFSET_RPX,
          VIEWPORT_PADDING_RPX,
        );
  const query = uni.createSelectorQuery();
  if (instance?.proxy) query.in(instance.proxy);
  query
    .select(`#favorite-more-${item.id}`)
    .boundingClientRect((rect) => {
      const box = rect as { bottom?: number } | null;
      const topRpx = box?.bottom
        ? toDesignUnit(box.bottom) + MENU_OFFSET_RPX
        : toDesignUnit(point.y) + MENU_OFFSET_RPX;
      menuStyle.value = {
        top: `${topRpx}rpx`,
        left: `${leftRpx}rpx`,
        maxHeight: `${Math.max(viewportHeightRpx - topRpx - VIEWPORT_PADDING_RPX, 0)}rpx`,
      };
    })
    .exec();
}

function handleMore(item: FavoriteItem, event: unknown) {
  if (activeMenuId.value === item.id) {
    closeMenu();
    return;
  }
  activeMenuId.value = item.id;
  activeMenuItem.value = item;
  menuStyle.value = {};
  updateMenuPosition(item, event);
}

async function handleDeleteFavorite(item: FavoriteItem) {
  try {
    await deleteFavorite(item.id);
    favorites.value = favorites.value.filter(
      (favorite) => favorite.id !== item.id,
    );
    uni.showToast({ title: "已删除", icon: "none" });
  } catch (error) {
    uni.showToast({
      title: error instanceof Error ? error.message : "删除失败",
      icon: "none",
    });
  }
}

function handleAction(type: "forward" | "copy" | "delete", item: FavoriteItem) {
  closeMenu();
  if (type === "delete") {
    uni.showModal({
      title: "提示",
      content: "确定删除该收藏吗？",
      confirmColor: "#ff4d4f",
      success: (res) => {
        if (res.confirm) void handleDeleteFavorite(item);
      },
    });
    return;
  }
  if (type === "copy") {
    uni.setClipboardData({
      data: item.content,
      success: () => uni.showToast({ title: "已复制", icon: "none" }),
    });
    return;
  }
  if (chatStore.getRawMessage(item.messageId)) {
    forwardStore.start(item.conversationId, [item.messageId]);
    uni.navigateTo({ url: "/pages/chat/forward" });
    return;
  }
  uni.showToast({ title: "请回到聊天后转发", icon: "none" });
}

function voiceDuration(item: FavoriteItem) {
  try {
    const parsed = JSON.parse(item.content) as { duration?: number };
    const total = Math.max(0, Math.ceil(Number(parsed.duration || 0)));
    const min = String(Math.floor(total / 60)).padStart(2, "0");
    const sec = String(total % 60).padStart(2, "0");
    return `${min}:${sec}`;
  } catch {
    return "00:00";
  }
}

function voicePath(item: FavoriteItem) {
  try {
    const parsed = JSON.parse(item.content) as { path?: string };
    return parsed.path || "";
  } catch {
    return "";
  }
}

function displayText(item: FavoriteItem) {
  if (item.type !== "voice") return item.content;
  return "[语音]";
}
</script>

<template>
  <view class="page">
    <view class="navbar">
      <view class="back" @click="goBack">‹</view>
      <text class="title">我的收藏</text>
      <view class="space" />
    </view>

    <view class="tabs">
      <view
        v-for="item in tabs"
        :key="item.type"
        class="tab"
        :class="{ active: tab === item.type }"
        @click="selectTab(item.type)"
      >
        {{ item.label }}
      </view>
    </view>

    <EmptyState v-if="!loading && favorites.length === 0" text="无收藏" />

    <scroll-view
      v-else
      class="list"
      scroll-y
      :show-scrollbar="false"
      @scrolltolower="loadMore"
    >
      <view v-for="group in groups" :key="group.key" class="group">
        <view class="group-head">
          <text class="group-title">{{ group.title }}</text>
          <text class="group-date">{{ group.dateLabel }}</text>
        </view>
        <view v-for="item in group.items" :key="item.id" class="card">
          <view
            :id="`favorite-more-${item.id}`"
            class="more"
            @click.stop="handleMore(item, $event)"
          >
            ⋮
          </view>
          <text
            v-if="item.type === 'text' || item.type === 'emoji'"
            class="card-text"
          >
            {{ displayText(item) }}
          </text>
          <image
            v-else-if="item.type === 'image' || item.type === 'video'"
            class="card-image"
            :src="item.content"
            mode="widthFix"
          />
          <view v-else-if="item.type === 'voice'" class="voice">
            <text class="voice-label">语音 {{ voiceDuration(item) }}</text>
            <text v-if="!voicePath(item)" class="voice-empty">无法播放</text>
          </view>
          <text v-else class="card-text">{{ item.content }}</text>
        </view>
      </view>
    </scroll-view>

    <view
      v-if="activeMenuItem && menuStyle.top"
      class="menu-mask"
      @click="closeMenu"
    >
      <view class="menu" :style="menuStyle" @click.stop>
        <view class="menu-item" @click="handleAction('forward', activeMenuItem)"
          >转发</view
        >
        <view
          v-if="
            activeMenuItem.type === 'text' || activeMenuItem.type === 'emoji'
          "
          class="menu-item"
          @click="handleAction('copy', activeMenuItem)"
        >
          复制
        </view>
        <view class="menu-item" @click="handleAction('delete', activeMenuItem)"
          >删除</view
        >
      </view>
    </view>
    <ImSuccessToast
      :visible="successVisible"
      text="转发成功"
      placement="top"
      @close="successVisible = false"
    />
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

.navbar {
  height: 96rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
}

.back,
.space {
  width: 72rpx;
  font-size: 52rpx;
  color: #111;
  line-height: 1;
}

.title {
  flex: 1;
  text-align: center;
  font-size: 36rpx;
  font-weight: 700;
  color: #111;
}

.tabs {
  display: flex;
  align-items: stretch;
  padding: 0 8rpx;
  border-bottom: 2rpx solid #f2f2f2;
}

.tab {
  flex: 1;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #212121;
  border-bottom: 6rpx solid transparent;
}

.tab.active {
  color: #0a2fc2;
  font-weight: 700;
  border-bottom-color: #0a2fc2;
}

.list {
  flex: 1;
  height: 0;
}

.group {
  padding: 8rpx 32rpx 24rpx;
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: 24rpx;
  padding: 20rpx 0 16rpx;
}

.group-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #222;
}

.group-date {
  font-size: 26rpx;
  color: #888;
}

.card {
  position: relative;
  min-height: 120rpx;
  padding: 28rpx 56rpx 28rpx 28rpx;
  border-radius: 16rpx;
  background: #f3f4f7;
}

.more {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  color: #888;
}

.card-text {
  font-size: 30rpx;
  line-height: 1.5;
  color: #222;
  word-break: break-all;
}

.card-image {
  width: 100%;
  border-radius: 8rpx;
  display: block;
}

.voice {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.voice-label,
.voice-empty {
  font-size: 28rpx;
  color: #555;
}

.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
}

.menu {
  position: fixed;
  z-index: 81;
  min-width: 176rpx;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: 0 12rpx 32rpx rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.menu-item {
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #222;
}
</style>
