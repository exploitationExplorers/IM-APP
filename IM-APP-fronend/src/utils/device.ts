import { requirePrivacyConsent } from '@/utils/privacy-consent'

const DEVICE_ID_KEY = 'im_device_id'

/** 获取稳定的本机设备 ID，供认证与会话绑定使用 */
export function getDeviceId(): string {
  requirePrivacyConsent()
  let id = uni.getStorageSync(DEVICE_ID_KEY) as string
  if (id) return id

  id = `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

  uni.setStorageSync(DEVICE_ID_KEY, id)
  return id
}
