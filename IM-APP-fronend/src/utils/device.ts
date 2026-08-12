const DEVICE_ID_KEY = 'im_device_id'

/** 获取稳定的本机设备 ID，供认证与会话绑定使用 */
export function getDeviceId(): string {
  let id = uni.getStorageSync(DEVICE_ID_KEY) as string
  if (id) return id

  id = `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

  // #ifdef APP-PLUS
  try {
    const info = uni.getSystemInfoSync()
    const platform = info.platform || 'app'
    const model = (info.model || 'device').replace(/\s+/g, '_')
    id = `${platform}_${model}_${Date.now().toString(36)}`
  } catch {
    // 兜底使用上方生成的 id
  }
  // #endif

  uni.setStorageSync(DEVICE_ID_KEY, id)
  return id
}
