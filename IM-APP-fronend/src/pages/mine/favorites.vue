<script setup lang="ts">
import { getCurrentInstance, shallowRef } from "vue";
import { onShow } from "@dcloudio/uni-app";
import {
  FavoriteListType,
  fetchFavorites,
  deleteFavorite,
} from "@/api/favorites";
import type { FavoriteItem } from "@/api/favorites";
import EmptyState from "@/components/EmptyState.vue";

const VOICE_WAVE_HEIGHTS = [3.4, 11, 3.7, 7.4, 12.4, 4.1, 13.9, 19.3];
const PAGE_SIZE = 20;

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
const instance = getCurrentInstance();

const MENU_WIDTH_RPX = 176;
const MENU_OFFSET_RPX = 8;
const VIEWPORT_PADDING_RPX = 16;

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
  void loadFavorites(tab.value, true);
});

const toDesignUnit = (value: number) => {
  const { windowWidth } = uni.getSystemInfoSync();
  return (value * 750) / windowWidth;
};

// 用于兼容模板中可能存在的状态栏布局分支
const statusBarHeight = uni.getSystemInfoSync()?.statusBarHeight || 0;
const goBack = () => {
  uni.navigateBack();
};

const closeMenu = () => {
  activeMenuId.value = null;
  activeMenuItem.value = null;
  menuStyle.value = {};
};

const getEventPoint = (event: any) => {
  const touch = event?.changedTouches?.[0] || event?.touches?.[0];

  return {
    x: touch?.clientX ?? event?.detail?.x ?? event?.clientX ?? 0,
    y: touch?.clientY ?? event?.detail?.y ?? event?.clientY ?? 0,
  };
};

const updateMenuPosition = (item: FavoriteItem, event: any) => {
  const { windowWidth, windowHeight } = uni.getSystemInfoSync();
  const viewportWidthRpx = toDesignUnit(windowWidth);
  const viewportHeightRpx = toDesignUnit(windowHeight);
  const point = getEventPoint(event);
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

  if (instance?.proxy) {
    query.in(instance.proxy);
  }

  query
    .select(`#favorite-more-${item.id}`)
    .boundingClientRect((rect: any) => {
      const topRpx = rect
        ? toDesignUnit(rect.bottom) + MENU_OFFSET_RPX
        : toDesignUnit(point.y) + MENU_OFFSET_RPX;
      const maxHeightRpx = Math.max(
        viewportHeightRpx - topRpx - VIEWPORT_PADDING_RPX,
        0,
      );

      menuStyle.value = {
        top: `${topRpx + 60}rpx`,
        left: `${leftRpx}rpx`,
        maxHeight: `${maxHeightRpx}rpx`,
      };
    })
    .exec();
};

const handleClick = (item: FavoriteItem) => {
  closeMenu();
  console.log("点击：", item);

  // 如果需要跳转
  // uni.navigateTo({
  //   url: `/pages/collections/detail?id=${item.id}`
  // })
};

const handleMore = (item: FavoriteItem, event: any) => {
  if (activeMenuId.value === item.id) {
    closeMenu();
    return;
  }

  activeMenuId.value = item.id;
  activeMenuItem.value = item;
  menuStyle.value = {};
  updateMenuPosition(item, event);
  console.log("更多操作：", item);
};

async function handleDeleteFavorite(item: FavoriteItem) {
  try {
    await deleteFavorite(item.id);
    favorites.value = favorites.value.filter(
      (favorite) => favorite.id !== item.id,
    );
    uni.showToast({ title: "删除成功", icon: "none" });
  } catch (error) {
    uni.showToast({
      title: error instanceof Error ? error.message : "删除失败",
      icon: "none",
    });
  }
}

const handleAction = (
  type: "forward" | "copy" | "delete",
  item: FavoriteItem,
) => {
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

  console.log("菜单操作：", type, item);
};
</script>

