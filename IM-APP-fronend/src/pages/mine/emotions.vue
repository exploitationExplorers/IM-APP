<script setup lang="ts">
import { ref, computed } from 'vue'

// 状态栏高度适配
const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20

// 状态
const isEditMode = ref(false)
const emotions = ref<{ id: string; url: string }[]>([])
const selectedIds = ref<string[]>([])

// 计算属性
const hasSelected = computed(() => selectedIds.value.length > 0)

// 返回上一页
function goBack() {
  uni.navigateBack()
}

// 切换编辑模式
function toggleEdit() {
  isEditMode.value = !isEditMode.value
  if (!isEditMode.value) {
    selectedIds.value = [] // 退出时清空选中
  }
}

// 上传图片
function onUpload() {
  if (isEditMode.value) return // 编辑模式下禁止上传（可选，这里看需求，我们选择禁止）
  
  uni.chooseImage({
    count: 9, // 允许一次多选
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      // res.tempFiles 包含文件的详细信息（H5等平台可能依赖扩展名）
      // res.tempFilePaths 就是图片路径数组
      const tempFiles = res.tempFiles as unknown as { path: string; name?: string; type?: string }[]
      const paths = res.tempFilePaths as string[]
      
      // 过滤只允许的图片格式
      const validImageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
      const validPaths: string[] = []
      let hasInvalidFile = false

      paths.forEach((path, index) => {
        const file = tempFiles?.[index]
        const fileName = file?.name || path
        
        // 判断扩展名或 MIME 类型（针对 H5 等特殊情况）
        const extMatch = fileName.toLowerCase().match(/\.[0-9a-z]+$/i)
        const ext = extMatch ? extMatch[0] : ''
        if (
          (ext && validImageExtensions.includes(ext)) || 
          (file?.type && file.type.startsWith('image/')) ||
          (ext && !validImageExtensions.includes(ext)) 
        ) {
          if (ext && !validImageExtensions.includes(ext)) {
             hasInvalidFile = true
          } else {
             validPaths.push(path)
          }
        } else {
           validPaths.push(path)
        }
      })

      if (hasInvalidFile) {
        uni.showToast({ title: '仅支持上传图片格式', icon: 'none' })
        if (validPaths.length === 0) return
      }
      uni.showLoading({ title: '上传中...' })
      setTimeout(() => {
        const newEmotions = validPaths.map((path) => ({
          id: Math.random().toString(36).substring(2),
          url: path
        }))
        emotions.value.push(...newEmotions)
        uni.hideLoading()
        uni.showToast({ title: '上传成功', icon: 'success' })
      }, 800)
    },
    fail: () => {
      // 取消选择等情况
    }
  })
}

// 点击图片
function onEmotionClick(item: { id: string; url: string }) {
  if (isEditMode.value) {
    // 编辑模式下切换选中状态
    const index = selectedIds.value.indexOf(item.id)
    if (index > -1) {
      selectedIds.value.splice(index, 1)
    } else {
      selectedIds.value.push(item.id)
    }
  } else {
    // 普通模式下可以预览大图
    uni.previewImage({
      urls: emotions.value.map(e => e.url),
      current: item.url
    })
  }
}

// 删除选中图片
function onDelete() {
  if (!hasSelected.value) return

  uni.showModal({
    title: '提示',
    content: `确定删除这 ${selectedIds.value.length} 个表情吗？`,
    confirmColor: '#ff4d4f',
    success: (res) => {
      if (res.confirm) {
        uni.showLoading({ title: '删除中...' })
        setTimeout(() => {
          emotions.value = emotions.value.filter(e => !selectedIds.value.includes(e.id))
          selectedIds.value = []
          uni.hideLoading()
          uni.showToast({ title: '已删除', icon: 'success' })
          
          if (emotions.value.length === 0) {
            isEditMode.value = false
          }
        }, 500)
      }
    }
  })
}
</script>

