<script setup lang="ts">
import { getCurrentInstance, ref } from "vue";
import EmptyState from "@/components/EmptyState.vue";

const tab = ref<"all" | "text" | "media" | "file" | "voice">("all");
const tabs = [
  { key: "all" as const, label: "全部" },
  { key: "text" as const, label: "文字" },
  { key: "media" as const, label: "图片与视频" },
  { key: "file" as const, label: "文件" },
  { key: "voice" as const, label: "语音" },
];

const list = ref([
  {
    id: 192657,
    type: "text",
    content: "你是谁",
  },
  {
    id: 192815,
    type: "file",
    name: "Activation Import Template.xlsx",
    size: "14.7KB",
  },
  {
    id: 192656,
    type: "voice",
    duration: "0:02",
    wave: [3.4, 11, 3.7, 7.4, 12.4, 4.1, 13.9, 19.3],
  },
  {
    id: 192655,
    type: "image",
    url: "https://mo6if.ey3177.com/66CHAT/1786500774509/3244/png_445609_20260812101254.png?h=1200&w=800",
  },
]);

const activeMenuId = ref<number | null>(null);
const activeMenuItem = ref<any | null>(null);
const menuStyle = ref<Record<string, string>>({});
const instance = getCurrentInstance();

const MENU_WIDTH_RPX = 176;
const MENU_OFFSET_RPX = 8;
const VIEWPORT_PADDING_RPX = 16;

const toDesignUnit = (value: number) => {
  const { windowWidth } = uni.getSystemInfoSync();
  return (value * 750) / windowWidth;
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

const updateMenuPosition = (item: any, event: any) => {
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
        top: `${topRpx}rpx`,
        left: `${leftRpx}rpx`,
        maxHeight: `${maxHeightRpx}rpx`,
      };
    })
    .exec();
};

const handleClick = (item: any) => {
  closeMenu();
  console.log("点击：", item);

  // 如果需要跳转
  // uni.navigateTo({
  //   url: `/pages/collections/detail?id=${item.id}`
  // })
};

const handleMore = (item: any, event: any) => {
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

const handleAction = (type: "forward" | "copy" | "delete", item: any) => {
  closeMenu();
  console.log("菜单操作：", type, item);
};
</script>

<template>
  <view class="page">
    <view class="tab-list">
      <view
        v-for="item in tabs"
        :key="item.key"
        class="tab-item"
        :class="{ active: tab === item.key }"
        @click="tab = item.key"
      >
        {{ item.label }}
      </view>
    </view>
    <!-- <EmptyState text="无收藏" /> -->

    <!-- 内容滚动区域 -->
    <scroll-view class="content-scroll" scroll-y :show-scrollbar="false">
      <view class="content">
        <!-- 分组 -->
        <view class="collection-section">
          <!-- 标题 -->
          <view class="collection-header">
            <text class="collection-title"> 妲己把茶倒你嘴你 </text>
            <text class="collection-date"> 今日 </text>
          </view>
          <!-- 横向滚动 -->
          <scroll-view class="card-scroll" scroll-x :show-scrollbar="false">
            <view class="card-list">
              <!-- 文字卡片 -->
              <view
                class="card"
                v-for="(item, index) in list"
                :key="index"
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
                <template v-if="item.type === 'text'">
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
                        {{ item.name }}
                      </text>
                      <text class="file-size">
                        {{ item.size }}
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
                          v-for="(height, i) in item.wave"
                          :key="i"
                          class="wave-line"
                          :style="{ height: height * 2 + 'rpx' }"
                        />
                      </view>

                      <!-- 时长 -->
                      <text class="voice-time">
                        {{ item.duration }}
                      </text>
                    </view>
                  </view>
                </template>

                <!-- 图片 -->
                <template v-else-if="item.type === 'image'">
                  <view class="image-card">
                    <image class="image" :src="item.url" mode="aspectFill" />

                    <!-- 图片类型图标 -->
                    <view class="image-icon">
                      <text>▧</text>
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
  margin: 32rpx 0;
}

.tab-item {
  height: 68rpx;
  box-sizing: border-box;
  border-bottom: 4rpx solid transparent;

  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
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
  width: 246rpx;
  height: 246rpx;
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
</style>
