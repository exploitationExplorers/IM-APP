import { computed, ref, watch } from 'vue'
import { avatarThumbnailUrl } from '@/utils/chatMediaUrl'

/**
 * 头像加载顺序：128px 缩略图 → 原图 → 默认头像。
 * 原头像已经无法再缩小时直接走默认值，避免对同一失败地址重复请求。
 */
export function useAvatarThumbnail(
  source: () => string | undefined,
  fallback: string,
) {
  const stage = ref<0 | 1 | 2>(0)
  const original = computed(() => String(source() || '').trim())
  const originalOrFallback = computed(() => original.value || fallback)
  const thumbnail = computed(() => avatarThumbnailUrl(originalOrFallback.value))
  const src = computed(() => {
    if (stage.value === 0) return thumbnail.value
    if (stage.value === 1) return originalOrFallback.value
    return fallback
  })

  watch(original, () => {
    stage.value = 0
  })

  function onError() {
    if (
      stage.value === 0 &&
      originalOrFallback.value !== fallback &&
      thumbnail.value !== originalOrFallback.value
    ) {
      stage.value = 1
      return
    }
    stage.value = 2
  }

  return { src, onError }
}