<template>
  <view class="page">
    <view class="navbar">
      <!-- 返回按钮 -->
      <button class="back-btn" @click="goBack">
        <view class="icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-miterlimit="10"
              stroke-width="1.5"
              d="M15 19.92L8.48 13.4c-.77-.77-.77-2.03 0-2.8L15 4.08"
            />
          </svg>
        </view>
      </button>
      <!-- 标题 -->
      <view class="title-wrapper">
        <text class="title">我的收藏</text>
      </view>
      <!-- 占位，保证标题居中 -->
      <view class="placeholder"></view>
    </view>

    <view class="tab-list">
      <view
        v-for="item in tabs"
        :key="item.type"
        class="tab-item"
        :class="{ active: tab === item.type }"
        @click="selectTab(item.type)"
      >
        {{ item.label }}
      </view>
    </view>
    <EmptyState v-if="!loading && favorites.length === 0" text="无收藏" />

    <!-- 内容滚动区域 -->
    <scroll-view v-else class="content-scroll" scroll-y :show-scrollbar="false">
      <view class="content">
        <!-- 分组 -->
        <view class="collection-section">
          <!-- 标题 -->
          <view v-if="favorites.length" class="collection-header">
            <text class="collection-title">我的收藏</text>
          </view>
          <!-- 横向滚动 -->
          <scroll-view
            class="card-scroll"
            scroll-x
            :show-scrollbar="false"
            @scrolltolower="loadMore"
          >
            <view class="card-list">
              <!-- 文字卡片 -->
              <view
                v-for="item in favorites"
                :key="item.id"
                class="card"
                @click="handleClick(item)"
              >
                <!-- 右上角更多 -->
                <view
                  :id="`favorite-more-${item.id}`"
                  class="more-btn"
                  @click.stop="handleMore(item, $event)"
                >
                  <text class="more-dot">⋮</text>
                </view>

                <!-- 文字 -->
                <template v-if="item.type === 'text' || item.type === 'emoji'">
                  <view class="text-card">
                    <text class="text-content">
                      {{ item.content }}
                    </text>
                  </view>
                </template>

                <!-- 文件 -->
                <template v-else-if="item.type === 'file'">
                  <view class="file-card">
                    <view class="file-icon">
                      <view class="file-icon-page">
                        <view class="file-icon-corner" />
                      </view>
                    </view>

                    <view class="file-content">
                      <text class="file-name">
                        {{ item.content }}
                      </text>
                    </view>
                  </view>
                </template>

                <!-- 语音 -->
                <template v-else-if="item.type === 'voice'">
                  <view class="voice-card">
                    <!-- 麦克风图标 -->
                    <view class="voice-icon"> 🎙 </view>

                    <!-- 语音播放器 -->
                    <view class="voice-player">
                      <!-- 波形 -->
                      <view class="wave">
                        <view
                          v-for="(height, i) in VOICE_WAVE_HEIGHTS"
                          :key="i"
                          class="wave-line"
                          :style="{ height: height * 2 + 'rpx' }"
                        />
                      </view>

                      <!-- 时长 -->
                      <text class="voice-time"> 0:00 </text>
                    </view>
                  </view>
                </template>

                <!-- 图片与视频 -->
                <template
                  v-else-if="item.type === 'image' || item.type === 'video'"
                >
                  <view class="image-card">
                    <image
                      class="image"
                      :src="item.content"
                      mode="aspectFill"
                    />

                    <!-- 媒体类型图标 -->
                    <view class="image-icon">
                      <text>{{ item.type === "video" ? "▶" : "▧" }}</text>
                    </view>
                  </view>
                </template>
              </view>
            </view>
          </scroll-view>
        </view>
      </view>
    </scroll-view>

    <view
      v-if="activeMenuItem && menuStyle.top"
      class="menu-mask"
      @click="closeMenu"
    >
      <view class="context-menu" :style="menuStyle" @click.stop>
        <button
          class="menu-item"
          @click.stop="handleAction('forward', activeMenuItem)"
        >
          转发
        </button>

        <button
          v-if="
            activeMenuItem.type === 'text' || activeMenuItem.type === 'emoji'
          "
          class="menu-item"
          @click.stop="handleAction('copy', activeMenuItem)"
        >
          复制
        </button>

        <button
          class="menu-item"
          @click.stop="handleAction('delete', activeMenuItem)"
        >
          删除
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.tab-list {
  height: 68rpx;
  display: flex;
  justify-content: space-evenly;
  align-items: stretch;
  border-bottom: 2rpx solid #f2f2f2;
  margin: 28rpx 0;
}

