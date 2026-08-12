const PROFILE_SAVE_SUCCESS_KEY = 'profile_save_success'

/** 子页保存成功后标记，返回 profile 页时展示成功提示 */
export function markProfileSaveSuccess() {
  uni.setStorageSync(PROFILE_SAVE_SUCCESS_KEY, '1')
}

/** 读取并清除标记，仅返回一次 true */
export function consumeProfileSaveSuccess(): boolean {
  const flag = uni.getStorageSync(PROFILE_SAVE_SUCCESS_KEY)
  if (flag) {
    uni.removeStorageSync(PROFILE_SAVE_SUCCESS_KEY)
    return true
  }
  return false
}

const SECURITY_SAVE_SUCCESS_KEY = 'security_save_success'

/** 重置密码成功后标记，返回安全页时展示成功提示 */
export function markSecuritySaveSuccess() {
  uni.setStorageSync(SECURITY_SAVE_SUCCESS_KEY, '1')
}

export function consumeSecuritySaveSuccess(): boolean {
  const flag = uni.getStorageSync(SECURITY_SAVE_SUCCESS_KEY)
  if (flag) {
    uni.removeStorageSync(SECURITY_SAVE_SUCCESS_KEY)
    return true
  }
  return false
}
