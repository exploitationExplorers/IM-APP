/**
 * 新消息提示音与震动。
 *
 * 多端兼容策略（与 components/ChatBubble.vue 的语音播放保持一致）：
 * - App 端：用 uni.createInnerAudioContext 播放本地 static 资源（最稳）。
 * - H5 / 小程序端：优先用 Web Audio 振荡器合成短促提示音（无需依赖二进制资源，
 *   且在 HTTPS/localhost 下一定能响）；若环境不支持 Web Audio，则回退到
 *   uni.createInnerAudioContext 加载 static 下的 wav。
 *
 * 提示音资源：/static/sound/message.wav
 */

const SOUND_SRC = '/static/sound/message.wav'

function isAppPlatform(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'app'
  } catch {
    return false
  }
}

let audioCtx: AudioContext | null = null

/** H5 下用 Web Audio 合成两声"叮咚"，不依赖任何外部资源 */
function beepByWebAudio(): boolean {
  if (typeof window === 'undefined') return false
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return false
  try {
    if (!audioCtx) audioCtx = new Ctor()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()

    const playTone = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = ctx.currentTime + at
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + dur + 0.02)
    }
    // 第一声 880Hz、第二声 1174.66Hz（A5），间隔 0.16s
    playTone(880, 0, 0.16)
    playTone(1174.66, 0.16, 0.16)
    return true
  } catch {
    return false
  }
}

/** App 端用原生音频上下文播放 static 资源 */
function playByInnerAudio(): boolean {
  const inner = (uni as unknown as { createInnerAudioContext?: () => any }).createInnerAudioContext
  if (typeof inner !== 'function') return false
  try {
    const ctx = inner()
    ctx.src = SOUND_SRC
    ctx.onError?.(() => undefined)
    ctx.play?.()
    return true
  } catch {
    return false
  }
}

/** 收到新消息时调用：播放提示音。多端自动选择可用通道 */
export function playMessageSound(): void {
  if (isAppPlatform()) {
    if (playByInnerAudio()) return
    if (beepByWebAudio()) return
    return
  }
  // H5 / 小程序：优先 Web Audio 保证一定能响，再回退 inner audio
  if (beepByWebAudio()) return
  playByInnerAudio()
}

/** 震动反馈：仅 Android 端有效，iOS 不支持，需调用方自行按开关判断 */
export function vibrateShort(): void {
  try {
    const v = (uni as unknown as { vibrateShort?: (o?: unknown) => void }).vibrateShort
    if (typeof v === 'function') {
      v({ type: 'light', fail: () => undefined })
    }
  } catch {
    /* 平台不支持时静默 */
  }
}