.tab-item {
  height: 68rpx;
  box-sizing: border-box;
  border-bottom: 4rpx solid transparent;

  display: flex;
  flex-direction: column;
}

.nav-bar-wrap {
  background: #ffffff;
}

.nav-bar {
  height: 96rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  box-sizing: border-box;
}

.nav-left,
.nav-right {
  width: 160rpx;
  display: flex;
  align-items: center;
}

.nav-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.back-icon {
  font-size: 52rpx;
  color: #111;
  line-height: 1;
  padding: 8rpx 12rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 700;
  color: #111;
}

.tabs {
  white-space: nowrap;
  padding: 8rpx 20rpx 0;
  border-bottom: 2rpx solid #f2f2f2;
  background: #fff;
}

/* 横向滚动容器里的 tab 必须是 inline，否则会被挤成一列 */
.tab-item {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  height: 68rpx;
  box-sizing: border-box;
  padding: 0 24rpx;
  margin-right: 8rpx;
  border-bottom: 4rpx solid transparent;
  color: $uni-text-color;
  font-size: 30rpx;
  line-height: 60rpx;
  transition: all 0.2s;
}

.tab-item.active {
  border-bottom-color: $uni-color-primary;
  color: $uni-color-primary;
  font-weight: bold;
}
/* =========================
   外层纵向滚动
========================= */

.content-scroll {
  width: 100%;
  height: 100%;
  flex: 1;
  box-sizing: border-box;
}

.content {
  width: 100%;
}

/* =========================
   分组
========================= */

.collection-section {
  margin-left: 38rpx;
  margin-right: 38rpx;
}

/* =========================
   标题
========================= */

.collection-header {
  display: flex;
  align-items: center;
}

.collection-title {
  padding-top: 16rpx;
  padding-bottom: 16rpx;
  font-size: 28rpx;
  line-height: 48rpx;
  color: #333;
}

.collection-date {
  margin-left: 32rpx;
  padding-top: 16rpx;
  padding-bottom: 16rpx;
  font-size: 28rpx;
  line-height: 48rpx;
  color: #666;
  white-space: nowrap;
}

/* =========================
   横向滚动
========================= */

.card-scroll {
  width: 100%;
  white-space: nowrap;
}

.card-list {
  display: flex;
  gap: 30rpx;
  padding-bottom: 8rpx;
}

/* =========================
   卡片
========================= */

.card {
  position: relative;
  flex-shrink: 0;
  width: 262rpx;
  height: 262rpx;
  border-radius: 8rpx;
  background: #f3f4f7;
  overflow: hidden;
}

/* =========================
   右上角更多按钮
========================= */

.more-btn {
  position: absolute;
  z-index: 20;
  right: 0;
  top: 0;
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.more-dot {
  color: #666;
  font-size: 48rpx;
  font-weight: bold;
  line-height: 48rpx;
}

.menu-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 999;
}

.context-menu {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  // width: 156rpx;
  box-sizing: border-box;
  padding: 16rpx;
  overflow-y: auto;
  background: #fff;
  border-radius: 16rpx;
  box-shadow:
    0 20rpx 30rpx -6rpx rgba(0, 0, 0, 0.1),
    0 8rpx 12rpx -8rpx rgba(0, 0, 0, 0.1);
}

