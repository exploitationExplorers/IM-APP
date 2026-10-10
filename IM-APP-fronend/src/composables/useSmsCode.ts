import { ref } from 'vue'
import { onUnload } from '@dcloudio/uni-app'
import { sendSmsCode } from '@/api/auth'
import { findCountryByDialCode, validatePhone } from '@/constants/countries'
import type { SmsScene } from '@/types'

/**
 * 「获取验证码」在注册、找回密码两个页面是同一套逻辑：
 * 校验手机号 → 发码 → 按服务端返回的间隔倒计时。
 *
 * 抽出来既避免两处各写一遍，也把倒计时统一在这里清理 —— 否则用户发完码
 * 直接离开页面，计时器会一直跑下去。
 */
export function useSmsCode(scene: SmsScene) {
  const countdown = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  function stopCountdown() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function startCountdown(seconds: number) {
    countdown.value = seconds > 0 ? seconds : 60
    stopCountdown()
    timer = setInterval(() => {
      if (countdown.value > 0) countdown.value -= 1
      if (countdown.value <= 0) stopCountdown()
    }, 1000)
  }

  /** 手机号不合法时按当前国家码提示正确格式，返回 false */
  function checkPhone(countryCode: string, phone: string): boolean {
    if (!validatePhone(countryCode, phone)) {
      uni.showToast({ title: findCountryByDialCode(countryCode).placeholder, icon: 'none' })
      return false
    }
    return true
  }

  /** 发码。成功返回 true；倒计时中、手机号不合法或发送失败都返回 false（并已提示） */
  async function send(countryCode: string, phone: string): Promise<boolean> {
    if (countdown.value > 0) return false
    if (!checkPhone(countryCode, phone)) return false
    try {
      const res = await sendSmsCode(phone, scene, countryCode)
      uni.showToast({ title: '验证码已发送', icon: 'none' })
      startCountdown(res.retryAfterSec || 60)
      return true
    } catch (e) {
      uni.showToast({ title: (e as Error).message, icon: 'none' })
      return false
    }
  }

  onUnload(stopCountdown)

  return { countdown, startCountdown, stopCountdown, send, checkPhone }
}
