function pointFrom(x?: unknown, y?: unknown): { x: number; y: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const px = Number(x)
  const py = Number(y)
  // 0,0 基本是无效锚点，交给菜单默认居中
  if (px <= 0 && py <= 0) return null
  return { x: px, y: py }
}

type TouchLike = {
  clientX?: number
  clientY?: number
  pageX?: number
  pageY?: number
  screenX?: number
  screenY?: number
}

function pointFromTouch(touch: TouchLike): { x: number; y: number } | null {
  return (
    pointFrom(touch.clientX, touch.clientY) ||
    pointFrom(touch.pageX, touch.pageY) ||
    pointFrom(touch.screenX, touch.screenY)
  )
}

/**
 * uni-app longpress 的 touches 经常只有 pageX/pageY（没有 clientX），
 * 旧逻辑只读 clientX → 拿不到坐标 → 菜单掉到屏幕正中间。
 */
export function resolveMenuPoint(event?: unknown): { x: number; y: number } | null {
  if (!event || typeof event !== 'object') return null
  const ev = event as Record<string, unknown>
  const touches = (ev.touches || ev.changedTouches) as TouchLike[] | undefined
  const fromTouch = touches?.[0] ? pointFromTouch(touches[0]) : null
  if (fromTouch) return fromTouch

  const fromEv = pointFrom(ev.clientX, ev.clientY) || pointFrom(ev.pageX, ev.pageY)
  if (fromEv) return fromEv

  const detail = ev.detail as { x?: number; y?: number; clientX?: number; clientY?: number } | undefined
  if (!detail) return null
  return pointFrom(detail.clientX, detail.clientY) || pointFrom(detail.x, detail.y)
}
