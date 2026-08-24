import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

import {
  DESKTOP_BREAKPOINT,
  DESKTOP_LIST_WIDTH,
  DESKTOP_SIDEBAR_WIDTH,
} from '@/composables/useDesktopLayout'

export const DESKTOP_LIST_MIN_WIDTH = 280
export const DESKTOP_LIST_MAX_WIDTH = 560
export const DESKTOP_ROOM_MIN_WIDTH = 360
export const DESKTOP_LIST_WIDTH_KEY = 'im-desktop-list-width'

function readSavedWidth(): number {
  if (typeof localStorage === 'undefined') return DESKTOP_LIST_WIDTH
  const raw = localStorage.getItem(DESKTOP_LIST_WIDTH_KEY)
  if (!raw) return DESKTOP_LIST_WIDTH
  const n = Number(raw)
  return Number.isFinite(n) ? n : DESKTOP_LIST_WIDTH
}

function clampListWidth(width: number, viewportWidth = window.innerWidth): number {
  const maxByRoom = viewportWidth - DESKTOP_SIDEBAR_WIDTH - DESKTOP_ROOM_MIN_WIDTH - 8
  const max = Math.min(DESKTOP_LIST_MAX_WIDTH, maxByRoom)
  return Math.max(DESKTOP_LIST_MIN_WIDTH, Math.min(max, width))
}

export function useDesktopListResize(isDesktop: Ref<boolean>) {
  const listWidth = ref(DESKTOP_LIST_WIDTH)
  const isResizing = ref(false)

  function syncWidth() {
    listWidth.value = clampListWidth(listWidth.value)
  }

  function persistWidth() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(DESKTOP_LIST_WIDTH_KEY, String(listWidth.value))
  }

  function onResizeStart(event: MouseEvent) {
    if (!isDesktop.value || typeof window === 'undefined') return
    event.preventDefault()
    isResizing.value = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.documentElement.classList.add('im-desktop-resizing')

    const onMove = (ev: MouseEvent) => {
      listWidth.value = clampListWidth(ev.clientX - DESKTOP_SIDEBAR_WIDTH)
    }

    const onUp = () => {
      isResizing.value = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.documentElement.classList.remove('im-desktop-resizing')
      persistWidth()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    onMove(event)
  }

  onMounted(() => {
    listWidth.value = clampListWidth(readSavedWidth())
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', syncWidth)
    }
  })

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', syncWidth)
    }
    if (typeof document !== 'undefined') {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.documentElement.classList.remove('im-desktop-resizing')
    }
  })

  watch(isDesktop, (enabled) => {
    if (enabled) syncWidth()
  })

  return { listWidth, isResizing, onResizeStart }
}

export function isDesktopViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT
}
