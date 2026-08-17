export type NotificationAuthStatus = 'authorized' | 'denied' | 'notDetermined'

function isAppPlatform(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'app'
  } catch {
    return false
  }
}

/** 当前系统通知权限。H5 用 Notification API，App 用 getAppAuthorizeSetting。 */
export function getNotificationAuthStatus(): NotificationAuthStatus {
  if (!isAppPlatform() && typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') return 'authorized'
    if (Notification.permission === 'denied') return 'denied'
    return 'notDetermined'
  }
  try {
    const setting = uni.getAppAuthorizeSetting?.()
    const raw = setting?.notificationAuthorized
    if (raw === 'authorized') return 'authorized'
    if (raw === 'denied') return 'denied'
  } catch {
    /* 旧基座可能没有该 API */
  }
  return 'notDetermined'
}

/** 还没问过系统、且当前环境能弹出授权时才出自定义询问。 */
export function canPromptNotificationPermission(): boolean {
  if (!isAppPlatform() && typeof Notification === 'undefined') return false
  return getNotificationAuthStatus() === 'notDetermined'
}

function requestAndroidPostNotifications(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = plus?.android?.requestPermissions
    if (!request) {
      resolve(true)
      return
    }
    request(
      ['android.permission.POST_NOTIFICATIONS'],
      (result) => {
        const granted = result.granted || []
        resolve(granted.includes('android.permission.POST_NOTIFICATIONS'))
      },
      () => resolve(false),
    )
  })
}

function requestWebNotification(): Promise<boolean> {
  if (typeof Notification === 'undefined') return Promise.resolve(false)
  if (Notification.permission === 'granted') return Promise.resolve(true)
  if (Notification.permission === 'denied') return Promise.resolve(false)
  return Notification.requestPermission().then((p) => p === 'granted')
}

/**
 * 弹出系统通知授权（需在用户点击「确认」之后调用）。
 * Android 13+ 要 POST_NOTIFICATIONS；H5 走 Notification.requestPermission；
 * iOS 在后续 getPushClientId 时由系统询问。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isAppPlatform()) {
    return requestWebNotification()
  }
  const info = uni.getSystemInfoSync()
  const os = (info.osName || info.platform || '').toLowerCase()
  if (os.includes('android')) {
    return requestAndroidPostNotifications()
  }
  return getNotificationAuthStatus() !== 'denied'
}

export function getPushPlatform(): { platform: 'ios' | 'android' | 'web'; channel: string } {
  if (!isAppPlatform()) return { platform: 'web', channel: '' }
  const os = (uni.getSystemInfoSync().osName || uni.getSystemInfoSync().platform || '').toLowerCase()
  if (os.includes('ios')) return { platform: 'ios', channel: 'apns' }
  return { platform: 'android', channel: 'fcm' }
}

/** 优先厂商推送 clientId；没有 uni-push 时用本机 deviceId，至少能向后端登记开关。 */
export async function getPushDeviceToken(): Promise<string | null> {
  type PushClientIdFn = (opts: {
    success?: (res: { cid?: string }) => void
    fail?: () => void
  }) => void
  const getter = (uni as unknown as { getPushClientId?: PushClientIdFn }).getPushClientId
  if (typeof getter === 'function') {
    const cid = await new Promise<string | null>((resolve) => {
      getter({
        success: (res) => resolve(res.cid || null),
        fail: () => resolve(null),
      })
    })
    if (cid) return cid
  }
  try {
    const { getDeviceId } = await import('@/utils/device')
    return getDeviceId()
  } catch {
    return null
  }
}
