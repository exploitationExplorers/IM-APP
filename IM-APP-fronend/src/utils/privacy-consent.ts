import { APP_CONFIG } from '@/config'

export const PRIVACY_CONSENT_KEY = 'im_privacy_consent_v1'
// 正式法律文本更新时同步更新版本，以便重新征求同意。
const CONSENT_VERSION = '2026-10-26'

export function hasPrivacyConsent(): boolean {
  if (!APP_CONFIG.appStore) return true
  return uni.getStorageSync(PRIVACY_CONSENT_KEY) === CONSENT_VERSION
}

export function acceptPrivacyConsent(): void {
  uni.setStorageSync(PRIVACY_CONSENT_KEY, CONSENT_VERSION)
}

export function requirePrivacyConsent(): void {
  if (!hasPrivacyConsent()) throw new Error('请先阅读并同意隐私政策与用户协议')
}
