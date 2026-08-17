import { registerPushToken, unregisterPushToken } from '@/api/im'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { getDeviceId } from '@/utils/device'
import { getPushDeviceToken, getPushPlatform } from '@/utils/notification-permission'
import { getToken } from '@/utils/request'

const PUSH_TOKEN_KEY = 'im_push_device_token'

function savedToken(): string {
  const raw = uni.getStorageSync(PUSH_TOKEN_KEY)
  return typeof raw === 'string' ? raw : ''
}

/** 登录后或打开「新消息通知」时登记设备；未登录 / Redis 失败不打断主流程。 */
export async function syncPushRegistration(): Promise<void> {
  if (!getToken()) return
  const settings = useChatSettingsStore()
  if (!settings.message || settings.noDisturb) {
    await unregisterPushRegistration()
    return
  }
  const deviceToken = (await getPushDeviceToken()) || getDeviceId()
  if (!deviceToken) return
  const { platform, channel } = getPushPlatform()
  try {
    await registerPushToken({
      platform,
      channel: channel || undefined,
      deviceToken,
      enabled: true,
    })
    uni.setStorageSync(PUSH_TOKEN_KEY, deviceToken)
  } catch {
    /* 推送登记失败不影响聊天 */
  }
}

export async function unregisterPushRegistration(): Promise<void> {
  const deviceToken = savedToken() || getDeviceId()
  if (!deviceToken || !getToken()) {
    uni.removeStorageSync(PUSH_TOKEN_KEY)
    return
  }
  try {
    await unregisterPushToken(deviceToken)
  } catch {
    /* 退出时服务端撤销失败忽略 */
  }
  uni.removeStorageSync(PUSH_TOKEN_KEY)
}