.menu-item {
  width: 100%;
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 30rpx;
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: $uni-text-color;
  font-size: 26rpx;
  line-height: 80rpx;
}

.menu-item::after {
  border: none;
}

.menu-item:active {
  background: #f5f5f5;
}

/* =========================
   文字卡片
========================= */

.text-card {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 64rpx 16rpx 16rpx;
  border: 2rpx solid #eeeeee;
  border-radius: 8rpx;
  overflow: hidden;
}

.text-content {
  display: -webkit-box;
  width: 100%;
  font-size: 26rpx;
  line-height: 48rpx;
  color: #333;
  word-break: break-all;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

/* =========================
   语音卡片
========================= */

.voice-card {
  position: relative;

  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 麦克风 */

.voice-icon {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
}

/* 播放器 */

.voice-player {
  width: 100%;
  max-width: 400rpx;
  box-sizing: border-box;
  padding: 24rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-radius: 32rpx;
  border: 2rpx solid #eeeeee;
}

/* 波形 */

.wave {
  display: inline-flex;
  align-items: center;
  gap: 4rpx;
  height: 40rpx;
}
.wave-line {
  width: 4rpx;
  flex-shrink: 0;
  border-radius: 1998rpx;
  background: #888;
}
/* 时长 */

.voice-time {
  margin-left: 16rpx;
  font-size: 24rpx;
  font-weight: 500;
  color: #333;
  white-space: nowrap;
}
/* =========================
   图片卡片
========================= */
.image-card {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 8rpx;
}

.image {
  width: 100%;
  height: 100%;
  display: block;
}
/* 图片类型图标 */
.image-icon {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 34rpx;
}

/* =========================
   文件卡片
========================= */

.file-card {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  border: 2rpx solid #eeeeee;
  border-radius: 8rpx;
}

.file-icon {
  position: absolute;
  left: 8rpx;
  top: 8rpx;
  z-index: 1;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333;
}

.file-icon-page {
  position: relative;
  width: 32rpx;
  height: 34rpx;
  box-sizing: border-box;
  border: 3rpx solid currentColor;
  border-radius: 4rpx;
}

.file-icon-corner {
  position: absolute;
  top: -3rpx;
  right: -3rpx;
  width: 14rpx;
  height: 14rpx;
  box-sizing: border-box;
  border-left: 3rpx solid currentColor;
  border-bottom: 3rpx solid currentColor;
}

.file-content {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 64rpx 16rpx 16rpx;
  overflow: hidden;
}

.file-name {
  display: -webkit-box;
  width: 100%;
  max-height: 144rpx;
  overflow: hidden;
  color: #333;
  font-size: 26rpx;
  line-height: 36rpx;
  word-break: break-all;
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.file-size {
  display: block;
  margin-top: 4rpx;
  color: #333;
  font-size: 26rpx;
  line-height: 36rpx;
}

.navbar {
  width: 100%;
  height: 96rpx;
  min-height: 80rpx;
  padding: 0 40rpx;
  box-sizing: border-box;

  display: flex;
  align-items: center;
  gap: 32rpx;

  background-color: #fff;
  color: #333;
}

/* 返回按钮 */
.back-btn {
  flex: none;
  width: 72rpx;
  height: 72rpx;
  padding: 0;
  margin: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border: none;
  background: transparent;
  color: #333;
}

/* 去掉 button 默认样式 */
.back-btn::after {
  border: none;
}

.icon {
  width: 48rpx;
  height: 48rpx;

  display: flex;
  align-items: center;
  justify-content: center;
}

/* 标题区域 */
.title-wrapper {
  flex: 1;
  min-width: 0;
  width: 0;
}

.title {
  display: block;
  width: 100%;

  font-size: 36rpx;
  font-weight: 700;
  line-height: 1.4;

  text-align: left;
  color: #333;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 右侧占位 */
.placeholder {
  width: 96rpx;
  height: 96rpx;
  flex: none;
  visibility: hidden;
}
</style>