<template>
  <view class="page">
    <!-- 自定义导航栏 -->
    <view class="nav-bar-wrap">
      <view class="status-bar" :style="{ height: statusBarHeight + 'px' }"></view>
      <view class="nav-bar">
        <view class="nav-left" >
          <text class="back-icon" @click="goBack">‹</text>
          <text class="title">我的表情</text>
        </view>
        <view class="nav-right" @click="toggleEdit">
          <view class="edit-btn" :class="{ 'cancel-btn': isEditMode }">
            {{ isEditMode ? '取消' : '编辑' }}
          </view>
        </view>
      </view>
    </view>

    <!-- 主体内容 -->
    <scroll-view scroll-y class="content" :class="{ 'has-bottom-bar': isEditMode }">
      <view class="grid-container">
        <!-- 添加按钮 -->
        <view class="emotion-item add-btn-wrap" @click="onUpload" v-if="!isEditMode">
          <view class="add-btn">
            <text class="add-icon">+</text>
          </view>
        </view>

        <!-- 图片列表 -->
        <view 
          class="emotion-item" 
          v-for="item in emotions" 
          :key="item.id"
          @click="onEmotionClick(item)"
        >
          <image class="emotion-img" :src="item.url" mode="aspectFill" />
          
          <!-- 编辑模式下的复选框 -->
          <view class="checkbox-wrap" v-if="isEditMode">
            <view class="checkbox" :class="{ checked: selectedIds.includes(item.id) }">
              <view v-if="selectedIds.includes(item.id)" class="check-mark"></view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 底部删除操作栏 -->
    <view class="bottom-bar" v-if="isEditMode">
      <view 
        class="delete-btn" 
        :class="{ active: hasSelected }"
        @click="onDelete"
      >
        删除
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
}

/* 导航栏样式 */
.nav-bar-wrap {
  background: #ffffff;
  position: sticky;
  top: 0;
  z-index: 100;
}
.nav-bar {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32rpx;
}
.nav-left {
  display: flex;
  align-items: center;
  height: 100%;
}
.back-icon {
  font-size: 56rpx;
  color: #333;
  margin-right: 8rpx;
  font-weight: 300;
  margin-top: -4rpx;
}
.title {
  font-size: 34rpx;
  font-weight: 600;
  color: #000;
}
.nav-right {
  height: 100%;
  display: flex;
  align-items: center;
}
.edit-btn {
  font-size: 28rpx;
  color: #333;
  padding: 8rpx 16rpx;
  border-radius: 8rpx;
}
.edit-btn.cancel-btn {
  background: #f5f6f8;
}

/* 主体内容 */
.content {
  flex: 1;
  width: 100%;
  box-sizing: border-box;
  padding: 32rpx;
  /* 如果有底部栏，增加底部内边距防止遮挡 */
}
.content.has-bottom-bar {
  padding-bottom: calc(140rpx + env(safe-area-inset-bottom));
}

/* 网格布局 */
.grid-container {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20rpx;
}

.emotion-item {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12rpx;
  position: relative;
  overflow: hidden;
  background: #f5f6f8;
}

.emotion-img {
  width: 100%;
  height: 100%;
  display: block;
}

/* 添加按钮 */
.add-btn-wrap {
  background: transparent;
}
.add-btn {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 2rpx dashed #a0a5b3;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.add-icon {
  font-size: 50rpx;
  color: #a0a5b3;
  font-weight: 300;
}

/* 复选框 */
.checkbox-wrap {
  position: absolute;
  top: 0;
  right: 0;
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 8rpx;
  box-sizing: border-box;
  background: linear-gradient(to bottom left, rgba(0,0,0,0.2), transparent);
}
.checkbox {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  border: 2rpx solid #ffffff;
  background: rgba(0, 0, 0, 0.3);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.checkbox.checked {
  background: #0A2FC2;
  border-color: #0A2FC2;
}
.check-mark {
  width: 10rpx;
  height: 18rpx;
  border-right: 3rpx solid #fff;
  border-bottom: 3rpx solid #fff;
  transform: rotate(45deg);
  margin-bottom: 4rpx;
}

/* 底部操作栏 */
.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 20rpx 32rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  box-sizing: border-box;
  border-top: 1rpx solid #f0f0f0;
}
.delete-btn {
  width: 100%;
  height: 88rpx;
  background: #e5e5e5;
  color: #999999;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  font-weight: 500;
  transition: all 0.3s;
}
.delete-btn.active {
  background: #ff4d4f;
  color: #ffffff;
}
</style>
